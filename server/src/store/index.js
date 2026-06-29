import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { config, usingMongo } from '../config.js';
import { memoryStore } from './memoryStore.js';
import { mongoStore } from './mongoStore.js';

export let store = memoryStore;

// Tracks how persistence was achieved, for /api/health and auth gating.
export const dbState = { kind: 'memory', persistent: false, via: null };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// On-disk data dir for the bundled local MongoDB (survives restarts, git-ignored).
const LOCAL_DB_PATH = path.resolve(__dirname, '../../.localdb');

let memServer = null;
// Fixed port for the bundled local mongod. A fixed port lets a process that
// reloads (e.g. `node --watch`) reconnect to the SAME running mongod instead of
// spawning a second one that collides on the dbPath lock ("DBPathInUse").
const LOCAL_DB_PORT = Number(process.env.LOCAL_DB_PORT) || 27077;
const LOCAL_URI = `mongodb://127.0.0.1:${LOCAL_DB_PORT}/incsource`;

// Is a local mongod already serving on the fixed port (left by a prior reload)?
// If so we reuse it rather than starting a second one over the same data dir.
async function localMongoAlreadyUp() {
  try {
    const conn = await mongoose.createConnection(LOCAL_URI, { serverSelectionTimeoutMS: 1500 }).asPromise();
    await conn.close();
    return true;
  } catch {
    return false;
  }
}

// Spin up a real, persistent MongoDB locally using a bundled mongod binary.
// This is NOT the ephemeral JS memory store — it's an actual mongod process with
// WiredTiger files on disk, so accounts and data survive restarts even without Atlas.
async function startLocalMongo() {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  fs.mkdirSync(LOCAL_DB_PATH, { recursive: true });
  // We only reach here when nothing is serving on the port, so a leftover lock is
  // stale — clear it so a hard-killed previous run can't block startup.
  try { fs.rmSync(path.join(LOCAL_DB_PATH, 'mongod.lock'), { force: true }); } catch { /* ignore */ }
  // Pin a known-good mongod build. The auto-selected latest (8.2.x) crashes on
  // start on some Windows machines (it leaves .mdmp dumps → "failed to start
  // within 10s"), so we use 7.0.14, which runs reliably and is already cached.
  const localMongoVersion = process.env.LOCAL_MONGO_VERSION || '7.0.14';
  memServer = await MongoMemoryServer.create({
    binary: { version: localMongoVersion },
    instance: { port: LOCAL_DB_PORT, dbName: 'incsource', dbPath: LOCAL_DB_PATH, storageEngine: 'wiredTiger' },
  });
  return memServer.getUri('incsource');
}

export async function initStore() {
  // 0) Tests (and anyone who sets STORE=memory) get the fast in-process store —
  //    no mongod spin-up, fully deterministic, resets per process.
  if (process.env.STORE === 'memory' || process.env.NODE_ENV === 'test') {
    store = memoryStore;
    Object.assign(dbState, { kind: 'memory', persistent: false, via: null });
    return store;
  }

  // 1) Prefer a configured MongoDB (Atlas/production) when reachable.
  if (usingMongo) {
    try {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 4000 });
      store = mongoStore;
      await mongoStore.ensureDefaults();
      Object.assign(dbState, { kind: 'mongo', persistent: true, via: 'atlas' });
      console.log('🗄️  Store: MongoDB connected (configured URI)');
      return store;
    } catch (err) {
      console.warn(`⚠️  Configured MongoDB unreachable (${err.message.split('.')[0]}).`);
    }
  }

  // 2) Fall back to a bundled local MongoDB so we still get a real, persistent DB.
  //    Retry a few times: during process churn an orphaned mongod may still be
  //    booting on the fixed port (holding the dbPath lock), so a single attempt
  //    can wrongly fall through to memory. We prefer reusing it once it's up.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const reuse = await localMongoAlreadyUp();
      const uri = reuse ? LOCAL_URI : await startLocalMongo();
      if (reuse) console.log('🗄️  Reusing local MongoDB already running on port', LOCAL_DB_PORT);
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
      store = mongoStore;
      await mongoStore.ensureDefaults();
      Object.assign(dbState, { kind: 'mongo', persistent: true, via: 'local' });
      console.log(`🗄️  Store: local MongoDB (persistent, ${LOCAL_DB_PATH})`);
      return store;
    } catch (err) {
      const lockClash = /DBPathInUse|lock file|in use/i.test(err.message);
      if (attempt < 4 && lockClash) {
        // An orphaned mongod likely holds the dir — wait for it to accept
        // connections so the next loop reuses it instead of starting a rival.
        console.warn(`⚠️  Local MongoDB busy (attempt ${attempt}/4) — waiting to reuse…`);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      console.warn(`⚠️  Local MongoDB failed to start (${err.message.split('\n')[0]}). Using in-memory (non-persistent).`);
      break;
    }
  }

  // 3) Last resort: in-process memory store (data resets on restart).
  Object.assign(dbState, { kind: 'memory', persistent: false, via: null });
  console.log('🗄️  Store: in-memory (non-persistent fallback)');
  return memoryStore;
}

// Clean shutdown so the local mongod child process doesn't linger.
async function shutdown() {
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  try { if (memServer) await memServer.stop({ doCleanup: false, force: false }); } catch { /* ignore */ }
}
process.on('SIGINT', () => shutdown().finally(() => process.exit(0)));
process.on('SIGTERM', () => shutdown().finally(() => process.exit(0)));
