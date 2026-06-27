// ─────────────────────────────────────────────────────────────────────────────
// Active-Intent scoring engine — the core IP.
// Turns messy profile data into a 0–100 "how likely is this person job-hunting
// RIGHT NOW" score, with an explainable breakdown recruiters can trust.
//
// Design goals:
//  • The signals recruiters care about most (applied to you, #OpenToWork, short
//    notice, posted a resume) dominate the score.
//  • An actively-applying candidate should land in WARM/HOT, not look "cold".
//  • Every point is explainable — each contribution shows up in `scoreBreakdown`.
// All weights live here; tune in one place.
// ─────────────────────────────────────────────────────────────────────────────

const WEIGHTS = {
  appliedToYourJob: 50, // came to YOU — strongest possible signal
  openToWorkConfirmed: 50, // verified #OpenToWork badge — actively job-seeking → HOT-leaning
  openToWorkStated: 42, // says "open to work" (badge/headline) — must clear WARM (≥40), never look "cold"
  postedResume: 22, // public resume on a job board = active seeker
  noticeImmediate: 22, // ≤15 days / "immediate joiner"
  notice30: 12,
  notice60: 5,
  seekingLanguage: 14, // "looking for", "available for", "seeking"
  recencyMax: 15, // decays from today → 0 at the recency horizon
  recentlyChangedJob: 8,
  contactable: 6, // has email/phone — reachable now
  richProfile: 4, // ≥4 skills + a current title (real, complete profile)
};
const RECENCY_HORIZON_DAYS = 60;

const SEEKING_PHRASES = [
  'looking for', 'actively looking', 'seeking', 'available for', 'available immediately',
  'open for opportunities', 'open to opportunities', 'job seeker', 'hire me', 'serving notice',
];

function daysSince(date) {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 86_400_000;
}

/**
 * @param {object} c - normalized candidate
 * @returns {{ activeScore, scoreBreakdown:{label,points}[], rawSignals:string[] }}
 */
export function scoreActiveIntent(c) {
  const breakdown = [];
  const rawSignals = [];
  const signals = new Set(c.rawSignals || []);
  const haystack = [c.headline, c.summary, c.currentTitle, (c.rawSignals || []).join(' ')]
    .filter(Boolean).join(' ').toLowerCase();
  const add = (label, points) => { if (points > 0) breakdown.push({ label, points }); };

  // 1. Applied to YOUR job.
  if (c.appliedToJob) {
    add(`Applied to your job: ${c.appliedToJob}`, WEIGHTS.appliedToYourJob);
    rawSignals.push('applied-to-your-job');
  }

  // 2. Open to work — verified badge beats a self-declared headline.
  const statedOtw = c.openToWork || haystack.includes('open to work') || haystack.includes('opentowork');
  if (signals.has('open-to-work-confirmed')) {
    add('#OpenToWork badge (verified)', WEIGHTS.openToWorkConfirmed);
    rawSignals.push('open-to-work');
  } else if (statedOtw) {
    add('States open to work', WEIGHTS.openToWorkStated);
    rawSignals.push('open-to-work');
  }

  // 3. Posted a public resume — an active job-seeker by definition.
  if (signals.has('posted-resume')) {
    add('Posted a public resume', WEIGHTS.postedResume);
    rawSignals.push('posted-resume');
  }

  // 4. Notice period / immediate availability.
  if (c.noticePeriodDays != null) {
    if (c.noticePeriodDays <= 15) { add(`Short notice (${c.noticePeriodDays}d)`, WEIGHTS.noticeImmediate); rawSignals.push('immediate-joiner'); }
    else if (c.noticePeriodDays <= 30) add(`Notice ${c.noticePeriodDays}d`, WEIGHTS.notice30);
    else if (c.noticePeriodDays <= 60) add(`Notice ${c.noticePeriodDays}d`, WEIGHTS.notice60);
  } else if (haystack.includes('immediate joiner') || haystack.includes('immediately available')) {
    add('States "immediate joiner"', WEIGHTS.noticeImmediate);
    rawSignals.push('immediate-joiner');
  }

  // 5. Seeking language.
  const phrase = SEEKING_PHRASES.find((p) => haystack.includes(p));
  if (phrase) { add(`Seeking language: "${phrase}"`, WEIGHTS.seekingLanguage); rawSignals.push('seeking-language'); }

  // 6. Recency — linear decay from today → horizon.
  const d = daysSince(c.lastActiveAt);
  if (d != null) {
    const recency = Math.max(0, Math.round(WEIGHTS.recencyMax * (1 - d / RECENCY_HORIZON_DAYS)));
    if (recency > 0) { add(`Active ${Math.round(d)}d ago`, recency); if (d <= 7) rawSignals.push('recently-active'); }
  }

  // 7. Recently changed jobs (some actors expose this).
  if (signals.has('recently-changed-jobs') || signals.has('open-to-work-badge')) {
    add('Recently changed jobs', WEIGHTS.recentlyChangedJob);
  }

  // 8. Contactable.
  if (c.email || c.phone) { add('Has direct contact info', WEIGHTS.contactable); rawSignals.push('contactable'); }

  // 9. Rich, complete profile (lightly rewards real, matchable candidates).
  if ((c.skills || []).length >= 4 && c.currentTitle) add('Complete profile', WEIGHTS.richProfile);

  const activeScore = Math.min(100, breakdown.reduce((s, b) => s + b.points, 0));
  return { activeScore, scoreBreakdown: breakdown, rawSignals: [...new Set([...(c.rawSignals || []), ...rawSignals])] };
}

/** Human label for a score band — used by the UI for color/sorting buckets. */
export function scoreBand(score) {
  if (score >= 70) return 'hot';
  if (score >= 40) return 'warm';
  return 'cold';
}
