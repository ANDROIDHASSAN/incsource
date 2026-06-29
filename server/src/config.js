import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 4000,
  mongoUri: process.env.MONGODB_URI || null,

  apify: {
    token: process.env.APIFY_TOKEN || null,

    // Discovery actors (people / candidates)
    linkedinActor: process.env.APIFY_LINKEDIN_ACTOR || 'apimaestro/linkedin-profile-search-scraper',
    harvestActor: process.env.APIFY_HARVEST_ACTOR || 'harvestapi/linkedin-profile-search',
    indeedActor: process.env.APIFY_INDEED_ACTOR || 'lexis-solutions/resume-indeed-com-scraper',

    // Hiring-intel actor (job postings, not candidates)
    naukriJobsActor: process.env.APIFY_NAUKRI_ACTOR || 'memo23/naukri-scraper',

    // Enrichment actor (confirms #OpenToWork on profile URLs)
    otwActor: process.env.APIFY_OTW_ACTOR || 'scrapers-hub/linkedin-open-to-work-status',
    // Run the OpenToWork confirmation pass on LinkedIn candidates. OFF by default:
    // the search actor already returns open_to_work natively, and this extra pass
    // is slow (40s+) and fragile, which caused runs to exhaust their budget and
    // return nothing. Opt back in with APIFY_OTW_ENRICH=true if you need deeper
    // confirmation on profiles the search actor leaves blank.
    otwEnrich: process.env.APIFY_OTW_ENRICH === 'true',

    // Contact-enrichment actor — finds verified email + phone from name + company.
    contactActor: process.env.APIFY_CONTACT_ACTOR || 'ryanclinton/waterfall-contact-enrichment',
    // Verification depth: 'standard' (MX, fast) or 'deep' (SMTP, accurate).
    contactVerify: process.env.APIFY_CONTACT_VERIFY || 'standard',
    // Max candidates to bulk-enrich per run (spend guard — $0.20 each).
    contactBulkCap: Number(process.env.APIFY_CONTACT_BULK_CAP) || 25,

    // ── Spend controls (tuned for ≤ ₹1 / lead on discovery) ──
    // Per-result charge ceiling used to derive the run's maxTotalChargeUsd.
    // 0.02 USD ≈ ₹1.7/item; with a healthy keep rate this lands under ₹1/lead.
    usdPerItem: Number(process.env.APIFY_USD_PER_ITEM) || 0.02,
    // Absolute ceiling for any single actor call.
    maxUsdPerCall: Number(process.env.APIFY_MAX_USD_PER_CALL) || 2,
    // Hard cap so a runaway run can't drain credits (also clamps per-source items).
    maxItemsPerRun: Number(process.env.APIFY_MAX_ITEMS) || 100,
    // Email lookup costs more and is slower; opt in via env.
    includeEmail: process.env.APIFY_INCLUDE_EMAIL === 'true',
    // Naukri employer-email enrichment (billed per email found).
    naukriEnrichEmails: process.env.APIFY_NAUKRI_EMAILS === 'true',
  },

  resdexApiKey: process.env.NAUKRI_RESDEX_API_KEY || null,
  linkedinTalentToken: process.env.LINKEDIN_TALENT_TOKEN || null,

  // Email sending safety — protects a free SMTP account (e.g. Gmail ~500/day) from
  // being flagged/banned for bulk sending. Daily cap is enforced server-side; sends
  // are throttled with jitter so they don't go out in a suspicious rapid burst.
  email: {
    dailyCap: Number(process.env.EMAIL_DAILY_CAP) || 400,
    throttleMs: Number(process.env.EMAIL_THROTTLE_MS) || 800, // base gap between sends
    jitterMs: Number(process.env.EMAIL_JITTER_MS) || 700, // random extra 0..jitter per send
  },

  // AI semantic JD↔candidate matching. Groq only (fast + low cost).
  ai: {
    batchSize: Number(process.env.AI_MATCH_BATCH) || 12,
    maxCandidates: Number(process.env.AI_MATCH_MAX) || 48,
  },
  groq: {
    key: process.env.GROQ_API_KEY || null,
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    // Neural text-to-speech (Orpheus on GroqCloud) — gives JARVIS a real human voice
    // instead of the robotic browser SpeechSynthesis, and works on every browser.
    // English voices: autumn, diana, hannah, austin, daniel, troy.
    ttsModel: process.env.GROQ_TTS_MODEL || 'canopylabs/orpheus-v1-english',
    ttsVoice: process.env.GROQ_TTS_VOICE || 'austin',
  },

  // Auth — JWT signing. Set AUTH_SECRET in production; dev gets a stable default.
  auth: {
    secret: process.env.AUTH_SECRET || 'incsource-dev-secret-change-me',
    tokenTtl: process.env.AUTH_TOKEN_TTL || '7d',
  },
};

export const usingMongo = Boolean(config.mongoUri);
// Apify + AI keys are runtime-settable via the UI, so check them dynamically.
export const usingApify = () => Boolean(config.apify.token);
export const usingAI = () => Boolean(config.groq.key);
export const aiProvider = () => (config.groq.key ? 'groq' : null);

// Apply keys submitted from the UI Settings panel (no restart needed).
export function applySettings({ groqKey, groqModel, apifyToken } = {}) {
  if (groqKey !== undefined) config.groq.key = groqKey ? String(groqKey).trim() : null;
  if (groqModel) config.groq.model = String(groqModel).trim();
  if (apifyToken !== undefined) config.apify.token = apifyToken ? String(apifyToken).trim() : null;
}

// Raw keys for the Settings panel's "reveal" (eye) + pre-fill. Auth-gated on the
// route so only a signed-in user can read their own stored secrets back.
export function revealSettings() {
  return {
    groq: { key: config.groq.key || '', model: config.groq.model },
    apify: { token: config.apify.token || '' },
  };
}

// Masked status for the Settings panel (never returns the raw secret).
export function settingsStatus() {
  const mask = (k) => (k ? `••••${String(k).slice(-4)}` : null);
  return {
    groq: { configured: Boolean(config.groq.key), masked: mask(config.groq.key), model: config.groq.model },
    apify: { configured: usingApify(), masked: mask(config.apify.token) },
    ai: usingAI(),
  };
}
