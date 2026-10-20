import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // the hash worker is the only importer of @noble/hashes — without this the dev server
  // discovers it mid-session, re-optimizes the deps and force-reloads the page, which kills
  // an in-flight upload (the e2e stack runs the dev server)
  optimizeDeps: {
    include: ['@noble/hashes/sha2'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react/') ||
            id.includes('node_modules/scheduler') ||
            id.includes('node_modules/react-router')
          ) {
            return 'vendor-react'
          }
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
      // worker job surface lives on core outside /api (act-gated; browsers never call it,
      // but same-origin API clients like the e2e suite reach core through this proxy)
      '/worker': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    passWithNoTests: true,
    // real-browser lane is opt-in: `pnpm --filter @photox/web test:browser` (needs Chromium)
    exclude: [...configDefaults.exclude, 'test/browser/**'],
  },
})
