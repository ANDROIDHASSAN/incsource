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
    brief: { ...EMPTY_BRIEF, ...(parsed.brief || {}) },
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
  const inCity = text.match(/\b(?:in|at|from|based in)\s+([A-Z][a-zA-Z]+)/);
  if (inCity) brief.city = inCity[1];
  for (const [rx, [lo, hi]] of SENIORITY) if (rx.test(text)) { brief.expMin = lo; brief.expMax = hi; break; }
  const yrs = text.match(/(\d+)\s*\+?\s*(?:years|yrs|year)/i);
  if (yrs) { brief.expMin = Number(yrs[1]); }
  // "10 candidates" OR "find/get/pull/source/need/want 10 …".
  const cnt = text.match(/(\d+)\s*(?:candidates|people|profiles|devs|developers)\b/i)
    || text.match(/\b(?:find|get|pull|source|need|want)\s+(\d+)\b/i);
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
