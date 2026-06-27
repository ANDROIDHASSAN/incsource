// Normalize + dedupe utilities shared by the ingest pipeline.
import { parseLocation, canonicalState } from './geo.js';
import { parseYears } from './experience.js';

// Best-effort work-mode detection from a candidate's text. Most profiles don't
// state it → null (unknown), which filters treat leniently.
function deriveWorkMode(text = '') {
  const s = String(text).toLowerCase();
  if (/\bhybrid\b/.test(s)) return 'hybrid';
  if (/\bremote\b|\bwork from home\b|\bwfh\b|\bremotely\b/.test(s)) return 'remote';
  if (/\bon-?site\b|\bin[\s-]?office\b|\bwork from office\b|\bwfo\b/.test(s)) return 'onsite';
  return null;
}

function slug(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Canonicalize a profile URL so the same person from different providers/formats
// (http/https, www, query params, trailing slash) dedupes to one key.
function canonicalUrl(url) {
  return String(url)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[?#]/)[0]
    .replace(/\/+$/, '')
    .trim();
}

/**
 * Build a stable dedupe key for a candidate. Priority:
 *   - job-lead: external job id (companies repeat, names == company)
 *   - profile URL (canonicalized)
 *   - email
 *   - name + company
 */
export function dedupeKey(c) {
  if (c.recordType === 'job-lead') return `job:${slug(c.externalId || c.profileUrl || c.fullName)}`;
  if (c.profileUrl) return `url:${canonicalUrl(c.profileUrl)}`;
  if (c.email) return `email:${String(c.email).toLowerCase().trim()}`;
  return `nc:${slug(c.fullName)}|${slug(c.currentCompany)}`;
}

/** Ensure a normalized candidate has every expected field with sane defaults. */
export function ensureShape(partial, source) {
  // Backfill city/state/country from the location string when not given structurally.
  const parsed = parseLocation(partial.location);
  // Provider city fields are often polluted with the region ("Gurugram, Haryana"),
  // which breaks exact city matching — keep only the first segment.
  const firstSeg = (s) => (s ? String(s).split(',')[0].trim() : null);
  return {
    source,
    recordType: partial.recordType || 'candidate',
    externalId: partial.externalId ?? null,
    fullName: partial.fullName?.trim() || 'Unknown',
    headline: partial.headline?.trim() || '',
    location: partial.location?.trim() || '',
    city: firstSeg(partial.city) || parsed.city || null,
    state: canonicalState(partial.state || parsed.state) || null,
    country: partial.country || parsed.country || null,
    countryCode: partial.countryCode || parsed.countryCode || null,
    currentTitle: partial.currentTitle?.trim() || '',
    currentCompany: partial.currentCompany?.trim() || '',
    skills: Array.isArray(partial.skills) ? partial.skills.filter(Boolean).slice(0, 30) : [],
    // Years of experience: prefer a structured number, else parse it out of the
    // headline/summary (e.g. "Senior React Developer · 6 years").
    experienceYears:
      partial.experienceYears != null && !Number.isNaN(Number(partial.experienceYears))
        ? Number(partial.experienceYears)
        : parseYears(`${partial.headline || ''} ${partial.summary || ''}`),
    profileUrl: partial.profileUrl || null,
    email: partial.email || null,
    phone: partial.phone || null,
    summary: partial.summary || '',
    lastActiveAt: partial.lastActiveAt || null,
    noticePeriodDays: partial.noticePeriodDays ?? null,
    openToWork: Boolean(partial.openToWork),
    appliedToJob: partial.appliedToJob || null,
    workMode: partial.workMode || deriveWorkMode(`${partial.headline || ''} ${partial.summary || ''} ${partial.location || ''}`),
    rawSignals: partial.rawSignals || [],
  };
}

// Some "developer" searches surface company / business pages (e.g. "Rajashree
// Group", a real-estate firm) rather than people. Drop them — a recruiter wants
// candidates, not businesses. Detected from business-entity words in the name.
const COMPANY_NAME_RX = /\b(group|pvt\.?\s*ltd|private limited|ltd|llp|inc|solutions|technologies|technolog|systems|enterprises|infotech|realty|developers|builders|constructions?|industries|corporation|ventures|associates|consultancy|consultants|infra|logistics|services pvt)\b/i;
export function isLikelyCompany(c) {
  return COMPANY_NAME_RX.test(c?.fullName || '');
}

/** Collapse duplicates within a single batch, keeping the richest record. */
export function dedupeBatch(candidates) {
  const map = new Map();
  for (const c of candidates) {
    const key = c.dedupeKey;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, c);
    } else {
      map.set(key, {
        ...prev,
        ...c,
        email: c.email || prev.email,
        phone: c.phone || prev.phone,
        experienceYears: c.experienceYears ?? prev.experienceYears,
        skills: [...new Set([...(prev.skills || []), ...(c.skills || [])])],
        // accumulate sources correctly across 3+ collisions
        sources: [...new Set([...(prev.sources || [prev.source]), c.source])],
        openToWork: Boolean(prev.openToWork || c.openToWork),
        activeScore: Math.max(prev.activeScore || 0, c.activeScore || 0),
      });
    }
  }
  return [...map.values()];
}
