import { Router } from 'express';
import { runSourcing } from '../services/ingest.js';
import { listProviders } from '../providers/index.js';
import { store } from '../store/index.js';
import { asyncHandler, rateLimit, singleFlight, requireRole } from '../middleware/index.js';
import { audit } from '../services/audit.js';

export const sourcingRouter = Router();

// What sources exist and which run live vs. mock/owned.
sourcingRouter.get('/providers', (_req, res) => {
  res.json({ providers: listProviders() });
});

// Sourcing spends Apify credits and writes data, so it needs at least recruiter.
const canSource = requireRole('recruiter');

// Normalize the request body into runSourcing params (shared by both routes).
// `orgId` is taken from the token and stamped onto every candidate + run.
function briefFromBody(req) {
  const body = req.body || {};
  const cleanNum = (v) => (v === '' || v == null ? null : Number(v));
  const { sources, query, limit, count, records, location, openToWorkOnly, indiaOnly, countryOnly, findContacts, sessionName, city, state, country, expMin, expMax, skills, jd, customActor, workMode, strict } = body;
  return {
    orgId: req.user.orgId,
    customActor: typeof customActor === 'string' ? customActor.slice(0, 300) : '',
    workMode: ['remote', 'hybrid', 'onsite'].includes(workMode) ? workMode : 'any',
    // STRICT mode: only fetch exactly what was asked (location + experience), no
    // widening. The AI assistant sends this so its runs match the user's request.
    strict: strict === true,
    sources,
    query,
    limit: Math.min(Number(limit) || 25, 100),
    count: count != null ? Math.min(Math.max(1, Number(count) || 25), 200) : null,
    records,
    location: location || 'India',
    city: typeof city === 'string' ? city : '',
    state: typeof state === 'string' ? state : '',
    country: typeof country === 'string' ? country : '',
    expMin: cleanNum(expMin),
    expMax: cleanNum(expMax),
    skills: Array.isArray(skills) ? skills.filter((s) => typeof s === 'string') : [],
    jd: typeof jd === 'string' ? jd : '',
    openToWorkOnly: openToWorkOnly !== false,
    indiaOnly: indiaOnly !== false,
    // "Only this country" — defaults on; falls back to the legacy indiaOnly flag.
    countryOnly: countryOnly != null ? countryOnly !== false : indiaOnly !== false,
    findContacts: findContacts === true,
    sessionName: typeof sessionName === 'string' ? sessionName : '',
  };
}

// Kick off a sourcing run. Rate-limited + single-flight to protect Apify credits.
sourcingRouter.post(
  '/run',
  canSource,
  rateLimit({ windowMs: 60_000, max: 12 }),
  singleFlight(),
  asyncHandler(async (req, res) => {
    const result = await runSourcing(briefFromBody(req));
    audit(req, 'sourcing.run', { kept: result.run?.kept, query: result.run?.query });
    res.json(result);
  })
);

// Streaming variant — emits newline-delimited JSON events (phase / source ticks /
// partial candidate snapshots) as the run progresses, then a final `done` event.
// Lets the UI show live progress instead of one long spinner.
sourcingRouter.post(
  '/run/stream',
  canSource,
  rateLimit({ windowMs: 60_000, max: 12 }),
  singleFlight(),
  asyncHandler(async (req, res) => {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    req.on('close', () => { closed = true; });
    const write = (obj) => { if (!closed) res.write(JSON.stringify(obj) + '\n'); };

    try {
      const result = await runSourcing({ ...briefFromBody(req), onEvent: write });
      audit(req, 'sourcing.run', { kept: result.run?.kept, query: result.run?.query });
      write({ type: 'done', run: result.run, candidates: result.candidates });
    } catch (err) {
      write({ type: 'error', message: err.message || 'Sourcing failed' });
    } finally {
      res.end();
    }
  })
);

// Saved sessions (sourcing run history) — scoped to the caller's org.
sourcingRouter.get('/runs', asyncHandler(async (req, res) => {
  res.json({ runs: await store.listRuns(50, req.user.orgId) });
}));

// Candidates captured in a saved session (filterable within the session).
sourcingRouter.get('/runs/:id/candidates', asyncHandler(async (req, res) => {
  const run = await store.getRun(req.params.id, req.user.orgId);
  if (!run) return res.status(404).json({ error: 'Session not found' });
  const ids = run.candidateIds || [];
  if (!ids.length) return res.json({ candidates: [], total: 0, run: { id: run.id, name: run.name } });
  const result = await store.listCandidates({ ...req.query, ids: ids.join(','), limit: req.query.limit || 500, orgId: req.user.orgId });
  res.json({ ...result, run: { id: run.id, name: run.name, query: run.query, location: run.location } });
}));

// Rename a session.
sourcingRouter.patch('/runs/:id', canSource, asyncHandler(async (req, res) => {
  const updated = await store.updateRun(req.params.id, { name: String(req.body?.name || '').slice(0, 80) }, req.user.orgId);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
}));

// Delete a session (does not delete the candidates).
sourcingRouter.delete('/runs/:id', canSource, asyncHandler(async (req, res) => {
  res.json({ deleted: await store.deleteRun(req.params.id, req.user.orgId) });
}));
