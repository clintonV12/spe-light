/**
 * vite.config.ts
 *
 * VITE_MOCK=true   → all API calls go to the in-memory mock layer (no proxy needed)
 * VITE_MOCK unset  → calls are proxied to VITE_API_URL (default: http://localhost:8080)
 *
 * Deliberately NOT proxied: /invitations. That path is the SPA's own page
 * route (AcceptInvitePage). The corresponding API call now lives under
 * /api/v1/invitations/accept, which the /api/v1 rule below already covers —
 * see realEndpoints.ts and router.go for the full fix.
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
            // NOTE: no /invitations proxy rule. Invite acceptance is a POST
            // to /api/v1/invitations/accept (already covered by the /api/v1
            // rule above) — bare /invitations is the SPA's own page route
            // (AcceptInvitePage, mounted at /invitations/accept in App.tsx)
            // and must NOT be proxied to the backend, or GET requests for
            // the page itself get swallowed and 405 before React Router
            // ever sees them.
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