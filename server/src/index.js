// Server bootstrap: connect the store, seed a login, then start listening.
// All app wiring lives in app.js so this stays a thin, obvious entry point.
import { config, usingApify } from './config.js';
import { createApp } from './app.js';
import { initStore, dbState } from './store/index.js';
import { seedDefaultUser } from './services/userStore.js';

// A stray rejection or async throw should be logged, never crash the process.
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err?.message || err));
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err?.message || err));

async function main() {
  // Production safety: refuse to run with the public dev JWT secret — otherwise
  // anyone could forge a login token. In dev we warn but allow it.
  if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET) {
    console.error('❌ AUTH_SECRET is not set. Refusing to start in production with the default dev secret (login tokens would be forgeable). Set AUTH_SECRET in server/.env.');
    process.exit(1);
  }
  if (!process.env.AUTH_SECRET) {
    console.warn('⚠️  AUTH_SECRET not set — using the insecure dev default. Set AUTH_SECRET before deploying.');
  }

  const store = await initStore();
  const seedOrgId = await seedDefaultUser();
  // Backfill any pre-multi-tenancy rows so an existing deployment keeps working.
  await store.migrateTenancy?.(seedOrgId);

  createApp().listen(config.port, () => {
    console.log(`\n🚀 IncSource API on http://localhost:${config.port}`);
    console.log(`   Store: ${dbState.kind}  ·  Apify: ${usingApify() ? 'live' : 'mock'}\n`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
