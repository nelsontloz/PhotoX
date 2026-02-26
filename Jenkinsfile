pipeline {
  agent {
    label "${params.CI_AGENT_LABEL}"
  }

  parameters {
    string(name: 'CI_AGENT_LABEL', defaultValue: 'node', description: 'Jenkins node label with bash, node/npm, and python3')
  }

  options {
    skipDefaultCheckout(true)
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Preflight Tooling (No Docker)') {
      steps {
        sh '''#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
}

require_cmd bash
require_cmd node
require_cmd npm
require_cmd python3

if [ ! -f "scripts/full-build.sh" ]; then
  echo "Missing required script: scripts/full-build.sh"
  exit 1
fi

chmod +x scripts/full-build.sh

echo "Tooling versions:"
bash --version | head -n 1
node --version
npm --version
python3 --version

echo "PACT_BROKER_BASE_URL source:"
if [ -n "${PACT_BROKER_BASE_URL:-}" ]; then
  echo "- Using Jenkins environment variable PACT_BROKER_BASE_URL"
elif [ -f ".env" ] || [ -f ".env.example" ]; then
  echo "- Using repository env file fallback (.env or .env.example)"
else
  echo "- Not set in Jenkins env and no env file fallback found"
  echo "  full-build will fail until PACT_BROKER_BASE_URL is provided"
fi
'''
      }
    }

    stage('Full Build') {
      steps {
        sh '''#!/usr/bin/env bash
set -euo pipefail
./scripts/full-build.sh 2>&1 | tee full-build.log
'''
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'full-build.log', allowEmptyArchive: true, fingerprint: true
    }
  }
}
