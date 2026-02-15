# PhotoX Personal Edition - Local Dev Quickstart (Docker First)

## 1) Prerequisites

- Docker Engine running locally.
- Docker Compose v2 available.
- Available ports: `80`, `443`, `3001`, `5432`, `6379`, `9090`.
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

- Web app: `http://localhost/`
- Grafana: `http://localhost:3001`
- Prometheus: `http://localhost:9090`
- Service health (container-local): `http://127.0.0.1:<port>/health`

Backend API docs through gateway:
- Auth: `http://localhost/api/v1/auth/docs`
- Ingest: `http://localhost/api/v1/uploads/docs`
- Library: `http://localhost/api/v1/library/docs`
- Album/Sharing: `http://localhost/api/v1/albums/docs`
- Search: `http://localhost/api/v1/search/docs`
- Worker: `http://localhost/api/v1/worker/docs`
- ML: `http://localhost/api/v1/ml/docs`

OpenAPI JSON through gateway:
- Auth: `http://localhost/api/v1/auth/openapi.json`
- Ingest: `http://localhost/api/v1/uploads/openapi.json`
- Library: `http://localhost/api/v1/library/openapi.json`
- Album/Sharing: `http://localhost/api/v1/albums/openapi.json`
- Search: `http://localhost/api/v1/search/openapi.json`
- Worker: `http://localhost/api/v1/worker/openapi.json`
- ML: `http://localhost/api/v1/ml/openapi.json`

---

## 6) Quick Health Verification

Example checks:

```bash
docker compose exec -T web-app wget -qO- http://127.0.0.1:3000/health
docker compose exec -T auth-service wget -qO- http://127.0.0.1:3000/health
docker compose exec -T ml-service python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health').status)"

# Swagger/OpenAPI smoke checks
python3 scripts/smoke_swagger_docs.py
```

---

## 7) Common Docker Troubleshooting

- `Cannot connect to the Docker daemon`
  - Start Docker Engine and retry.
- `permission denied` for media bind mounts
  - Confirm `PHOTOX_ORIGINALS_DIR` and `PHOTOX_DERIVED_DIR` are writable.
- service starts but health check fails
  - inspect logs and validate service port and `/health` endpoint.

---

## 8) AI Agent Navigation

After environment is up, agents should follow:

1. `docs/06-ai-agent-master-runbook.md`
2. `docs/07-ai-agent-task-contracts.md`
3. `docs/08-service-implementation-spec.md`
4. `docs/09-testing-and-quality-gates.md`
5. `docs/10-execution-checklists-and-handoffs.md`
