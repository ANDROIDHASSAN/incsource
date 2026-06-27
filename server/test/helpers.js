// Shared test helpers: boot the real app in-process on an ephemeral port and talk
// to it over HTTP with native fetch — exercising the full middleware + routing
// stack exactly as production does, with zero extra dependencies.
import { createApp } from '../src/app.js';
import { initStore } from '../src/store/index.js';
import { seedDefaultUser } from '../src/services/userStore.js';

export const ADMIN = { email: 'admin@incsource.com', password: 'incsource123' };

/** Start the API on a random free port. Returns { url, close }. */
export async function startTestServer() {
  await initStore();          // STORE=memory (set in test-setup) → instant, isolated
  await seedDefaultUser();    // guarantees the ADMIN login exists
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Log in and return a valid Bearer token. */
export async function login(url, creds = ADMIN) {
  const res = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  });
  const data = await res.json();
  if (!data.token) throw new Error(`login failed: ${JSON.stringify(data)}`);
  return data.token;
}

/** The signed-in user (incl. orgId/role) for a token. */
export async function getMe(url, token) {
  const res = await fetch(`${url}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json()).user;
}

/** Headers for an authenticated JSON request. */
export const authHeaders = (token) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
});

/** Thin fetch wrapper returning { status, body }. */
export async function api(url, method, path, { token, body } = {}) {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}
