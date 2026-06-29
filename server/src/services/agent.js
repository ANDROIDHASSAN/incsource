// Conversational sourcing agent. Turns a free-form chat ("find me a React dev in
// Nashik") into a complete, structured sourcing brief by asking smart follow-up
// questions — then signals when it's ready to run. The actual sourcing/emailing is
// executed by the existing (org-scoped, rate-limited, spend-capped) pipeline; the
// agent only decides WHAT to do, never bypasses those guardrails.
//
// Uses Groq when a key is set; falls back to a deterministic rule-based planner so
// the assistant still works (and stays testable) with no LLM configured.
import { config, usingAI } from '../config.js';
import { usage, recordGroqHeaders } from './usage.js';
import { CITY_TO_STATE, STATES } from '../data/indiaGeo.js';

// Detect a known Indian city/state anywhere in the text (handles multi-word names
// like "New Delhi" / "Navi Mumbai"), preferring the longest match so "New Delhi"
// wins over "Delhi". Returns { city, state } with whatever it can resolve.
const CITY_KEYS = Object.keys(CITY_TO_STATE).sort((a, b) => b.length - a.length);
const STATE_KEYS = STATES.slice().sort((a, b) => b.length - a.length);
function detectGeo(text = '') {
  const t = ` ${String(text).toLowerCase()} `;
  let city = '';
  let state = '';
  for (const c of CITY_KEYS) { if (t.includes(` ${c} `) || t.includes(` ${c},`) || t.includes(` ${c}.`)) { city = c; break; } }
  for (const s of STATE_KEYS) { if (t.includes(s.toLowerCase())) { state = s; break; } }
  if (city && !state) state = CITY_TO_STATE[city] || '';
  // Title-case the detected city for display.
  if (city) city = city.replace(/\b\w/g, (m) => m.toUpperCase());
  return { city, state };
}

// Fill in the region from a known city (Nashik → Maharashtra) so the plan label
// and the strict sourcing gate both have the right state, even when the model
// (or the user) only gave a city.
function backfillGeo(brief) {
  if (brief.city && !brief.state) brief.state = CITY_TO_STATE[String(brief.city).trim().toLowerCase()] || '';
  return brief;
}

const EMPTY_BRIEF = {
  role: '', city: '', state: '', country: 'India',
  expMin: null, expMax: null, skills: [], openToWork: true,
  workMode: 'any', count: 25, wantsEmail: null, emailTemplate: 'intro',
};

const SYSTEM = `You are IncSource's sourcing assistant — a sharp, friendly technical recruiter who helps a user define and launch a candidate search through natural conversation.

Your job each turn:
1. Read the WHOLE conversation and maintain a structured "brief" of what the user wants.
2. Ask ONE clear question at a time for whatever is still missing or vague. Mix specific questions (seniority? city? how many?) with open-ended ones that improve targeting ("any must-have frameworks?", "remote ok or on-site?", "only people open to work?").
3. When you know at least role + location + count AND the user has answered whether to also email candidates, set "ready": true and write a short confirmation summarizing the plan (and that they can hit Run).

Rules:
- Be concise and warm. Never ask for something already known.
- Infer sensibly (e.g. "junior" → expMin 0, expMax 2; "senior" → expMin 5). Default country India unless told otherwise.
- "count" is how many candidates to pull (default 25 if unspecified once otherwise ready).
- emailTemplate is one of: intro, opentowork, followup.
- Respond with ONLY a JSON object, no prose outside it, of EXACTLY this shape:
{"reply":"<message to the user>","brief":{"role":"","city":"","state":"","country":"India","expMin":null,"expMax":null,"skills":[],"openToWork":true,"workMode":"any","count":25,"wantsEmail":null,"emailTemplate":"intro"},"ready":false}`;

async function groqTurn(messages) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.groq.key}` },
    body: JSON.stringify({
      model: config.groq.model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) }))],
    }),
  });
  recordGroqHeaders(res.headers);
  usage.incGroq();
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  return {
    reply: String(parsed.reply || 'Could you tell me a bit more about the role you’re hiring for?'),
    brief: backfillGeo({ ...EMPTY_BRIEF, ...(parsed.brief || {}) }),
    ready: Boolean(parsed.ready),
  };
}

// ── Deterministic fallback (no LLM) ─────────────────────────────────────────
const ROLE_RX = /\b([a-z+#.]+\s+)?(developer|engineer|designer|manager|analyst|architect|consultant|scientist|tester|qa|devops|lead|recruiter|marketer|administrator|specialist)\b/i;
const SENIORITY = [[/\b(fresher|entry|graduate|trainee|intern)\b/i, [0, 1]], [/\bjunior|jr\b/i, [0, 2]], [/\bmid|intermediate\b/i, [3, 5]], [/\b(senior|sr)\b/i, [5, null]], [/\b(lead|principal|staff)\b/i, [8, null]]];

function deriveBrief(messages) {
  const text = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  const brief = { ...EMPTY_BRIEF };
  const role = text.match(ROLE_RX);
  if (role) brief.role = role[0].trim();
  // Resolve location from any known Indian city/state in the message (multi-word
  // safe), falling back to the "in <Word>" heuristic for unknown places.
  const geo = detectGeo(text);
  if (geo.city) brief.city = geo.city;
  if (geo.state) brief.state = geo.state;
  if (!brief.city && !brief.state) {
    const inCity = text.match(/\b(?:in|at|from|based in)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/);
    if (inCity) brief.city = inCity[1];
  }
  for (const [rx, [lo, hi]] of SENIORITY) if (rx.test(text)) { brief.expMin = lo; brief.expMax = hi; break; }
  const yrs = text.match(/(\d+)\s*\+?\s*(?:years|yrs|year)/i);
  if (yrs) { brief.expMin = Number(yrs[1]); }
  // "10 candidates", "find/get me 10 …", etc. (tolerant of "find me 5 React devs").
  const cnt = text.match(/(\d+)\s*(?:candidates|people|profiles|devs?|developers?|engineers?|designers?|managers?|analysts?|architects?|consultants?|testers?)\b/i)
    || text.match(/\b(?:find|get|pull|source|need|want|fetch|give|show|me)\s+(?:me\s+)?(\d+)\b/i);
  if (cnt) brief.count = Math.min(Number(cnt[1]), 200);
  const skillsM = text.match(/\b(react|node|angular|vue|python|java|django|mongodb|aws|typescript|next\.?js|express|kubernetes|docker|sql)\b/gi);
  if (skillsM) brief.skills = [...new Set(skillsM.map((s) => s.toLowerCase()))];
  if (/\byes\b.*\bemail|email.*\byes\b|send (them )?emails?/i.test(text)) brief.wantsEmail = true;
  if (/\bno\b.*email|don'?t (send|email)|no email/i.test(text)) brief.wantsEmail = false;
  return brief;
}

function fallbackTurn(messages) {
  const brief = deriveBrief(messages);
  const missing = [];
  if (!brief.role) missing.push('the role/title you’re hiring for');
  if (!brief.city && !brief.state) missing.push('which city or region');
  if (brief.expMin == null && brief.expMax == null) missing.push('the experience level (fresher, mid, senior?)');
  if (brief.wantsEmail == null) missing.push('whether I should also email the candidates');

  if (missing.length) {
    return { reply: `Got it${brief.role ? ` — ${brief.role}${brief.city ? ` in ${brief.city}` : ''}` : ''}. To target this well, could you tell me ${missing[0]}?`, brief, ready: false };
  }
  const where = [brief.city, brief.country].filter(Boolean).join(', ');
  return {
    reply: `Perfect. I'll source ${brief.count} ${brief.role}${where ? ` in ${where}` : ''}${brief.openToWork ? ', focusing on people open to work' : ''}${brief.wantsEmail ? ', and email them once found' : ''}. Hit Run task when you're ready.`,
    brief,
    ready: true,
  };
}

/** One assistant turn. messages = [{role:'user'|'assistant', content}]. */
export async function agentTurn(messages = []) {
  const safe = Array.isArray(messages) ? messages.slice(-20) : [];
  if (usingAI()) {
    try { return await groqTurn(safe); }
    catch { /* fall through to the deterministic planner */ }
  }
  return fallbackTurn(safe);
}

// ── Voice control brain (JARVIS) ────────────────────────────────────────────
// Turn a single spoken command into ONE structured app action. Powers the
// hands-free voice HUD. Groq when available, deterministic rules otherwise.
const VOICE_ACTIONS = ['source', 'filter', 'summarize', 'usage', 'navigate', 'stop', 'say'];
const VOICE_SYSTEM = `You are JARVIS, the voice-control brain of IncSource — an active-candidate sourcing app for recruiters. Convert the user's spoken command into EXACTLY ONE structured action.

Actions:
- "source": start sourcing candidates with the agent team. params.brief = {role, city, state, country, expMin, expMax, count, openToWork, wantsEmail}. Infer sensibly. count default 6. Use null when unknown.
- "filter": narrow the on-screen candidate list. params may include {band:"hot"|"warm"|"cold"|"all", openToWork:true, hasEmail:true, starred:true, query:"<keywords>", clear:true}.
- "summarize": read the current results aloud. params {}.
- "usage": report email / AI / sourcing usage. params {}.
- "navigate": open a panel. params.panel = "jd"|"templates"|"settings"|"usage"|"assistant"|"new".
- "stop": stop talking / cancel. params {}.
- "say": just answer or chat (anything else). params {}.

"speak" is ALWAYS a short, confident, friendly JARVIS-style spoken reply (1-2 sentences). Address the user naturally.
Respond with ONLY JSON: {"action":"<one of the above>","params":{...},"speak":"<spoken reply>"}`;

async function groqCommand(transcript) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.groq.key}` },
    body: JSON.stringify({
      model: config.groq.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: VOICE_SYSTEM }, { role: 'user', content: String(transcript).slice(0, 800) }],
    }),
  });
  recordGroqHeaders(res.headers);
  usage.incGroq();
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json();
  const p = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  const action = VOICE_ACTIONS.includes(p.action) ? p.action : 'say';
  let params = (p.params && typeof p.params === 'object') ? p.params : {};
  // Normalize the source brief: the model sometimes nests it under params.brief and
  // sometimes returns the fields flat in params — handle both → always params.brief.
  if (action === 'source') {
    const raw = (params.brief && typeof params.brief === 'object') ? params.brief : params;
    params = { brief: backfillGeo({ ...EMPTY_BRIEF, ...raw }) };
  }
  return { action, params, speak: String(p.speak || 'On it.').slice(0, 400), transcript };
}

// Deterministic fallback so voice still works with no Groq key.
function ruleBasedCommand(transcript) {
  const t = String(transcript || '').toLowerCase().trim();
  if (!t) return { action: 'say', params: {}, speak: 'I didn’t catch that — say it again?', transcript };
  if (/\b(stop|cancel|quiet|shut up|never ?mind)\b/.test(t)) return { action: 'stop', params: {}, speak: 'Standing by.', transcript };
  if (/\busage|quota|how many emails|credits?\b/.test(t)) return { action: 'usage', params: {}, speak: 'Pulling up your usage now.', transcript };
  if (/\b(summari[sz]e|read|how many candidates|what did you find|results?)\b/.test(t)) return { action: 'summarize', params: {}, speak: 'Here’s what we have so far.', transcript };
  if (/\bopen|show me|go to\b/.test(t)) {
    const panel = /jd|job description|match/.test(t) ? 'jd' : /template|email/.test(t) ? 'templates' : /setting|api key/.test(t) ? 'settings' : /usage/.test(t) ? 'usage' : /assistant|chat/.test(t) ? 'assistant' : /new session|new search/.test(t) ? 'new' : null;
    if (panel) return { action: 'navigate', params: { panel }, speak: `Opening ${panel}.`, transcript };
  }
  if (/\bclear (the )?filters?\b/.test(t)) return { action: 'filter', params: { clear: true }, speak: 'Filters cleared.', transcript };
  if (/\bhot\b/.test(t)) return { action: 'filter', params: { band: 'hot' }, speak: 'Showing the hottest candidates.', transcript };
  if (/\bopen to work\b/.test(t)) return { action: 'filter', params: { openToWork: true }, speak: 'Filtering to people open to work.', transcript };
  if (/\b(find|source|get|pull|search for|look for|need|want)\b/.test(t)) {
    const brief = backfillGeo(deriveBrief([{ role: 'user', content: transcript }]));
    const where = [brief.city, brief.country].filter(Boolean).join(', ');
    return { action: 'source', params: { brief }, speak: `On it — dispatching the agent team to source ${brief.count} ${brief.role || 'candidates'}${where ? ` in ${where}` : ''}.`, transcript };
  }
  return { action: 'say', params: {}, speak: 'I can source candidates, filter the list, read results, or open a panel — what would you like?', transcript };
}

/** Interpret one spoken command → { action, params, speak }. */
export async function interpretVoiceCommand(transcript = '') {
  if (!String(transcript).trim()) return { action: 'say', params: {}, speak: 'I’m listening.', transcript };
  if (usingAI()) { try { return await groqCommand(transcript); } catch { /* fall back */ } }
  return ruleBasedCommand(transcript);
}
