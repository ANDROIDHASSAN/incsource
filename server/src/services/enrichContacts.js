// Contact enrichment — finds verified email for candidates from their
// name + company, via ryanclinton/waterfall-contact-enrichment.
// Premium ($0.20/contact), so callers cap how many they enrich.
import { config, usingApify } from '../config.js';
import { runActor } from '../providers/apifyClient.js';

function splitName(full = '') {
  const parts = String(full).trim().split(/\s+/);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || parts[0] || '' };
}

function buildPeople(candidates) {
  return candidates
    .map((c) => {
      if (c.email) return null; // never pay to enrich a contact we already have
      const { firstName, lastName } = splitName(c.fullName);
      if (!firstName || !c.currentCompany) return null;
      return { firstName, lastName, company: c.currentCompany, _id: c.id };
    })
    .filter(Boolean);
}

// Match an enrichment result back to a candidate by name (case-insensitive).
function keyOf(first, last) {
  return `${String(first).toLowerCase().trim()}|${String(last).toLowerCase().trim()}`;
}

/**
 * Enrich a list of candidates in place. Returns { enriched, withEmail }.
 * Only fills fields that are currently missing — never overwrites existing contact.
 */
export async function enrichContacts(candidates) {
  if (!usingApify()) return { enriched: 0, withEmail: 0, error: 'Apify token not set' };
  const people = buildPeople(candidates);
  if (!people.length) return { enriched: 0, withEmail: 0, error: 'No name+company to enrich' };

  let results;
  try {
    results = await runActor(
      config.apify.contactActor,
      {
        people: people.map(({ firstName, lastName, company }) => ({ firstName, lastName, company })),
        verificationLevel: config.apify.contactVerify,
        enrichFromWebsite: true,
        detectPattern: true,
        outputProfile: 'standard',
      },
      { maxItems: people.length }
    );
  } catch (err) {
    return { enriched: 0, withEmail: 0, error: err.message };
  }

  const byName = new Map();
  for (const r of results || []) byName.set(keyOf(r.firstName, r.lastName), r);

  let enriched = 0;
  let withEmail = 0;
  for (const c of candidates) {
    const { firstName, lastName } = splitName(c.fullName);
    const r = byName.get(keyOf(firstName, lastName));
    if (!r) continue;
    if (!c.email && r.email) {
      c.email = r.email;
      withEmail++;
      c.rawSignals = [...new Set([...(c.rawSignals || []), 'contact-enriched'])];
      enriched++;
    }
  }
  return { enriched, withEmail };
}
