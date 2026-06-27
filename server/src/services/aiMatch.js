// AI semantic JD↔candidate matching.
// The deterministic matcher pre-filters to a shortlist; an LLM then judges TRUE
// fit (skill meaning, seniority, must-have vs nice-to-have) and returns an
// explainable verdict per candidate. Provider: Groq only.
// Falls back silently if GROQ_API_KEY is not set.
import { config, usingAI } from '../config.js';
import { usage, recordGroqHeaders } from './usage.js';

const SYSTEM = `You are an expert technical recruiter evaluating how well candidates fit a specific job description.
For each candidate, judge TRUE fit — not keyword overlap. Account for:
- Semantic skill equivalence ("MERN" implies React+Node+Mongo+Express; "ML" = Machine Learning).
- Must-have vs nice-to-have requirements in the JD.
- Seniority and years of experience implied by titles/headline.
- Role alignment (a "Frontend Engineer" can fit a "React Developer" JD).
Score each candidate 0–100 on real fit and assign a verdict:
"strong" = clearly meets the core must-haves (you'd shortlist them);
"possible" = partial fit, worth a look;
"weak" = missing core requirements.
Be strict — only "strong" when they genuinely match the must-haves.
Respond with ONLY a JSON object of this exact shape (no prose):
{"results":[{"id":"<candidate id>","fit":<0-100 integer>,"verdict":"strong|possible|weak","reason":"<one short sentence>","matched":["<met requirement>"],"missing":["<key gap>"]}]}`;

function compactCandidate(c) {
  return {
    id: c.id,
    name: c.fullName,
    title: c.currentTitle || '',
    headline: (c.headline || '').slice(0, 240),
    company: c.currentCompany || '',
    location: [c.city, c.state].filter(Boolean).join(', '),
    openToWork: Boolean(c.openToWork),
    skills: (c.skills || []).slice(0, 25),
  };
}

function buildPrompt(jd, candidates) {
  return (
    `JOB DESCRIPTION:\nTitle: ${jd.title}\nSeniority: ${jd.seniority}${jd.minExperience ? ` (${jd.minExperience}+ yrs)` : ''}\n` +
    `Location: ${jd.location || 'Any'}\nRequired skills: ${(jd.skills || []).join(', ')}\n\n` +
    `CANDIDATES (JSON):\n${JSON.stringify(candidates.map(compactCandidate))}\n\n` +
    `Evaluate every candidate. Echo each candidate's exact "id". Return the JSON object described above.`
  );
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ── Groq (OpenAI-compatible) ────────────────────────────
async function groqBatch(jd, candidates) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.groq.key}` },
    body: JSON.stringify({
      model: config.groq.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildPrompt(jd, candidates) },
      ],
    }),
  });
  // Capture Groq's rate-limit headers (per-key request/token ceilings) + count the
  // call so the Usage panel can show how much AI quota is left today.
  recordGroqHeaders(res.headers);
  usage.incGroq();
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '{}';
  return JSON.parse(text).results || [];
}

const scoreBatch = (jd, candidates) => groqBatch(jd, candidates);

/**
 * @returns Map<candidateId, { fit, verdict, reason, matched, missing }> — empty if AI unavailable.
 */
export async function aiScore(jd, candidates) {
  const map = new Map();
  if (!usingAI() || !candidates.length) return map;
  const pool = candidates.slice(0, config.ai.maxCandidates);
  try {
    const batches = chunk(pool, config.ai.batchSize);
    const all = await Promise.all(batches.map((b) => scoreBatch(jd, b).catch((e) => { console.warn('AI match batch failed:', e.message); return []; })));
    for (const r of all.flat()) {
      if (r && r.id) map.set(String(r.id), { fit: r.fit, verdict: r.verdict, reason: r.reason, matched: r.matched || [], missing: r.missing || [] });
    }
  } catch (e) {
    console.warn('AI match failed:', e.message);
  }
  return map;
}
