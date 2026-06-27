// Express app factory — builds the fully-wired API with no side effects (no
// network listen, no DB connection). Keeping construction separate from startup
// lets tests spin up the real app in-process against an ephemeral port, and keeps
// `index.js` a thin, readable bootstrap.
import express from 'express';
import cors from 'cors';
import { usingApify, usingAI } from './config.js';
import { dbState } from './store/index.js';
import { notFound, errorHandler, apiKeyAuth, requireAuth } from './middleware/index.js';

import { authRouter } from './routes/auth.js';
import { candidatesRouter } from './routes/candidates.js';
import { sourcingRouter } from './routes/sourcing.js';
import { geoRouter } from './routes/geo.js';
import { segmentsRouter } from './routes/segments.js';
import { matchRouter } from './routes/match.js';
import { templatesRouter } from './routes/templates.js';
import { emailRouter } from './routes/email.js';
import { settingsRouter } from './routes/settings.js';
import { usageRouter } from './routes/usage.js';

// Allowed CORS origins: an explicit allowlist in production (CORS_ORIGIN, comma-
// separated), or fully open in dev so the Vite dev server / local tools just work.
function corsOptions() {
  const allow = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  return allow ? { origin: allow } : {};
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors(corsOptions()));
  app.use(express.json({ limit: '2mb' }));

  // Liveness/diagnostics — always public, never leaks secrets.
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      apify: usingApify() ? 'live' : 'mock',
      ai: usingAI(),
      store: dbState.kind,
      db: { persistent: dbState.persistent, via: dbState.via },
      time: new Date().toISOString(),
    });
  });

  // Optional shared-secret gate (no-op unless API_KEY is set) — defence in depth
  // in front of the per-user JWT gate below.
  app.use('/api', apiKeyAuth());

  // Account auth (register / login / me) — public so users can sign in & sign up.
  app.use('/api/auth', authRouter);

  // Everything below requires a signed-in recruiter (valid JWT). The web client
  // attaches the Bearer token to every /api call, so this is transparent to the
  // app while keeping candidate PII, sourcing spend and outreach behind auth.
  const gate = requireAuth();
  app.use('/api/candidates', gate, candidatesRouter);
  app.use('/api/sourcing', gate, sourcingRouter);
  app.use('/api/geo', gate, geoRouter);
  app.use('/api/segments', gate, segmentsRouter);
  app.use('/api/match', gate, matchRouter);
  app.use('/api/templates', gate, templatesRouter);
  app.use('/api/email', gate, emailRouter);
  app.use('/api/settings', gate, settingsRouter);
  app.use('/api/usage', gate, usageRouter);

  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
