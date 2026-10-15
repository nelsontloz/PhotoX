import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

export default defineConfig({
  plugins: [swc.vite({ jsc: { parser: { syntax: 'typescript', decorators: true } } })],
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    // Split so container-backed integration specs get headroom without loosening the
    // tight defaults for unit specs: each integration test does DB + HTTP roundtrips
    // whose latency stretches under parallel-load contention (observed as 5s-timeout
    // flakes and transient guard fail-closed 401s), so they get a wider per-test
    // budget plus one retry for infra hiccups. Unit specs keep the 5s default.
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
          testTimeout: 30_000,
          hookTimeout: 60_000,
          retry: 1,
        },
      },
    ],
  },
})
