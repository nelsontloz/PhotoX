import { defineConfig, mergeConfig } from 'vitest/config'
import type { UserConfig } from 'vite'
import viteConfig from './vite.config'

// The base config's jsdom `test.exclude` hides this lane, and mergeConfig only ever *adds*
// array entries — so drop the base test block and declare this lane's own.
const { test: _jsdomTest, ...viteOnly } = viteConfig as UserConfig & { test?: unknown }

// Opt-in real-browser lane — not part of `pnpm verify` (Jenkins has no Chromium).
// Run with: pnpm --filter @photox/web test:browser
export default mergeConfig(
  viteOnly,
  defineConfig({
    test: {
      include: ['test/browser/**/*.spec.{ts,tsx}'],
      browser: {
        enabled: true,
        headless: true,
        provider: 'playwright',
        instances: [{ browser: 'chromium' }],
        viewport: { width: 1024, height: 768 },
      },
    },
  }),
)
