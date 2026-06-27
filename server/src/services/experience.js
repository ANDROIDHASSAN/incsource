// Experience parsing + banding. Turns messy "5+ years" / "5-8 Yrs" text and
// structured experience arrays into a single `experienceYears` number, and maps
// any year count into the recruiter-facing band used by the UI filters.

/** Parse a years-of-experience number from free text. Ranges → take the minimum. */
export function parseYears(text = '') {
  const s = String(text).toLowerCase();
  // "5-8 yrs", "5 to 8 years", "5–8yr" → 5 (the floor of the range)
  const range = s.match(/(\d{1,2})\s*(?:[-–]|to)\s*(\d{1,2})\s*\+?\s*(?:years|yrs|yr|year)\b/);
  if (range) return Number(range[1]);
  // "5+ years", "5 yrs", "5 year experience"
  const single = s.match(/(\d{1,2})\s*\+?\s*(?:years|yrs|yr|year)\b/);
  if (single) return Number(single[1]);
  return null;
}

/** Sum / pick a sensible total from a provider's structured experience entries. */
export function yearsFromExperiences(experiences = []) {
  if (!Array.isArray(experiences) || !experiences.length) return null;
  let total = 0;
  let found = false;
  for (const e of experiences) {
    const y = parseYears(e?.years || e?.duration || e?.dates || '');
    if (y != null) { total += y; found = true; }
  }
  return found ? total : null;
}

// Pull a 4-digit year out of whatever date shape an actor returns
// (string "Jan 2019", { year: 2019 }, "2019-03", epoch-ish, etc.).
function yearOf(v) {
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v.year) return Number(v.year);
    return yearOf(v.date || v.text || v.value || '');
  }
  const m = String(v).match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

// Internships, trainee stints, apprenticeships, volunteering and freelance gigs
// during college must NOT count as professional experience — otherwise a fresh
// grad with a 1-month 2021 college internship looks like a 5-year veteran. We
// detect them from the employment type or the role title.
const NON_PRO_RX = /\b(intern|internship|apprentice(?:ship)?|articleship|trainee|traineeship|volunteer|freelance|seasonal|summer\s+(?:intern|trainee)|student|fellow(?:ship)?)\b/i;
function isNonProfessional(e) {
  const title = e?.position ?? e?.title ?? e?.role ?? e?.job_title ?? e?.jobTitle ?? '';
  const type = e?.employmentType ?? e?.employment_type ?? e?.type ?? '';
  return NON_PRO_RX.test(`${type} ${title}`);
}

const startYearOf = (e) =>
  yearOf(
    e?.start_date ?? e?.startDate ?? e?.starts_at ?? e?.startsAt ?? e?.start ??
    e?.date_range?.start ?? e?.dateRange?.start ?? e?.duration ?? e?.dates ?? e?.period
  );

/**
 * Compute PROFESSIONAL years of experience from a LinkedIn-style work history:
 * the earliest start year among non-internship roles → now. Internships/trainee
 * roles are ignored; if every role is an internship, the person is a fresher (0).
 * This is far more accurate than scraping "5 years" out of a headline or counting
 * a one-month college internship as full experience.
 */
export function yearsFromHistory(experiences = []) {
  if (!Array.isArray(experiences) || !experiences.length) return null;
  const thisYear = new Date().getFullYear();

  const professional = experiences.filter((e) => !isNonProfessional(e));
  // All roles are internships/training → genuine fresher.
  if (professional.length === 0 && experiences.some(startYearOf)) return 0;

  let earliest = null;
  for (const e of professional) {
    const start = startYearOf(e);
    if (start && start >= 1960 && start <= thisYear && (earliest == null || start < earliest)) earliest = start;
  }
  if (earliest != null) return Math.max(0, Math.min(50, thisYear - earliest));
  // Fall back to summing any "X yrs" durations present.
  return yearsFromExperiences(experiences);
}

// Recruiter-facing bands. `max: null` means open-ended.
export const EXPERIENCE_BANDS = [
  { key: 'fresher', label: 'Fresher', min: 0, max: 1 },
  { key: '1-3', label: '1–3 yrs', min: 1, max: 3 },
  { key: '3-5', label: '3–5 yrs', min: 3, max: 5 },
  { key: '5-8', label: '5–8 yrs', min: 5, max: 8 },
  { key: '8-12', label: '8–12 yrs', min: 8, max: 12 },
  { key: '12+', label: '12+ yrs', min: 12, max: null },
];

/** Map a year count to a band key (used to tag candidates + annotate the UI). */
export function experienceBand(years) {
  if (years == null) return null;
  if (years < 1) return 'fresher';
  if (years < 3) return '1-3';
  if (years < 5) return '3-5';
  if (years < 8) return '5-8';
  if (years < 12) return '8-12';
  return '12+';
}
