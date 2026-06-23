import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts', 'test/**/*.pact.spec.ts'],
  },
})
