import { usingApify } from '../config.js';
import { runActor } from './apifyClient.js';

// Lets a recruiter plug in ANY Apify actor by URL or id and run it as a source.
// Because arbitrary actors return arbitrary shapes, we map output best-effort by
// trying the common field names people's people-scrapers use.

/** Pull an actor id ("owner/name" or 17-char id) out of a URL or raw string. */
export function parseActorId(input = '') {
  let s = String(input).trim();
  if (!s) return null;
  // console.apify.com/actors/<id-or-owner~name>
  let m = s.match(/console\.apify\.com\/actors\/([a-zA-Z0-9~/_.-]+)/i);
  if (m) s = m[1];
  else {
    // apify.com/<owner>/<name>  (store page)
    m = s.match(/apify\.com\/([\w.-]+\/[\w.-]+)/i);
    if (m) s = m[1];
  }
  s = s.replace(/^https?:\/\//, '').split(/[?#]/)[0].replace(/\/+$/, '').replace('~', '/').trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return s;            // owner/name
  if (/^[a-zA-Z0-9]{17}$/.test(s)) return s;             // raw actor id
  const parts = s.split('/').filter(Boolean);
  if (parts.length >= 2 && /^[\w.-]+$/.test(parts[0]) && /^[\w.-]+$/.test(parts[1])) return `${parts[0]}/${parts[1]}`;
  if (parts[0] && /^[a-zA-Z0-9]{17}$/.test(parts[0])) return parts[0];
  return null;
}

const pick = (o, keys) => {
  for (const k of keys) {
    const v = o?.[k];
    if (v != null && v !== '') return v;
  }
  return undefined;
};

function locStr(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return v.full || v.linkedinText || v.parsed?.text || [v.city, v.state, v.country].filter(Boolean).join(', ') || '';
}

function skillList(v) {
  if (!v) return [];
  let arr = v;
  if (typeof v === 'string') arr = v.split(/,|;|·|\|/);
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => (typeof s === 'string' ? s : s?.name || s?.label || s?.skill)).filter(Boolean).map((s) => String(s).trim());
}

/**
 * Build a provider for an arbitrary Apify actor.
 * @param {string} actorId  e.g. "owner/name"
 * @param {object} extraInput  optional input overrides merged into the actor call
 */
export function makeCustomProvider(actorId, extraInput = {}) {
  return {
    id: `custom:${actorId}`,
    label: `Apify · ${actorId.split('/').pop()}`,
    compliance: 'custom',
    live: () => usingApify(),

    async fetch({ query, limit, location }) {
      // Send the search terms under every common key name; actors ignore unknowns.
      const input = {
        query, search: query, searchQuery: query, keyword: query, current_job_title: query,
        location, locations: location ? [location] : undefined,
        maxItems: limit, maxResults: limit, max_profiles: limit, maxProfiles: limit, limit,
        ...extraInput,
      };
      return runActor(actorId, input, { maxItems: limit });
    },

    normalize(raw) {
      const b = raw.basic_info || raw.profile || raw;
      const name =
        pick(b, ['fullName', 'fullname', 'name', 'full_name', 'displayName']) ||
        `${pick(b, ['firstName', 'first_name']) || ''} ${pick(b, ['lastName', 'last_name']) || ''}`.trim();
      return {
        externalId: pick(b, ['id', 'publicIdentifier', 'public_identifier', 'profileUrl', 'url', 'linkedinUrl']),
        fullName: name || 'Unknown',
        headline: pick(b, ['headline', 'title', 'currentTitle', 'designation', 'position', 'occupation']) || '',
        location: locStr(pick(b, ['location', 'locationName', 'city', 'address', 'geo'])),
        currentTitle: pick(b, ['currentTitle', 'jobTitle', 'title', 'designation', 'position']) || '',
        currentCompany: pick(b, ['currentCompany', 'companyName', 'company', 'current_company', 'employer']) || '',
        skills: skillList(pick(b, ['skills', 'keySkills', 'top_skills', 'skillsList', 'skill_list'])),
        profileUrl: pick(b, ['profileUrl', 'linkedinUrl', 'url', 'sourceUrl', 'profile_url', 'link']) || null,
        email: pick(b, ['email', 'emailAddress', 'work_email']) || null,
        phone: pick(b, ['phone', 'phoneNumber', 'mobile']) || null,
        summary: pick(b, ['about', 'summary', 'description', 'bio']) || '',
        experienceYears: pick(b, ['experienceYears', 'years_of_experience', 'totalExperience']) ?? null,
        openToWork: Boolean(pick(b, ['openToWork', 'open_to_work', 'isOpenToWork'])),
        rawSignals: [pick(b, ['headline', 'title']), pick(b, ['about', 'summary'])].filter(Boolean),
      };
    },
  };
}
