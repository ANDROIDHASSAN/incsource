// In-memory store — used automatically when MONGODB_URI is not set.
// Same interface as mongoStore so nothing downstream knows the difference.
import { normalizeFilters, matchesFilters } from '../services/candidateFilters.js';

export const PIPELINE_STAGES = ['New', 'Shortlisted', 'Contacted', 'Interviewing', 'Hired', 'Rejected'];
const EDITABLE = ['status', 'starred', 'notes', 'tags'];

let seq = 1;
let segSeq = 1;
let tplSeq = 1;
const candidates = new Map(); // id -> candidate
const byDedupe = new Map(); // dedupeKey -> id
const runs = [];
const segments = [];
const templates = [];

const clone = (o) => JSON.parse(JSON.stringify(o));

// Dedupe keys are unique PER TENANT — two orgs may legitimately hold the same
// LinkedIn profile, each with their own pipeline state.
const dkey = (orgId, dedupeKey) => `${orgId || '_'}::${dedupeKey}`;
// A record is visible to a caller only when org scope matches (no scope = internal).
const inOrg = (rec, orgId) => !orgId || rec?.orgId === orgId;

function workflowDefaults() {
  return { status: 'New', starred: false, notes: '', tags: [], lastContactedAt: null, outreachCount: 0, outreachLog: [] };
}

export const memoryStore = {
  kind: 'memory',

  // No legacy data to migrate — the in-memory store is fresh each process.
  async migrateTenancy() { return { migrated: 0 }; },

  async upsertCandidates(list) {
    let inserted = 0;
    let updated = 0;
    const ids = [];
    for (const c of list) {
      const existingId = byDedupe.get(dkey(c.orgId, c.dedupeKey));
      if (existingId) {
        const prev = candidates.get(existingId);
        // Re-sourcing must NEVER clobber recruiter workflow state.
        const merged = {
          ...prev,
          ...c,
          id: prev.id,
          email: c.email || prev.email,
          phone: c.phone || prev.phone,
          sources: Array.from(new Set([...(prev.sources || [prev.source]), c.source])),
          activeScore: Math.max(prev.activeScore || 0, c.activeScore || 0),
          openToWork: Boolean(prev.openToWork || c.openToWork), // OR-merge, never reset
          appliedToJob: c.appliedToJob || prev.appliedToJob,
          status: prev.status,
          starred: prev.starred,
          notes: prev.notes,
          tags: prev.tags,
          createdAt: prev.createdAt,
          updatedAt: new Date().toISOString(),
        };
        candidates.set(existingId, merged);
        ids.push(existingId);
        updated++;
      } else {
        const id = String(seq++);
        const now = new Date().toISOString();
        candidates.set(id, { ...workflowDefaults(), ...c, id, sources: [c.source], createdAt: now, updatedAt: now });
        byDedupe.set(dkey(c.orgId, c.dedupeKey), id);
        ids.push(id);
        inserted++;
      }
    }
    return { inserted, updated, ids };
  },

  async listCandidates(params = {}) {
    const f = normalizeFilters(params);
    const idSet = f.ids.length ? new Set(f.ids) : null;
    let items = [...candidates.values()].filter((c) => (!idSet || idSet.has(c.id)) && matchesFilters(c, f));

    const desc = f.sort.startsWith('-');
    const key = f.sort.replace(/^-/, '');
    items.sort((a, b) => {
      const av = a[key] ?? 0;
      const bv = b[key] ?? 0;
      if (typeof av === 'string' || typeof bv === 'string') {
        return desc ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
      }
      return desc ? bv - av : av - bv;
    });

    const total = items.length;
    const page = items.slice(f.offset, f.offset + f.limit);
    return { candidates: clone(page), total };
  },

  async getCandidate(id, orgId) {
    const c = candidates.get(String(id));
    return c && inOrg(c, orgId) ? clone(c) : null;
  },

  async updateCandidate(id, patch, orgId) {
    const c = candidates.get(String(id));
    if (!c || !inOrg(c, orgId)) return null;
    for (const k of EDITABLE) if (k in patch) c[k] = patch[k];
    c.updatedAt = new Date().toISOString();
    return clone(c);
  },

  async bulkUpdate(ids, patch, orgId) {
    let n = 0;
    for (const id of ids) if (await this.updateCandidate(id, patch, orgId)) n++;
    return n;
  },

  // Recompute active-intent score for every candidate with the current model
  // (scoreFn). Mirrors mongoStore.rescoreAll; workflow fields are left intact.
  async rescoreAll(scoreFn, orgId) {
    let n = 0;
    for (const c of candidates.values()) {
      if (!inOrg(c, orgId)) continue;
      const { activeScore, scoreBreakdown, rawSignals } = scoreFn(clone(c));
      c.activeScore = activeScore;
      c.scoreBreakdown = scoreBreakdown;
      c.rawSignals = rawSignals;
      n++;
    }
    return { rescored: n };
  },

  async setContact(id, { email, phone }, orgId) {
    const c = candidates.get(String(id));
    if (!c || !inOrg(c, orgId)) return null;
    if (email) c.email = email;
    if (phone) c.phone = phone;
    c.updatedAt = new Date().toISOString();
    return clone(c);
  },

  async recordOutreach(id, { channel, subject }, orgId) {
    const c = candidates.get(String(id));
    if (!c || !inOrg(c, orgId)) return null;
    c.outreachLog = [{ channel, subject, at: new Date().toISOString() }, ...(c.outreachLog || [])].slice(0, 50);
    c.outreachCount = (c.outreachCount || 0) + 1;
    c.lastContactedAt = new Date().toISOString();
    if (c.status === 'New' || c.status === 'Shortlisted') c.status = 'Contacted';
    c.updatedAt = new Date().toISOString();
    return clone(c);
  },

  async deleteCandidate(id, orgId) {
    const c = candidates.get(String(id));
    if (!c || !inOrg(c, orgId)) return false;
    candidates.delete(String(id));
    byDedupe.delete(dkey(c.orgId, c.dedupeKey));
    return true;
  },

  async bulkDelete(ids, orgId) {
    let n = 0;
    for (const id of ids) if (await this.deleteCandidate(id, orgId)) n++;
    return n;
  },

  async stats(params = {}) {
    const f = normalizeFilters(params);
    const items = [...candidates.values()].filter((c) => c.recordType !== 'job-lead' && inOrg(c, f.orgId));
    return {
      total: items.length,
      openToWork: items.filter((c) => c.openToWork).length,
      hot: items.filter((c) => (c.activeScore || 0) >= 70).length,
      shortlisted: items.filter((c) => c.starred).length,
    };
  },

  async analytics(params = {}) {
    const f = normalizeFilters(params);
    const items = [...candidates.values()].filter((c) => matchesFilters(c, f));
    const tally = (fn) => {
      const m = new Map();
      for (const c of items) for (const v of [].concat(fn(c)).filter(Boolean)) m.set(v, (m.get(v) || 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
    };
    const band = (c) => ((c.activeScore || 0) >= 70 ? 'Hot' : (c.activeScore || 0) >= 40 ? 'Warm' : 'Cold');
    return {
      total: items.length,
      avgScore: items.length ? Math.round(items.reduce((s, c) => s + (c.activeScore || 0), 0) / items.length) : 0,
      openToWork: items.filter((c) => c.openToWork).length,
      byStatus: tally((c) => c.status),
      bySource: tally((c) => c.sources || c.source),
      byBand: tally(band),
      byState: tally((c) => c.state).slice(0, 8),
      bySkill: tally((c) => c.skills).slice(0, 12),
    };
  },

  async facets(params = {}) {
    const f = normalizeFilters(params);
    const items = [...candidates.values()].filter((c) => inOrg(c, f.orgId));
    const tally = (key) => {
      const m = new Map();
      for (const c of items) for (const v of (key === 'skills' ? c.skills || [] : [c[key]]).filter(Boolean)) m.set(v, (m.get(v) || 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
    };
    return { states: tally('state'), cities: tally('city'), sources: tally('source'), skills: tally('skills').slice(0, 40) };
  },

  async saveRun(run) {
    const record = { id: `run-${seq++}`, ...run };
    runs.unshift(record);
    return record;
  },
  async listRuns(limit = 50, orgId) {
    // omit the heavy candidateIds array from the list view
    return runs.filter((r) => inOrg(r, orgId)).slice(0, limit)
      .map(({ candidateIds, ...r }) => ({ ...clone(r), candidateCount: (candidateIds || []).length }));
  },
  async getRun(id, orgId) {
    const r = runs.find((x) => x.id === String(id));
    return r && inOrg(r, orgId) ? clone(r) : null;
  },
  async updateRun(id, patch, orgId) {
    const r = runs.find((x) => x.id === String(id));
    if (!r || !inOrg(r, orgId)) return null;
    if (typeof patch.name === 'string') r.name = patch.name;
    return clone(r);
  },
  async deleteRun(id, orgId) {
    const i = runs.findIndex((x) => x.id === String(id) && inOrg(x, orgId));
    if (i === -1) return false;
    runs.splice(i, 1);
    return true;
  },

  // saved filter segments
  async listSegments(orgId) {
    return clone(segments.filter((s) => inOrg(s, orgId)));
  },
  async saveSegment(name, filters, orgId) {
    const record = { id: String(segSeq++), orgId, name, filters, createdAt: new Date().toISOString() };
    segments.unshift(record);
    return clone(record);
  },
  async deleteSegment(id, orgId) {
    const i = segments.findIndex((s) => s.id === String(id) && inOrg(s, orgId));
    if (i === -1) return false;
    segments.splice(i, 1);
    return true;
  },

  // custom email templates
  async listTemplates(orgId) {
    return clone(templates.filter((t) => inOrg(t, orgId)));
  },
  async saveTemplate({ name, subject, body, orgId }) {
    const t = { id: `custom-${tplSeq++}`, orgId, name, subject, body, custom: true, createdAt: new Date().toISOString() };
    templates.unshift(t);
    return clone(t);
  },
  async updateTemplate(id, patch, orgId) {
    const t = templates.find((x) => x.id === String(id) && inOrg(x, orgId));
    if (!t) return null;
    for (const k of ['name', 'subject', 'body']) if (k in patch) t[k] = patch[k];
    return clone(t);
  },
  async deleteTemplate(id, orgId) {
    const i = templates.findIndex((x) => x.id === String(id) && inOrg(x, orgId));
    if (i === -1) return false;
    templates.splice(i, 1);
    return true;
  },
};
