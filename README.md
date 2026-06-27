# IncSource — Active Talent Sourcing

> Part of the **InCruiter** suite (_Augmented AI for Precision Hiring_). IncSource is the
> **sourcing** product: it finds candidates who are *actively looking*, scores their intent,
> and lets recruiters **outreach** in one click — then hands the lead to the rest of the suite.

A production-grade MERN app: **M**ongoDB · **E**xpress · **R**eact · **N**ode.

---

## What it does

1. **Aggregates** active candidates from LinkedIn (HarvestAPI + apimaestro), Indeed resumes,
   Naukri (hiring intel) and your own inbound applicants — via swappable providers.
2. **Scores active intent** 0–100 from `#OpenToWork`, "immediate joiner", short notice,
   recency and applied-to-your-job signals.
3. **Filters** surgically: region → state → city (multi-select), skills (any/all), score band,
   notice period, pipeline status, shortlist, contactability.
4. **Runs the recruiter pipeline**: status stages (New → Shortlisted → Contacted → Interviewing
   → Hired/Rejected), star/shortlist, notes, tags, bulk actions.
5. **Outreach**: personalized templated messages, one-click open-in-mail / copy, auto-logged
   and moved to *Contacted*.
6. **Exports** the filtered set to CSV for your ATS, and surfaces **talent analytics**
   (pipeline, intent band, source, top states, in-demand skills).

---

## Run it

```bash
# backend
cd server && npm install && npm run dev      # http://localhost:4000

# frontend
cd client && npm install && npm run dev      # http://localhost:5173
```

- **Dashboard** → http://localhost:5173
- **Marketing landing page** → http://localhost:5173/landing.html

**Zero-setup mode**: with no `MONGODB_URI` it uses an in-memory store; with no `APIFY_TOKEN`
providers return realistic mock data — the full pipeline works out of the box. Add the keys in
`server/.env` (see `server/.env.example`) to go live.

---

## Architecture

```
 React dashboard ──HTTP──► Express API ──► Ingest pipeline
   modal · filters ·          (rate-limited,    ├─ Providers (LinkedIn / Indeed / Naukri / Inbound)
   bulk · analytics ·          async-safe,      ├─ normalize → canonical geo → dedupe
   outreach · segments         spend-capped)    ├─ Active-Intent scoring + OpenToWork enrichment
                                                 ├─ India + open-to-work audience filters
                                                 └─ Store (MongoDB | in-memory — identical behavior)
```

One shared filter engine (`services/candidateFilters.js`) drives **both** stores, so MongoDB and
in-memory always return identical results. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`REVIEW.md`](REVIEW.md) (production hardening report).

## API surface

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | status (apify mode, store kind) |
| GET | `/api/candidates` | paginated, filtered list → `{ candidates, total }` |
| GET | `/api/candidates/stats` · `/analytics` · `/facets` · `/meta` | header stats, charts, dropdowns, pipeline stages + templates |
| GET | `/api/candidates/export` | CSV of filtered set |
| PATCH | `/api/candidates/:id` | update status / starred / notes / tags |
| POST | `/api/candidates/bulk` | bulk update or delete |
| POST | `/api/candidates/:id/outreach/preview` · `/outreach` | render message · log outreach |
| DELETE | `/api/candidates/:id` | GDPR / DPDP delete |
| POST | `/api/sourcing/run` | run a sourcing pass (rate-limited, single-flight) |
| GET/POST/DELETE | `/api/segments` | saved searches |
| GET | `/api/geo` | India states/cities/zones for location filters |

## Production posture

- **Race-safe** atomic upserts; **async-wrapped** routes with central error handling; process-level
  crash guards.
- **Spend-capped** Apify calls (per-call + enrichment ceilings), **rate-limited** + **single-flight**
  sourcing.
- **Input-validated** (ReDoS-safe regex, sort whitelist, length caps, enum-checked status).
- **Workflow-safe**: re-sourcing refreshes signals but never overwrites recruiter status/notes/stars.
- **Compliance**: India-only targeting, one-click delete, no PII stored beyond what's sourced.

⚠️ Before public launch add **auth** on `/api/*` and server-side **SMTP** for outreach — see
[`REVIEW.md`](REVIEW.md).
