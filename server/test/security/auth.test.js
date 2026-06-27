import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, login, api, ADMIN } from '../helpers.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

describe('account auth', () => {
  it('registers a new account and returns a token', async () => {
    const r = await api(srv.url, 'POST', '/api/auth/register', {
      body: { email: 'new.user@example.com', password: 'longenough1', name: 'New User' },
    });
    assert.equal(r.status, 201);
    assert.ok(r.body.token);
    assert.equal(r.body.user.email, 'new.user@example.com');
    assert.ok(!('passwordHash' in r.body.user), 'must never leak the password hash');
  });

  it('rejects a short password (400)', async () => {
    const r = await api(srv.url, 'POST', '/api/auth/register', { body: { email: 'x@y.com', password: '123' } });
    assert.equal(r.status, 400);
  });

  it('rejects an invalid email (400)', async () => {
    const r = await api(srv.url, 'POST', '/api/auth/register', { body: { email: 'not-an-email', password: 'longenough1' } });
    assert.equal(r.status, 400);
  });

  it('rejects a duplicate email (409)', async () => {
    const body = { email: 'dup@example.com', password: 'longenough1' };
    await api(srv.url, 'POST', '/api/auth/register', { body });
    const r = await api(srv.url, 'POST', '/api/auth/register', { body });
    assert.equal(r.status, 409);
  });

  it('rejects a wrong password without revealing which field was wrong (401)', async () => {
    const r = await api(srv.url, 'POST', '/api/auth/login', { body: { email: ADMIN.email, password: 'wrong' } });
    assert.equal(r.status, 401);
    assert.match(r.body.error, /email or password/i);
  });

  it('returns the current user for a valid token, 401 without one', async () => {
    const token = await login(srv.url);
    assert.equal((await api(srv.url, 'GET', '/api/auth/me', { token })).status, 200);
    assert.equal((await api(srv.url, 'GET', '/api/auth/me')).status, 401);
  });

  it('rejects a tampered/garbage JWT (401)', async () => {
    const r = await api(srv.url, 'GET', '/api/auth/me', { token: 'not.a.realtoken' });
    assert.equal(r.status, 401);
  });
});

describe('API gate — data routes require a valid token', () => {
  const PROTECTED = [
    ['GET', '/api/candidates'],
    ['GET', '/api/candidates/stats'],
    ['GET', '/api/sourcing/runs'],
    ['GET', '/api/segments'],
    ['GET', '/api/templates'],
    ['GET', '/api/geo'],
    ['GET', '/api/usage'],
    ['GET', '/api/settings/reveal'],
    ['POST', '/api/settings'],
    ['POST', '/api/email/campaign'],
  ];

  for (const [method, path] of PROTECTED) {
    it(`${method} ${path} → 401 without a token`, async () => {
      const r = await api(srv.url, method, path, { body: method === 'POST' ? {} : undefined });
      assert.equal(r.status, 401);
    });
  }

  it('the same routes succeed WITH a token', async () => {
    const token = await login(srv.url);
    assert.equal((await api(srv.url, 'GET', '/api/candidates', { token })).status, 200);
    assert.equal((await api(srv.url, 'GET', '/api/usage', { token })).status, 200);
  });
});

describe('public surface', () => {
  it('health is reachable without auth and leaks no secrets', async () => {
    const r = await api(srv.url, 'GET', '/api/health');
    assert.equal(r.status, 200);
    const blob = JSON.stringify(r.body).toLowerCase();
    assert.ok(!blob.includes('secret') && !blob.includes('password') && !blob.includes('token'));
  });
});
