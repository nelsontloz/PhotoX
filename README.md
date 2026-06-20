# Photox

Personal photo and video hosting platform.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose

## Quick Start

```bash
# Install dependencies
pnpm install

# Start all services (infrastructure + apps)
docker compose up -d

# Open the web app
open http://localhost:5173
```

## Development

```bash
# Run all services in dev mode (hot reload)
docker compose up -d postgres redis minio
pnpm dev

# Run a single service
pnpm --filter user-service dev
```

## Services

| Service              | Port      | Description                       |
| -------------------- | --------- | --------------------------------- |
| gateway              | 3000      | API Gateway                       |
| user-service         | 3001      | User management & auth            |
| media-service        | 3002      | Photo & album metadata            |
| file-storage-service | 3003      | File upload, storage & thumbnails |
| web                  | 5173      | React frontend                    |
| postgres             | 5432      | PostgreSQL database               |
| redis                | 6379      | Redis (Pub/Sub + cache)           |
| minio                | 9000/9001 | S3-compatible object storage      |
