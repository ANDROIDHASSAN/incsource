// Single source of truth for candidate filtering. Used by BOTH the in-memory
// store (matchesFilters) and the MongoDB store (toMongoQuery) so the two
// backends always behave identically.
import { isIndian } from './geo.js';
import { ZONES } from '../data/indiaGeo.js';

const BANDS = { hot: [70, 100], warm: [40, 69], cold: [0, 39] };

function effectiveStates(f) {
  if (f.states && f.states.length) return f.states;
  if (f.region && ZONES[f.region]) return ZONES[f.region];
  return null;
}

function arr(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}
const bool = (v) => v === true || v === 'true' || v === '1';
const num = (v) => (v === '' || v == null ? undefined : Number(v));
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Only allow sorting on indexed/known fields — prevents unindexed-scan DoS.
const SORTABLE = new Set(['activeScore', 'fitScore', 'fullName', 'createdAt', 'updatedAt', 'noticePeriodDays', 'status']);
function safeSort(s) {
  const field = String(s || '').replace(/^-/, '');
  return SORTABLE.has(field) ? s : '-fitScore';
}

export function normalizeFilters(p = {}) {
  const band = p.band && BANDS[p.band] ? p.band : undefined;
  const [bandMin, bandMax] = band ? BANDS[band] : [];
  return {
    q: p.q ? String(p.q).trim().slice(0, 120) : undefined,
    minScore: band ? bandMin : num(p.minScore),
    maxScore: band ? bandMax : num(p.maxScore),
    sources: arr(p.sources ?? p.source),
    states: arr(p.states ?? p.state),
    cities: arr(p.cities ?? p.city),
    region: p.region && ZONES[p.region] ? p.region : undefined,
    indiaOnly: bool(p.indiaOnly),
    skills: arr(p.skills),
    skillsMatch: p.skillsMatch === 'all' ? 'all' : 'any',
    status: arr(p.status),
    starred: bool(p.starred),
    ids: arr(p.ids),
    recordType: p.recordType,
    includeLeads: bool(p.includeLeads),
    hasEmail: bool(p.hasEmail),
    hasPhone: bool(p.hasPhone),
    openToWork: bool(p.openToWork),
    noticeMaxDays: num(p.noticeMaxDays),
    expMin: num(p.expMin),
    expMax: num(p.expMax),
    workMode: ['remote', 'hybrid', 'onsite'].includes(p.workMode) ? p.workMode : undefined,
    sort: safeSort(p.sort),
    limit: Math.min(Math.max(num(p.limit) || 50, 1), 500),
    offset: Math.max(num(p.offset) || 0, 0),
  };
}

export function matchesFilters(c, f) {
  if (f.q) {
    const hay = [c.fullName, c.headline, c.currentTitle, c.currentCompany, c.location, (c.skills || []).join(' '), (c.tags || []).join(' ')]
      .filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  // Score bands filter on the JD-fit rating (fall back to active-intent when a
  // candidate hasn't been JD-scored yet).
  const rating = c.fitScore != null ? c.fitScore : (c.activeScore || 0);
  if (f.minScore != null && rating < f.minScore) return false;
  if (f.maxScore != null && rating > f.maxScore) return false;
  if (f.sources.length && !(c.sources || [c.source]).some((s) => f.sources.includes(s))) return false;
  const stateList = effectiveStates(f);
  if (stateList && !stateList.map((s) => s.toLowerCase()).includes(String(c.state || '').toLowerCase())) return false;
  if (f.cities.length) {
    const cc = String(c.city || '').toLowerCase();
    if (!f.cities.some((ci) => cc.includes(ci.toLowerCase()))) return false;
  }
  if (f.indiaOnly && !isIndian(c)) return false;
  if (f.skills.length) {
    const have = (c.skills || []).map((s) => s.toLowerCase());
    const want = f.skills.map((s) => s.toLowerCase());
    const test = (w) => have.some((h) => h.includes(w));
    if (f.skillsMatch === 'all' ? !want.every(test) : !want.some(test)) return false;
  }
  if (f.status.length && !f.status.includes(c.status)) return false;
  if (f.starred && !c.starred) return false;
  if (f.recordType && c.recordType !== f.recordType) return false;
  if (!f.includeLeads && !f.recordType && c.recordType === 'job-lead') return false;
  if (f.hasEmail && !c.email) return false;
  if (f.hasPhone && !c.phone) return false;
  if (f.openToWork && !c.openToWork) return false;
  if (f.noticeMaxDays != null && !(c.noticePeriodDays != null && c.noticePeriodDays <= f.noticeMaxDays)) return false;
  // Experience: STRICT segregation — when a band is set, only candidates whose
  // years are KNOWN and inside the band pass (unknown-experience excluded), so
  // "Fresher (0–1)" returns exactly 0–1-yr people, never older or unknown ones.
  if (f.expMin != null || f.expMax != null) {
    if (c.experienceYears == null) return false;
    if (f.expMin != null && c.experienceYears < f.expMin) return false;
    if (f.expMax != null && c.experienceYears > f.expMax) return false;
  }
  // Work mode: keep matches + unknowns, exclude only the clearly-mismatched.
  if (f.workMode && c.workMode && c.workMode !== f.workMode) return false;
  return true;
}

export function toMongoQuery(f) {
  const and = []; // each entry is AND-ed together
  const q = {};

  if (f.q) {
    const rx = { $regex: escapeRx(f.q), $options: 'i' };
    and.push({ $or: [{ fullName: rx }, { headline: rx }, { currentTitle: rx }, { currentCompany: rx }, { location: rx }, { skills: rx }, { tags: rx }] });
  }
  if (f.minScore != null || f.maxScore != null) {
    const range = {};
    if (f.minScore != null) range.$gte = f.minScore;
    if (f.maxScore != null) range.$lte = f.maxScore;
    // Band on fitScore, or activeScore when not yet JD-scored.
    and.push({ $or: [{ fitScore: range }, { fitScore: null, activeScore: range }] });
  }
  // Match memory's `(c.sources || [c.source])` — check both the array and scalar.
  if (f.sources.length) and.push({ $or: [{ sources: { $in: f.sources } }, { source: { $in: f.sources } }] });
  const stateList = effectiveStates(f);
  // Case-insensitive exact state match (memory lowercases both sides).
  if (stateList) q.state = { $in: stateList.map((s) => new RegExp(`^${escapeRx(s)}$`, 'i')) };
  if (f.cities.length) q.city = { $in: f.cities.map((c) => new RegExp(escapeRx(c), 'i')) };
  if (f.indiaOnly) q.countryCode = 'IN';
  if (f.skills.length) {
    const rxs = f.skills.map((s) => ({ skills: { $regex: escapeRx(s), $options: 'i' } }));
    if (f.skillsMatch === 'all') and.push(...rxs);
    else and.push({ $or: rxs }); // skills-any as its own AND group (not merged with text $or)
  }
  if (f.status.length) q.status = { $in: f.status };
  if (f.starred) q.starred = true;
  if (f.recordType) q.recordType = f.recordType;
  else if (!f.includeLeads) q.recordType = { $ne: 'job-lead' };
  if (f.hasEmail) q.email = { $nin: [null, ''] };
  if (f.hasPhone) q.phone = { $nin: [null, ''] };
  if (f.openToWork) q.openToWork = true;
  if (f.noticeMaxDays != null) q.noticePeriodDays = { $lte: f.noticeMaxDays };
  if (f.expMin != null || f.expMax != null) {
    const range = {};
    if (f.expMin != null) range.$gte = f.expMin;
    if (f.expMax != null) range.$lte = f.expMax;
    // STRICT: known year inside the band only (mirrors matchesFilters).
    q.experienceYears = range;
  }
  if (f.workMode) {
    // Matching mode OR unknown — mirrors matchesFilters.
    and.push({ $or: [{ workMode: f.workMode }, { workMode: null }, { workMode: { $exists: false } }] });
  }

  if (and.length) q.$and = and;
  return q;
}
