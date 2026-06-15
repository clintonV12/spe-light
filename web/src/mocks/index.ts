/**
 * Runs before React mounts (main.tsx bootstrap).
 * Calls setAuth on the Zustand store directly — no localStorage race.
 */
import { mockAuth } from './handlers'

export async function installMocks() {
  const tokens = await mockAuth.login('', '')
  const user   = await mockAuth.me()
  const org    = await mockAuth.org()

  // Import the store and call setAuth synchronously before any component mounts.
  const { useAuthStore } = await import('../store/auth')
  useAuthStore.getState().setAuth(
    user, org, tokens.access_token, tokens.refresh_token,
  )

  console.info(
    '%c[StratPlan Mock] %cAuto-logged in as ' + user.name + ' (' + user.role + ') · no backend needed',
    'color:#4B6BFB;font-weight:bold',
    'color:#6B758F',
  )
}