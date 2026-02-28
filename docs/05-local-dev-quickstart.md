# PhotoX Personal Edition - Local Dev Quickstart (Docker First)

## 1) Prerequisites

- Docker Engine running locally.
- Docker Compose v2 available.
- Available ports: `8088`, `3001`, `5432`, `6379`, `9090`.
- Local writable directories for media originals and derivatives.

---

## 2) Project Artifacts

- Compose file: `docker-compose.yml`
- Environment template: `.env.example`
- Prometheus config: `infra/prometheus/prometheus.yml`
- Service scaffolds: `services/*`
- Web scaffold: `apps/web`
- Current implementation snapshot: `docs/11-current-implementation-status.md`

---

## 3) First-Time Local Setup

1. Copy env template.

```bash
cp .env.example .env
```

2. Set local absolute media paths in `.env`.

Example values:

```text
PHOTOX_ORIGINALS_DIR=/absolute/path/to/photox/data/originals
PHOTOX_DERIVED_DIR=/absolute/path/to/photox/data/derived
```

3. Create directories.

```bash
mkdir -p /absolute/path/to/photox/data/originals /absolute/path/to/photox/data/derived
```

4. Validate compose config.

```bash
docker compose --env-file .env config
```

---

## 4) Start and Stop Commands

Infra only:

```bash
docker compose --env-file .env up -d postgres redis
```

Full stack:

```bash
docker compose --env-file .env --profile app up -d --build
```

View status:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs --no-color <service> --tail 120
```

Stop stack:

```bash
docker compose --env-file .env down
```

---

## 5) Basic Endpoints

- Web app (gateway): `http://localhost:8088/`
- Web app (direct dev server): `http://localhost:3000/`
- Grafana: `http://localhost:3001`
- Prometheus: `http://localhost:9090`
- Service health (container-local): `http://127.0.0.1:<port>/health`

Notes:
- When using `http://localhost:3000` directly, Next.js dev rewrites are enabled in `apps/web/next.config.mjs`.
- Default dev mode in compose is `NEXT_DEV_API_PROXY_MODE=compose`, which routes `/api/v1/*` directly to internal service hosts (for example `/api/v1/me` -> `auth-service:3000`) and avoids proxying back through host `localhost` from inside the web container.
- Alternative mode is `NEXT_DEV_API_PROXY_MODE=gateway`, which routes `/api/v1/*` to `${NEXT_DEV_API_PROXY_TARGET:-http://localhost:8088}/api/v1/*`.
- This keeps web API calls like `/api/v1/me` working in local development and avoids auth redirect loops caused by local `404` responses from the Next.js server.

Backend API docs through gateway:
- Auth: `http://localhost:8088/api/v1/auth/docs`
- Ingest: `http://localhost:8088/api/v1/uploads/docs`
- Library: `http://localhost:8088/api/v1/library/docs`
- Album/Sharing: `http://localhost:8088/api/v1/albums/docs`
- Search: `http://localhost:8088/api/v1/search/docs`
- Worker: `http://localhost:8088/api/v1/worker/docs`
- ML: `http://localhost:8088/api/v1/ml/docs`

OpenAPI JSON through gateway:
- Auth: `http://localhost:8088/api/v1/auth/openapi.json`
- Ingest: `http://localhost:8088/api/v1/uploads/openapi.json`
- Library: `http://localhost:8088/api/v1/library/openapi.json`
- Album/Sharing: `http://localhost:8088/api/v1/albums/openapi.json`
- Search: `http://localhost:8088/api/v1/search/openapi.json`
- Worker: `http://localhost:8088/api/v1/worker/openapi.json`
- ML: `http://localhost:8088/api/v1/ml/openapi.json`

---

## 6) Quick Health Verification

Example checks:

```bash
docker compose exec -T web-app wget -qO- http://127.0.0.1:3000/health
docker compose exec -T auth-service wget -qO- http://127.0.0.1:3000/health
docker compose exec -T ml-service python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health').status)"

# Swagger/OpenAPI smoke checks
python3 scripts/smoke_swagger_docs.py

# Pact contract checks (run inside each service/app)
npm --prefix apps/web test
npm --prefix services/worker test
npm --prefix services/auth test
npm --prefix services/ingest test
npm --prefix services/library test
```

Smoke check note:
- `scripts/smoke_swagger_docs.py` starts each Node service locally and polls readiness endpoints (`/health`, docs, OpenAPI) with bounded retries before failing.
- On failure, it reports the tail of service stdout/stderr to speed up diagnosis.

Pact workflow notes:
- `apps/web` test workflow generates and publishes HTTP consumer pacts.
- `services/worker` test workflow generates and publishes message consumer pacts, then verifies worker provider pacts.
- `services/auth`, `services/ingest`, and `services/library` test workflows verify pacts from broker and publish verification results.
- `PACT_BROKER_BASE_URL` must be set for pact publish and provider verification workflows (recommended local value: `http://localhost:9292`).
- Pact provider/message verification is mock-based and must not require PostgreSQL, Redis, BullMQ, or other live service endpoints.
- Auth/ingest/library provider verification uses `http://localhost:8088` by default unless provider base URL env vars are set.

---

## 7) Common Docker Troubleshooting

- `Cannot connect to the Docker daemon`
  - Start Docker Engine and retry.
- `permission denied` for media bind mounts
  - Confirm `PHOTOX_ORIGINALS_DIR` and `PHOTOX_DERIVED_DIR` are writable.
- service starts but health check fails
  - inspect logs and validate service port and `/health` endpoint.

---

## 8) Common Pact Troubleshooting

### Missing libcrypt.so.1

If you encounter the error `ruby: error while loading shared libraries: libcrypt.so.1: cannot open shared object file` when running Pact tests, it is likely because your Linux distribution (e.g., Fedora 33+, Ubuntu 22.04+) has moved to a newer version of the encryption library.

**Fix for Fedora/RHEL:**
```bash
sudo dnf install libxcrypt-compat
```

**Fix for Ubuntu/Debian:**
```bash
sudo apt-get install libcrypt1
```

---

## 9) AI Agent Navigation

After environment is up, agents should follow:

1. `docs/06-ai-agent-master-runbook.md`
2. `docs/07-ai-agent-task-contracts.md`
3. `docs/08-service-implementation-spec.md`
4. `docs/09-testing-and-quality-gates.md`
5. `docs/10-execution-checklists-and-handoffs.md`
