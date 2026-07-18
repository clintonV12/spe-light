/**
 * vite.config.ts
 *
 * VITE_MOCK=true   → all API calls go to the in-memory mock layer (no proxy needed)
 * VITE_MOCK unset  → calls are proxied to VITE_API_URL (default: http://localhost:8080)
 *
 * .env.local (git-ignored) for live backend development:
 *   VITE_MOCK=
 *   VITE_API_URL=http://localhost:8080
 *
 * .env.development (committed) for mock-only development:
 *   VITE_MOCK=true
 */

import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const isMock    = env.VITE_MOCK === 'true'
  const apiTarget = env.VITE_API_URL ?? 'http://localhost:8080'

  return {
    plugins: [react()],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },

    server: {
      port: 5173,
      proxy: isMock
        ? {}  // No proxy needed in mock mode
        : {
            // /api/v1/* — authenticated JSON API (mounted at /api/v1 in Go)
            '/api/v1': {
              target:       apiTarget,
              changeOrigin: true,
              secure:       false,
            },
            // /auth/* — public auth routes (login, refresh, SSO flows)
            '/auth': {
              target:       apiTarget,
              changeOrigin: true,
              secure:       false,
            },
            // /invitations/accept — public invite acceptance
            '/invitations': {
              target:       apiTarget,
              changeOrigin: true,
              secure:       false,
            },
            // /health — Go health check
            '/health': {
              target:       apiTarget,
              changeOrigin: true,
              secure:       false,
            },
          },
    },

    build: {
      outDir:    'dist',
      sourcemap: mode !== 'production',
      rollupOptions: {
        output: {
          // manualChunks must be a function in Rollup — returning undefined
          // for a module means "put it in the default chunk".
          manualChunks: (id: string) => {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
              return 'vendor'
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'ui'
            }
            // Mock layer never ships in production (VITE_MOCK is never true there)
            if (id.includes('/src/mocks/')) {
              return 'mocks'
            }
          },
        },
      },
    },

    define: {
      // Expose version to AppFooter: import.meta.env.VITE_APP_VERSION
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(env.VITE_APP_VERSION ?? '0.1.0'),
    },
  }
})