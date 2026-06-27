// Geo parsing + India detection. Turns a free-text location string into
// { city, state, country, countryCode } and decides whether a candidate is Indian.
import { STATES, CITY_TO_STATE as CITY_MAP } from '../data/indiaGeo.js';

const STATE_SET = new Set(STATES.map((s) => s.toLowerCase()));

// City → state from the full dataset, plus common aliases/spellings.
const CITY_TO_STATE = {
  ...CITY_MAP,
  bangalore: 'Karnataka',
  gurgaon: 'Haryana',
  trivandrum: 'Kerala',
  pondicherry: 'Puducherry',
  calcutta: 'West Bengal',
  bombay: 'Maharashtra',
  madras: 'Tamil Nadu',
  vizag: 'Andhra Pradesh',
  prayagraj: 'Uttar Pradesh',
  allahabad: 'Uttar Pradesh',
};

const INDIA_HINTS = /\b(india|bharat|भारत)\b/i;

// Administrative-noise words that wrap a real place name in scraped locations,
// e.g. "Greater Bengaluru Area", "Pune District", "Mumbai Metropolitan Region".
// Stripping them lets us recover the underlying city/state.
const NOISE_WORDS = /\b(greater|district|division|metropolitan|area|region|tehsil|taluka|taluk|mandal|subdivision|sub-division|zone)\b/gi;
const stripNoise = (s) => String(s || '').replace(NOISE_WORDS, ' ').replace(/\s+/g, ' ').trim();

// City→state lookup pre-sorted longest-first so "navi mumbai" wins over "mumbai".
const CITY_ENTRIES = Object.entries(CITY_TO_STATE).sort((a, b) => b[0].length - a[0].length);

export function parseLocation(text = '') {
  if (!text || typeof text !== 'string') return {};
  const rawTokens = text.split(',').map((t) => t.trim()).filter(Boolean);
  const tokens = rawTokens.map(stripNoise).filter(Boolean);
  const lower = text.toLowerCase();
  const isIndia = INDIA_HINTS.test(lower) || tokens.some((t) => STATE_SET.has(t.toLowerCase()));

  // 1) State = first (noise-stripped) token that matches a known Indian state.
  let state = tokens.find((t) => STATE_SET.has(t.toLowerCase())) || null;
  if (state) state = STATES.find((s) => s.toLowerCase() === state.toLowerCase());

  // 2) City = first token that isn't the state or the word "India".
  let city = tokens.find((t) => !STATE_SET.has(t.toLowerCase()) && !INDIA_HINTS.test(t)) || null;

  // 3) Backfill state from the city: exact match first, then a word-boundary scan
  //    of the whole (noise-stripped) string so "Greater Bengaluru Area" → Karnataka.
  if (!state && city && CITY_TO_STATE[city.toLowerCase()]) state = CITY_TO_STATE[city.toLowerCase()];
  if (!state) {
    const hay = ` ${stripNoise(lower)} `;
    for (const [ck, st] of CITY_ENTRIES) {
      if (hay.includes(` ${ck} `)) {
        state = st;
        if (!city || !CITY_TO_STATE[city.toLowerCase()]) city = ck.replace(/\b\w/g, (m) => m.toUpperCase());
        break;
      }
    }
  }

  return {
    city: city || null,
    state: state || null,
    country: isIndia ? 'India' : rawTokens[rawTokens.length - 1] || null,
    countryCode: isIndia ? 'IN' : null,
  };
}

// Map any-casing state string to the canonical STATES entry (so Mongo $in matches).
const CANON = new Map(STATES.map((s) => [s.toLowerCase(), s]));
export function canonicalState(s) {
  if (!s) return null;
  return CANON.get(String(s).trim().toLowerCase()) || s;
}

export function isIndian(c = {}) {
  if (c.countryCode === 'IN') return true;
  if (INDIA_HINTS.test(c.country || '')) return true;
  if (c.state && STATE_SET.has(String(c.state).toLowerCase())) return true;
  if (INDIA_HINTS.test(c.location || '')) return true;
  return false;
}

// ── International country support ───────────────────────────────────────────
// Supported countries for sourcing (recruiter picks one; we target it + filter to
// it). India stays the default, but the app now works for clients in any of these.
export const COUNTRIES = [
  { name: 'India', code: 'IN' },
  { name: 'United States', code: 'US' },
  { name: 'United Kingdom', code: 'GB' },
  { name: 'United Arab Emirates', code: 'AE' },
  { name: 'Singapore', code: 'SG' },
  { name: 'Canada', code: 'CA' },
  { name: 'Australia', code: 'AU' },
  { name: 'Germany', code: 'DE' },
  { name: 'Netherlands', code: 'NL' },
  { name: 'Ireland', code: 'IE' },
  { name: 'Saudi Arabia', code: 'SA' },
  { name: 'France', code: 'FR' },
];
const CODE_TO_NAME = new Map(COUNTRIES.map((c) => [c.code, c.name]));
const NAME_TO_CODE = new Map(COUNTRIES.map((c) => [c.name.toLowerCase(), c.code]));
// Common aliases recruiters type.
[['usa', 'US'], ['u.s.', 'US'], ['us', 'US'], ['united states of america', 'US'],
 ['uk', 'GB'], ['u.k.', 'GB'], ['britain', 'GB'], ['great britain', 'GB'], ['england', 'GB'],
 ['uae', 'AE'], ['emirates', 'AE'], ['dubai', 'AE'], ['abu dhabi', 'AE'], ['ksa', 'SA'],
].forEach(([k, v]) => NAME_TO_CODE.set(k, v));

// Map a country name (or 2-letter code) to its ISO code. "Anywhere"/"Remote" → null.
export function countryCodeOf(name) {
  if (!name) return null;
  const s = String(name).trim().toLowerCase();
  if (!s || s === 'anywhere' || s === 'remote' || s === 'any' || s === 'global' || s === 'worldwide') return null;
  return NAME_TO_CODE.get(s) || (/^[a-z]{2}$/.test(s) ? s.toUpperCase() : null);
}
export function countryName(code) {
  return CODE_TO_NAME.get(String(code || '').toUpperCase()) || code || null;
}

// Does a candidate belong to the given country code? Prefers the scraped
// countryCode; falls back to country/location text (and India's richer detection).
export function matchesCountry(c = {}, code) {
  if (!code) return true; // no country constraint
  if (code === 'IN') return isIndian(c);
  if (c.countryCode) return String(c.countryCode).toUpperCase() === code;
  const name = (CODE_TO_NAME.get(code) || '').toLowerCase();
  if (name && (String(c.country || '').toLowerCase().includes(name) || String(c.location || '').toLowerCase().includes(name))) return true;
  return false;
}
