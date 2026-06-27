# Architecture

## Data flow

```
                         POST /api/sourcing/run  { sources, query, limit }
                                       │
                                       ▼
                          ┌──────────────────────┐
                          │     Ingest pipeline   │   services/ingest.js
                          └──────────┬───────────┘
            ┌────────────────────────┼────────────────────────┐
            ▼                        ▼                         ▼
   apify-linkedin            apify-naukri                  inbound
   (providers/*)             (providers/*)                 (providers/*)
            └────────────┬───────────┴────────────┬──────────┘
                         ▼                         ▼
                  normalize()                   each raw record → Candidate shape
                         │
                         ▼
                  dedupe() across the batch + against the store
                         │
                         ▼
                  scoreActiveIntent()  → activeScore 0..100 + signals[]
                         │
                         ▼
                  store.upsertCandidates()  (MongoDB or in-memory)
```

## The provider contract

Every source is a `SourceProvider`:

```js
{
  id: 'apify-linkedin',
  label: 'LinkedIn (Apify)',
  enabled() { return Boolean(process.env.APIFY_TOKEN); }, // can it run live?
  async fetch({ query, limit }) { return RawCandidate[] }   // raw, source-shaped
  normalize(raw) { return PartialCandidate }                // → unified shape
}
```

The pipeline never knows which source it's talking to. To add **Indeed**, **AngelList**,
or **Naukri Resdex**, drop a new file in `server/src/providers/`, register it in
`providers/index.js`, done.

## The Candidate shape (unified)

```js
{
  externalId, source,            // provenance
  fullName, headline, location,
  currentTitle, currentCompany,
  skills: [],
  profileUrl, email, phone,      // contact (often null from scraping)
  lastActiveAt,                  // recency signal
  noticePeriodDays,              // intent signal (Naukri/inbound)
  openToWork: Boolean,           // intent signal (LinkedIn)
  rawSignals: [],                // free-text signals found
  activeScore, scoreBreakdown,   // computed by the engine
  appliedToJob,                  // inbound-only
}
```

## Active-Intent scoring (the IP)

`services/activeSignal.js` assigns weighted points:

| Signal | Points |
|---|---|
| Applied to one of *your* jobs (inbound) | +40 |
| `#OpenToWork` / "open to work" | +25 |
| "immediate joiner" / notice ≤ 15 days | +20 |
| Headline mentions seeking/looking/available | +12 |
| Active in last 7 days | +15 (decays to 0 by 90 days) |
| Notice period 16–30 days | +8 |
| Profile has contactable email/phone | +5 |

Capped at 100. Recruiters sort by this. Tune the weights in one place.

## Why graceful degradation

- **No `MONGODB_URI`** → `store/memoryStore.js` keeps everything in a `Map`. The app is
  fully usable for demos and dev without installing Mongo.
- **No `APIFY_TOKEN`** → each Apify provider returns realistic mock records from
  `providers/mockData.js`, so the *entire* pipeline (normalize → dedupe → score → UI) is
  exercised. Flip the token on and the same code path calls real actors.

This means you (or a teammate) can `npm install && npm run dev` and immediately see the
product, then graduate to real data by adding env vars — no code changes.
