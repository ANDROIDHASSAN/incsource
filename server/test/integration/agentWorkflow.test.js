import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { startAgenticRun, getJob } from '../../src/services/agentWorkflow.js';
import { initStore } from '../../src/store/index.js';

// No GROQ key in tests → every LLM agent uses its deterministic fallback, so the
// whole background workflow runs offline and reproducibly. Mock providers supply
// candidates (Bengaluru/Pune/etc.).
const ORG = 'aw-test-org';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function runToDone(brief, sources) {
  const id = startAgenticRun({ brief, sources, orgId: ORG });
  for (let i = 0; i < 80; i++) {
    const j = getJob(id, ORG);
    if (j && j.status !== 'running') return j;
    await wait(120);
  }
  throw new Error('workflow did not finish in time');
}

describe('agentic workflow (background engine, offline)', () => {
  before(async () => { await initStore(); });

  it('runs the whole agent team to completion and settles every agent', async () => {
    const job = await runToDone(
      { role: 'React developer', city: 'Bengaluru', state: 'Karnataka', country: 'India', expMin: 1, expMax: 8, count: 5, openToWork: false, wantsEmail: false },
      ['inbound', 'linkedin-harvest', 'apify-linkedin']
    );
    assert.equal(job.status, 'done');
    assert.ok(job.agents.every((a) => ['done', 'skipped', 'failed'].includes(a.status)), 'no agent left stuck on "working"');
    assert.equal(job.agents.find((a) => a.id === 'orchestrator').status, 'done');
    assert.ok(job.agents.some((a) => a.id === 'critic'), 'a Critic agent ran');
    assert.ok(!job.agents.some((a) => a.id === 'outreach'), 'no Outreach agent when email not requested');
    assert.ok(job.events.length > 5, 'emitted a real event stream');
    assert.ok(job.result?.run, 'produced a session');
  });

  it('keeps the result strictly in the requested city (one clean session)', async () => {
    const job = await runToDone(
      { role: 'React developer', city: 'Bengaluru', state: 'Karnataka', country: 'India', count: 6, openToWork: false, wantsEmail: false },
      ['inbound', 'linkedin-harvest', 'apify-linkedin']
    );
    assert.match(job.result.run.location, /Bengaluru/);
    assert.ok((job.result.kept || 0) >= 1, 'returned the in-city candidates');
  });

  it('org-scopes job access', () => {
    const id = startAgenticRun({ brief: { role: 'dev', city: 'Pune', count: 2 }, orgId: ORG });
    assert.equal(getJob(id, 'someone-else'), null, 'another org cannot read the job');
    assert.ok(getJob(id, ORG), 'owning org can read the job');
  });

  it('adds the Outreach agent to the roster only when email is requested', () => {
    const id = startAgenticRun({ brief: { role: 'dev', city: 'Pune', count: 2, wantsEmail: true }, orgId: ORG });
    assert.ok(getJob(id, ORG).agents.some((a) => a.id === 'outreach'));
  });
});
