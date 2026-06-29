// Real, background agentic workflow. A run is executed server-side by a team of
// LLM-driven agents that genuinely PLAN, SOURCE, SCREEN, CRITIQUE (loop) and WRITE
// OUTREACH — not a UI timer. The HTTP route fires a job and returns immediately;
// the client polls the job's live agent + event state. Every LLM agent has a
// deterministic fallback so the workflow still completes with no Groq key.
import { runSourcing } from './ingest.js';
import { config, usingAI } from '../config.js';
import { usage, recordGroqHeaders, emailRemaining } from './usage.js';
import { store } from '../store/index.js';
import { TEMPLATES, renderTemplate } from './outreach.js';
import { sendEmail } from './emailService.js';

// ── In-process job registry (single instance). Pruned after a TTL. ──
const jobs = new Map();
let jobSeq = 0;
const JOB_TTL_MS = 20 * 60_000;
const MAX_CRITIC_ROUNDS = 2;       // extra in-location sourcing rounds the critic may trigger
const MAX_OUTREACH = 25;           // personalized emails per run (spend guard)

// ── Responsiveness budget (a voice/chat agent must never hang) ──────────────
// Each sourcing round is hard-capped, and the whole multi-round phase shares an
// overall budget. A stuck/exhausted live source (e.g. Apify at quota) can sit
// near its own 70s soft timeout × multiple rounds = minutes; these caps bound the
// agent so it always finishes fast and reports a clear outcome instead of hanging.
const AGENT_SOURCE_MS = Number(process.env.AGENT_SOURCE_MS) || 45_000; // per sourcing round
const AGENT_TOTAL_MS = Number(process.env.AGENT_TOTAL_MS) || 90_000;   // across all rounds

// Race a promise against a deadline. On timeout we reject (and move on); the
// underlying fetch is abandoned — acceptable, since its result would be stale.
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${label} exceeded ${Math.round(ms / 1000)}s`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function prune() {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.createdAt > JOB_TTL_MS) jobs.delete(id);
}

// The agent roster (icons match the client orchestration graph).
const ROSTER = [
  { id: 'orchestrator', icon: '✦', name: 'Orchestrator', role: 'Planned the search strategy' },
  { id: 'scout', icon: '🛰️', name: 'Sourcing Scout', role: 'Queried live talent sources' },
  { id: 'parser', icon: '🧬', name: 'Profile Parser', role: 'Extracted & normalized profiles' },
  { id: 'dedupe', icon: '🧹', name: 'Dedupe Agent', role: 'Merged duplicate profiles' },
  { id: 'scorer', icon: '🎯', name: 'Intent Scorer', role: 'Scored active-intent signals' },
  { id: 'matcher', icon: '🧠', name: 'Fit Matcher', role: 'AI-ranked candidates by fit' },
  { id: 'critic', icon: '⚖️', name: 'Critic', role: 'Reviewed shortlist quality' },
];
const OUTREACH_AGENT = { id: 'outreach', icon: '✉️', name: 'Outreach Writer', role: 'Wrote personalized outreach' };

// ── job helpers ──
const setAgent = (job, id, patch) => { const a = job.agents.find((x) => x.id === id); if (a) Object.assign(a, patch); };
const emit = (job, from, to, kind, text) => {
  job.events.push({ id: ++job.evSeq, t: Date.now() - job.startedAt, from, to, kind, text });
  if (job.events.length > 240) job.events.splice(0, job.events.length - 240);
};
const keyOf = (c) => String(c.id || c.dedupeKey || c.externalId);

// Public (org-scoped) view returned to the client. Includes the LIVE candidate
// pool the agents have sourced so far, so the UI can stream results into the
// main list in real time (no separate "orchestration" screen needed).
export function getJob(id, orgId) {
  const j = jobs.get(id);
  if (!j || (orgId && j.orgId !== orgId)) return null;
  return {
    id: j.id,
    status: j.status,
    agents: j.agents,
    events: j.events.slice(-100),
    elapsedMs: (j.endedAt || Date.now()) - j.startedAt,
    result: j.result,
    error: j.error,
    candidates: j.candidates || [],
    kept: j.kept || 0,
    scanned: j.scanned || 0,
    phase: j.phase || '',
    sources: j.sources || {},
  };
}

// Merge a progressive candidate snapshot into the job's live pool (keyed +
// re-ranked), so the client sees the list grow candidate-by-candidate across
// every sourcing round.
function ingestCandidates(job, list) {
  if (!Array.isArray(list) || !list.length) return;
  for (const c of list) job.cmap.set(keyOf(c), c);
  job.candidates = [...job.cmap.values()]
    .sort((a, b) => (b.fitScore ?? b.activeScore ?? 0) - (a.fitScore ?? a.activeScore ?? 0))
    .slice(0, 80);
  job.kept = job.candidates.length;
}

// ── Groq agent call (JSON mode) ──
async function callGroq(system, user, { temperature = 0.3 } = {}) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.groq.key}` },
    body: JSON.stringify({
      model: config.groq.model,
      temperature,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: String(user).slice(0, 6000) }],
    }),
  });
  recordGroqHeaders(res.headers);
  usage.incGroq();
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content || '{}');
}

// ── Agent 1: Planner (orchestrator) ──
async function plannerAgent(brief) {
  const fallback = {
    strategy: `Source ${brief.count || 'some'} ${brief.role || 'candidates'} in ${brief.city || brief.country || 'India'}`,
    primaryQuery: brief.role || (brief.skills || [])[0] || 'developer',
    altQueries: [],
    mustHaveSkills: brief.skills || [],
  };
  if (!usingAI()) return fallback;
  try {
    const sys = `You are the ORCHESTRATOR of a candidate-sourcing agent team. Given a hiring brief, return a focused search PLAN as JSON. Stay STRICTLY within the requested location and experience — never broaden them. JSON shape: {"strategy":"<one sentence plan>","primaryQuery":"<best job-title search phrase>","altQueries":["<in-scope title variant>","<in-scope title variant>"],"mustHaveSkills":["..."]}`;
    const p = await callGroq(sys, `BRIEF: ${JSON.stringify(brief)}`, { temperature: 0.2 });
    return {
      strategy: String(p.strategy || fallback.strategy).slice(0, 140),
      primaryQuery: String(p.primaryQuery || fallback.primaryQuery).slice(0, 60),
      altQueries: Array.isArray(p.altQueries) ? p.altQueries.slice(0, 3).map((q) => String(q).slice(0, 60)) : [],
      mustHaveSkills: Array.isArray(p.mustHaveSkills) ? p.mustHaveSkills.map(String) : fallback.mustHaveSkills,
    };
  } catch { return fallback; }
}

// ── Agent 5: Critic (drives the loop) ──
async function criticAgent(brief, pool, usedQueries) {
  const strong = pool.filter((c) => (c.fitScore ?? c.activeScore ?? 0) >= 70).length;
  const target = Number(brief.count) || pool.length || 1;
  const enough = pool.length >= target || strong >= Math.ceil(target / 2);
  const fallback = { satisfied: enough, reason: `${strong} strong of ${pool.length}`, suggestQuery: null };
  if (!usingAI()) return fallback;
  try {
    const sys = `You are a hiring QA CRITIC reviewing a candidate shortlist against the brief. Decide if it is good enough, or if ONE more search round with a DIFFERENT in-scope job title would help. NEVER suggest changing the location or experience band. Do not repeat an already-used query. JSON: {"satisfied":true|false,"reason":"<short>","suggestQuery":"<a different in-scope job-title query, or empty string>"}`;
    const user = `BRIEF: ${JSON.stringify({ role: brief.role, city: brief.city, expMin: brief.expMin, expMax: brief.expMax, count: brief.count, skills: brief.skills })}\nALREADY TRIED: ${JSON.stringify(usedQueries)}\nSHORTLIST (${pool.length}): ${JSON.stringify(pool.slice(0, 12).map((c) => ({ name: c.fullName, title: c.currentTitle, fit: c.fitScore, skills: (c.skills || []).slice(0, 8) })))}`;
    const r = await callGroq(sys, user, { temperature: 0.2 });
    const sug = r.suggestQuery ? String(r.suggestQuery).slice(0, 60) : null;
    return { satisfied: Boolean(r.satisfied), reason: String(r.reason || fallback.reason).slice(0, 120), suggestQuery: sug && !usedQueries.includes(sug) ? sug : null };
  } catch { return fallback; }
}

// ── Agent 6: Outreach writer (per candidate) ──
async function writeOutreach(brief, c) {
  const tplFallback = () => renderTemplate(TEMPLATES.find((t) => t.id === (brief.emailTemplate || 'intro')) || TEMPLATES[0], c, { role: brief.role });
  if (!usingAI()) return tplFallback();
  try {
    const sys = `You are a recruiter writing a SHORT, warm, personalized cold outreach email to a candidate about a role. 2–4 sentences, specific to their background, friendly, no buzzwords, no markdown. JSON: {"subject":"<subject line>","body":"<email body>"}`;
    const user = `ROLE: ${brief.role}\nCANDIDATE: ${c.fullName} — ${c.currentTitle || ''}${c.currentCompany ? ` at ${c.currentCompany}` : ''}. Skills: ${(c.skills || []).slice(0, 8).join(', ')}.${c.openToWork ? ' Open to work.' : ''}`;
    const m = await callGroq(sys, user, { temperature: 0.6 });
    if (!m.subject || !m.body) return tplFallback();
    return { subject: String(m.subject).slice(0, 160), body: String(m.body).slice(0, 2000) };
  } catch { return tplFallback(); }
}

// Map a runSourcing progress event onto the agent team's live state + the LIVE
// candidate pool that streams into the client's main list.
function mapSourcingEvent(job, ev) {
  if (ev.type === 'phase') {
    if (ev.message) job.phase = ev.message;
    if (ev.scanned != null) job.scanned = ev.scanned;
    const m = ev.message || '';
    if (/scoring|matching/i.test(m)) ['parser', 'dedupe', 'scorer'].forEach((id) => setAgent(job, id, { status: 'working' }));
    if (/ai-?scor/i.test(m)) setAgent(job, 'matcher', { status: 'working', detail: 'AI-scoring fit to the brief…' });
  } else if (ev.type === 'source') {
    job.sources[ev.source] = ev.error ? 'err' : ev.got;
    const txt = ev.error ? `${ev.source}: source error` : `${ev.source}: ${ev.got} found`;
    setAgent(job, 'scout', { detail: txt });
    emit(job, 'scout', 'orchestrator', ev.error ? 'error' : 'result', txt);
  } else if (ev.type === 'candidates') {
    if (ev.scanned != null) job.scanned = ev.scanned;
    ingestCandidates(job, ev.candidates); // grow the live pool the UI is streaming
    setAgent(job, 'parser', { status: 'done' });
    setAgent(job, 'dedupe', { status: 'done' });
    setAgent(job, 'scorer', { status: 'done', detail: `${ev.kept} scored` });
  }
}

function briefToRunBody(brief, sources, query) {
  return {
    sources,
    query: query || brief.role || '',
    count: Number(brief.count) || 25,
    city: brief.city || '',
    state: brief.state || '',
    country: brief.country || 'India',
    expMin: brief.expMin ?? null,
    expMax: brief.expMax ?? null,
    skills: Array.isArray(brief.skills) ? brief.skills : [],
    openToWorkOnly: brief.openToWork !== false,
    indiaOnly: (brief.country || 'India') === 'India',
    countryOnly: true,
    workMode: brief.workMode || 'any',
    strict: true, // the assistant only ever fetches what was asked for
    sessionName: [brief.role, brief.city].filter(Boolean).join(' · '),
  };
}

// ── The workflow ──
async function runWorkflow(job, brief, sources) {
  const orgId = job.orgId;
  emit(job, null, null, 'system', 'orchestrator online · decomposing the brief');

  // 1) PLAN
  setAgent(job, 'orchestrator', { status: 'working', detail: 'Planning the search…' });
  emit(job, 'orchestrator', null, 'think', 'allocating specialist agents');
  const plan = await plannerAgent(brief);
  emit(job, 'orchestrator', null, 'think', plan.strategy);
  setAgent(job, 'orchestrator', { status: 'done', detail: `✓ ${plan.strategy}` });

  // 2) SOURCE (scout/parser/dedupe/scorer/matcher driven by REAL runSourcing events)
  setAgent(job, 'scout', { status: 'working', detail: 'Querying sources…' });
  emit(job, 'orchestrator', 'scout', 'dispatch', `search “${plan.primaryQuery}” in ${brief.city || brief.country || 'India'}`);
  let pool = [];
  let run = null;
  let candidateIds = []; // the authoritative DB ids for the session (runSourcing returns them on the run)
  const usedQueries = [plan.primaryQuery];
  try {
    const res = await withTimeout(
      runSourcing({ ...briefToRunBody(brief, sources, plan.primaryQuery), orgId, onEvent: (ev) => mapSourcingEvent(job, ev) }),
      AGENT_SOURCE_MS, 'sourcing',
    );
    run = res.run; pool = res.candidates || [];
    candidateIds = (run?.candidateIds || []).slice();
  } catch (e) {
    emit(job, 'scout', 'orchestrator', 'error', e.message || 'sourcing failed');
  }
  ['scout', 'parser', 'dedupe', 'scorer'].forEach((id) => setAgent(job, id, { status: setAgentDoneOrFail(job, id) }));
  setAgent(job, 'matcher', { status: 'done', detail: `✓ Ranked ${pool.length} candidate${pool.length === 1 ? '' : 's'}` });
  emit(job, 'matcher', 'orchestrator', 'result', `ranked ${pool.length} candidate(s) ✓`);

  // 3) CRITIC LOOP — real LLM review, may trigger more in-location rounds.
  setAgent(job, 'critic', { status: 'working', detail: 'Reviewing shortlist…' });
  for (let round = 0; round <= MAX_CRITIC_ROUNDS; round++) {
    emit(job, 'orchestrator', 'critic', 'dispatch', 'assess shortlist quality');
    const verdict = await criticAgent(brief, pool, usedQueries);
    emit(job, 'critic', 'orchestrator', verdict.satisfied ? 'result' : 'think', verdict.satisfied ? `satisfied · ${verdict.reason}` : `needs more · ${verdict.reason}`);
    const overBudget = Date.now() - job.startedAt > AGENT_TOTAL_MS;
    if (verdict.satisfied || !verdict.suggestQuery || !run || round === MAX_CRITIC_ROUNDS || overBudget) {
      if (overBudget) emit(job, 'critic', 'orchestrator', 'think', 'time budget reached — finalizing with current shortlist');
      break;
    }
    // Another in-location round with the critic's suggested title.
    usedQueries.push(verdict.suggestQuery);
    setAgent(job, 'scout', { status: 'working', detail: `Re-searching “${verdict.suggestQuery}”…` });
    emit(job, 'critic', 'scout', 'dispatch', `try “${verdict.suggestQuery}”`);
    try {
      const more = await withTimeout(
        runSourcing({ ...briefToRunBody(brief, sources, verdict.suggestQuery), orgId, onEvent: (ev) => mapSourcingEvent(job, ev) }),
        AGENT_SOURCE_MS, 'round',
      );
      const seen = new Set(pool.map(keyOf));
      const fresh = (more.candidates || []).filter((c) => !seen.has(keyOf(c)));
      pool.push(...fresh);
      // The round's DB ids are authoritative — merge them (dedup by id) into the session.
      for (const id of more.run?.candidateIds || []) if (!candidateIds.includes(id)) candidateIds.push(id);
      if (more.run?.id) await store.deleteRun(more.run.id, orgId).catch(() => {}); // keep ONE session
      setAgent(job, 'scout', { status: 'done', detail: `+${fresh.length} new` });
      emit(job, 'scout', 'orchestrator', 'result', `+${fresh.length} new candidate(s) ✓`);
      // Sources are dry (live quota / no matches) — don't burn more rounds hammering them.
      if (fresh.length === 0) { emit(job, 'critic', 'orchestrator', 'think', 'no new candidates this round — stopping the search'); break; }
    } catch (e) {
      emit(job, 'scout', 'orchestrator', 'error', e.message || 'round failed');
      break;
    }
  }
  setAgent(job, 'critic', { status: 'done', detail: '✓ Reviewed' });

  // Fold the merged candidate ids into the single session (only when the critic
  // loop actually added rounds — otherwise the primary run already has them).
  if (run?.id && candidateIds.length && candidateIds.length !== (run.candidateIds || []).length) {
    const updated = await store.updateRun(run.id, { candidateIds, kept: candidateIds.length }, orgId).catch(() => null);
    if (updated) run = updated;
  }

  // 4) OUTREACH — personalized per candidate, only if requested.
  if (brief.wantsEmail) await outreachStep(job, brief, pool, orgId);

  // 5) finalize — settle every agent into a clean completed state.
  for (const a of job.agents) {
    if (a.status === 'working') a.status = 'done';
    if (a.status === 'done' && (!a.detail || a.detail === 'Waiting…' || /…$/.test(a.detail))) a.detail = `✓ ${a.role}`;
  }
  const kept = candidateIds.length || pool.length;
  setAgent(job, 'matcher', { detail: `✓ Ranked ${kept} candidate${kept === 1 ? '' : 's'}` });
  const strongMatches = pool.filter((c) => (c.fitScore || 0) >= 70).length;
  job.result = { run, kept, strongMatches };
  emit(job, null, null, 'system', `run complete · ${kept} candidate(s) · ${strongMatches} strong`);
  job.status = 'done';
  job.endedAt = Date.now();
}

function setAgentDoneOrFail(job, id) {
  return job.agents.find((a) => a.id === id)?.status === 'failed' ? 'failed' : 'done';
}

async function outreachStep(job, brief, pool, orgId) {
  setAgent(job, 'outreach', { status: 'working', detail: 'Writing personalized outreach…' });
  emit(job, 'orchestrator', 'outreach', 'dispatch', 'write personalized outreach');
  const withEmail = pool.filter((c) => c.email).slice(0, MAX_OUTREACH);
  if (!withEmail.length) {
    setAgent(job, 'outreach', { status: 'skipped', detail: 'No contactable emails' });
    emit(job, 'outreach', 'orchestrator', 'result', 'no candidates with an email');
    return;
  }
  let sent = 0, failed = 0;
  for (const c of withEmail) {
    if (emailRemaining() <= 0) { emit(job, 'outreach', 'orchestrator', 'think', 'daily email cap reached — holding the rest'); break; }
    const msg = await writeOutreach(brief, c);
    emit(job, 'outreach', null, 'think', `✍ ${c.fullName.split(' ')[0]}: ${String(msg.subject).slice(0, 46)}`);
    const r = await sendEmail({ to: c.email, subject: msg.subject, text: msg.body });
    if (r.ok) { usage.incEmail(); await store.recordOutreach(c.id, { channel: 'email', subject: msg.subject }, orgId).catch(() => {}); sent++; }
    else failed++;
  }
  setAgent(job, 'outreach', { status: failed && !sent ? 'failed' : 'done', detail: `✓ Sent ${sent}${failed ? ` · ${failed} failed` : ''}` });
  emit(job, 'outreach', 'orchestrator', 'result', `sent ${sent} personalized email(s) ✓`);
}

/** Start a background agentic run. Returns the jobId immediately. */
export function startAgenticRun({ brief = {}, sources, orgId }) {
  prune();
  const id = `job_${++jobSeq}_${Math.random().toString(36).slice(2, 8)}`;
  const roster = (brief.wantsEmail ? [...ROSTER, OUTREACH_AGENT] : ROSTER).map((a) => ({ ...a, status: 'queued', detail: 'Waiting…' }));
  const job = {
    id, orgId, status: 'running', createdAt: Date.now(), startedAt: Date.now(), endedAt: null,
    agents: roster, events: [], evSeq: 0, result: null, error: null,
    // live, streamed-to-client sourcing state
    candidates: [], cmap: new Map(), kept: 0, scanned: 0, phase: '', sources: {},
  };
  jobs.set(id, job);
  runWorkflow(job, brief, sources && sources.length ? sources : ['inbound', 'linkedin-harvest', 'apify-linkedin'])
    .catch((e) => { job.status = 'error'; job.error = e?.message || 'workflow failed'; job.endedAt = Date.now(); emit(job, null, null, 'system', `error · ${job.error}`); });
  return id;
}
