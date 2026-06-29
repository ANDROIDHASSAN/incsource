// MongoDB store — used when MONGODB_URI is set. Same interface as memoryStore.
import mongoose from 'mongoose';
import crypto from 'crypto';
import { normalizeFilters, toMongoQuery } from '../services/candidateFilters.js';

// A long, URL-safe secret for a candidate's public resume-upload link.
const newResumeToken = () => crypto.randomBytes(18).toString('base64url');

export const PIPELINE_STAGES = ['New', 'Shortlisted', 'Contacted', 'Interviewing', 'Hired', 'Rejected'];
const EDITABLE = ['status', 'starred', 'notes', 'tags'];

const candidateSchema = new mongoose.Schema(
  {
    orgId: { type: String, index: true }, // tenant owner
    dedupeKey: { type: String, index: true },
    source: String,
    sources: [String],
    recordType: { type: String, default: 'candidate' },
    externalId: String,
    fullName: String,
    headline: String,
    location: String,
    city: String,
    state: { type: String, index: true },
    country: String,
    countryCode: { type: String, index: true },
    currentTitle: String,
    currentCompany: String,
    skills: [String],
    profileUrl: String,
    email: String,
    phone: String,
    lastActiveAt: Date,
    noticePeriodDays: Number,
    experienceYears: { type: Number, index: true },
    workMode: { type: String, index: true },
    openToWork: { type: Boolean, index: true },
    appliedToJob: String,
    rawSignals: [String],
    activeScore: { type: Number, index: true },
    fitScore: { type: Number, index: true },
    matchedSkills: [String],
    missingSkills: [String],
    aiVerdict: String,
    aiReason: String,
    scoreBreakdown: [{ label: String, points: Number }],
    // recruiter workflow
    status: { type: String, default: 'New', index: true },
    starred: { type: Boolean, default: false, index: true },
    notes: { type: String, default: '' },
    tags: { type: [String], default: [] },
    lastContactedAt: Date,
    outreachCount: { type: Number, default: 0 },
    outreachLog: { type: [{ channel: String, subject: String, at: Date }], default: [] },
    // Resume collection — a per-candidate secret token powers the public upload
    // link we put in outreach; the parsed CV is attached here once received.
    resumeToken: { type: String, index: true },
    resume: {
      type: {
        filename: String, size: Number, mimetype: String, text: String,
        parsedEmail: String, parsedPhone: String, uploadedAt: Date,
      },
      default: null,
    },
  },
  { timestamps: true }
);

const runSchema = new mongoose.Schema(
  {
    orgId: { type: String, index: true },
    name: String,
    sources: [String], query: String, location: String,
    brief: { type: mongoose.Schema.Types.Mixed },
    customActor: String, customActorInvalid: Boolean,
    filters: { type: mongoose.Schema.Types.Mixed },
    requested: Number, requestedCount: Number, fetched: Number, kept: Number,
    shortOfTarget: Number, relaxed: Boolean, relaxNotes: [String],
    droppedNonIndia: Number, droppedNotOpen: Number, droppedExp: Number,
    contacts: { type: mongoose.Schema.Types.Mixed },
    inserted: Number, updated: Number, durationMs: Number,
    candidateIds: [String],
    errors: [{ source: String, message: String }], startedAt: Date,
  },
  // strict:false future-proofs against new run fields silently vanishing again.
  { timestamps: true, suppressReservedKeysWarning: true, strict: false, minimize: false }
);

const segmentSchema = new mongoose.Schema({ orgId: { type: String, index: true }, name: String, filters: Object }, { timestamps: true });
const templateSchema = new mongoose.Schema({ orgId: { type: String, index: true }, name: String, subject: String, body: String }, { timestamps: true });

// A profile is unique PER TENANT — two orgs may each hold the same candidate.
candidateSchema.index({ orgId: 1, dedupeKey: 1 }, { unique: true });
const Candidate = mongoose.model('Candidate', candidateSchema);
const Run = mongoose.model('SourcingRun', runSchema);
const Segment = mongoose.model('Segment', segmentSchema);
const Template = mongoose.model('EmailTemplate', templateSchema);

function out(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  o.id = String(o._id);
  delete o._id;
  delete o.__v;
  return o;
}

// Build an id query scoped to a tenant (omit orgId for internal/unscoped calls).
const scopeId = (id, orgId) => (orgId ? { _id: id, orgId } : { _id: id });
const scopeIds = (ids, orgId) => (orgId ? { _id: { $in: ids }, orgId } : { _id: { $in: ids } });

export const mongoStore = {
  kind: 'mongo',

  // Backfill workflow defaults on legacy docs created before these fields existed.
  async ensureDefaults() {
    await Candidate.updateMany(
      { status: { $exists: false } },
      { $set: { status: 'New', starred: false, notes: '', tags: [], outreachCount: 0, outreachLog: [] } }
    );
  },

  // One-time tenancy migration for databases created before multi-tenancy: assign
  // any org-less rows to the given (seed admin's) org, and drop the now-stale
  // single-field unique dedupe index in favour of the per-tenant compound one.
  async migrateTenancy(orgId) {
    if (!orgId) return { migrated: 0 };
    try { await Candidate.collection.dropIndex('dedupeKey_1'); } catch { /* not present → fine */ }
    const set = { $set: { orgId } };
    const where = { $or: [{ orgId: { $exists: false } }, { orgId: null }] };
    // Runs / segments / templates carry no cross-row unique constraint → bulk is safe.
    await Promise.all([
      Run.updateMany(where, set).catch((e) => console.warn('migrate runs:', e.message)),
      Segment.updateMany(where, set).catch((e) => console.warn('migrate segments:', e.message)),
      Template.updateMany(where, set).catch((e) => console.warn('migrate templates:', e.message)),
    ]);
    // Candidates share a per-tenant unique (orgId, dedupeKey). Assigning org-less rows
    // to the seed org can collide with a row already in that org (or with each other).
    // Migrate one at a time and DROP any row that would duplicate an existing tenant
    // candidate — a bulk updateMany aborts the whole startup on the first collision.
    let migrated = 0;
    const orphans = await Candidate.find(where).select('_id').lean();
    for (const o of orphans) {
      try { await Candidate.updateOne({ _id: o._id }, set); migrated++; }
      catch (e) {
        if (e?.code === 11000) await Candidate.deleteOne({ _id: o._id }).catch(() => {});
        else console.warn('migrate candidate:', e.message);
      }
    }
    return { migrated };
  },

  async upsertCandidates(list) {
    if (!list.length) return { inserted: 0, updated: 0 };
    // Atomic upsert per candidate (race-safe under concurrent runs). Re-sourcing
    // refreshes signal fields but NEVER clobbers recruiter workflow state, takes the
    // max activeScore, and accumulates sources.
    const ops = list.map((c) => {
      const set = {
        source: c.source, recordType: c.recordType, externalId: c.externalId,
        fullName: c.fullName, headline: c.headline, location: c.location,
        city: c.city, state: c.state, country: c.country, countryCode: c.countryCode,
        currentTitle: c.currentTitle, currentCompany: c.currentCompany, skills: c.skills,
        profileUrl: c.profileUrl, lastActiveAt: c.lastActiveAt, noticePeriodDays: c.noticePeriodDays,
        experienceYears: c.experienceYears ?? null, workMode: c.workMode ?? null,
        fitScore: c.fitScore ?? null, matchedSkills: c.matchedSkills || [], missingSkills: c.missingSkills || [],
        aiVerdict: c.aiVerdict || null, aiReason: c.aiReason || null,
        appliedToJob: c.appliedToJob, rawSignals: c.rawSignals, scoreBreakdown: c.scoreBreakdown,
      };
      if (c.email) set.email = c.email;
      if (c.phone) set.phone = c.phone;
      if (c.openToWork) set.openToWork = true; // OR-merge: only ever set true

      const setOnInsert = { status: 'New', starred: false, notes: '', tags: [], orgId: c.orgId ?? null };
      if (!c.openToWork) setOnInsert.openToWork = false; // avoid $set/$setOnInsert conflict

      return {
        updateOne: {
          filter: { orgId: c.orgId ?? null, dedupeKey: c.dedupeKey },
          update: { $set: set, $setOnInsert: setOnInsert, $max: { activeScore: c.activeScore || 0 }, $addToSet: { sources: c.source } },
          upsert: true,
        },
      };
    });
    const res = await Candidate.bulkWrite(ops, { ordered: false });
    const orgId = list[0]?.orgId ?? null;
    const keys = list.map((c) => c.dedupeKey);
    const docs = await Candidate.find({ orgId, dedupeKey: { $in: keys } }, '_id').lean();
    const ids = docs.map((d) => String(d._id));
    return { inserted: res.upsertedCount || 0, updated: res.modifiedCount || 0, ids };
  },

  async listCandidates(params = {}) {
    const f = normalizeFilters(params);
    const query = toMongoQuery(f);
    if (f.ids.length) {
      const valid = f.ids.filter((i) => mongoose.isValidObjectId(i));
      query._id = { $in: valid.length ? valid : [null] }; // empty → match nothing
    }
    const [docs, total] = await Promise.all([
      Candidate.find(query).sort(f.sort).skip(f.offset).limit(f.limit),
      Candidate.countDocuments(query),
    ]);
    return { candidates: docs.map(out), total };
  },

  async getCandidate(id, orgId) {
    if (!mongoose.isValidObjectId(id)) return null;
    return out(await Candidate.findOne(scopeId(id, orgId)));
  },

  async updateCandidate(id, patch, orgId) {
    if (!mongoose.isValidObjectId(id)) return null;
    const set = {};
    for (const k of EDITABLE) if (k in patch) set[k] = patch[k];
    return out(await Candidate.findOneAndUpdate(scopeId(id, orgId), { $set: set }, { new: true }));
  },

  async bulkUpdate(ids, patch, orgId) {
    const valid = ids.filter((i) => mongoose.isValidObjectId(i));
    const set = {};
    for (const k of EDITABLE) if (k in patch) set[k] = patch[k];
    const res = await Candidate.updateMany(scopeIds(valid, orgId), { $set: set });
    return res.modifiedCount ?? res.nModified ?? 0;
  },

  // Recompute the active-intent score for every stored candidate using the current
  // scoring model (scoreFn). Used after a weight change so the existing pool reflects
  // it without re-sourcing. Workflow fields (status/notes/stars/openToWork) untouched.
  async rescoreAll(scoreFn, orgId) {
    const docs = await Candidate.find(orgId ? { orgId } : {});
    const ops = [];
    for (const d of docs) {
      const { activeScore, scoreBreakdown, rawSignals } = scoreFn(out(d));
      ops.push({
        updateOne: {
          filter: { _id: d._id },
          update: { $set: { activeScore, scoreBreakdown, rawSignals } },
        },
      });
    }
    if (ops.length) await Candidate.bulkWrite(ops, { ordered: false });
    return { rescored: ops.length };
  },

  async setContact(id, { email, phone }, orgId) {
    if (!mongoose.isValidObjectId(id)) return null;
    const set = {};
    if (email) set.email = email;
    if (phone) set.phone = phone;
    if (!Object.keys(set).length) return out(await Candidate.findOne(scopeId(id, orgId)));
    return out(await Candidate.findOneAndUpdate(scopeId(id, orgId), { $set: set }, { new: true }));
  },

  async recordOutreach(id, { channel, subject }, orgId) {
    if (!mongoose.isValidObjectId(id)) return null;
    const existing = await Candidate.findOne(scopeId(id, orgId));
    if (!existing) return null;
    const update = {
      $push: { outreachLog: { $each: [{ channel, subject, at: new Date() }], $position: 0, $slice: 50 } },
      $inc: { outreachCount: 1 },
      $set: { lastContactedAt: new Date() },
    };
    if (existing.status === 'New' || existing.status === 'Shortlisted') update.$set.status = 'Contacted';
    return out(await Candidate.findOneAndUpdate(scopeId(id, orgId), update, { new: true }));
  },

  // ── Resume collection ──────────────────────────────────────────────────────
  // Return the candidate's resume-upload token, generating + persisting one on
  // first use. The token is the secret that authorizes a public upload, so it's
  // long and random.
  async ensureResumeToken(id, orgId) {
    if (!mongoose.isValidObjectId(id)) return null;
    const c = await Candidate.findOne(scopeId(id, orgId));
    if (!c) return null;
    if (!c.resumeToken) { c.resumeToken = newResumeToken(); await c.save(); }
    return c.resumeToken;
  },

  // Public lookup by token (NOT org-scoped — the token itself is the credential).
  async findByResumeToken(token) {
    if (!token) return null;
    return out(await Candidate.findOne({ resumeToken: String(token) }));
  },

  // Attach a parsed resume by candidate id (recruiter upload, org-scoped). Also
  // backfills email/phone from the CV when we don't already have them.
  async attachResume(id, resume, orgId) {
    if (!mongoose.isValidObjectId(id)) return null;
    const set = { resume };
    const c = await Candidate.findOne(scopeId(id, orgId));
    if (!c) return null;
    if (!c.email && resume.parsedEmail) set.email = resume.parsedEmail;
    if (!c.phone && resume.parsedPhone) set.phone = resume.parsedPhone;
    return out(await Candidate.findOneAndUpdate(scopeId(id, orgId), { $set: set }, { new: true }));
  },

  // Attach a parsed resume by token (public upload — candidate self-serve).
  async attachResumeByToken(token, resume) {
    if (!token) return null;
    const c = await Candidate.findOne({ resumeToken: String(token) });
    if (!c) return null;
    const set = { resume };
    if (!c.email && resume.parsedEmail) set.email = resume.parsedEmail;
    if (!c.phone && resume.parsedPhone) set.phone = resume.parsedPhone;
    return out(await Candidate.findOneAndUpdate({ _id: c._id }, { $set: set }, { new: true }));
  },

  async deleteCandidate(id, orgId) {
    if (!mongoose.isValidObjectId(id)) return false;
    return Boolean(await Candidate.findOneAndDelete(scopeId(id, orgId)));
  },

  async bulkDelete(ids, orgId) {
    const valid = ids.filter((i) => mongoose.isValidObjectId(i));
    const res = await Candidate.deleteMany(scopeIds(valid, orgId));
    return res.deletedCount || 0;
  },

  async stats(params = {}) {
    const { orgId } = normalizeFilters(params);
    const base = { recordType: { $ne: 'job-lead' }, ...(orgId ? { orgId } : {}) };
    const [total, openToWork, hot, shortlisted] = await Promise.all([
      Candidate.countDocuments(base),
      Candidate.countDocuments({ ...base, openToWork: true }),
      Candidate.countDocuments({ ...base, activeScore: { $gte: 70 } }),
      Candidate.countDocuments({ ...base, starred: true }),
    ]);
    return { total, openToWork, hot, shortlisted };
  },

  async analytics(params = {}) {
    const f = normalizeFilters(params);
    const match = toMongoQuery(f);
    const group = async (field, unwind, limit = 50) => {
      const path = field;
      const rows = await Candidate.aggregate([
        { $match: match },
        ...(unwind ? [{ $unwind: `$${path}` }] : []),
        { $group: { _id: `$${path}`, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]);
      return rows.filter((r) => r._id != null && r._id !== '').map((r) => ({ value: r._id, count: r.count }));
    };
    const bandAgg = await Candidate.aggregate([
      { $match: match },
      { $bucket: { groupBy: '$activeScore', boundaries: [0, 40, 70, 101], default: -1, output: { count: { $sum: 1 } } } },
    ]);
    const bandMap = { '-1': 'Cold', 0: 'Cold', 40: 'Warm', 70: 'Hot' };
    const byBand = bandAgg.map((b) => ({ value: bandMap[b._id] || 'Cold', count: b.count }));
    const totalAgg = await Candidate.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: 1 }, avg: { $avg: '$activeScore' }, open: { $sum: { $cond: ['$openToWork', 1, 0] } } } },
    ]);
    const t = totalAgg[0] || { total: 0, avg: 0, open: 0 };
    const [byStatus, bySource, byState, bySkill] = await Promise.all([
      group('status', false), group('sources', true), group('state', false, 8), group('skills', true, 12),
    ]);
    return {
      total: t.total, avgScore: Math.round(t.avg || 0), openToWork: t.open,
      byStatus, bySource, byBand, byState, bySkill,
    };
  },

  async facets(params = {}) {
    const { orgId } = normalizeFilters(params);
    const scope = orgId ? { orgId } : {};
    const top = async (field, limit = 1000) => {
      const path = field === 'source' ? 'sources' : field;
      const isArray = field === 'skills' || field === 'source';
      const rows = await Candidate.aggregate([
        { $match: { ...scope, [path]: isArray ? { $exists: true, $ne: [] } : { $nin: [null, ''] } } },
        ...(isArray ? [{ $unwind: `$${path}` }] : []),
        { $group: { _id: `$${path}`, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]);
      return rows.filter((r) => r._id != null && r._id !== '').map((r) => ({ value: r._id, count: r.count }));
    };
    const [states, cities, sources, skills] = await Promise.all([top('state'), top('city'), top('source'), top('skills', 40)]);
    return { states, cities, sources, skills };
  },

  async saveRun(run) {
    return out(await Run.create(run));
  },
  async listRuns(limit = 50, orgId) {
    const docs = await Run.find(orgId ? { orgId } : {}).select('-candidateIds').sort('-createdAt').limit(limit);
    return docs.map((d) => { const o = out(d); o.candidateCount = d.kept || 0; return o; });
  },
  async getRun(id, orgId) {
    if (!mongoose.isValidObjectId(id)) return null;
    return out(await Run.findOne(scopeId(id, orgId)));
  },
  async updateRun(id, patch, orgId) {
    if (!mongoose.isValidObjectId(id)) return null;
    const set = {};
    if (typeof patch.name === 'string') set.name = patch.name;
    // The agentic critic loop merges extra rounds into ONE session.
    if (Array.isArray(patch.candidateIds)) set.candidateIds = patch.candidateIds;
    if (typeof patch.kept === 'number') set.kept = patch.kept;
    return out(await Run.findOneAndUpdate(scopeId(id, orgId), { $set: set }, { new: true }));
  },
  async deleteRun(id, orgId) {
    if (!mongoose.isValidObjectId(id)) return false;
    return Boolean(await Run.findOneAndDelete(scopeId(id, orgId)));
  },

  async listSegments(orgId) {
    return (await Segment.find(orgId ? { orgId } : {}).sort('-createdAt')).map(out);
  },
  async saveSegment(name, filters, orgId) {
    return out(await Segment.create({ name, filters, orgId }));
  },
  async deleteSegment(id, orgId) {
    if (!mongoose.isValidObjectId(id)) return false;
    return Boolean(await Segment.findOneAndDelete(scopeId(id, orgId)));
  },

  async listTemplates(orgId) {
    return (await Template.find(orgId ? { orgId } : {}).sort('-createdAt')).map((d) => ({ ...out(d), custom: true }));
  },
  async saveTemplate({ name, subject, body, orgId }) {
    return { ...out(await Template.create({ name, subject, body, orgId })), custom: true };
  },
  async updateTemplate(id, patch, orgId) {
    if (!mongoose.isValidObjectId(id)) return null;
    const set = {};
    for (const k of ['name', 'subject', 'body']) if (k in patch) set[k] = patch[k];
    const d = await Template.findOneAndUpdate(scopeId(id, orgId), { $set: set }, { new: true });
    return d ? { ...out(d), custom: true } : null;
  },
  async deleteTemplate(id, orgId) {
    if (!mongoose.isValidObjectId(id)) return false;
    return Boolean(await Template.findOneAndDelete(scopeId(id, orgId)));
  },
};
