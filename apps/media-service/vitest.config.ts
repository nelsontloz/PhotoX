import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

export default defineConfig({
  plugins: [swc.vite({ jsc: { parser: { syntax: 'typescript', decorators: true } } })],
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    include: ['src/**/*.spec.ts', 'test/integration/**/*.spec.ts'],
  },
})
