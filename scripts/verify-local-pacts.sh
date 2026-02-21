#!/bin/bash

# Script to verify Pact contracts locally without human-in-the-loop or Broker interference.
set -e

PROJECT_ROOT=$(pwd)

echo "--- Cleaning old pacts ---"
rm -rf apps/web/pacts/*.json
rm -rf services/worker/pacts/*.json

echo "--- Regenerating fresh pacts ---"
(cd apps/web && npm run test:contract)
(cd services/worker && npm run test:contract:messages)

echo "--- Verifying HTTP Providers against local pacts ---"

# Auth Service
echo "Verifying Auth Service..."
export PACT_URL="$PROJECT_ROOT/apps/web/pacts/photox-web-app-auth-service.json"
(cd services/auth && npx vitest run --globals test/contracts/provider.pact.test.js)

# Ingest Service
echo "Verifying Ingest Service..."
export PACT_URL="$PROJECT_ROOT/apps/web/pacts/photox-web-app-ingest-service.json"
(cd services/ingest && npx vitest run --globals test/contracts/provider.pact.test.js)

# Library Service
echo "Verifying Library Service..."
export PACT_URL="$PROJECT_ROOT/apps/web/pacts/photox-web-app-library-service.json"
(cd services/library && npx vitest run --globals test/contracts/provider.pact.test.js)

# Worker Service (Provider)
echo "Verifying Worker Service (HTTP Provider)..."
export PACT_URL="$PROJECT_ROOT/apps/web/pacts/photox-web-app-worker-service.json"
(cd services/worker && npx vitest run --globals test/contracts/provider)

# Album Sharing Service
echo "Verifying Album Sharing Service..."
export PACT_URL="$PROJECT_ROOT/apps/web/pacts/photox-web-app-album-sharing-service.json"
(cd services/album-sharing && npx vitest run --globals test/contracts/provider.pact.test.js)

echo "--- Verifying Message Providers against local pacts ---"

# Ingest Message Provider
echo "Verifying Ingest Message Provider..."
export PACT_URL="$PROJECT_ROOT/services/worker/pacts/worker-service-ingest-service.json"
(cd services/ingest && npx vitest run --globals test/contracts/message.provider.pact.test.js)

# Library Message Provider
echo "Verifying Library Message Provider..."
export PACT_URL="$PROJECT_ROOT/services/worker/pacts/worker-service-library-service.json"
(cd services/library && npx vitest run --globals test/contracts/message.provider.pact.test.js)

echo "--- Local Verification Complete! ---"
