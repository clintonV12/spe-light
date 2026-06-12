import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface QueuedOperation {
  id: string
  operation: 'create' | 'update' | 'delete'
  resource: string
  payload: Record<string, unknown>
  created_at: string
}

interface OfflineState {
  isOnline: boolean
  isSyncing: boolean
  pendingCount: number
  queue: QueuedOperation[]
  lastSyncedAt: string | null
  conflictLog: Array<{ id: string; message: string; at: string }>

  setOnline: (online: boolean) => void
  setSyncing: (syncing: boolean) => void
  enqueue: (op: Omit<QueuedOperation, 'id' | 'created_at'>) => void
  dequeue: (id: string) => void
  clearQueue: () => void
  addConflict: (message: string) => void
  setLastSynced: (at: string) => void
}

export const useOfflineStore = create<OfflineState>()(
  persist(
    (set) => ({
      isOnline: navigator.onLine,
      isSyncing: false,
      pendingCount: 0,
      queue: [],
      lastSyncedAt: null,
      conflictLog: [],

      setOnline: (isOnline) => set({ isOnline }),
      setSyncing: (isSyncing) => set({ isSyncing }),

      enqueue: (op) => {
        const item: QueuedOperation = {
          ...op,
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
        }
        set((s) => ({
          queue: [...s.queue, item],
          pendingCount: s.queue.length + 1,
        }))
      },

      dequeue: (id) => {
        set((s) => {
          const queue = s.queue.filter((q) => q.id !== id)
          return { queue, pendingCount: queue.length }
        })
      },

      clearQueue: () => set({ queue: [], pendingCount: 0 }),

      addConflict: (message) => {
        set((s) => ({
          conflictLog: [
            ...s.conflictLog,
            { id: crypto.randomUUID(), message, at: new Date().toISOString() },
          ],
        }))
      },

      setLastSynced: (at) => set({ lastSyncedAt: at }),
    }),
    {
      name: 'stratplan-offline',
      partialize: (state) => ({
        queue: state.queue,
        pendingCount: state.pendingCount,
        lastSyncedAt: state.lastSyncedAt,
        conflictLog: state.conflictLog,
      }),
    },
  ),
)
