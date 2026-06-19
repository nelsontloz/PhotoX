pipeline {
    agent {
        kubernetes {
            yaml '''
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: node
    image: node:20-alpine
    command: ["cat"]
    tty: true
    env:
    - name: DOCKER_HOST
      value: tcp://localhost:2375
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
                    sh 'corepack enable && corepack prepare pnpm@9.15.0 --activate'
                    sh 'apk add --no-cache python3 make g++'
                    sh 'pnpm install --frozen-lockfile'
                }
            }
        }
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
        stage('Build') {
            steps { container('node') { sh 'pnpm build' } }
        }
    }
}
