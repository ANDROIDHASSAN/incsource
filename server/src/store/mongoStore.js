// MongoDB store — used when MONGODB_URI is set. Same interface as memoryStore.
import mongoose from 'mongoose';
import { normalizeFilters, toMongoQuery } from '../services/candidateFilters.js';

export const PIPELINE_STAGES = ['New', 'Shortlisted', 'Contacted', 'Interviewing', 'Hired', 'Rejected'];
const EDITABLE = ['status', 'starred', 'notes', 'tags'];

const candidateSchema = new mongoose.Schema(
  {
    dedupeKey: { type: String, index: true, unique: true },
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
  },
  { timestamps: true }
);

const runSchema = new mongoose.Schema(
  {
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

const segmentSchema = new mongoose.Schema({ name: String, filters: Object }, { timestamps: true });
const templateSchema = new mongoose.Schema({ name: String, subject: String, body: String }, { timestamps: true });

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

export const mongoStore = {
  kind: 'mongo',

  // Backfill workflow defaults on legacy docs created before these fields existed.
  async ensureDefaults() {
    await Candidate.updateMany(
      { status: { $exists: false } },
      { $set: { status: 'New', starred: false, notes: '', tags: [], outreachCount: 0, outreachLog: [] } }
    );
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

      const setOnInsert = { status: 'New', starred: false, notes: '', tags: [] };
      if (!c.openToWork) setOnInsert.openToWork = false; // avoid $set/$setOnInsert conflict

      return {
        updateOne: {
          filter: { dedupeKey: c.dedupeKey },
          update: { $set: set, $setOnInsert: setOnInsert, $max: { activeScore: c.activeScore || 0 }, $addToSet: { sources: c.source } },
          upsert: true,
        },
      };
    });
    const res = await Candidate.bulkWrite(ops, { ordered: false });
    const keys = list.map((c) => c.dedupeKey);
    const docs = await Candidate.find({ dedupeKey: { $in: keys } }, '_id').lean();
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

  async getCandidate(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return out(await Candidate.findById(id));
  },

  async updateCandidate(id, patch) {
    if (!mongoose.isValidObjectId(id)) return null;
    const set = {};
    for (const k of EDITABLE) if (k in patch) set[k] = patch[k];
    return out(await Candidate.findByIdAndUpdate(id, { $set: set }, { new: true }));
  },

  async bulkUpdate(ids, patch) {
    const valid = ids.filter((i) => mongoose.isValidObjectId(i));
    const set = {};
    for (const k of EDITABLE) if (k in patch) set[k] = patch[k];
    const res = await Candidate.updateMany({ _id: { $in: valid } }, { $set: set });
    return res.modifiedCount ?? res.nModified ?? 0;
  },

  // Recompute the active-intent score for every stored candidate using the current
  // scoring model (scoreFn). Used after a weight change so the existing pool reflects
  // it without re-sourcing. Workflow fields (status/notes/stars/openToWork) untouched.
  async rescoreAll(scoreFn) {
    const docs = await Candidate.find({});
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

  async setContact(id, { email, phone }) {
    if (!mongoose.isValidObjectId(id)) return null;
    const set = {};
    if (email) set.email = email;
    if (phone) set.phone = phone;
    if (!Object.keys(set).length) return out(await Candidate.findById(id));
    return out(await Candidate.findByIdAndUpdate(id, { $set: set }, { new: true }));
  },

  async recordOutreach(id, { channel, subject }) {
    if (!mongoose.isValidObjectId(id)) return null;
    const existing = await Candidate.findById(id);
    if (!existing) return null;
    const update = {
      $push: { outreachLog: { $each: [{ channel, subject, at: new Date() }], $position: 0, $slice: 50 } },
      $inc: { outreachCount: 1 },
      $set: { lastContactedAt: new Date() },
    };
    if (existing.status === 'New' || existing.status === 'Shortlisted') update.$set.status = 'Contacted';
    return out(await Candidate.findByIdAndUpdate(id, update, { new: true }));
  },

  async deleteCandidate(id) {
    if (!mongoose.isValidObjectId(id)) return false;
    return Boolean(await Candidate.findByIdAndDelete(id));
  },

  async bulkDelete(ids) {
    const valid = ids.filter((i) => mongoose.isValidObjectId(i));
    const res = await Candidate.deleteMany({ _id: { $in: valid } });
    return res.deletedCount || 0;
  },

  async stats() {
    const base = { recordType: { $ne: 'job-lead' } };
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

  async facets() {
    const top = async (field, limit = 1000) => {
      const path = field === 'source' ? 'sources' : field;
      const isArray = field === 'skills' || field === 'source';
      const rows = await Candidate.aggregate([
        { $match: { [path]: isArray ? { $exists: true, $ne: [] } : { $nin: [null, ''] } } },
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
  async listRuns(limit = 50) {
    const docs = await Run.find().select('-candidateIds').sort('-createdAt').limit(limit);
    return docs.map((d) => { const o = out(d); o.candidateCount = d.kept || 0; return o; });
  },
  async getRun(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return out(await Run.findById(id));
  },
  async updateRun(id, patch) {
    if (!mongoose.isValidObjectId(id)) return null;
    const set = {};
    if (typeof patch.name === 'string') set.name = patch.name;
    return out(await Run.findByIdAndUpdate(id, { $set: set }, { new: true }));
  },
  async deleteRun(id) {
    if (!mongoose.isValidObjectId(id)) return false;
    return Boolean(await Run.findByIdAndDelete(id));
  },

  async listSegments() {
    return (await Segment.find().sort('-createdAt')).map(out);
  },
  async saveSegment(name, filters) {
    return out(await Segment.create({ name, filters }));
  },
  async deleteSegment(id) {
    if (!mongoose.isValidObjectId(id)) return false;
    return Boolean(await Segment.findByIdAndDelete(id));
  },

  async listTemplates() {
    return (await Template.find().sort('-createdAt')).map((d) => ({ ...out(d), custom: true }));
  },
  async saveTemplate({ name, subject, body }) {
    return { ...out(await Template.create({ name, subject, body })), custom: true };
  },
  async updateTemplate(id, patch) {
    if (!mongoose.isValidObjectId(id)) return null;
    const set = {};
    for (const k of ['name', 'subject', 'body']) if (k in patch) set[k] = patch[k];
    const d = await Template.findByIdAndUpdate(id, { $set: set }, { new: true });
    return d ? { ...out(d), custom: true } : null;
  },
  async deleteTemplate(id) {
    if (!mongoose.isValidObjectId(id)) return false;
    return Boolean(await Template.findByIdAndDelete(id));
  },
};
