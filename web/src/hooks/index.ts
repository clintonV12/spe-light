import { useEffect, useCallback } from 'react'
import { useOfflineStore } from '../store/offline'
import { useAuthStore } from '../store/auth'
import { useUIStore } from '../store/ui'
import type { ToastVariant } from '../store/ui'
import type { UserRole } from '../types'
import apiClient from '../api/client'

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
  const { queue, dequeue, setSyncing, setLastSynced, addConflict, isOnline } =
    useOfflineStore()

  const sync = useCallback(async () => {
    if (!isOnline || queue.length === 0) return

    setSyncing(true)
    for (const item of queue) {
      try {
        const { operation, resource, payload } = item
        if (operation === 'create') {
          await apiClient.post(resource, payload)
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
  }, [queue, isOnline, dequeue, setSyncing, setLastSynced, addConflict])

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
  org_admin: 60,
  planner: 40,
  contributor: 20,
  viewer: 10,
}

export function usePermission() {
  const role = useAuthStore((s) => s.user?.role)

  const hasRole = useCallback(
    (minimum: UserRole): boolean => {
      if (!role) return false
      return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minimum]
    },
    [role],
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
