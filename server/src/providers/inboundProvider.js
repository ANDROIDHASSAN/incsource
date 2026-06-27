// Inbound provider — candidates who applied to YOUR jobs or opted in.
// This is the cleanest, fully-ownable source. In production you'd read from your
// ATS / application form table; here we accept records passed in the run payload
// and fall back to a small seed so the demo shows the highest-intent band.
import { usingApify } from '../config.js';

const seedInbound = [
  {
    externalId: 'IN-1001',
    fullName: 'Kavya Reddy',
    email: 'kavya.reddy@example.com',
    phone: '+91 98xxxxxx10',
    headline: 'MERN Stack Developer — applied via careers page',
    location: 'Bengaluru, India',
    currentTitle: 'Software Engineer',
    currentCompany: 'Razorpay',
    skills: ['React', 'Node.js', 'MongoDB', 'Express', 'AWS'],
    experienceYears: 4,
    noticePeriodDays: 15,
    appliedToJob: 'Senior MERN Developer',
    lastActiveAt: new Date().toISOString(),
  },
];

export const inboundProvider = {
  id: 'inbound',
  label: 'Inbound applicants',
  compliance: 'owned',

  enabled() {
    return true;
  },

  live() {
    return true; // always "live" — it's your own data
  },

  async fetch({ records } = {}) {
    // `records` come from your ATS / application webhook in production.
    if (Array.isArray(records) && records.length) return records;
    // Only show the sample applicant in demo mode; never inject mock data when live.
    return usingApify() ? [] : seedInbound;
  },

  normalize(raw) {
    return {
      externalId: raw.externalId,
      fullName: raw.fullName,
      email: raw.email || null,
      phone: raw.phone || null,
      headline: raw.headline || '',
      location: raw.location || '',
      currentTitle: raw.currentTitle || '',
      currentCompany: raw.currentCompany || '',
      skills: raw.skills || [],
      experienceYears: raw.experienceYears ?? null,
      profileUrl: raw.profileUrl || null,
      noticePeriodDays: raw.noticePeriodDays ?? null,
      appliedToJob: raw.appliedToJob || null,
      lastActiveAt: raw.lastActiveAt || null,
      rawSignals: ['inbound-application'],
    };
  },
};
