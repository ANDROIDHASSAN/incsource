import { config, usingApify } from '../config.js';
import { runActor } from './apifyClient.js';
import { mockNaukriJobs } from './mockData.js';
import { parseYears } from '../services/experience.js';

// Wired to: memo23/naukri-scraper
//   Input : { searchQuery, location, maximumJobs, platform, enrichEmails, freshnessDays }
//   Output: deeply-nested Naukri job postings.
//
// IMPORTANT: Naukri's public actors return JOB POSTINGS, not job-seekers (the
// candidate DB = Resdex, login-walled). So this is HIRING INTEL — who's hiring +
// recruiter contacts — not active candidates. We tag it recordType:'job-lead' and
// it scores ~0 on the Active-Intent engine, so it never pollutes candidate ranking.

function parseQuery(query = '') {
  const m = query.match(/^(.*?)\s+in\s+(.+)$/i);
  if (m) return { keyword: m[1].trim(), location: m[2].trim() };
  return { keyword: query.trim(), location: 'india' };
}

function skillsFrom(raw) {
  const ks = raw.keySkills;
  if (ks && (ks.preferred || ks.other)) {
    return [...(ks.preferred || []), ...(ks.other || [])].map((s) => s.label).filter(Boolean);
  }
  const tags = raw.basicInfo?.tagsAndSkills || raw.basicInfo?.keywords;
  return typeof tags === 'string' ? tags.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

export const naukriJobsProvider = {
  id: 'naukri-jobs',
  label: 'Naukri Jobs (hiring intel)',
  compliance: 'jobs-intel',

  enabled() {
    return true;
  },

  live() {
    return usingApify();
  },

  async fetch({ query, limit, location: loc }) {
    if (!usingApify()) return mockNaukriJobs(query);
    const { keyword, location } = parseQuery(query);
    const input = {
      platform: 'naukri',
      searchQuery: keyword,
      location: loc || location,
      maximumJobs: limit,
      enrichEmails: config.apify.naukriEnrichEmails,
    };
    return runActor(config.apify.naukriJobsActor, input, { maxItems: limit });
  },

  normalize(raw) {
    const b = raw.basicInfo || {};
    const title = raw.title || b.title || raw.Designation || 'Role';
    const company = raw.companyDetail?.name || b.companyName || raw.staticCompanyName || raw.Company?.Name || 'Company';
    const email = raw.Contact?.Email || b.email || null;
    return {
      externalId: raw.jobId || raw.JobId || b.jobId || raw.url,
      recordType: 'job-lead',
      fullName: company,
      headline: `Hiring: ${title}`,
      location: raw.Location || b.location || raw.companyDetail?.address || '',
      currentTitle: title,
      currentCompany: company,
      skills: skillsFrom(raw),
      experienceYears: parseYears(b.experienceText || raw.experience || ''),
      profileUrl: raw.url || raw.JdURL || b.jdURL || null,
      email,
      summary: raw.shortDescription || b.jobInfo || '',
      openToWork: false,
      rawSignals: ['naukri-job-posting', b.experienceText ? `exp:${b.experienceText}` : null].filter(Boolean),
    };
  },
};
