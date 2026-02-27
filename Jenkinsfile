pipeline {
  agent {
    label "${params.CI_AGENT_LABEL}"
  }

  parameters {
    string(name: 'CI_AGENT_LABEL', defaultValue: 'kaniko', description: 'Jenkins node label with Kaniko executor available at /kaniko/executor')
    string(name: 'KANIKO_DESTINATION', defaultValue: '', description: 'Optional image destination (example: registry.example.com/photox:ci). Leave empty for local verify build with --no-push.')
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

    stage('Build Root Dockerfile (Kaniko)') {
      steps {
        sh '''#!/usr/bin/env bash
set -euo pipefail

if [ ! -x "/kaniko/executor" ]; then
  echo "Missing /kaniko/executor. Run this stage on a Kaniko-enabled Jenkins agent/container."
  exit 1
fi

KANIKO_ARGS=(
  --dockerfile "$(pwd)/Dockerfile"
  --context "$(pwd)"
)

if [ -n "${KANIKO_DESTINATION:-}" ]; then
  KANIKO_ARGS+=(--destination "${KANIKO_DESTINATION}")
else
  KANIKO_ARGS+=(--no-push)
fi

/kaniko/executor "${KANIKO_ARGS[@]}"
'''
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: '*.log', allowEmptyArchive: true, fingerprint: true
    }
  }
}
