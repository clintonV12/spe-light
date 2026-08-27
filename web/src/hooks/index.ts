import { useEffect, useCallback } from 'react'
import { useOfflineStore } from '../store/offline'
import { useAuthStore } from '../store/auth'
import { useUIStore } from '../store/ui'
import type { ToastVariant } from '../store/ui'
import type { UserRole } from '../types'
import apiClient from '../api/client'
import { advisorApi } from '../api/endpoints'

// ─── useOnlineStatus ────────────────────────────────────────────────────────

export function useOnlineStatus() {
  const isOnline = useOfflineStore((s) => s.isOnline)
  const setOnline = useOfflineStore((s) => s.setOnline)

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [setOnline])

  return isOnline
}

// ─── useSyncEngine ──────────────────────────────────────────────────────────

export function useSyncEngine() {
  const { dequeue, setSyncing, setLastSynced, addConflict, resolveTempId, isOnline } =
    useOfflineStore()

  const sync = useCallback(async () => {
    // Snapshot which items to attempt (by id) — but each iteration below
    // re-reads that item fresh from the store rather than trusting this
    // snapshot's own copy. That matters once tempId resolution is in
    // play: resolving item A's tempId (a "create plan" that just synced)
    // rewrites item B's `resource` in place if B was a "create activity
    // under plan {tempId}" queued before A had a real id yet (see
    // resolveTempId in offline.ts) — B needs to pick up that rewrite
    // before it's sent, not the stale pre-rewrite path this snapshot
    // captured at the start of this pass.
    const ids = useOfflineStore.getState().queue.map((q) => q.id)
    if (!isOnline || ids.length === 0) return

    setSyncing(true)
    for (const id of ids) {
      const item = useOfflineStore.getState().queue.find((q) => q.id === id)
      if (!item) continue // already dequeued by an earlier pass/retry
      try {
        const { operation, resource, payload, tempId } = item
        if (operation === 'create') {
          const { data } = await apiClient.post<{ id?: string }>(resource, payload)
          // Only meaningful for a create that originated from an
          // offline-first flow (e.g. "new plan" while offline) — an
          // ordinary online create never goes through the queue at all,
          // so tempId is undefined there and this is a no-op. data?.id
          // is defensive: every real create endpoint returns the new
          // entity with an id, but nothing enforces that at the type
          // level for this generic apiClient.post call.
          if (tempId && data?.id) {
            resolveTempId(tempId, data.id)
          }
        } else if (operation === 'update') {
          await apiClient.put(resource, payload)
        } else if (operation === 'delete') {
          await apiClient.delete(resource)
        }
        dequeue(item.id)
      } catch {
        addConflict(`Failed to sync ${item.operation} on ${item.resource}`)
      }
    }
    setLastSynced(new Date().toISOString())
    setSyncing(false)
  }, [isOnline, dequeue, setSyncing, setLastSynced, addConflict, resolveTempId])

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline) sync()
  }, [isOnline]) // eslint-disable-line react-hooks/exhaustive-deps

  return { sync }
}

// ─── usePermission ──────────────────────────────────────────────────────────

const ROLE_HIERARCHY: Record<UserRole, number> = {
  super_admin: 100,
  platform_support: 80,
  // See hooks/usePermission.ts's ROLE_RANK for the full rationale — same
  // rank as org_admin, only meaningful once an advisor has selected an org.
  advisor: 60,
  org_admin: 60,
  planner: 40,
  contributor: 20,
  viewer: 10,
}

export function usePermission() {
  const role = useAuthStore((s) => s.user?.role)

  // Mirrors ProtectedRoute's redirect-to-/org-picker rule defensively: an
  // advisor with no org selected has ROLE_HIERARCHY.advisor === 60 (same
  // as org_admin) but hasn't actually been granted org_admin-equivalent
  // access to anything yet — that only happens once X-Org-Context is set
  // server-side. Without this, hasRole('planner') etc. would read true for
  // an advisor sitting on /org-picker before it's picked anything.
  const hasSelectedOrg = advisorApi.currentOrgId() !== null

  const hasRole = useCallback(
    (minimum: UserRole): boolean => {
      if (!role) return false
      if (role === 'advisor' && !hasSelectedOrg) return false
      return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minimum]
    },
    [role, hasSelectedOrg],
  )

  const can = {
    createPlan: hasRole('planner'),
    editActivity: hasRole('contributor'),
    runAI: hasRole('planner'),
    generateReports: hasRole('planner'),
    manageUsers: hasRole('org_admin'),
    manageOrgs: hasRole('super_admin'),
  }

  return { hasRole, can, role }
}

// ─── useToast ───────────────────────────────────────────────────────────────

export function useToast() {
  const addToast = useUIStore((s) => s.addToast)

  return {
    toast: (message: string, variant?: ToastVariant, duration?: number) =>
      addToast(message, variant, duration),
    success: (message: string) => addToast(message, 'success'),
    error: (message: string) => addToast(message, 'error'),
    warning: (message: string) => addToast(message, 'warning'),
    info: (message: string) => addToast(message, 'info'),
  }
}