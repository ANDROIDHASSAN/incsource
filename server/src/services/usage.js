// Usage & quota tracking so recruiters can see — and stay under — their daily
// limits (email account ban-safety, Apify spend, Groq AI rate limits).
//
// Email + Groq request counts are persisted to a small JSON file that resets each
// day (survives restarts; no DB coupling). Apify spend and Groq rate-limit ceilings
// come from the providers themselves (Apify REST API; Groq response headers).
import fs from 'fs';
import path from 'path';
import { config, usingApify } from '../config.js';

// Override with USAGE_FILE in tests so they never touch real usage counters.
const FILE = process.env.USAGE_FILE || path.resolve(process.cwd(), '.usage.json');
const today = () => new Date().toISOString().slice(0, 10);

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (d && d.date === today()) return d;
  } catch { /* missing/corrupt → fresh */ }
  return { date: today(), emailsSent: 0, groqRequests: 0 };
}
function save(d) { try { fs.writeFileSync(FILE, JSON.stringify(d)); } catch { /* best effort */ } }

export const usage = {
  emailsToday: () => load().emailsSent,
  incEmail(n = 1) { const d = load(); d.emailsSent += n; save(d); return d.emailsSent; },
  groqRequestsToday: () => load().groqRequests,
  incGroq(n = 1) { const d = load(); d.groqRequests += n; save(d); return d.groqRequests; },
};

// When the daily email counter rolls over — next UTC midnight (counts key off the
// UTC date). Lets the UI show a precise "resets in …".
export function emailResetsAt() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0)).toISOString();
}

// ── Email daily-cap helpers (Gmail/free SMTP ban-safety) ──
export function emailCap() { return config.email.dailyCap; }
export function emailRemaining() { return Math.max(0, emailCap() - usage.emailsToday()); }

// ── Groq rate-limit snapshot, captured from the latest API response headers.
// Groq exposes per-key request/token ceilings (requests reset daily on the free
// tier) — the most accurate "quota left" signal available for Groq.
let groqLimits = null;
export function recordGroqHeaders(headers) {
  if (!headers) return;
  const n = (k) => { const v = headers.get?.(k); return v == null || v === '' ? null : Number(v); };
  const s = (k) => headers.get?.(k) || null;
  const snap = {
    limitRequests: n('x-ratelimit-limit-requests'),
    remainingRequests: n('x-ratelimit-remaining-requests'),
    limitTokens: n('x-ratelimit-limit-tokens'),
    remainingTokens: n('x-ratelimit-remaining-tokens'),
    // Groq reports how long until each bucket refills (e.g. "2m59.5s", "7.6s").
    resetRequests: s('x-ratelimit-reset-requests'),
    resetTokens: s('x-ratelimit-reset-tokens'),
    at: new Date().toISOString(),
  };
  // Only keep if at least one real number came through.
  if ([snap.limitRequests, snap.remainingRequests, snap.limitTokens, snap.remainingTokens].some((v) => typeof v === 'number' && !Number.isNaN(v))) groqLimits = snap;
}
export function groqSnapshot() { return groqLimits; }

// ── Apify spend (monthly), fetched live and cached 60s to avoid hammering. ──
let apifyCache = { at: 0, data: null };
export async function apifyUsage() {
  if (!usingApify()) return { configured: false };
  if (apifyCache.data && Date.now() - apifyCache.at < 60_000) return apifyCache.data;
  try {
    const res = await fetch(`https://api.apify.com/v2/users/me/limits?token=${config.apify.token}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { configured: true, error: `HTTP ${res.status}` };
    const j = await res.json();
    const lim = j.data?.limits || {};
    const cur = j.data?.current || {};
    const data = {
      configured: true,
      usedUsd: cur.monthlyUsageUsd ?? null,
      limitUsd: lim.maxMonthlyUsageUsd ?? null,
      computeUnitsUsed: cur.monthlyActorComputeUnits ?? null,
      computeUnitsLimit: lim.maxMonthlyActorComputeUnits ?? null,
      cycleEnd: j.data?.monthlyUsageCycle?.endAt || null,
    };
    apifyCache = { at: Date.now(), data };
    return data;
  } catch (e) {
    return { configured: true, error: e.message };
  }
}
