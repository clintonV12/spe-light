import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { tokenStore } from '../api/client'
import type { User, Organisation } from '../types'

interface AuthState {
  user: User | null
  org: Organisation | null
  accessToken: string
  refreshToken: string
  isAuthenticated: boolean

  setAuth: (user: User, org: Organisation, access: string, refresh: string) => void
  clearAuth: () => void
  setUser: (user: User) => void
  setOrg: (org: Organisation) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      org: null,
      accessToken: '',
      refreshToken: '',
      isAuthenticated: false,

      setAuth: (user, org, accessToken, refreshToken) => {
        tokenStore.setTokens(accessToken, refreshToken)
        set({ user, org, accessToken, refreshToken, isAuthenticated: true })
      },

      clearAuth: () => {
        tokenStore.clear()
        set({
          user: null,
          org: null,
          accessToken: '',
          refreshToken: '',
          isAuthenticated: false,
        })
      },

      setUser: (user) => set({ user }),
      setOrg: (org) => set({ org }),
    }),
    {
      name: 'stratplan-auth',
      partialize: (state) => ({
        user: state.user,
        org: state.org,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
)
