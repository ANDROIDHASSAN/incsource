import { config, usingApify } from '../config.js';
import { runActor } from './apifyClient.js';
import { mockIndeed } from './mockData.js';
import { yearsFromExperiences } from '../services/experience.js';

// Wired to: lexis-solutions/resume-indeed-com-scraper
//   Input : { startUrls[], maxItems, proxyConfiguration }
//   Output: { name, currentTitle, currentCompany, location, skills[], experiences[],
//             educations[], isFreeToContact, matchId, sourceUrl, highlights[] }
// Posting a public resume IS the active-job-seeking signal.

function buildSearchUrl(query = '', location = 'India') {
  const q = encodeURIComponent(query || 'software');
  const l = encodeURIComponent(location || 'India');
  // sort=date surfaces the most recently updated resumes (freshest job-seekers).
  return `https://resumes.indeed.com/search?q=${q}&l=${l}&co=IN&sort=date`;
}

export const indeedResumeProvider = {
  id: 'indeed-resume',
  label: 'Indeed Resumes',
  compliance: 'scraping',

  enabled() {
    return true;
  },

  live() {
    return usingApify();
  },

  async fetch({ query, limit, location }) {
    if (!usingApify()) return mockIndeed(query);
    const input = {
      startUrls: [{ url: buildSearchUrl(query, location) }],
      maxItems: limit,
      proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'], apifyProxyCountry: 'US' },
    };
    return runActor(config.apify.indeedActor, input, { maxItems: limit });
  },

  normalize(raw) {
    const skills = Array.isArray(raw.skills) ? raw.skills : [];
    const latest = Array.isArray(raw.experiences) && raw.experiences[0] ? raw.experiences[0] : {};
    return {
      externalId: raw.matchId || raw.sourceUrl,
      fullName: raw.name || 'Unknown',
      headline: raw.currentTitle || latest.title || '',
      location: raw.location || '',
      currentTitle: raw.currentTitle || latest.title || '',
      currentCompany: raw.currentCompany || latest.company || '',
      skills,
      experienceYears: raw.experienceYears ?? yearsFromExperiences(raw.experiences),
      profileUrl: raw.sourceUrl || null,
      summary: Array.isArray(raw.highlights) ? raw.highlights.join(' ') : '',
      // Resume posters are active job-seekers by definition.
      openToWork: true,
      rawSignals: [
        'posted-resume',
        raw.isFreeToContact ? 'free-to-contact' : null,
        ...(Array.isArray(raw.highlights) ? raw.highlights : []),
      ].filter(Boolean),
    };
  },
};
