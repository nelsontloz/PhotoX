import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

export default defineConfig({
  plugins: [swc.vite({ jsc: { parser: { syntax: 'typescript', decorators: true } } })],
  test: {
    globals: true,
    environment: 'node',
    // a typo'd filter or a moved spec dir must fail, not report a green empty run
    passWithNoTests: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Split so the shared Redis container is only started for the integration project: the
    // unit project needs no Redis at all, and the integration project owns the container via
    // its globalSetup (one container for the whole run, one logical DB per spec file).
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
          include: ['test/**/*.spec.ts'],
          globalSetup: './test/global-setup.ts',
        },
      },
    ],
  },
})
