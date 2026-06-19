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
            steps { container('node') { sh 'pnpm test' } }
        }
        stage('Build') {
            steps { container('node') { sh 'pnpm build' } }
        }
    }
}
