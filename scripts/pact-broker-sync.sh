#!/bin/bash

set -euo pipefail

if [ -z "${PACT_BROKER_BASE_URL:-}" ]; then
  echo "PACT_BROKER_BASE_URL is required (example: http://localhost:9292)"
  exit 1
fi

echo "--- Publishing consumer pacts ---"
npm --prefix apps/web run test:contract
npm --prefix apps/web run pact:publish

npm --prefix services/worker run test:contract:messages
npm --prefix services/worker run pact:publish

echo "--- Verifying provider pacts (broker) ---"
npm --prefix services/auth run test:contract:provider
npm --prefix services/ingest run test:contract:provider
npm --prefix services/library run test:contract:provider
npm --prefix services/worker run test:contract:provider
npm --prefix services/album-sharing run test:contract:provider

echo "--- Pact broker sync complete ---"
