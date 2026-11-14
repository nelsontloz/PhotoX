import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite({ jsc: { parser: { syntax: 'typescript', decorators: true } } })],
  test: {
    globals: true,
    environment: 'node',
    // a typo'd filter or a moved spec dir must fail, not report a green empty run
    passWithNoTests: false,
    // Split so container-backed integration specs get headroom without loosening the
    // tight defaults for unit specs: each integration test does DB + HTTP roundtrips
    // whose latency stretches under parallel-load contention, so they get a wider per-test
    // budget. No retry: a flake has to be fixed, not absorbed — the guard's auth-state
    // lookups now answer 503 (not a misleading 401) when the DB itself is the problem.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.spec.ts'],
          // one Postgres + one Redis container for the whole project; each spec file
          // gets a private database and a private Redis logical DB inside them
          globalSetup: './test/global-setup.ts',
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
