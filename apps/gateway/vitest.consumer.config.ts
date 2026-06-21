import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    testTimeout: 30_000,
    include: ['test/pact/consumer/**/*.spec.ts'],
  },
})
