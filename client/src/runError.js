// Turn a sourcing run's raw source errors into one clear, actionable sentence.
// Shared by the main view (banner/toast) and the AI assistant so both name the
// real cause — the most common being the Apify account hitting its monthly spend
// cap, which 403s every actor and returns 0, looking (wrongly) like "no candidates
// exist". Naming the real cause tells the recruiter exactly what to do.
export function runErrorMessage(run) {
  const errs = run?.errors || [];
  if (!errs.length) return null;
  const txt = errs.map((e) => e.message || '').join(' · ');
  if (/monthly usage hard limit|platform-feature-disabled|usage hard limit exceeded/i.test(txt))
    return 'Apify monthly usage limit reached — live scraping is paused. Upgrade your Apify plan or add an API token with remaining quota in Tools → API keys (or wait for your Apify billing cycle to reset).';
  if (/\b401\b|invalid token|authderation|authentication|not authorized|unauthorized/i.test(txt))
    return 'Apify token was rejected — check or replace your API key in Tools → API keys.';
  if (/\b402\b|payment required|insufficient/i.test(txt))
    return 'Apify reported insufficient credit — top up or upgrade your Apify plan to resume live scraping.';
  if (/timed out|exceeded \d+s/i.test(txt))
    return 'Sources timed out before returning profiles — try again, or search a simpler role/location.';
  return `Sources errored (${errs.map((e) => e.source).join(', ')}): ${txt.slice(0, 160)}`;
}
