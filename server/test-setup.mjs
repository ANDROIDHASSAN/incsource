// Loaded via `node --test --import ./test-setup.mjs` BEFORE any source module, so
// it controls the environment config.js reads at import time. Setting these keys
// here also stops dotenv from loading the real server/.env values (dotenv never
// overwrites a key that already exists in process.env).
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';        // → in-memory store, no mongod, no prod guards
process.env.STORE = 'memory';
process.env.AUTH_SECRET = 'test-secret-deterministic';
process.env.APIFY_TOKEN = '';         // no live sourcing / network
process.env.GROQ_API_KEY = '';        // no live AI / network
process.env.SMTP_HOST = '';           // email stays in test mode (no real sends)
process.env.MONGODB_URI = '';         // never reach Atlas
process.env.CORS_ORIGIN = '';
// Per-process usage file so parallel test files don't race or touch real counters.
process.env.USAGE_FILE = path.join(os.tmpdir(), `incsource-usage-test-${process.pid}.json`);
