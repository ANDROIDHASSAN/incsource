import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { agentTurn, interpretVoiceCommand } from '../../src/services/agent.js';

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

  it('backfills the state from a known city (Nashik → Maharashtra)', async () => {
    const t = await agentTurn([{ role: 'user', content: 'React developer in Nashik, 5 candidates' }]);
    assert.equal(t.brief.city, 'Nashik');
    assert.equal(t.brief.state, 'Maharashtra');
    assert.equal(t.brief.count, 5);
  });

  it('handles multi-word city names (New Delhi)', async () => {
    const t = await agentTurn([{ role: 'user', content: 'find 7 python developers in New Delhi' }]);
    assert.equal(t.brief.city, 'New Delhi');
    assert.equal(t.brief.state, 'Delhi');
    assert.equal(t.brief.count, 7);
  });

  it('respects an explicit experience band', async () => {
    const t = await agentTurn([{ role: 'user', content: 'mid-level node developer in Pune' }]);
    assert.equal(t.brief.expMin, 3);
    assert.equal(t.brief.expMax, 5);
    assert.equal(t.brief.state, 'Maharashtra');
  });
});

// No GROQ key in tests → the deterministic voice command interpreter runs.
describe('voice command interpreter (offline)', () => {
  it('maps a sourcing command to a source action with a brief', async () => {
    const r = await interpretVoiceCommand('Jarvis find me 5 React developers in Nashik');
    assert.equal(r.action, 'source');
    assert.equal(r.params.brief.city, 'Nashik');
    assert.equal(r.params.brief.state, 'Maharashtra');
    assert.equal(r.params.brief.count, 5);
    assert.ok(typeof r.speak === 'string' && r.speak.length);
  });

  it('maps filter, summarize, usage, navigate and stop intents', async () => {
    assert.equal((await interpretVoiceCommand('show me the hot candidates')).action, 'filter');
    assert.equal((await interpretVoiceCommand('clear the filters')).params.clear, true);
    assert.equal((await interpretVoiceCommand('read the results')).action, 'summarize');
    assert.equal((await interpretVoiceCommand('what is my usage')).action, 'usage');
    assert.equal((await interpretVoiceCommand('open match to jd')).params.panel, 'jd');
    assert.equal((await interpretVoiceCommand('stop')).action, 'stop');
  });

  it('always returns a spoken reply and a valid action', async () => {
    const r = await interpretVoiceCommand('tell me a joke');
    assert.ok(['say', 'source', 'filter', 'summarize', 'usage', 'navigate', 'stop'].includes(r.action));
    assert.ok(r.speak.length > 0);
  });
});
