import { config, usingApify } from '../config.js';
import { runActor } from './apifyClient.js';
import { mockLinkedin } from './mockData.js';
import { yearsFromHistory } from '../services/experience.js';

// Wired to: apimaestro/linkedin-profile-search-scraper
//   Input  : { firstname, lastname, current_job_title, location, max_profiles, include_email }
//   Output : { basic_info: {...}, experience: [...], skills: [...], ... }  (one item per profile)

// The dashboard sends one free-text box. Support an intuitive "title in location"
// convention, e.g. "react developer in bengaluru" → title + location.
function parseQuery(query = '') {
  const m = query.match(/^(.*?)\s+in\s+(.+)$/i);
  if (m) return { current_job_title: m[1].trim(), location: m[2].trim() };
  return { current_job_title: query.trim(), location: '' };
}

export const apifyLinkedinProvider = {
  id: 'apify-linkedin',
  label: 'LinkedIn (Apify)',
  compliance: 'scraping',

  enabled() {
    return true; // always usable — falls back to mock without a token
  },

  live() {
    return usingApify();
  },

  async fetch({ query, limit, location: loc }) {
    if (!usingApify()) return mockLinkedin(query);
    const parsed = parseQuery(query);
    const input = {
      current_job_title: parsed.current_job_title,
      location: loc || parsed.location || 'India', // bias the search to the requested region
      max_profiles: limit,
      include_email: config.apify.includeEmail,
    };
    return runActor(config.apify.linkedinActor, input, { maxItems: limit });
  },

  normalize(raw) {
    // Real actor nests everything under basic_info; mock data is already flat.
    const b = raw.basic_info || raw;
    const currentExp = (raw.experience || []).find((e) => e.is_current) || {};
    let skills = b.top_skills || raw.skills || raw.skills_list || [];
    if (typeof skills === 'string') skills = skills.split(/,|·|;/).map((s) => s.trim()).filter(Boolean);

    return {
      externalId: b.public_identifier || b.urn || b.profile_url || raw.profileUrl,
      fullName: b.fullname || raw.fullName || `${b.first_name || ''} ${b.last_name || ''}`.trim(),
      headline: b.headline || raw.headline || '',
      location: b.location?.full || raw.locationName || raw.location || '',
      city: b.location?.city || null,
      country: b.location?.country || null,
      countryCode: b.location?.country_code || null,
      currentTitle: currentExp.title || raw.jobTitle || '',
      currentCompany: b.current_company || currentExp.company || raw.companyName || '',
      skills: Array.isArray(skills) ? skills : [],
      // Accurate YOE from the work-history start dates (falls back to a stated number).
      experienceYears: raw.experienceYears ?? b.years_of_experience ?? yearsFromHistory(raw.experience) ?? null,
      profileUrl: b.profile_url || raw.profileUrl || raw.url || null,
      email: b.email || raw.email || null,
      summary: b.about || raw.summary || '',
      openToWork:
        Boolean(b.open_to_work || raw.openToWork) ||
        /open\s?to\s?work/i.test(b.headline || raw.headline || ''),
      lastActiveAt: raw.lastActivity || raw.lastActiveAt || null, // LinkedIn doesn't expose this
      rawSignals: [b.headline || raw.headline, b.about].filter(Boolean),
    };
  },
};
