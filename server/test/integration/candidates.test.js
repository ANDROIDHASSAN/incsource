import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, login, getMe, api } from '../helpers.js';
import { store } from '../../src/store/index.js';
import { ensureShape, dedupeKey } from '../../src/services/normalize.js';
import { scoreActiveIntent } from '../../src/services/activeSignal.js';

// Build a fully-shaped, scored, org-tagged candidate and seed it into the store.
function seed(orgId, over) {
  const c = ensureShape({ source: 'inbound', ...over }, 'inbound');
  Object.assign(c, scoreActiveIntent(c));
  if (over.fitScore != null) c.fitScore = over.fitScore;
  c.orgId = orgId;
  c.dedupeKey = dedupeKey(c);
  return c;
}

let srv, token, orgId;
before(async () => {
  srv = await startTestServer();
  token = await login(srv.url);
  orgId = (await getMe(srv.url, token)).orgId;
  await store.upsertCandidates([
    seed(orgId, { fullName: 'Open One', email: 'open1@x.com', openToWork: true, fitScore: 95, city: 'Pune', state: 'Maharashtra', countryCode: 'IN', skills: ['React', 'Node.js'], experienceYears: 4 }),
    seed(orgId, { fullName: 'Closed Two', email: 'closed2@x.com', openToWork: false, fitScore: 60, city: 'Mumbai', state: 'Maharashtra', countryCode: 'IN', skills: ['Vue'], experienceYears: 6 }),
  ]);
});
after(async () => { await srv.close(); });

describe('candidates listing & filtering', () => {
  it('lists seeded candidates with a total', async () => {
    const r = await api(srv.url, 'GET', '/api/candidates?limit=50', { token });
    assert.equal(r.status, 200);
    assert.ok(r.body.total >= 2);
    assert.ok(Array.isArray(r.body.candidates));
  });

  it('open-to-work filter returns ONLY flagged candidates', async () => {
    const r = await api(srv.url, 'GET', '/api/candidates?openToWork=true&limit=50', { token });
    assert.equal(r.status, 200);
    assert.ok(r.body.candidates.length >= 1);
    assert.ok(r.body.candidates.every((c) => c.openToWork === true), 'no non-open candidate may leak');
  });

  it('reports header stats', async () => {
    const r = await api(srv.url, 'GET', '/api/candidates/stats', { token });
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.total, 'number');
    assert.ok(r.body.openToWork >= 1);
  });
});

describe('candidate workflow mutations', () => {
  it('PATCH updates status (whitelisted fields only)', async () => {
    const { body } = await api(srv.url, 'GET', '/api/candidates?limit=1', { token });
    const id = body.candidates[0].id;
    const r = await api(srv.url, 'PATCH', `/api/candidates/${id}`, { token, body: { status: 'Shortlisted', isAdmin: true } });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'Shortlisted');
    assert.ok(!('isAdmin' in r.body), 'must ignore non-whitelisted fields');
  });

  it('rejects an invalid status value (stays valid)', async () => {
    const { body } = await api(srv.url, 'GET', '/api/candidates?limit=1', { token });
    const id = body.candidates[0].id;
    const r = await api(srv.url, 'PATCH', `/api/candidates/${id}`, { token, body: { status: 'Hacked' } });
    assert.equal(r.status, 200);
    assert.notEqual(r.body.status, 'Hacked');
  });

  it('bulk-shortlists selected ids', async () => {
    const { body } = await api(srv.url, 'GET', '/api/candidates?limit=50', { token });
    const ids = body.candidates.map((c) => c.id);
    const r = await api(srv.url, 'POST', '/api/candidates/bulk', { token, body: { ids, patch: { starred: true } } });
    assert.equal(r.status, 200);
    assert.equal(r.body.updated, ids.length);
  });

  it('rejects a bulk call with no ids (400)', async () => {
    const r = await api(srv.url, 'POST', '/api/candidates/bulk', { token, body: { ids: [] } });
    assert.equal(r.status, 400);
  });
});

describe('CSV export', () => {
  it('streams a CSV with a header row and data', async () => {
    const res = await fetch(`${srv.url}/api/candidates/export`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    const csv = await res.text();
    assert.match(csv.split('\n')[0], /Name,.*Email/);
    assert.match(csv, /Open One/);
  });

  it('requires auth (401 without token)', async () => {
    const res = await fetch(`${srv.url}/api/candidates/export`);
    assert.equal(res.status, 401);
  });
});

describe('GDPR delete', () => {
  it('deletes a candidate by id', async () => {
    await store.upsertCandidates([seed(orgId, { fullName: 'Delete Me', email: 'del@x.com' })]);
    const { body } = await api(srv.url, 'GET', '/api/candidates?q=Delete Me&limit=1', { token });
    const id = body.candidates[0].id;
    const del = await api(srv.url, 'DELETE', `/api/candidates/${id}`, { token });
    assert.equal(del.status, 200);
    const after = await api(srv.url, 'GET', `/api/candidates/${id}`, { token });
    assert.equal(after.status, 404);
  });
});
