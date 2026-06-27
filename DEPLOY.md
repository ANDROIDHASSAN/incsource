# Deployment Guide

This is a MERN monorepo with two apps:

- `server/` — Express API (ESM, Node 22). Listens on `PORT` (default `4000`). Health check: `GET /api/health`.
- `client/` — Vite + React SPA. Builds to static files served by any web server / CDN.

---

## Local development

Run each app in its own terminal.

```bash
# Terminal 1 — API
cd server
cp .env.example .env   # then fill in the values
npm install
npm run dev            # http://localhost:4000

# Terminal 2 — client
cd client
npm install
npm run dev            # http://localhost:5173 (proxies /api -> http://localhost:4000)
```

You also need a MongoDB instance reachable via `MONGODB_URI` (local install, Docker, or Atlas).

---

## Docker Compose (full stack)

Brings up MongoDB, the API, and the nginx-served client together.

```bash
# Create the server env file first (compose loads ./server/.env)
cp server/.env.example server/.env   # then fill in the values

docker compose up --build
```

Once running:

- Client: <http://localhost:8080>
- API: <http://localhost:4000/api/health>

Notes:

- Compose sets `MONGODB_URI=mongodb://mongo:27017/incsource`, overriding any value in `server/.env`.
- MongoDB data persists in the named volume `mongo-data`.
- The client's nginx proxies `/api/` to the `server` service, so the SPA talks to the API through the same origin.
- Tear down with `docker compose down` (add `-v` to also delete the database volume).

---

## Required environment variables

Configure these in `server/.env`. See [`server/.env.example`](server/.env.example) for the full list.

| Variable        | Required | Purpose                                              |
| --------------- | -------- | ---------------------------------------------------- |
| `MONGODB_URI`   | Yes      | MongoDB connection string                            |
| `AUTH_SECRET`   | Yes      | Secret used to sign/verify auth tokens (JWT)         |
| `PORT`          | No       | API listen port (default `4000`)                     |
| `CORS_ORIGIN`   | Prod     | Allowed browser origin(s) for cross-origin requests  |
| `APIFY_TOKEN`   | No       | Apify integration                                    |
| `GROQ_API_KEY`  | No       | Groq integration                                     |
| `SMTP_*`        | No       | Outbound email (host, port, user, pass)              |

---

## Production checklist

- **`AUTH_SECRET` must be set** to a strong, unique random value in production. Never reuse the example/default value — tokens signed with a known secret are forgeable.
- **Lock `CORS_ORIGIN` to the client origin** (e.g. `https://app.example.com`). Do not leave it open / wildcarded in production.
- Serve everything over HTTPS (terminate TLS at your load balancer, reverse proxy, or CDN).
- Keep `server/.env` out of version control and out of built images (already covered by `.dockerignore`).
- Provide a managed/replicated MongoDB (e.g. Atlas) rather than the single-node compose `mongo` service for real production workloads.
```
