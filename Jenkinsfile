pipeline {
  agent any

  options {
    skipDefaultCheckout(true)
    timestamps()
  }

  environment {
    CI_ENV_FILE = '.env.jenkins'
    CI_PIPELINE_ENV_FILE = '.ci.pipeline.env'
  }

  stages {
    stage('Checkout + Setup Environment') {
      steps {
        checkout scm
        sh '''#!/usr/bin/env bash
set -euo pipefail

BASE_ENV_FILE=".env"
if [ ! -f "$BASE_ENV_FILE" ]; then
  BASE_ENV_FILE=".env.example"
fi

if [ ! -f "$BASE_ENV_FILE" ]; then
  echo "Unable to locate .env or .env.example"
  exit 1
fi

cp "$BASE_ENV_FILE" "$CI_ENV_FILE"

upsert_env() {
  local key="$1"
  local value="$2"

  if grep -Eq "^${key}=" "$CI_ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$CI_ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$CI_ENV_FILE"
  fi
}

PACT_URL_FROM_JENKINS="${PACT_BROKER_BASE_URL:-}"
PACT_URL_FROM_FILE="$(awk -F= '/^PACT_BROKER_BASE_URL=/{print substr($0, index($0, "=") + 1); exit}' "$CI_ENV_FILE" | tr -d '\r')"
PACT_URL="${PACT_URL_FROM_JENKINS:-$PACT_URL_FROM_FILE}"

if [ -z "$PACT_URL" ]; then
  echo "PACT_BROKER_BASE_URL is required for pact publish/verification workflows"
  exit 1
fi

BUILD_TS="$(date +%s)"
BUILD_REF="${BUILD_NUMBER:-0}-${BUILD_TS}"
PACT_CONSUMER_VERSION="jenkins-consumer-${BUILD_REF}"
PACT_PROVIDER_VERSION="jenkins-provider-${BUILD_REF}"
PACT_BRANCH="${BRANCH_NAME:-${GIT_BRANCH:-jenkins}}"
PACT_TAG="${BRANCH_NAME:-ci}"

upsert_env "PACT_BROKER_BASE_URL" "$PACT_URL"
upsert_env "PACT_CONSUMER_APP_VERSION" "$PACT_CONSUMER_VERSION"
upsert_env "PACT_PROVIDER_APP_VERSION" "$PACT_PROVIDER_VERSION"
upsert_env "PACT_CONTRACT_BRANCH" "$PACT_BRANCH"
upsert_env "PACT_CONTRACT_TAG" "$PACT_TAG"

cat > "$CI_PIPELINE_ENV_FILE" <<EOF
export CI_ENV_FILE=${CI_ENV_FILE}
export PACT_BROKER_BASE_URL=${PACT_URL}
export PACT_CONSUMER_APP_VERSION=${PACT_CONSUMER_VERSION}
export PACT_PROVIDER_APP_VERSION=${PACT_PROVIDER_VERSION}
export PACT_CONTRACT_BRANCH=${PACT_BRANCH}
export PACT_CONTRACT_TAG=${PACT_TAG}
EOF

echo "Using env file: $CI_ENV_FILE"
echo "PACT_BROKER_BASE_URL: $PACT_URL"
echo "PACT_CONSUMER_APP_VERSION: $PACT_CONSUMER_VERSION"
echo "PACT_PROVIDER_APP_VERSION: $PACT_PROVIDER_VERSION"
'''
      }
    }

    stage('Validate Compose Config') {
      steps {
        sh '''#!/usr/bin/env bash
set -euo pipefail
. "$CI_PIPELINE_ENV_FILE"
docker compose --env-file "$CI_ENV_FILE" config
'''
      }
    }

    stage('Start Integration Infra') {
      steps {
        sh '''#!/usr/bin/env bash
set -euo pipefail
. "$CI_PIPELINE_ENV_FILE"
docker compose --env-file "$CI_ENV_FILE" up -d postgres redis
'''
      }
    }

    stage('Install Node Dependencies') {
      steps {
        sh '''#!/usr/bin/env bash
set -euo pipefail

for dir in apps/web services/*; do
  if [ -f "$dir/package.json" ]; then
    echo "Installing dependencies in $dir"
    npm --prefix "$dir" install
  fi
done
'''
      }
    }

    stage('Run Required Test Workflows (Sequential)') {
      steps {
        sh '''#!/usr/bin/env bash
set -euo pipefail
. "$CI_PIPELINE_ENV_FILE"

npm --prefix apps/web test
npm --prefix services/worker test
npm --prefix services/auth test
npm --prefix services/ingest test
npm --prefix services/library test

if [ -f services/album-sharing/package.json ]; then
  if node -e "const pkg=require('./services/album-sharing/package.json'); process.exit(pkg.scripts && pkg.scripts.test ? 0 : 1)"; then
    npm --prefix services/album-sharing test
  else
    echo "services/album-sharing has no test script; skipping"
  fi
fi
'''
      }
    }

    stage('Swagger/OpenAPI Smoke Checks') {
      steps {
        sh '''#!/usr/bin/env bash
set -euo pipefail
. "$CI_PIPELINE_ENV_FILE"
python3 scripts/smoke_swagger_docs.py
'''
      }
    }

    stage('Build Docker Images') {
      steps {
        sh '''#!/usr/bin/env bash
set -euo pipefail
. "$CI_PIPELINE_ENV_FILE"
docker compose --env-file "$CI_ENV_FILE" build
'''
      }
    }
  }

  post {
    always {
      sh '''#!/usr/bin/env bash
set -euo pipefail

mkdir -p artifacts

if [ -f "$CI_PIPELINE_ENV_FILE" ]; then
  . "$CI_PIPELINE_ENV_FILE"
fi

docker compose --env-file "$CI_ENV_FILE" ps > artifacts/compose-ps.txt || true
docker compose --env-file "$CI_ENV_FILE" logs --no-color > artifacts/compose-logs.txt || true
cp "$CI_ENV_FILE" artifacts/ci-env-used.env || true
'''
      archiveArtifacts artifacts: 'artifacts/**', allowEmptyArchive: true, fingerprint: true

      sh '''#!/usr/bin/env bash
set -euo pipefail

if [ -f "$CI_PIPELINE_ENV_FILE" ]; then
  . "$CI_PIPELINE_ENV_FILE"
fi

docker compose --env-file "$CI_ENV_FILE" down --remove-orphans || true
'''
    }
  }
}
