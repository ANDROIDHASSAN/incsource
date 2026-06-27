import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api } from '../helpers.js';
import { signToken } from '../../src/services/auth.js';

let srv;
// Two independent tenants, each an admin of their own org.
let A, B; // { token, orgId }

async function registerOrg(email) {
  const r = await api(srv.url, 'POST', '/api/auth/register', { body: { email, password: 'longenough1', company: email } });
  return { token: r.body.token, orgId: r.body.user.orgId, role: r.body.user.role };
}

// Seed a candidate into the caller's org via the real sourcing pipeline (inbound
// records work offline — no Apify needed), then return the stored candidate
// (with its persisted id) from the org's list.
async function sourceOne(token, name) {
  await api(srv.url, 'POST', '/api/sourcing/run', {
    token,
    body: {
      sources: ['inbound'], query: name, count: 1, openToWorkOnly: false, indiaOnly: false, countryOnly: false,
      records: [{ externalId: name, fullName: name, email: `${name}@x.com`, headline: 'React dev', location: 'Pune, India', currentTitle: 'Dev', skills: ['React'], experienceYears: 3 }],
    },
  });
  const list = await api(srv.url, 'GET', `/api/candidates?q=${name}`, { token });
  return list.body.candidates?.find((c) => c.fullName === name);
}

before(async () => {
  srv = await startTestServer();
  A = await registerOrg('org-a@example.com');
  B = await registerOrg('org-b@example.com');
});
after(async () => { await srv.close(); });

describe('tenant isolation — one org can never see or touch another org’s data', () => {
  it('registration creates an isolated org with the user as admin', () => {
    assert.ok(A.orgId && B.orgId);
    assert.notEqual(A.orgId, B.orgId);
    assert.equal(A.role, 'admin');
  });

  it('a candidate sourced by org A is invisible to org B', async () => {
    const cand = await sourceOne(A.token, 'Alice');
    assert.ok(cand?.id, 'org A should have sourced a candidate');

    const aList = await api(srv.url, 'GET', '/api/candidates', { token: A.token });
    assert.ok(aList.body.candidates.some((c) => c.id === cand.id));

    const bList = await api(srv.url, 'GET', '/api/candidates', { token: B.token });
    assert.ok(!bList.body.candidates.some((c) => c.id === cand.id), 'org B must not see org A candidates');

    // Direct id access across tenants is a 404, not a leak.
    assert.equal((await api(srv.url, 'GET', `/api/candidates/${cand.id}`, { token: B.token })).status, 404);
    // And org B cannot mutate or delete it.
    assert.equal((await api(srv.url, 'PATCH', `/api/candidates/${cand.id}`, { token: B.token, body: { status: 'Hired' } })).status, 404);
    assert.equal((await api(srv.url, 'DELETE', `/api/candidates/${cand.id}`, { token: B.token })).body.deleted, false);

    // Org A still owns it fully.
    assert.equal((await api(srv.url, 'GET', `/api/candidates/${cand.id}`, { token: A.token })).status, 200);
  });

  it('stats and sessions are scoped per org', async () => {
    const aStats = await api(srv.url, 'GET', '/api/candidates/stats', { token: A.token });
    const bStats = await api(srv.url, 'GET', '/api/candidates/stats', { token: B.token });
    assert.ok(aStats.body.total >= 1);
    assert.equal(bStats.body.total, 0);

    const bRuns = await api(srv.url, 'GET', '/api/sourcing/runs', { token: B.token });
    assert.equal(bRuns.body.runs.length, 0, 'org B has run nothing');
  });

  it('segments are isolated per org', async () => {
    await api(srv.url, 'POST', '/api/segments', { token: A.token, body: { name: 'A seg', filters: { band: 'hot' } } });
    assert.equal((await api(srv.url, 'GET', '/api/segments', { token: A.token })).body.segments.length, 1);
    assert.equal((await api(srv.url, 'GET', '/api/segments', { token: B.token })).body.segments.length, 0);
  });
});

describe('invite flow — teammates join the SAME org and share its pool', () => {
  it('an admin invite lets a recruiter join org A', async () => {
    const orgInfo = await api(srv.url, 'GET', '/api/org', { token: A.token });
    const code = orgInfo.body.inviteCode;
    assert.ok(code, 'admin sees the invite code');

    const joined = await api(srv.url, 'POST', '/api/auth/register', {
      body: { email: 'teammate@example.com', password: 'longenough1', inviteCode: code },
    });
    assert.equal(joined.status, 201);
    assert.equal(joined.body.user.orgId, A.orgId, 'teammate is in org A');
    assert.equal(joined.body.user.role, 'recruiter');

    // The teammate sees org A's candidates (shared pool).
    const list = await api(srv.url, 'GET', '/api/candidates', { token: joined.body.token });
    assert.ok(list.body.candidates.length >= 1);
  });

  it('a bad invite code is rejected', async () => {
    const r = await api(srv.url, 'POST', '/api/auth/register', { body: { email: 'x@y.com', password: 'longenough1', inviteCode: 'totally-bogus' } });
    assert.equal(r.status, 400);
  });
});

describe('RBAC — roles gate mutations and admin actions', () => {
  it('a viewer can read but not mutate', async () => {
    const viewerToken = signToken({ id: 'viewer-1', email: 'v@a.com', orgId: A.orgId, role: 'viewer' });
    assert.equal((await api(srv.url, 'GET', '/api/candidates', { token: viewerToken })).status, 200);
    const cand = (await api(srv.url, 'GET', '/api/candidates', { token: A.token })).body.candidates[0];
    assert.equal((await api(srv.url, 'PATCH', `/api/candidates/${cand.id}`, { token: viewerToken, body: { status: 'Hired' } })).status, 403);
    assert.equal((await api(srv.url, 'POST', '/api/segments', { token: viewerToken, body: { name: 'no', filters: {} } })).status, 403);
  });

  it('only an admin may change API keys', async () => {
    const recruiterToken = signToken({ id: 'rec-1', email: 'r@a.com', orgId: A.orgId, role: 'recruiter' });
    assert.equal((await api(srv.url, 'POST', '/api/settings', { token: recruiterToken, body: {} })).status, 403);
    assert.equal((await api(srv.url, 'GET', '/api/settings/reveal', { token: recruiterToken })).status, 403);
    // Admin is allowed.
    assert.notEqual((await api(srv.url, 'GET', '/api/settings/reveal', { token: A.token })).status, 403);
  });
});
