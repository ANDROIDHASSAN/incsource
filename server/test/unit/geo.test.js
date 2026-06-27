import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isIndian, countryCodeOf, countryName, matchesCountry } from '../../src/services/geo.js';

describe('isIndian', () => {
  it('detects India from country code, state, or location text', () => {
    assert.equal(isIndian({ countryCode: 'IN' }), true);
    assert.equal(isIndian({ state: 'Maharashtra' }), true);
    assert.equal(isIndian({ location: 'Bengaluru, India' }), true);
  });
  it('rejects non-Indian profiles', () => {
    assert.equal(isIndian({ countryCode: 'US', location: 'Austin, Texas' }), false);
    assert.equal(isIndian({}), false);
  });
});

describe('countryCodeOf / countryName', () => {
  it('resolves names and common aliases to ISO codes', () => {
    assert.equal(countryCodeOf('India'), 'IN');
    assert.equal(countryCodeOf('USA'), 'US');
    assert.equal(countryCodeOf('uk'), 'GB');
    assert.equal(countryCodeOf('uae'), 'AE');
  });
  it('treats "anywhere"/blank as no constraint (null)', () => {
    assert.equal(countryCodeOf('anywhere'), null);
    assert.equal(countryCodeOf(''), null);
    assert.equal(countryCodeOf(null), null);
  });
  it('round-trips code → name', () => {
    assert.equal(countryName('IN'), 'India');
    assert.equal(countryName('US'), 'United States');
  });
});

describe('matchesCountry', () => {
  it('null code means no constraint (matches anyone)', () => {
    assert.equal(matchesCountry({ countryCode: 'US' }, null), true);
  });
  it('matches on the candidate country code', () => {
    assert.equal(matchesCountry({ countryCode: 'US' }, 'US'), true);
    assert.equal(matchesCountry({ countryCode: 'US' }, 'IN'), false);
  });
  it('uses richer detection for India', () => {
    assert.equal(matchesCountry({ state: 'Karnataka' }, 'IN'), true);
  });
});
