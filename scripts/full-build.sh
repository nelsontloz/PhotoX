#!/bin/bash

# PhotoX Master Build and Test Script
# This script automates the build, test, and contract verification process.

set -e

# Load .env variables if present
ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
  ENV_FILE=".env.example"
fi

if [ -f "$ENV_FILE" ]; then
  echo "--- Sourcing $ENV_FILE file ---"
  set -a
  . "./$ENV_FILE"
  set +a
fi

# Broker compatibility note:
# Some Pact Broker deployments do not support branch metadata publishing.
# Provider verification in this repo conditionally sets providerVersionBranch
# when PACT_CONTRACT_BRANCH is present, which can cause verification publish
# failures on older brokers. Unset by default in this master build workflow.
unset PACT_CONTRACT_BRANCH

# Validate required variables
if [ -z "$PACT_BROKER_BASE_URL" ]; then
  echo "Error: PACT_BROKER_BASE_URL is not set. Please set it in .env or environment."
  exit 1
fi

is_container_runtime=false
if [ -f "/.dockerenv" ] || grep -qaE 'docker|containerd|kubepods' /proc/1/cgroup 2>/dev/null; then
  is_container_runtime=true
fi

if [ "$is_container_runtime" = true ] && echo "$PACT_BROKER_BASE_URL" | grep -qiE '^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?(/|$)'; then
  echo "Error: PACT_BROKER_BASE_URL resolves to localhost inside a container: $PACT_BROKER_BASE_URL"
  echo "Set PACT_BROKER_BASE_URL to a reachable external URL (default repo value is https://pact-broker.int.zerg91.com/)."
  exit 1
fi

echo "Resolved PACT_BROKER_BASE_URL: $PACT_BROKER_BASE_URL"

echo "--- Starting PhotoX Master Build ---"

# Set unique versions for Pact to avoid mutation errors on the broker
export PACT_CONSUMER_APP_VERSION="refactor-$(date +%s)"
export PACT_PROVIDER_APP_VERSION="refactor-$(date +%s)"
echo "Using Pact Version: $PACT_CONSUMER_APP_VERSION"

# 1. Consumer Phase: Generate and publish contracts
echo "--- Phase 1: Consumer Contracts ---"

echo "Building and testing Web App (HTTP Consumer)..."
rm -rf apps/web/pacts/*.json
cd apps/web
npm install
npm run test
cd ../..

echo "Building and testing Worker Service (Message Consumer)..."
rm -rf services/worker/pacts/*.json
cd services/worker
npm install
npm run test:unit
npm run test:integration
npm run test:contract:messages
npm run pact:publish
cd ../..

# 2. Provider Phase: Verify contracts and run service tests
echo "--- Phase 2: Provider Verification ---"

SERVICES=("auth" "ingest" "library" "album-sharing" "search")

for service in "${SERVICES[@]}"; do
  echo "Building and testing service: $service..."
  cd "services/$service"
  npm install
  # search service might not have a test script, check before running
  if npm run | grep -q "test"; then
    npm run test
  else
    echo "No test script found for $service, skipping tests."
  fi
  cd ../..
done

echo "Verifying Worker Service HTTP endpoints (Provider)..."
cd services/worker
npm run test:contract:provider
cd ../..


echo "--- PhotoX Master Build Complete! ---"
