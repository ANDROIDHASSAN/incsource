import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { runSourcing } from '../../src/services/ingest.js';
import { initStore } from '../../src/store/index.js';

// Feed a controlled candidate set through the inbound provider (records) so we can
// assert exactly what STRICT mode keeps vs. what the lenient run widens to.
const rec = (id, name, city, years) => ({
  externalId: id,
  fullName: name,
  location: `${city}, India`,
  currentTitle: 'React Developer',
  currentCompany: 'Acme',
  skills: ['React', 'Node.js'],
  experienceYears: years,
  lastActiveAt: new Date().toISOString(),
});

// 2 in-city + in-band, 1 in-city but out-of-band, 3 elsewhere in the same state.
const RECORDS = [
  rec('N1', 'Asha Nashik', 'Nashik', 2),
  rec('N2', 'Bina Nashik', 'Nashik', 3),
  rec('N3', 'Old Timer', 'Nashik', 12),   // out of the 1–3 band
  rec('P1', 'Pal Pune', 'Pune', 2),       // Maharashtra, not Nashik
  rec('M1', 'Mit Mumbai', 'Mumbai', 2),   // Maharashtra, not Nashik
  rec('M2', 'Meera Mumbai', 'Mumbai', 3), // Maharashtra, not Nashik
];

const base = {
  sources: ['inbound'],
  records: RECORDS,
  query: 'React Developer',
  city: 'Nashik',
  count: 5,
  expMin: 1,
  expMax: 3,
  openToWorkOnly: false, // isolate the geo + experience behaviour
};

describe('strict sourcing (AI assistant)', () => {
  before(async () => { await initStore(); });

  it('returns ONLY the requested city + experience band, even when short of count', async () => {
    const { candidates } = await runSourcing({ ...base, strict: true });
    const names = candidates.map((c) => c.fullName).sort();
    assert.deepEqual(names, ['Asha Nashik', 'Bina Nashik'], 'strict must keep only in-Nashik, in-band people');
    // Never leaks another city or an out-of-band person to pad the count.
    assert.ok(!candidates.some((c) => /Pune|Mumbai/.test(c.location)), 'no out-of-city padding');
    assert.ok(!candidates.some((c) => c.experienceYears > 4), 'no out-of-band padding');
    assert.ok(candidates.length < base.count, 'honest "X of N" — fewer than requested');
  });

  it('lenient (dashboard) mode WIDENS to fill the count', async () => {
    const { candidates } = await runSourcing({ ...base, strict: false });
    // The lenient run pads toward the target from the surrounding state.
    assert.ok(candidates.length > 2, 'lenient widens beyond the 2 exact-Nashik matches');
    assert.ok(candidates.some((c) => /Pune|Mumbai/.test(c.location)), 'lenient surfaces nearby-state talent');
  });

  it('infers the state from a known city (Nashik → Maharashtra)', async () => {
    const { run } = await runSourcing({ ...base, strict: true });
    assert.match(run.location, /Maharashtra/);
  });
});
