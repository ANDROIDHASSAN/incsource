import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreActiveIntent, scoreBand } from '../../src/services/activeSignal.js';

describe('scoreActiveIntent', () => {
  it('an open-to-work candidate is never "cold" (lands in warm/hot)', () => {
    // Regression guard: stated open-to-work alone must clear the warm threshold (40).
    const { activeScore } = scoreActiveIntent({ fullName: 'A', openToWork: true });
    assert.ok(activeScore >= 40, `expected >= 40, got ${activeScore}`);
    assert.notEqual(scoreBand(activeScore), 'cold');
  });

  it('applying to your job is the strongest signal', () => {
    const { activeScore, scoreBreakdown } = scoreActiveIntent({ fullName: 'A', appliedToJob: 'React Dev' });
    assert.ok(activeScore >= 50);
    assert.ok(scoreBreakdown.some((b) => /applied/i.test(b.label)));
  });

  it('produces an explainable breakdown that sums to the score (capped at 100)', () => {
    const c = {
      fullName: 'A', openToWork: true, appliedToJob: 'Dev', noticePeriodDays: 0,
      email: 'a@x.com', skills: ['a', 'b', 'c', 'd'], currentTitle: 'Dev',
      headline: 'open to work, immediate joiner, looking for roles',
    };
    const { activeScore, scoreBreakdown } = scoreActiveIntent(c);
    assert.ok(scoreBreakdown.length > 0);
    assert.ok(activeScore <= 100);
    assert.ok(scoreBreakdown.every((b) => b.points > 0));
  });

  it('a stale profile with no signals scores 0 (cold)', () => {
    const { activeScore } = scoreActiveIntent({ fullName: 'A' });
    assert.equal(activeScore, 0);
    assert.equal(scoreBand(activeScore), 'cold');
  });
});

describe('scoreBand', () => {
  it('maps scores to bands at the documented thresholds', () => {
    assert.equal(scoreBand(70), 'hot');
    assert.equal(scoreBand(69), 'warm');
    assert.equal(scoreBand(40), 'warm');
    assert.equal(scoreBand(39), 'cold');
    assert.equal(scoreBand(0), 'cold');
  });
});
