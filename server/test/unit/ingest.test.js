import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSearchQuery, biasQueryForExperience } from '../../src/services/ingest.js';

describe('cleanSearchQuery', () => {
  it('distils a pasted sentence into a short "<qualifier> <role>" phrase', () => {
    const q = cleanSearchQuery('1 year experience in React development from Nashik', ['React']);
    assert.ok(q.length <= 60);
    assert.match(q, /develop/i);
  });

  it('keeps the qualifier word before the role', () => {
    assert.equal(cleanSearchQuery('Senior React Developer'), 'React Developer');
  });

  it('falls back to skills when there is no role word', () => {
    assert.equal(cleanSearchQuery('', ['React', 'Node', 'Mongo']), 'React Node');
    assert.equal(cleanSearchQuery('hello world foo', ['Go']), 'Go');
  });
});

describe('biasQueryForExperience', () => {
  it('prefixes Junior for entry-level bands', () => {
    assert.equal(biasQueryForExperience('React Developer', 0, 1), 'Junior React Developer');
    assert.equal(biasQueryForExperience('React Developer', 1, 3), 'Junior React Developer');
  });

  it('prefixes Senior for senior bands', () => {
    assert.equal(biasQueryForExperience('React Developer', 5, null), 'Senior React Developer');
  });

  it('leaves mid-level and already-seniority-tagged queries untouched', () => {
    assert.equal(biasQueryForExperience('React Developer', 3, 5), 'React Developer');
    assert.equal(biasQueryForExperience('Senior Engineer', 5, null), 'Senior Engineer');
    assert.equal(biasQueryForExperience('Lead Architect', 0, 1), 'Lead Architect');
  });
});
