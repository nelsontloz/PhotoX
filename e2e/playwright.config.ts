import { defineConfig } from '@playwright/test'
import { defineBddProject } from 'playwright-bdd'

// The stack has global state that forces an ordered serial prologue: 01-bootstrap registers the
// first account of the fresh database (it becomes admin) before anything else registers, and
// 04-faces / 05-semantic's semantic-upload.feature switch the global face detector and
// reprocess/recluster data for every user. Everything else is scenario-scoped (each scenario
// registers its own random user), so the `suite` project runs it in parallel with the worker
// pool that run.sh's --e2e-workers sets.
const setup = defineBddProject({
  name: 'setup',
  features: [
    'features/01-bootstrap/**/*.feature',
    'features/04-faces/**/*.feature',
    'features/05-semantic/semantic-upload.feature',
  ],
  steps: 'steps/**/*.ts',
})

const suite = defineBddProject({
  name: 'suite',
  features: [
    'features/**/*.feature',
    '!features/01-bootstrap/**',
    '!features/04-faces/**',
    '!features/05-semantic/semantic-upload.feature',
  ],
  steps: 'steps/**/*.ts',
})

export default defineConfig({
  outputDir: 'test-results',
  fullyParallel: false,
  // serial by default; run.sh translates --e2e-workers=N into playwright's --workers=N, which
  // raises this pool — the `setup` project below keeps its own workers cap so it stays serial
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5273',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'on',
  },
  projects: [
    { ...setup, workers: 1 },
    { ...suite, dependencies: ['setup'], fullyParallel: true },
  ],
})
