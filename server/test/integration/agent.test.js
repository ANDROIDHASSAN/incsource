import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, login, api } from '../helpers.js';

let srv, token;
before(async () => { srv = await startTestServer(); token = await login(srv.url); });
after(async () => { await srv.close(); });

describe('POST /api/agent/chat', () => {
  it('requires auth', async () => {
    assert.equal((await api(srv.url, 'POST', '/api/agent/chat', { body: { messages: [{ role: 'user', content: 'hi' }] } })).status, 401);
  });

  it('rejects an empty conversation', async () => {
    assert.equal((await api(srv.url, 'POST', '/api/agent/chat', { token, body: { messages: [] } })).status, 400);
  });

  it('returns a reply + structured brief for a sourcing ask', async () => {
    const r = await api(srv.url, 'POST', '/api/agent/chat', {
      token, body: { messages: [{ role: 'user', content: 'I want a react developer in Nashik' }] },
    });
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.reply, 'string');
    assert.ok(r.body.brief);
    assert.match(r.body.brief.role, /developer/i);
    assert.equal(typeof r.body.ready, 'boolean');
  });
});
