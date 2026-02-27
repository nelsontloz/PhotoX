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
        container('kaniko') {
          sh '''#!/busybox/sh
set -eu

if [ ! -x "/kaniko/executor" ]; then
  echo "Missing /kaniko/executor. Ensure this runs inside the kaniko container."
  exit 1
fi

if [ -n "${KANIKO_DESTINATION:-}" ]; then
  /kaniko/executor \
    --dockerfile "${WORKSPACE}/Dockerfile" \
    --context "${WORKSPACE}" \
    --destination "${KANIKO_DESTINATION}"
else
  /kaniko/executor \
    --dockerfile "${WORKSPACE}/Dockerfile" \
    --context "${WORKSPACE}" \
    --no-push
fi
'''
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: '*.log', allowEmptyArchive: true, fingerprint: true
    }
  }
}
