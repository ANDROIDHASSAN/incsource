import { Router, raw } from 'express';
import { asyncHandler, rateLimit, requireRole } from '../middleware/index.js';
import { agentTurn, interpretVoiceCommand } from '../services/agent.js';
import { startAgenticRun, getJob } from '../services/agentWorkflow.js';
import { transcribeAudio, synthesizeSpeech } from '../services/voice.js';
import { audit } from '../services/audit.js';

export const agentRouter = Router();

// One conversational turn. Returns the assistant's reply, the structured brief so
// far, and whether it's ready to run. Execution itself goes through the normal
// sourcing/email endpoints, so all org-scoping, rate-limits and spend caps apply.
agentRouter.post('/chat', rateLimit({ windowMs: 60_000, max: 40 }), asyncHandler(async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!messages.length) return res.status(400).json({ error: 'messages required' });
  const turn = await agentTurn(messages);
  res.json(turn);
}));

// Kick off a REAL background agentic run (planner → source → screen → critic loop →
// outreach). Returns a jobId immediately; the run continues server-side even if the
// client disconnects. Same org-scoping / rate-limits / spend caps apply downstream.
const canRun = requireRole('recruiter');
agentRouter.post('/run', canRun, rateLimit({ windowMs: 60_000, max: 12 }), asyncHandler(async (req, res) => {
  const brief = (req.body && typeof req.body.brief === 'object' && req.body.brief) || {};
  const sources = Array.isArray(req.body?.sources) ? req.body.sources : undefined;
  const jobId = startAgenticRun({ brief, sources, orgId: req.user.orgId });
  audit(req, 'agent.run', { role: brief.role, city: brief.city });
  res.status(202).json({ jobId });
}));

// Poll a job's live agent + event state (org-scoped).
agentRouter.get('/jobs/:id', asyncHandler(async (req, res) => {
  const job = getJob(req.params.id, req.user.orgId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired' });
  res.json(job);
}));

// ── Voice control (JARVIS) ──────────────────────────────────────────────────
// Interpret ONE spoken command → a structured app action the client executes.
agentRouter.post('/command', rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(async (req, res) => {
  const transcript = String(req.body?.transcript || '').slice(0, 800);
  if (!transcript.trim()) return res.status(400).json({ error: 'transcript required' });
  res.json(await interpretVoiceCommand(transcript));
}));

// Speech-to-text fallback for browsers without the Web Speech API. Accepts raw
// audio bytes (audio/webm|wav|…) and returns { text } via Groq Whisper.
agentRouter.post('/transcribe', raw({ type: () => true, limit: '25mb' }), rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(async (req, res) => {
  const buf = Buffer.isBuffer(req.body) ? req.body : null;
  if (!buf || !buf.length) return res.status(400).json({ error: 'no audio' });
  const out = await transcribeAudio(buf, req.headers['content-type'] || 'audio/webm');
  if (out.error) return res.status(502).json({ error: out.error });
  res.json({ text: out.text });
}));

// Text-to-speech: returns neural WAV audio for JARVIS to play. Keeps the agent's
// voice consistent across all browsers (not just Chromium's on-device synth).
agentRouter.post('/speak', rateLimit({ windowMs: 60_000, max: 120 }), asyncHandler(async (req, res) => {
  const text = String(req.body?.text || '');
  if (!text.trim()) return res.status(400).json({ error: 'text required' });
  const out = await synthesizeSpeech(text, req.body?.voice);
  if (out.error) return res.status(502).json({ error: out.error });
  res.set('Content-Type', out.contentType);
  res.set('Cache-Control', 'no-store');
  res.send(out.audio);
}));
