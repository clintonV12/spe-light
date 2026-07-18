/**
 * api/client.ts — Axios instance for StratPlan.
 *
 * Responsibilities:
 *   1. Attach Bearer token from tokenStore on every request.
 *   2. On 401: attempt one silent token refresh, replay the failed request.
 *   3. If refresh also fails: clear tokens and redirect to /login.
 *
 * Token storage:
 *   Tokens live in localStorage under the keys below. The auth Zustand store
 *   calls tokenStore.setTokens() on login/refresh and tokenStore.clear() on
 *   logout so everything stays in sync without circular imports.
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

// ── Token store ──────────────────────────────────────────────────────────────

/**
 * tokenStore is the single place tokens are read/written.
 * Import it in the auth store (store/auth.ts) to set/clear tokens on
 * login, refresh, and logout — do NOT write to localStorage elsewhere.
 */
export const tokenStore = {
  getAccess:  (): string => localStorage.getItem(TOKEN_KEY)   ?? '',
  getRefresh: (): string => localStorage.getItem(REFRESH_KEY) ?? '',
  setTokens: (access: string, refresh: string): void => {
    localStorage.setItem(TOKEN_KEY,   access)
    localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear: (): void => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

// ── Axios instance ────────────────────────────────────────────────────────────

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
})

// ── Request interceptor — attach Bearer ──────────────────────────────────────

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.getAccess()
  if (token && config.headers) {
    config.headers['Authorization'] = `Bearer ${token}`
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
      // Hard redirect — clears React state and forces re-auth.
      window.location.href = '/login'
      return Promise.reject(refreshError)

    } finally {
      isRefreshing = false
    }
  },
)

export default apiClient