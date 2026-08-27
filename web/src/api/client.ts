/**
 * api/client.ts — Axios instance for StratPlan.
 *
 * Responsibilities:
 *   1. Attach Bearer token from tokenStore on every request.
 *   2. On 401: attempt one silent token refresh, replay the failed request.
 *   3. If refresh also fails: clear tokens and redirect to /login.
 *
 * Token storage:
 *   Tokens live in sessionStorage under the keys below — deliberately NOT
 *   localStorage. sessionStorage is cleared the moment the tab/browser is
 *   closed, which is what actually kills the session client-side; a
 *   localStorage-backed token survives indefinitely and silently
 *   re-authenticates whoever opens the browser next. The trade-off: each
 *   tab gets its own session (sessionStorage isn't shared across tabs),
 *   so opening the app in a second tab means signing in again there too.
 *   That's intentional, not a bug — see store/auth.ts, which persists its
 *   own user/org/isAuthenticated snapshot the same way for the same reason.
 *   The auth Zustand store calls tokenStore.setTokens() on login/refresh
 *   and tokenStore.clear() on logout so everything stays in sync without
 *   circular imports.
 *
 * Base URL:
 *   /api/v1 — proxied to the Go backend by Vite in dev (vite.config.ts) and
 *   by the reverse proxy (nginx / Caddy) in production.
 *
 *   Auth routes (/auth/*, /invitations/accept) are NOT under /api/v1 —
 *   the backend mounts them at the root. The authApi helpers in
 *   realEndpoints.ts use absolute paths for those calls.
 */

import axios, { AxiosError } from 'axios'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

// ── Constants ────────────────────────────────────────────────────────────────

const BASE_URL    = '/api/v1'
const TOKEN_KEY   = 'stratplan_access'
const REFRESH_KEY = 'stratplan_refresh'

// Only meaningful for a logged-in advisor (Role.Advisor — a platform-tier
// user with no org of their own, see internal/models.RoleAdvisor). Holds
// whichever organisation the advisor has currently selected to act in;
// sent as X-Org-Context on every request so the backend's
// ResolveAdvisorOrgContext middleware can grant org_admin-equivalent
// access to that one org for the duration of the request. Ignored by the
// backend entirely for every other role, so it's safe to just always
// attach the header when this is set.
const ADVISOR_ORG_KEY = 'stratplan_advisor_org'

// ── Token store ──────────────────────────────────────────────────────────────

/**
 * tokenStore is the single place tokens are read/written.
 * Import it in the auth store (store/auth.ts) to set/clear tokens on
 * login, refresh, and logout — do NOT write to sessionStorage elsewhere.
 */
export const tokenStore = {
  getAccess:  (): string => sessionStorage.getItem(TOKEN_KEY)   ?? '',
  getRefresh: (): string => sessionStorage.getItem(REFRESH_KEY) ?? '',
  setTokens: (access: string, refresh: string): void => {
    sessionStorage.setItem(TOKEN_KEY,   access)
    sessionStorage.setItem(REFRESH_KEY, refresh)
  },
  clear: (): void => {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(REFRESH_KEY)
    sessionStorage.removeItem(ADVISOR_ORG_KEY)
  },
}

/**
 * advisorOrgStore holds the org an advisor has currently selected. Separate
 * from tokenStore because it's not part of the auth session itself — it's
 * UI-level "which org am I looking at right now" state that only exists
 * for the advisor role, and is cleared independently when an advisor
 * exits back to the org picker (without logging them out entirely).
 */
export const advisorOrgStore = {
  get: (): string | null => sessionStorage.getItem(ADVISOR_ORG_KEY),
  set: (orgId: string): void => sessionStorage.setItem(ADVISOR_ORG_KEY, orgId),
  clear: (): void => sessionStorage.removeItem(ADVISOR_ORG_KEY),
}

// ── Axios instance ────────────────────────────────────────────────────────────

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
})

// ── Request interceptor — attach Bearer + advisor org context ────────────────

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.getAccess()
  if (token && config.headers) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  const advisorOrg = advisorOrgStore.get()
  if (advisorOrg && config.headers) {
    config.headers['X-Org-Context'] = advisorOrg
  }
  return config
})

// ── Response interceptor — silent refresh on 401 ─────────────────────────────

/**
 * When the access token expires mid-session, the backend returns 401.
 * We intercept, swap to the refresh token, get new tokens, and replay the
 * original request transparently. If the refresh also fails (expired or
 * revoked), we clear storage and redirect to /login.
 *
 * Concurrent requests that 401 at the same time are queued and replayed
 * together once the new access token arrives, avoiding multiple refresh calls.
 */

type QueueEntry = { resolve: (token: string) => void; reject: (err: unknown) => void }

let isRefreshing = false
let failedQueue: QueueEntry[] = []

function flushQueue(err: unknown, token: string | null) {
  failedQueue.forEach((entry) => {
    if (err) entry.reject(err)
    else     entry.resolve(token!)
  })
  failedQueue = []
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    // Only attempt refresh on 401, and never for the refresh call itself.
    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error)
    }

    // Queue concurrent 401s while a refresh is already in flight.
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      }).then((token) => {
        original.headers['Authorization'] = `Bearer ${token}`
        return apiClient(original)
      })
    }

    original._retry = true
    isRefreshing    = true

    try {
      // Use a plain axios call (not apiClient) to avoid interceptor loops.
      const { data } = await axios.post<{ access_token: string; refresh_token: string }>(
        '/auth/refresh',
        { refresh_token: tokenStore.getRefresh() },
      )

      tokenStore.setTokens(data.access_token, data.refresh_token)
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${data.access_token}`
      flushQueue(null, data.access_token)

      original.headers['Authorization'] = `Bearer ${data.access_token}`
      return apiClient(original)

    } catch (refreshError) {
      flushQueue(refreshError, null)
      tokenStore.clear()
      // This catch only ever fires for a session that WAS authenticated —
      // a 401 was received, a refresh was attempted, and that refresh
      // itself failed (expired/revoked/idle-timed-out refresh token; see
      // authsvc.Service.RefreshToken's SESSION_IDLE_TIMEOUT_MIN check).
      // Previously this just hard-redirected straight to /login with zero
      // explanation — from the person's point of view they were typing
      // away and then, with no warning, landed back on the sign-in form.
      //
      // A toast won't survive what comes next: window.location.href does
      // a full page reload, unmounting the entire React tree (including
      // ToastContainer, which only renders inside AppShell anyway —
      // LoginPage sits outside it). sessionStorage is the one thing that
      // does survive. LoginPage reads this key once on mount and clears
      // it immediately, so it never resurfaces on a later, unrelated
      // visit to the login page.
      //
      // Prefer the backend's own message when the response carries one
      // (e.g. "session expired due to inactivity — please log in again")
      // since it's more specific than a generic fallback — checking both
      // `error` and `message` keys since this file doesn't have
      // internal/response's exact JSON shape in scope to be certain
      // which one ErrorJSON uses.
      const body = axios.isAxiosError(refreshError)
        ? (refreshError.response?.data as { error?: string; message?: string } | undefined)
        : undefined
      sessionStorage.setItem('stratplan_session_expired', body?.error || body?.message || 'true')
      // Hard redirect — clears React state and forces re-auth.
      window.location.href = '/login'
      return Promise.reject(refreshError)

    } finally {
      isRefreshing = false
    }
  },
)

export default apiClient