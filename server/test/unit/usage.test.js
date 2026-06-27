import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { usage, emailCap, emailRemaining, emailResetsAt } from '../../src/services/usage.js';

// Each test file runs in its own process with a per-process USAGE_FILE (test-setup),
// but reset between cases here for fully deterministic counters.
beforeEach(() => { try { fs.rmSync(process.env.USAGE_FILE, { force: true }); } catch { /* ignore */ } });

describe('email usage counter', () => {
  it('starts at zero with the full daily cap remaining', () => {
    assert.equal(usage.emailsToday(), 0);
    assert.equal(emailRemaining(), emailCap());
  });

  it('increments and decrements remaining', () => {
    usage.incEmail();
    usage.incEmail(2);
    assert.equal(usage.emailsToday(), 3);
    assert.equal(emailRemaining(), emailCap() - 3);
  });

  it('remaining never goes negative past the cap', () => {
    usage.incEmail(emailCap() + 50);
    assert.equal(emailRemaining(), 0);
  });
});

describe('groq usage counter', () => {
  it('tracks request counts', () => {
    assert.equal(usage.groqRequestsToday(), 0);
    usage.incGroq();
    usage.incGroq();
    assert.equal(usage.groqRequestsToday(), 2);
  });
});

describe('emailResetsAt', () => {
  it('is the next UTC midnight (in the future)', () => {
    const reset = new Date(emailResetsAt());
    assert.ok(reset.getTime() > Date.now());
    assert.equal(reset.getUTCHours(), 0);
    assert.equal(reset.getUTCMinutes(), 0);
  });
});
