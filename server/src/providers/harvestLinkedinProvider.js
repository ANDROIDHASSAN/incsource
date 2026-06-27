import { config, usingApify } from '../config.js';
import { runActor } from './apifyClient.js';
import { mockHarvest } from './mockData.js';
import { yearsFromHistory } from '../services/experience.js';

// Wired to: harvestapi/linkedin-profile-search
//   Input : { searchQuery, currentJobTitles[], locations[], maxItems, profileScraperMode, recentlyChangedJobs }
//   Output: top-level { openToWork, hiring, firstName, lastName, headline, linkedinUrl,
//                       currentPosition[], skills[], topSkills, location{}, emails }

function parseQuery(query = '') {
  const m = query.match(/^(.*?)\s+in\s+(.+)$/i);
  if (m) return { title: m[1].trim(), location: m[2].trim() };
  return { title: query.trim(), location: '' };
}

export const harvestLinkedinProvider = {
  id: 'linkedin-harvest',
  label: 'LinkedIn (HarvestAPI)',
  compliance: 'scraping',

  enabled() {
    return true;
  },

  live() {
    return usingApify();
  },

  async fetch({ query, limit, location: loc }) {
    if (!usingApify()) return mockHarvest(query);
    const parsed = parseQuery(query);
    const location = loc || parsed.location || 'India';
    const input = {
      searchQuery: parsed.title || undefined,
      currentJobTitles: parsed.title ? [parsed.title] : undefined,
      locations: [location],
      maxItems: limit,
      profileScraperMode: config.apify.includeEmail ? 'Full + email search' : 'Full',
      // Focus segmentation on India to pull more unique Indian profiles.
      autoQuerySegmentationTargetCountries: /india/i.test(location) ? ['IN'] : undefined,
    };
    return runActor(config.apify.harvestActor, input, { maxItems: limit });
  },

  normalize(raw) {
    const pos = (raw.currentPosition && raw.currentPosition[0]) || (raw.currentPositions && raw.currentPositions[0]) || {};
    const skills = Array.isArray(raw.skills)
      ? raw.skills.map((s) => (typeof s === 'string' ? s : s.name)).filter(Boolean)
      : typeof raw.topSkills === 'string'
        ? raw.topSkills.split(/,|·/).map((s) => s.trim()).filter(Boolean)
        : [];
    const email = Array.isArray(raw.emails) && raw.emails.length ? (raw.emails[0].email || raw.emails[0]) : null;

    return {
      externalId: raw.publicIdentifier || raw.id || raw.linkedinUrl,
      fullName: `${raw.firstName || ''} ${raw.lastName || ''}`.trim() || raw.name || 'Unknown',
      headline: raw.headline || '',
      location: raw.location?.linkedinText || raw.location?.parsed?.text || '',
      city: raw.location?.parsed?.city || null,
      state: raw.location?.parsed?.state || null,
      country: raw.location?.parsed?.country || null,
      countryCode: raw.location?.parsed?.countryCode || raw.location?.countryCode || null,
      currentTitle: pos.position || pos.title || '',
      currentCompany: pos.companyName || pos.company?.name || '',
      skills,
      experienceYears: raw.experienceYears ?? yearsFromHistory(raw.experience || raw.positions || raw.currentPositions || raw.currentPosition) ?? null,
      profileUrl: raw.linkedinUrl || null,
      email,
      summary: raw.about || raw.summary || '',
      openToWork: Boolean(raw.openToWork),
      rawSignals: [
        raw.headline,
        raw.openToWork ? 'open-to-work-badge' : null,
        raw.hiring ? 'currently-hiring' : null,
      ].filter(Boolean),
    };
  },
};
