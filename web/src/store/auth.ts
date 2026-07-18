/**
 * store/auth.ts — Authentication state (Zustand + localStorage persistence).
 *
 * Responsibilities:
 *   - Hold the logged-in user, their org, and the token pair.
 *   - Expose setAuth (called by LoginPage / AcceptInvitePage after a successful
 *     login or invite-accept) and clearAuth (called by logout).
 *   - Keep tokenStore in sync so the Axios interceptor always has the latest
 *     access token without a circular import.
 *   - Rehydrate from localStorage on page reload via the `persist` middleware
 *     so users don't have to log in again after refreshing.
 *
 * Usage in components:
 *   const user  = useAuthStore((s) => s.user)
 *   const org   = useAuthStore((s) => s.org)
 *   const isAuth = useAuthStore((s) => s.isAuthenticated)
 *
 * Usage on login:
 *   const setAuth = useAuthStore((s) => s.setAuth)
 *   setAuth(user, org, tokens.access_token, tokens.refresh_token)
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { tokenStore } from '../api/client'
import type { User, Organisation } from '../types'

// ── State shape ───────────────────────────────────────────────────────────────

interface AuthState {
  user:            User | null
  org:             Organisation | null
  isAuthenticated: boolean

  /**
   * Call after a successful login, token refresh, or invite acceptance.
   * Writes tokens into localStorage via tokenStore so the Axios interceptor
   * picks them up immediately on the next request.
   */
  setAuth: (
    user:         User,
    org:          Organisation,
    accessToken:  string,
    refreshToken: string,
  ) => void

  /**
   * Call on logout or when a refresh fails.
   * Clears tokens from localStorage and resets state.
   */
  clearAuth: () => void
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user:            null,
      org:             null,
      isAuthenticated: false,

      setAuth: (user, org, accessToken, refreshToken) => {
        tokenStore.setTokens(accessToken, refreshToken)
        set({ user, org, isAuthenticated: true })
      },

      clearAuth: () => {
        tokenStore.clear()
        set({ user: null, org: null, isAuthenticated: false })
      },
    }),
    {
      name:    'stratplan_auth',
      storage: createJSONStorage(() => localStorage),
      // Only persist user + org — tokens are already in their own localStorage
      // keys via tokenStore; we don't want them duplicated in the JSON blob.
      partialize: (state) => ({ user: state.user, org: state.org, isAuthenticated: state.isAuthenticated }),
    },
  ),
)