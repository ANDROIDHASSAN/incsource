// Thin Apify REST client (no SDK dependency — uses native fetch).
// Runs an actor synchronously and returns its dataset items.
import { config } from '../config.js';

const BASE = 'https://api.apify.com/v2';

/**
 * Run an actor and get back its dataset items.
 * @param {string} actorId  e.g. "apimaestro/linkedin-profile-search" (use ~ for slash in URL)
 * @param {object} input    actor input JSON
 * @param {object} opts     { maxItems }
 */
export async function runActor(actorId, input, { maxItems = config.apify.maxItemsPerRun } = {}) {
  if (!config.apify.token) throw new Error('APIFY_TOKEN not set');
  const path = actorId.replace('/', '~');

  // Enforce the runaway ceiling regardless of what a caller asked for.
  const cap = Math.min(Math.max(1, maxItems), config.apify.maxItemsPerRun);

  // Result count is capped via the actor INPUT (max_profiles / maxItems / etc.).
  // We cap SPEND with maxTotalChargeUsd instead of the URL `maxItems` param, because
  // a low URL maxItems can drop the derived charge-cap below an actor's minimum and
  // get the whole run rejected (e.g. HarvestAPI's $0.10 floor). Keep the ceiling
  // above any single actor's minimum, scaled to how many items we asked for.
  const ABS_MAX_USD = config.apify.maxUsdPerCall; // hard per-call ceiling
  const maxTotalChargeUsd = Math.min(ABS_MAX_USD, Math.max(0.12, Number((cap * config.apify.usdPerItem).toFixed(2))));
  const url =
    `${BASE}/acts/${path}/run-sync-get-dataset-items` +
    `?token=${config.apify.token}&maxTotalChargeUsd=${maxTotalChargeUsd}`;

  // Time-box each actor call so one slow/hung source can't stall the whole run.
  // LinkedIn scraping actors have real cold starts (container spin-up can take
  // 30–60s before scraping even begins), so a tight timeout kills healthy runs
  // mid-flight. 120s comfortably clears a cold start; the run budget bounds totals.
  const timeoutMs = Number(process.env.APIFY_CALL_TIMEOUT_MS) || 90_000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: ac.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Apify actor ${actorId} timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Apify actor ${actorId} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const items = await res.json();
  // Final guard: never return more than requested even if the actor over-delivers.
  return Array.isArray(items) ? items.slice(0, cap) : [];
}
