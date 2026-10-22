import { defineConfig } from 'vitest/config'

// `tsc -b` emits src/*.spec.ts into dist/ as CommonJS, and vitest's default include glob
// would pick those up too after a build (vitest 5 refuses to load vitest via require()).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    passWithNoTests: true,
  },
})
