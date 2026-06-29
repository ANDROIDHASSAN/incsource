// Resolve the PUBLIC base URL of the web app (where the SPA is served), used to
// build candidate-facing links like the resume-upload page (`/r/:token`). The app
// and API may live on different origins in dev (Vite 5173 ↔ API 4000), so we can't
// just use the API host — we prefer, in order: an explicit override, the request's
// Origin (the browser that triggered the send), the configured CORS allow-list,
// then the API host as a last resort.
export function appBaseUrl(req) {
  const clean = (u) => String(u || '').trim().replace(/\/+$/, '');
  if (process.env.APP_URL) return clean(process.env.APP_URL);
  const origin = req?.get?.('origin');
  if (origin) return clean(origin);
  if (process.env.CORS_ORIGIN) {
    const first = process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)[0];
    if (first) return clean(first);
  }
  if (req?.get) return clean(`${req.protocol}://${req.get('host')}`);
  return '';
}

/** The public resume-upload URL for a candidate token. */
export const resumeUploadUrl = (req, token) => `${appBaseUrl(req)}/r/${token}`;
