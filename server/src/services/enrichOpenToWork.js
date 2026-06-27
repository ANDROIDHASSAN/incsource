import { config, usingApify } from '../config.js';
import { runActor } from '../providers/apifyClient.js';

// Confirmation pass using scrapers-hub/linkedin-open-to-work-status.
//   Input : { startUrls: [{ url }] }   (LinkedIn profile URLs)
//   Output: { data: { open_to_work }, message }  (one item per URL, order preserved)
//
// Takes already-discovered candidates, runs the badge check on the LinkedIn ones
// that aren't already flagged, and sets openToWork=true when confirmed. Cheap
// ($0.00199/result) and only runs when live + enabled.

export async function enrichOpenToWork(candidates) {
  if (!usingApify() || !config.apify.otwEnrich) return candidates;

  const ENRICH_CAP = 40; // hard ceiling on profiles checked per run (spend guard)
  const targets = candidates
    .filter((c) => !c.openToWork && c.profileUrl && /linkedin\.com\/in\//i.test(c.profileUrl))
    .slice(0, ENRICH_CAP);
  if (!targets.length) return candidates;

  let results;
  try {
    results = await runActor(
      config.apify.otwActor,
      { startUrls: targets.map((c) => ({ url: c.profileUrl })) },
      { maxItems: targets.length }
    );
  } catch {
    return candidates; // enrichment is best-effort; never fail the run
  }

  // Results map back to targets by index — but only trust that alignment when the
  // actor returned exactly one result per URL. If counts differ, some URLs were
  // dropped/reordered and index-mapping would mis-flag the wrong person, so skip.
  if (!Array.isArray(results) || results.length !== targets.length) return candidates;
  targets.forEach((c, i) => {
    const otw = results[i]?.data?.open_to_work;
    if (otw) {
      c.openToWork = true;
      c.rawSignals = [...new Set([...(c.rawSignals || []), 'open-to-work-confirmed'])];
    }
  });
  return candidates;
}
