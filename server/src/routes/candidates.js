import { Router } from 'express';
import { store } from '../store/index.js';
import { PIPELINE_STAGES } from '../store/memoryStore.js';
import { asyncHandler, rateLimit, requireRole } from '../middleware/index.js';
import { candidatesToCsv } from '../services/csv.js';
import { TEMPLATES, renderTemplate } from '../services/outreach.js';
import { enrichContacts } from '../services/enrichContacts.js';
import { EXPERIENCE_BANDS } from '../services/experience.js';
import { scoreActiveIntent } from '../services/activeSignal.js';
import { audit } from '../services/audit.js';
import { config } from '../config.js';

export const candidatesRouter = Router();

// Tenant scope from the caller's token — overrides any client-supplied orgId, so a
// user can never read or mutate another org's data.
const scoped = (req, extra = {}) => ({ ...req.query, ...extra, orgId: req.user.orgId });
const org = (req) => req.user.orgId;
const canWrite = requireRole('recruiter'); // viewers are read-only

// List + filter (paginated; returns { candidates, total }).
candidatesRouter.get('/', asyncHandler(async (req, res) => {
  res.json(await store.listCandidates(scoped(req)));
}));

// Header stats.
candidatesRouter.get('/stats', asyncHandler(async (req, res) => {
  res.json(await store.stats(scoped(req)));
}));

// Re-score the whole pool with the current active-intent model. Run after a
// scoring-weight change so existing candidates reflect it without re-sourcing.
candidatesRouter.post('/rescore', canWrite, rateLimit({ windowMs: 60_000, max: 6 }), asyncHandler(async (req, res) => {
  res.json(await store.rescoreAll((c) => scoreActiveIntent(c), org(req)));
}));

// Analytics for the dashboard (respects filters).
candidatesRouter.get('/analytics', asyncHandler(async (req, res) => {
  res.json(await store.analytics(scoped(req)));
}));

// Filter-dropdown facets.
candidatesRouter.get('/facets', asyncHandler(async (req, res) => {
  res.json(await store.facets(scoped(req)));
}));

// Pipeline stages + outreach templates (static config for the UI).
candidatesRouter.get('/meta', (_req, res) => {
  res.json({ stages: PIPELINE_STAGES, templates: TEMPLATES, experienceBands: EXPERIENCE_BANDS });
});

// CSV export of the current filtered set (no pagination).
candidatesRouter.get('/export', asyncHandler(async (req, res) => {
  const { candidates } = await store.listCandidates(scoped(req, { limit: 500, offset: 0 }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="incsource-candidates.csv"');
  audit(req, 'candidates.export', { count: candidates.length });
  res.send(candidatesToCsv(candidates));
}));

// Render an outreach message for a candidate (does not send; client opens mail / copies).
candidatesRouter.post('/:id/outreach/preview', asyncHandler(async (req, res) => {
  const c = await store.getCandidate(req.params.id, org(req));
  if (!c) return res.status(404).json({ error: 'Not found' });
  const tpl = TEMPLATES.find((t) => t.id === req.body?.templateId) || TEMPLATES[0];
  res.json({ candidate: { id: c.id, email: c.email, fullName: c.fullName }, ...renderTemplate(tpl, c, req.body || {}) });
}));

// Log that outreach happened → bumps status to Contacted, records history.
candidatesRouter.post('/:id/outreach', canWrite, asyncHandler(async (req, res) => {
  const c = await store.recordOutreach(req.params.id, { channel: req.body?.channel || 'email', subject: req.body?.subject || '' }, org(req));
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
}));

// Find a verified email for ONE candidate (enrichment).
candidatesRouter.post('/:id/enrich', canWrite, rateLimit({ windowMs: 60_000, max: 30 }), asyncHandler(async (req, res) => {
  const c = await store.getCandidate(req.params.id, org(req));
  if (!c) return res.status(404).json({ error: 'Not found' });
  const result = await enrichContacts([c]);
  if (result.error) return res.status(502).json({ error: result.error });
  const updated = await store.setContact(c.id, { email: c.email }, org(req));
  res.json({ candidate: updated, found: { email: Boolean(updated.email) } });
}));

// Bulk-enrich selected candidates (capped for spend).
candidatesRouter.post('/enrich', canWrite, rateLimit({ windowMs: 60_000, max: 6 }), asyncHandler(async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).slice(0, config.apify.contactBulkCap);
  if (!ids.length) return res.status(400).json({ error: 'No ids provided' });
  const list = (await Promise.all(ids.map((id) => store.getCandidate(id, org(req))))).filter(Boolean);
  const result = await enrichContacts(list);
  if (result.error) return res.status(502).json({ error: result.error });
  await Promise.all(list.map((c) => store.setContact(c.id, { email: c.email }, org(req))));
  res.json(result);
}));

// Bulk update (status/star/tags) or delete. Body: { ids: [], patch: {} } or { ids: [], delete: true }.
candidatesRouter.post('/bulk', canWrite, asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 1000) : [];
  if (!ids.length) return res.status(400).json({ error: 'No ids provided' });
  if (req.body.delete) {
    const deleted = await store.bulkDelete(ids, org(req));
    audit(req, 'candidates.bulkDelete', { count: deleted });
    return res.json({ deleted });
  }
  const patch = sanitizePatch(req.body?.patch || {});
  res.json({ updated: await store.bulkUpdate(ids, patch, org(req)) });
}));

candidatesRouter.get('/:id', asyncHandler(async (req, res) => {
  const c = await store.getCandidate(req.params.id, org(req));
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
}));

// Update a single candidate's workflow fields.
candidatesRouter.patch('/:id', canWrite, asyncHandler(async (req, res) => {
  const c = await store.updateCandidate(req.params.id, sanitizePatch(req.body || {}), org(req));
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
}));

candidatesRouter.delete('/:id', canWrite, asyncHandler(async (req, res) => {
  const ok = await store.deleteCandidate(req.params.id, org(req));
  if (ok) audit(req, 'candidates.delete', { id: req.params.id });
  res.status(ok ? 200 : 404).json({ deleted: ok });
}));

// Whitelist + validate editable fields.
function sanitizePatch(body) {
  const patch = {};
  if (typeof body.status === 'string' && PIPELINE_STAGES.includes(body.status)) patch.status = body.status;
  if (typeof body.starred === 'boolean') patch.starred = body.starred;
  if (typeof body.notes === 'string') patch.notes = body.notes.slice(0, 5000);
  if (Array.isArray(body.tags)) patch.tags = body.tags.filter((t) => typeof t === 'string').slice(0, 20);
  return patch;
}
