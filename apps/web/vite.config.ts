import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import Pages from 'vite-plugin-pages'

function suppressEconnreset(): Plugin {
  return {
    name: 'suppress-econnreset',
    configureServer(server) {
      server.httpServer?.on('connection', (socket) => {
        socket.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'ECONNRESET') {
            socket.destroy()
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), Pages({ importMode: 'async' }), suppressEconnreset()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', 'zustand', 'axios', 'jwt-decode'],
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
  },
})
