// JD → candidate matching engine.
// parseJD extracts structured requirements from free-text; scoreFit ranks a
// candidate against them. Deterministic + explainable (recruiters trust "8/10 skills").
import { BASE_SKILLS, normSkill, SKILL_ALIASES } from '../data/skills.js';
import { parseLocation } from './geo.js';
import { STATES, CITY_TO_STATE } from '../data/indiaGeo.js';

const ROLE_WORDS = ['developer', 'engineer', 'manager', 'designer', 'analyst', 'scientist',
  'architect', 'lead', 'consultant', 'administrator', 'specialist', 'executive', 'recruiter',
  'marketer', 'accountant', 'intern', 'programmer', 'tester', 'devops'];

function canon(skill) {
  const n = normSkill(skill);
  return SKILL_ALIASES[n] || n;
}

/** Extract title, skills, location, experience, seniority from JD text. */
export function parseJD(text = '', vocab = []) {
  const raw = String(text);
  const lower = raw.toLowerCase();

  // Skill vocabulary = base list + whatever skills exist on real candidates.
  const allSkills = [...new Set([...BASE_SKILLS, ...vocab])];
  const skills = [];
  const seen = new Set();
  for (const sk of allSkills) {
    const pattern = new RegExp(`(^|[^a-z0-9+#.])${escapeRx(sk.toLowerCase())}([^a-z0-9+#]|$)`, 'i');
    if (pattern.test(lower)) {
      const c = canon(sk);
      if (!seen.has(c)) { seen.add(c); skills.push(sk); }
    }
  }

  // Title — grab the role word + up to 3 preceding qualifier words ("Senior React Developer").
  const roleRx = new RegExp(`((?:[a-z.+#]+\\s+){0,3}(?:${ROLE_WORDS.join('|')}))`, 'i');
  const tm = raw.match(roleRx);
  let title = tm ? tm[1].trim() : '';
  if (!title) {
    const m = raw.match(/(?:hiring|looking for|role|position|title)[:\s-]+([a-z0-9 ,/+]{3,50})/i);
    title = m ? m[1].trim() : raw.split(/\n|\./)[0].slice(0, 50);
  }

  // Experience.
  const expM = lower.match(/(\d+)\s*\+?\s*(?:years|yrs|year)/);
  const minExperience = expM ? Number(expM[1]) : null;

  // Seniority.
  const seniority = /\b(senior|sr\.?|lead|principal|staff|head)\b/i.test(lower) ? 'senior'
    : /\b(junior|jr\.?|entry|fresher|intern)\b/i.test(lower) ? 'junior' : 'mid';

  // Location — scan the whole JD for any Indian state or major city by name.
  let state = STATES.find((s) => new RegExp(`\\b${escapeRx(s)}\\b`, 'i').test(raw)) || null;
  let city = null;
  for (const c of Object.keys(CITY_TO_STATE)) {
    if (new RegExp(`\\b${escapeRx(c)}\\b`, 'i').test(lower)) { city = title2(c); state = state || CITY_TO_STATE[c]; break; }
  }
  if (!state && !city) {
    const loc = parseLocation(raw);
    state = loc.state; city = loc.city;
  }
  const location = city || state || (/\bindia\b/i.test(lower) ? 'India' : null);

  return { title: cleanTitle(title), skills, minExperience, seniority, location, state, city };
}

const title2 = (s) => s.replace(/\b\w/g, (m) => m.toUpperCase());

function cleanTitle(t) {
  let s = String(t).trim();
  // strip leading filler words, repeatedly
  while (/^(we are|we're|hiring|looking for|seeking|join us as|the|a|an)\s+/i.test(s)) {
    s = s.replace(/^(we are|we're|hiring|looking for|seeking|join us as|the|a|an)\s+/i, '');
  }
  return s.replace(/[.:,]+$/, '').replace(/\b\w/g, (m, i) => (i === 0 ? m.toUpperCase() : m)).trim();
}
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A required skill is "had" if the candidate has the same canonical skill, OR one
// clearly contains the other (so "React" matches "React.js"/"React Native", and
// "Node" matches "Node.js") — without sloppy substring hits like java⊂javascript.
function hasSkill(haveCanon, reqCanon) {
  if (haveCanon.has(reqCanon)) return true;
  for (const h of haveCanon) {
    if (h === reqCanon) return true;
    if (h.length >= 3 && reqCanon.length >= 3 && (h.startsWith(reqCanon) || reqCanon.startsWith(h))) return true;
  }
  return false;
}

/**
 * Score how well a candidate's profile matches the JD → 0–100 + breakdown.
 * Pure JD↔profile fit: skills 65 · role/title 25 · location 10. No active-intent —
 * that's a separate signal; the rating here is "how much they match the JD".
 * When the JD lists no skills, role match carries the score so it still ranks.
 */
export function scoreFit(candidate, jd) {
  const breakdown = [];
  const reqSkills = [...new Set((jd.skills || []).map(canon))];
  const haveCanon = new Set((candidate.skills || []).map(canon));

  const matched = (jd.skills || []).filter((s) => hasSkill(haveCanon, canon(s)));
  const missing = (jd.skills || []).filter((s) => !hasSkill(haveCanon, canon(s)));
  const matchedCanon = new Set(matched.map(canon));
  const matchCount = matchedCanon.size;

  // Role / title token overlap with the candidate's title + headline.
  const jdTitleTokens = tokens(jd.title);
  const candText = tokens(`${candidate.currentTitle || ''} ${candidate.headline || ''}`);
  const titleOverlap = jdTitleTokens.length ? jdTitleTokens.filter((t) => candText.includes(t)).length / jdTitleTokens.length : 0;

  // Location.
  let locPts = 0;
  if (jd.state && candidate.state && jd.state.toLowerCase() === candidate.state.toLowerCase()) locPts = 10;
  else if (jd.city && candidate.city && candidate.city.toLowerCase().includes(jd.city.toLowerCase())) locPts = 10;
  else if (jd.location && /india/i.test(jd.location) && candidate.countryCode === 'IN') locPts = 6;

  let skillPts = 0;
  let titlePts = 0;
  if (reqSkills.length) {
    // Skills 65 · role 25 · location 10
    skillPts = Math.round((matchCount / reqSkills.length) * 65);
    titlePts = Math.round(titleOverlap * 25);
    breakdown.push({ label: `Skills ${matchCount}/${reqSkills.length}`, points: skillPts });
    if (titlePts) breakdown.push({ label: 'Role match', points: titlePts });
  } else {
    // No required skills → role carries it: role 85 · location 15
    titlePts = Math.round(titleOverlap * 85);
    locPts = locPts ? 15 : 0;
    if (titlePts) breakdown.push({ label: 'Role match', points: titlePts });
  }
  if (locPts) breakdown.push({ label: 'Location match', points: locPts });

  const fitScore = Math.min(100, skillPts + titlePts + locPts);
  return { fitScore, breakdown, matchedSkills: matched, missingSkills: missing };
}

function tokens(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9+#]+/).filter((t) => t.length > 2 && !STOP.has(t));
}
const STOP = new Set(['the', 'and', 'for', 'with', 'developer', 'engineer', 'experience', 'years', 'strong', 'good']);

/** Rank a candidate list against a JD. */
export function matchCandidates(candidates, jd, { activeOnly = true } = {}) {
  return candidates
    .map((c) => ({ ...scoreFit(c, jd), candidate: c }))
    .filter((m) => (activeOnly ? m.candidate.openToWork || m.candidate.appliedToJob : true))
    .filter((m) => m.fitScore > 0)
    .sort((a, b) => b.fitScore - a.fitScore || (b.candidate.activeScore || 0) - (a.candidate.activeScore || 0));
}
