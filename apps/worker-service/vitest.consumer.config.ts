import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

export default defineConfig({
  plugins: [swc.vite({ jsc: { parser: { syntax: 'typescript', decorators: true } } })],
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    testTimeout: 30_000,
    include: ['test/pact/consumer/**/*.spec.ts'],
  },
})
