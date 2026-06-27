// Production middleware: async error wrapping, 404, error handler, rate limiting,
// security headers, request logging, auth + RBAC.
import crypto from 'crypto';
import { log } from '../services/logger.js';

// Wrap an async route handler so rejected promises reach the error handler
// instead of hanging the request or crashing the process.
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Conservative security headers (helmet-equivalent, zero deps). This is a JSON API
// behind a separate static frontend, so we keep it strict and simple.
export function securityHeaders() {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.removeHeader('X-Powered-By');
    next();
  };
}

// Tag each request with an id and log a single structured line on completion —
// the backbone of observability (latency, status, who, correlation id).
export function requestLogger() {
  return (req, res, next) => {
    req.id = req.get('x-request-id') || crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      log.info('request', {
        requestId: req.id, method: req.method, path: req.originalUrl.split('?')[0],
        status: res.statusCode, ms: Math.round(ms), orgId: req.user?.orgId || null,
      });
    });
    next();
  };
}

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

// Centralized error handler — never leak stack traces to clients.
export function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  if (status >= 500) console.error('API error:', err.message);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
}

// Optional API-key gate. Disabled (no-op) unless API_KEY is set, so local/dev
// stays open; in production set API_KEY (server) + VITE_API_KEY (client) to lock
// down the paid sourcing/enrichment endpoints. Health check is always public.
export function apiKeyAuth() {
  const key = process.env.API_KEY || null;
  return (req, res, next) => {
    if (!key) return next();
    const got = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (got === key) return next();
    res.status(401).json({ error: 'Unauthorized' });
  };
}

// JWT auth gate. Rejects requests without a valid Bearer token. Attaches the
// decoded payload ({ sub, email, orgId, role }) to req.user. Use on routes that
// require a logged-in recruiter.
export function requireAuth() {
  return async (req, res, next) => {
    const { verifyToken } = await import('../services/auth.js');
    const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const payload = token ? verifyToken(token) : null;
    if (!payload) return res.status(401).json({ error: 'Please sign in to continue.' });
    req.user = payload;
    next();
  };
}

// Role gate — use AFTER requireAuth. Roles are ordered viewer < recruiter < admin;
// the user needs at least the lowest role passed. Keeps mutating/admin actions off
// limits to read-only members.
const ROLE_RANK = { viewer: 0, recruiter: 1, admin: 2 };
export function requireRole(...allowed) {
  const min = Math.min(...allowed.map((r) => ROLE_RANK[r] ?? 99));
  return (req, res, next) => {
    const rank = ROLE_RANK[req.user?.role] ?? -1;
    if (rank < min) return res.status(403).json({ error: 'You don’t have permission to do that.' });
    next();
  };
}

// Minimal in-memory rate limiter keyed by IP — protects expensive endpoints
// (sourcing runs cost Apify credits) without an external dependency.
export function rateLimit({ windowMs = 60_000, max = 10 } = {}) {
  const hits = new Map(); // ip -> [timestamps]
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      const retry = Math.ceil((windowMs - (now - arr[0])) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: `Too many requests. Retry in ${retry}s.` });
    }
    arr.push(now);
    hits.set(ip, arr);
    next();
  };
}

// Prevent overlapping expensive runs from the same process exhausting credits.
export function singleFlight() {
  let inFlight = 0;
  const MAX = Number(process.env.MAX_CONCURRENT_RUNS) || 3;
  return (req, res, next) => {
    if (inFlight >= MAX) return res.status(429).json({ error: 'A sourcing run is already in progress. Try again shortly.' });
    inFlight++;
    res.on('finish', () => { inFlight--; });
    res.on('close', () => { if (!res.writableEnded) inFlight--; });
    next();
  };
}
