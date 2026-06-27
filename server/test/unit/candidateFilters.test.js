import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFilters, matchesFilters, toMongoQuery } from '../../src/services/candidateFilters.js';

const candidate = (over = {}) => ({
  fullName: 'Asha Rao', headline: 'React developer', currentTitle: 'React Developer',
  currentCompany: 'Acme', location: 'Pune, Maharashtra, India', city: 'Pune', state: 'Maharashtra',
  countryCode: 'IN', skills: ['React', 'Node.js'], status: 'New', recordType: 'candidate',
  fitScore: 80, activeScore: 50, openToWork: true, experienceYears: 4, email: 'a@x.com', ...over,
});

describe('normalizeFilters', () => {
  it('maps a band to its score range', () => {
    const f = normalizeFilters({ band: 'hot' });
    assert.equal(f.minScore, 70);
    assert.equal(f.maxScore, 100);
  });

  it('whitelists the sort field (rejects arbitrary input → safe default)', () => {
    assert.equal(normalizeFilters({ sort: '-activeScore' }).sort, '-activeScore');
    assert.equal(normalizeFilters({ sort: 'fullName' }).sort, 'fullName');
    assert.equal(normalizeFilters({ sort: '; DROP TABLE' }).sort, '-fitScore');
    assert.equal(normalizeFilters({ sort: 'passwordHash' }).sort, '-fitScore');
  });

  it('clamps limit into a sane range and parses CSV arrays', () => {
    assert.equal(normalizeFilters({ limit: 99999 }).limit, 500);
    assert.equal(normalizeFilters({ limit: -5 }).limit, 1);
    assert.deepEqual(normalizeFilters({ skills: 'React, Node, ' }).skills, ['React', 'Node']);
  });
});

describe('matchesFilters', () => {
  it('open-to-work filter excludes candidates without the flag', () => {
    const f = normalizeFilters({ openToWork: true });
    assert.equal(matchesFilters(candidate({ openToWork: true }), f), true);
    assert.equal(matchesFilters(candidate({ openToWork: false }), f), false);
  });

  it('score band filters on JD fit, falling back to active intent', () => {
    const hot = normalizeFilters({ band: 'hot' });
    assert.equal(matchesFilters(candidate({ fitScore: 90 }), hot), true);
    assert.equal(matchesFilters(candidate({ fitScore: 50 }), hot), false);
    // No fitScore → falls back to activeScore.
    assert.equal(matchesFilters(candidate({ fitScore: null, activeScore: 75 }), hot), true);
  });

  it('skills match supports any vs all', () => {
    const any = normalizeFilters({ skills: 'React,Go', skillsMatch: 'any' });
    const all = normalizeFilters({ skills: 'React,Go', skillsMatch: 'all' });
    assert.equal(matchesFilters(candidate({ skills: ['React'] }), any), true);
    assert.equal(matchesFilters(candidate({ skills: ['React'] }), all), false);
    assert.equal(matchesFilters(candidate({ skills: ['React', 'Go'] }), all), true);
  });

  it('city filter is case/transliteration tolerant', () => {
    const f = normalizeFilters({ cities: 'Pune' });
    assert.equal(matchesFilters(candidate({ city: 'pune' }), f), true);
    assert.equal(matchesFilters(candidate({ city: 'Mumbai', location: 'Mumbai' }), f), false);
  });

  it('experience band is strict (known years inside the band only)', () => {
    const fresher = normalizeFilters({ expMin: 0, expMax: 1 });
    assert.equal(matchesFilters(candidate({ experienceYears: 1 }), fresher), true);
    assert.equal(matchesFilters(candidate({ experienceYears: 4 }), fresher), false);
    assert.equal(matchesFilters(candidate({ experienceYears: null }), fresher), false);
  });

  it('free-text query matches across name/skills/company', () => {
    const f = normalizeFilters({ q: 'react' });
    assert.equal(matchesFilters(candidate(), f), true);
    assert.equal(matchesFilters(candidate({ headline: 'Designer', currentTitle: 'Designer', skills: ['Figma'] }), f), false);
  });

  it('hides job-leads unless explicitly included', () => {
    const base = normalizeFilters({});
    assert.equal(matchesFilters(candidate({ recordType: 'job-lead' }), base), false);
    const withLeads = normalizeFilters({ includeLeads: true });
    assert.equal(matchesFilters(candidate({ recordType: 'job-lead' }), withLeads), true);
  });
});

describe('toMongoQuery', () => {
  it('translates the open-to-work + email filters to a safe query', () => {
    const q = toMongoQuery(normalizeFilters({ openToWork: true, hasEmail: true }));
    assert.equal(q.openToWork, true);
    assert.deepEqual(q.email, { $nin: [null, ''] });
  });

  it('escapes regex metacharacters in free-text search (ReDoS / injection safe)', () => {
    const q = toMongoQuery(normalizeFilters({ q: 'a.*+(' }));
    const rx = q.$and[0].$or[0].fullName.$regex;
    assert.equal(rx, 'a\\.\\*\\+\\(');
  });
});
