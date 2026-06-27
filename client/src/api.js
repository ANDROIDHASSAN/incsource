// ── Auth token (JWT) — persisted in localStorage and attached to every /api call.
const TOKEN_KEY = 'incsource.token';
export const auth = {
  get: () => (typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null),
  set: (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },
};

// Attach the API key (if locked down) and the Bearer token to every /api request.
const API_KEY = import.meta.env?.VITE_API_KEY;
if (typeof window !== 'undefined' && window.fetch) {
  const _fetch = window.fetch.bind(window);
  window.fetch = (url, opts = {}) => {
    if (typeof url !== 'string' || !url.startsWith('/api')) return _fetch(url, opts);
    const headers = { ...(opts.headers || {}) };
    if (API_KEY) headers['x-api-key'] = API_KEY;
    const token = auth.get();
    if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
    return _fetch(url, { ...opts, headers });
  };
}

const json = (r) => r.json();
const qs = (params = {}) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();

export const api = {
  health: () => fetch('/api/health').then(json),

  // auth
  register: (body) => fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),
  login: (body) => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),
  me: () => fetch('/api/auth/me').then(json),
  providers: () => fetch('/api/sourcing/providers').then(json),
  stats: () => fetch('/api/candidates/stats').then(json),
  analytics: (params = {}) => fetch(`/api/candidates/analytics?${qs(params)}`).then(json),
  facets: () => fetch('/api/candidates/facets').then(json),
  geo: () => fetch('/api/geo').then(json),
  meta: () => fetch('/api/candidates/meta').then(json),

  candidates: (params = {}) => fetch(`/api/candidates?${qs(params)}`).then(json),
  candidate: (id) => fetch(`/api/candidates/${id}`).then(json),
  patch: (id, body) =>
    fetch(`/api/candidates/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),
  bulk: (body) =>
    fetch('/api/candidates/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),
  remove: (id) => fetch(`/api/candidates/${id}`, { method: 'DELETE' }).then(json),
  enrich: (id) => fetch(`/api/candidates/${id}/enrich`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(json),
  enrichBulk: (ids) => fetch('/api/candidates/enrich', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }).then(json),
  exportUrl: (params = {}) => `/api/candidates/export?${qs(params)}`,
  // Download the CSV via an authenticated fetch (the export route now requires a
  // token, and a plain window.open navigation can't send the Authorization header).
  downloadExport: async (params = {}) => {
    const res = await fetch(`/api/candidates/export?${qs(params)}`);
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'incsource-candidates.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  outreachPreview: (id, body) =>
    fetch(`/api/candidates/${id}/outreach/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),
  outreachLog: (id, body) =>
    fetch(`/api/candidates/${id}/outreach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),

  run: (body) =>
    fetch('/api/sourcing/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),

  // Streaming run — calls onEvent({type, ...}) for every progress event as the
  // server emits newline-delimited JSON. Falls back to a single 'done' if the
  // browser can't stream the response body.
  runStream: async (body, onEvent) => {
    const res = await fetch('/api/sourcing/run/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      onEvent(data.run ? { type: 'done', ...data } : { type: 'error', message: 'Sourcing failed' });
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const flush = (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) { try { onEvent(JSON.parse(line)); } catch { /* ignore partial */ } }
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      flush(dec.decode(value, { stream: true }));
    }
    const tail = buf.trim();
    if (tail) { try { onEvent(JSON.parse(tail)); } catch { /* ignore */ } }
  },

  // saved sessions (sourcing run history)
  sessions: () => fetch('/api/sourcing/runs').then(json),
  sessionCandidates: (id, params = {}) => fetch(`/api/sourcing/runs/${id}/candidates?${qs(params)}`).then(json),
  renameSession: (id, name) => fetch(`/api/sourcing/runs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).then(json),
  deleteSession: (id) => fetch(`/api/sourcing/runs/${id}`, { method: 'DELETE' }).then(json),

  matchParse: (jd) => fetch('/api/match/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jd }) }).then(json),
  uploadJD: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/match/upload', { method: 'POST', body: fd }).then(json);
  },
  match: (body) => fetch('/api/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),

  // usage / quotas (email daily cap, Apify spend, Groq AI limits)
  usage: () => fetch('/api/usage').then(json),

  // email + templates
  emailStatus: () => fetch('/api/email/status').then(json),

  // settings / API keys
  settings: () => fetch('/api/settings').then(json),
  revealSettings: () => fetch('/api/settings/reveal').then(json),
  saveSettings: (body) => fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),
  groqModels: () => fetch('/api/settings/groq-models').then(json),
  templates: () => fetch('/api/templates').then(json),
  createTemplate: (body) => fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),
  updateTemplate: (id, body) => fetch(`/api/templates/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),
  deleteTemplate: (id) => fetch(`/api/templates/${id}`, { method: 'DELETE' }).then(json),
  sendEmail: (id, body) => fetch(`/api/email/send/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),
  campaign: (body) => fetch('/api/email/campaign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),

  segments: () => fetch('/api/segments').then(json),
  saveSegment: (body) =>
    fetch('/api/segments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(json),
  deleteSegment: (id) => fetch(`/api/segments/${id}`, { method: 'DELETE' }).then(json),
};
