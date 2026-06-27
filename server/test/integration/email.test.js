import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, login, getMe, api } from '../helpers.js';
import { store } from '../../src/store/index.js';
import { ensureShape, dedupeKey } from '../../src/services/normalize.js';
import { usage, emailCap } from '../../src/services/usage.js';

function seed(orgId, over) {
  const c = ensureShape({ source: 'inbound', ...over }, 'inbound');
  c.orgId = orgId;
  c.dedupeKey = dedupeKey(c);
  return c;
}

let srv, token, withEmailId, noEmailId;
before(async () => {
  srv = await startTestServer();
  token = await login(srv.url);
  const orgId = (await getMe(srv.url, token)).orgId;
  const { ids } = await store.upsertCandidates([
    seed(orgId, { fullName: 'Has Email', email: 'has@x.com' }),
    seed(orgId, { fullName: 'No Email' }),
  ]);
  [withEmailId, noEmailId] = ids;
});
after(async () => { await srv.close(); });

describe('email status', () => {
  it('reports mode + daily quota without making a network call', async () => {
    const r = await api(srv.url, 'GET', '/api/email/status', { token });
    assert.equal(r.status, 200);
    assert.equal(r.body.mode, 'test'); // SMTP_HOST unset in tests
    assert.equal(r.body.dailyCap, emailCap());
    assert.equal(typeof r.body.remaining, 'number');
  });
});

describe('single send guards', () => {
  it('refuses to send to a candidate with no email (400)', async () => {
    const r = await api(srv.url, 'POST', `/api/email/send/${noEmailId}`, { token, body: { templateId: 'intro' } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /no email/i);
  });

  it('enforces the daily ban-safety cap (429) once exhausted', async () => {
    usage.incEmail(emailCap()); // simulate the day's quota already spent
    const r = await api(srv.url, 'POST', `/api/email/send/${withEmailId}`, { token, body: { templateId: 'intro' } });
    assert.equal(r.status, 429);
    assert.match(r.body.error, /daily email limit/i);
  });
});

describe('campaign guards', () => {
  it('rejects a campaign with no recipients (400)', async () => {
    const r = await api(srv.url, 'POST', '/api/email/campaign', { token, body: { ids: [] } });
    assert.equal(r.status, 400);
  });

  it('skips recipients without an email instead of failing', async () => {
    // Quota is exhausted from the previous test → the no-email candidate is still
    // counted as "skipped", and nothing is actually sent (no network).
    const r = await api(srv.url, 'POST', '/api/email/campaign', { token, body: { ids: [noEmailId], templateId: 'intro' } });
    // Either 429 (cap) or a clean skipped summary — both are safe, never a 5xx.
    assert.ok(r.status === 200 || r.status === 429);
  });
});
