import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

// Opt-in provider pact verification config — invoked only by `test:pact:provider`.
// `pnpm verify` uses vitest.config.ts and never picks up test/pact.
export default defineConfig({
  plugins: [swc.vite({ jsc: { parser: { syntax: 'typescript', decorators: true } } })],
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['test/pact/**/*.spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
})
