pipeline {
    agent {
        kubernetes {
            yaml '''
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: node
    image: registry.int.zerg91.com/photox/node-builder:20-alpine
    command: ["cat"]
    tty: true
    env:
    - name: DOCKER_HOST
      value: tcp://localhost:2375
    - name: TURBO_CACHE
      value: "true"
  - name: dind
    image: docker:27.5.1-dind
    securityContext:
      privileged: true
    env:
    - name: DOCKER_TLS_CERTDIR
      value: ""
            '''
        }
    }

    stages {
        stage('Install') {
            steps {
                container('node') {
                    cache([
                        keys: ['pnpm-store-${checksum "pnpm-lock.yaml"}'],
                        path: '~/.local/share/pnpm/store'
                    ])
                    sh 'pnpm install --frozen-lockfile'
                }
            }
        }
        stage('Build Shared') {
            steps { container('node') { sh 'pnpm --filter "./packages/*" build' } }
        }
        stage('Validate') {
            parallel {
                stage('Typecheck') {
                    steps { container('node') { sh 'pnpm typecheck' } }
                }
                stage('Lint') {
                    steps { container('node') { sh 'pnpm lint' } }
                }
                stage('Test') {
                    steps {
                        container('dind') {
                            sh 'timeout 30 sh -c "until docker info >/dev/null 2>&1; do sleep 1; done"'
                        }
                        container('node') {
                            sh 'pnpm test'
                        }
                    }
                }
            }
        }
        stage('Build') {
            steps { container('node') { sh 'pnpm build' } }
        }
    }
}
