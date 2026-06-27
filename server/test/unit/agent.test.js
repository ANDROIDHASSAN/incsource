import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { agentTurn } from '../../src/services/agent.js';

// No GROQ_API_KEY in tests → the deterministic fallback planner runs.
describe('agent (offline planner)', () => {
  it('extracts role, city and experience from a free-form ask', async () => {
    const t = await agentTurn([{ role: 'user', content: 'I need a React developer in Nashik with 3 years experience' }]);
    assert.match(t.brief.role, /developer/i);
    assert.equal(t.brief.city, 'Nashik');
    assert.equal(t.brief.expMin, 3);
    assert.equal(t.ready, false); // still needs the email decision
    assert.equal(typeof t.reply, 'string');
  });

  it('captures must-have skills and count', async () => {
    const t = await agentTurn([{ role: 'user', content: 'find 10 senior node and react developers in Pune' }]);
    assert.equal(t.brief.count, 10);
    assert.ok(t.brief.skills.includes('node') && t.brief.skills.includes('react'));
    assert.equal(t.brief.expMin, 5); // "senior"
  });

  it('becomes ready once role, location, experience and email decision are known', async () => {
    const t = await agentTurn([
      { role: 'user', content: 'junior react developer in Mumbai' },
      { role: 'assistant', content: 'Should I email them?' },
      { role: 'user', content: 'yes send them emails' },
    ]);
    assert.equal(t.ready, true);
    assert.equal(t.brief.wantsEmail, true);
    assert.match(t.reply, /run/i);
  });
});
