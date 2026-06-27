import { Router } from 'express';
import { asyncHandler } from '../middleware/index.js';
import { emailStatus } from '../services/emailService.js';
import { usage, emailCap, emailRemaining, emailResetsAt, groqSnapshot, apifyUsage } from '../services/usage.js';
import { usingAI, config } from '../config.js';

export const usageRouter = Router();

// One call powering the Usage panel: email (daily ban-safety cap), Apify (monthly
// spend), and Groq (per-key AI request quota). Each block is independent so a
// provider being down/unconfigured never breaks the others.
usageRouter.get('/', asyncHandler(async (_req, res) => {
  const [mail, apify] = await Promise.all([emailStatus(), apifyUsage()]);
  const g = groqSnapshot();
  res.json({
    email: {
      mode: mail.mode, // 'smtp' (live) | 'test' (Ethereal) | 'error'
      from: mail.from,
      sentToday: usage.emailsToday(),
      dailyCap: emailCap(),
      remaining: emailRemaining(),
      resetsAt: emailResetsAt(), // next UTC midnight
    },
    apify,
    groq: {
      configured: usingAI(),
      model: config.groq.model,
      requestsToday: usage.groqRequestsToday(),
      // Live per-key ceilings from Groq's last response headers (null until first AI call).
      limitRequests: g?.limitRequests ?? null,
      remainingRequests: g?.remainingRequests ?? null,
      limitTokens: g?.limitTokens ?? null,
      remainingTokens: g?.remainingTokens ?? null,
      resetRequests: g?.resetRequests ?? null, // e.g. "2m59s" until daily requests refill
      resetTokens: g?.resetTokens ?? null, // e.g. "7.6s" until per-minute tokens refill
    },
  });
}));
