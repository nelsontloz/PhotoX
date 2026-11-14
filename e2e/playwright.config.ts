import { defineConfig } from '@playwright/test';
import { defineBddProject } from 'playwright-bdd';

// The stack still has one global-state feature that forces an ordered serial prologue: 04-faces
// reprocesses/reclusters faces for every user, and the parallel suite must not observe that
// mid-run. Everything else is scenario-scoped (each scenario registers its own random user), so
// the `suite` project — which also runs 01-bootstrap, whose seeded-admin check searches the users
// table — runs in parallel with the worker pool that playwright's native --workers flag raises.
const setup = defineBddProject({
  name: 'setup',
  features: ['features/04-faces/**/*.feature'],
  steps: 'steps/**/*.ts',
});

const suite = defineBddProject({
  name: 'suite',
  features: ['features/**/*.feature', '!features/04-faces/**'],
  steps: 'steps/**/*.ts',
});

export default defineConfig({
  // serial by default; playwright's native --workers=N (forwarded by run.sh) raises this pool —
  // the `setup` project below keeps its own workers cap so it stays serial
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5273',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { ...setup, workers: 1 },
    { ...suite, dependencies: ['setup'], fullyParallel: true },
  ],
});
