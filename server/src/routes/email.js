import { Router } from 'express';
import { store } from '../store/index.js';
import { config } from '../config.js';
import { asyncHandler, rateLimit, requireRole } from '../middleware/index.js';
import { TEMPLATES, renderTemplate } from '../services/outreach.js';
import { sendEmail, emailStatus } from '../services/emailService.js';
import { resumeUploadUrl } from '../services/appUrl.js';
import { usage, emailCap, emailRemaining } from '../services/usage.js';

export const emailRouter = Router();

// Build the candidate's public resume-upload link, creating the token on first use.
// Returns '' when the recruiter didn't ask to collect resumes for this campaign.
async function resumeLinkFor(req, candidate, wantResume) {
  if (!wantResume) return '';
  const token = await store.ensureResumeToken(candidate.id, req.user.orgId);
  return token ? resumeUploadUrl(req, token) : '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A randomized gap between sends so a campaign doesn't go out as one suspicious
// rapid burst (a common spam/abuse trigger that gets free accounts banned).
const safeGap = () => config.email.throttleMs + Math.floor(Math.random() * config.email.jitterMs);
const canSend = requireRole('recruiter');

emailRouter.get('/status', asyncHandler(async (_req, res) => {
  res.json({ ...emailStatus(), sentToday: usage.emailsToday(), dailyCap: emailCap(), remaining: emailRemaining() });
}));

// Resolve { subject, body } from a templateId (built-in or this org's custom) or
// raw subject/body, then personalize for the candidate. `extra` carries the
// per-candidate resume link and the campaign-wide requirements text.
async function compose(body, candidate, orgId, extra = {}) {
  let tpl;
  if (body.subject != null || body.body != null) {
    tpl = { subject: body.subject || '', body: body.body || '' };
  } else {
    const all = [...TEMPLATES, ...(await store.listTemplates(orgId))];
    tpl = all.find((t) => t.id === body.templateId) || TEMPLATES[0];
  }
  return renderTemplate(tpl, candidate, {
    role: body.role, recruiter: body.recruiter, company: body.company,
    requirements: body.requirements, resumeLink: extra.resumeLink || '',
  });
}

// Send to a single candidate.
emailRouter.post('/send/:id', canSend, rateLimit({ windowMs: 60_000, max: 60 }), asyncHandler(async (req, res) => {
  const c = await store.getCandidate(req.params.id, req.user.orgId);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (!c.email) return res.status(400).json({ error: 'Candidate has no email — run Find email & phone first.' });
  // Daily ban-safety cap.
  if (emailRemaining() <= 0) {
    return res.status(429).json({ error: `Daily email limit reached (${emailCap()}/day). Resets tomorrow — protects your sending account from being flagged.` });
  }

  const resumeLink = await resumeLinkFor(req, c, req.body?.resumeRequest);
  const msg = await compose(req.body || {}, c, req.user.orgId, { resumeLink });
  const result = await sendEmail({ to: c.email, subject: msg.subject, text: msg.body });
  if (!result.ok) return res.status(502).json({ error: result.error });
  usage.incEmail();

  const updated = await store.recordOutreach(c.id, { channel: 'email', subject: msg.subject }, req.user.orgId);
  res.json({ ok: true, previewUrl: result.previewUrl, candidate: updated, remaining: emailRemaining() });
}));

// Bulk campaign — throttled sequential send to selected candidates with an email.
emailRouter.post('/campaign', canSend, rateLimit({ windowMs: 60_000, max: 4 }), asyncHandler(async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).slice(0, 500);
  if (!ids.length) return res.status(400).json({ error: 'No recipients selected' });

  const list = (await Promise.all(ids.map((id) => store.getCandidate(id, req.user.orgId)))).filter(Boolean);
  const withEmail = list.filter((c) => c.email);
  const results = [];
  let sent = 0, skipped = list.length - withEmail.length, failed = 0, capped = 0;
  // Mark the no-email ones up front.
  for (const c of list) if (!c.email) results.push({ id: c.id, name: c.fullName, status: 'skipped', reason: 'no email' });

  // Enforce the daily ban-safety cap: never send more than what's left today.
  let remaining = emailRemaining();
  if (remaining <= 0) {
    return res.status(429).json({ error: `Daily email limit reached (${emailCap()}/day). Resets tomorrow.`, sent: 0, skipped, failed: 0, capped: withEmail.length, total: list.length, remaining: 0 });
  }

  for (const c of withEmail) {
    if (remaining <= 0) { capped++; results.push({ id: c.id, name: c.fullName, status: 'capped', reason: 'daily limit' }); continue; }
    const resumeLink = await resumeLinkFor(req, c, req.body?.resumeRequest);
    const msg = await compose(req.body || {}, c, req.user.orgId, { resumeLink });
    const r = await sendEmail({ to: c.email, subject: msg.subject, text: msg.body });
    if (r.ok) {
      usage.incEmail();
      remaining = emailRemaining();
      await store.recordOutreach(c.id, { channel: 'email', subject: msg.subject }, req.user.orgId);
      sent++;
      results.push({ id: c.id, name: c.fullName, status: 'sent', previewUrl: r.previewUrl });
    } else {
      failed++;
      results.push({ id: c.id, name: c.fullName, status: 'failed', reason: r.error });
    }
    // Throttle with jitter between real sends (skip the wait after the last one).
    if (remaining > 0 && c !== withEmail[withEmail.length - 1]) await sleep(safeGap());
  }

  res.json({ sent, skipped, failed, capped, total: list.length, remaining: emailRemaining(), dailyCap: emailCap(), results });
}));
