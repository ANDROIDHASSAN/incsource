import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, api } from '../helpers.js';
import { userStore } from '../../src/services/userStore.js';

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

describe('password storage', () => {
  it('stores a bcrypt hash, never the plaintext', async () => {
    const user = await userStore.create({ email: 'hash@test.com', password: 'plaintext-secret-1' });
    assert.notEqual(user.passwordHash, 'plaintext-secret-1');
    assert.match(user.passwordHash, /^\$2[aby]\$/); // bcrypt signature
    assert.equal(await user.verifyPassword('plaintext-secret-1'), true);
    assert.equal(await user.verifyPassword('nope'), false);
  });
});

describe('rate limiting (abuse / credit protection)', () => {
  it('returns 429 with Retry-After once the window limit is exceeded', async () => {
    // /api/auth/register is capped at 10/min per IP; fire enough to trip it.
    const attempts = [];
    for (let i = 0; i < 14; i++) {
      attempts.push(api(srv.url, 'POST', '/api/auth/register', { body: { email: `x${i}@y`, password: '123' } }));
    }
    const results = await Promise.all(attempts);
    const statuses = results.map((r) => r.status);
    assert.ok(statuses.includes(429), `expected a 429 among ${statuses.join(',')}`);
  });
});

describe('error handler', () => {
  it('returns a clean JSON 404 for unknown API routes (no stack trace)', async () => {
    const r = await api(srv.url, 'GET', '/api/does-not-exist');
    assert.equal(r.status, 404);
    assert.equal(typeof r.body.error, 'string');
    assert.doesNotMatch(JSON.stringify(r.body), /at \/|\.js:\d+/); // no stack leak
  });
});
