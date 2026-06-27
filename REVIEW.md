# IncSource — Production Code Review & Hardening

A full review of the backend core was run (correctness, concurrency, security, cost).
Below is every finding and how it was resolved. All fixes are in `main`.

## Critical — fixed

| # | Issue | Where | Fix |
|---|---|---|---|
| 1 | **Mongo query corruption**: text-search `$or` and skills-`any` `$or` collided, turning `(text) AND (any skill)` into `(text) OR (any skill)` — and diverging from the in-memory store. | `candidateFilters.js` `toMongoQuery` | Rewrote with an `$and` accumulator; each OR-group is its own AND clause. Memory + Mongo now identical. |
| 2 | **Upsert race**: concurrent runs did `findOne → create`, hitting the unique index and aborting the whole batch. | `mongoStore.upsertCandidates` | Replaced with atomic `bulkWrite` upserts using `$max` (score), `$addToSet` (sources), `$setOnInsert` (workflow). Race-safe. |

## High — fixed

| # | Issue | Fix |
|---|---|---|
| 3 | **Store merge divergence** on re-sourcing (skills/geo/openToWork handled differently in memory vs Mongo; `openToWork` could reset true→false). | Both stores now OR-merge `openToWork`, take `$max` score, accumulate sources, and **never** clobber recruiter workflow (`status/starred/notes/tags`). |
| 4 | **Unbounded enrichment spend**: OpenToWork pass could fan out to hundreds of profiles. | Hard cap of 40 profiles/run + absolute `$5`/call ceiling (`APIFY_MAX_USD_PER_CALL`). |
| 5 | **Unvalidated sort** → unindexed-scan DoS. | `safeSort()` whitelist (`activeScore, fullName, createdAt, updatedAt, noticePeriodDays, status`). |
| 6 | **ReDoS / regex injection** via unescaped `q` into Mongo `$regex`. | `escapeRx()` applied to `q`, `cities`, `skills`. |
| 7 | **Dedupe misses across sources**: raw URL slugging left `www`, query params, protocol differences. | `canonicalUrl()` normalizes before keying; job-leads key on `externalId`; emails lowercased. |

## Medium — fixed

- **Source accumulation** lost prior sources on 3+ collisions in `dedupeBatch` → now uses `prev.sources`.
- **State case-sensitivity** in Mongo `$in` → `canonicalState()` normalizes every candidate's state to the canonical `STATES` casing in `ensureShape`.
- **apimaestro skills string** silently dropped when returned as a comma string → now split into an array.
- **Async route crashes**: every handler wrapped in `asyncHandler`; added 404 + centralized `errorHandler`; `unhandledRejection`/`uncaughtException` guards.

## Production middleware added
- `asyncHandler` — no hung requests / unhandled rejections.
- `rateLimit` (12/min on sourcing) + `singleFlight` (max concurrent runs) — protects Apify credits.
- `errorHandler` — never leaks stack traces; 5xx logged, 4xx messaged.
- Input caps: `q` ≤120 chars, `limit` ≤500, notes ≤5000, bulk ids ≤1000, status validated against the pipeline enum.
- Startup migration `ensureDefaults()` backfills workflow fields on legacy docs.

## Verified non-issues
- `import { store }` works despite reassignment (ES module live bindings).
- `apifyClient` slices results to `maxItems` as a final guard.

## Still recommended before public launch
- **Auth** on `/api/*` (currently open) — add an API key / session layer; `/api/sourcing/run` accepts inbound records.
- **Global per-run budget** across all providers (currently per-call capped).
- **SMTP integration** to send outreach server-side (today it opens the user's mail client + logs the touch).
- Move secrets out of `.env` into a secrets manager; rotate the keys shared during development.
