import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface QueuedOperation {
  id: string
  operation: 'create' | 'update' | 'delete'
  resource: string
  payload: Record<string, unknown>
  created_at: string
  /**
   * Only meaningful for operation: 'create'. The client-generated id
   * (crypto.randomUUID()) a page rendered/navigated to immediately,
   * before the real POST could complete — e.g. "create a plan while
   * offline" needs *something* to put in the /plans/:id URL right away,
   * since there's no server-assigned id yet. Carried through so
   * useSyncEngine can call resolveTempId() with the real id once this
   * operation actually succeeds — see idMap below.
   */
  tempId?: string
}

interface OfflineState {
  isOnline: boolean
  isSyncing: boolean
  pendingCount: number
  queue: QueuedOperation[]
  lastSyncedAt: string | null
  conflictLog: Array<{ id: string; message: string; at: string }>
  /**
   * tempId → real server id, populated by useSyncEngine once a queued
   * 'create' operation's response comes back. Consumers that navigated to
   * or rendered something under a tempId (PlanDetailPage sitting on
   * `/plans/{tempId}`, a child "create activity under this plan" queued
   * operation whose resource still points at the tempId, etc.) read this
   * to find out a real id now exists and update accordingly — redirect
   * the URL, rewrite a still-queued child operation's resource, relabel a
   * "pending sync" badge as synced.
   *
   * Deliberately never auto-pruned: a page that mounted, read a stale
   * tempId, and unmounted before the create resolved still needs the
   * mapping to be there whenever it (or another page) next asks. Cleared
   * wholesale by clearQueue() only, same lifecycle as the queue itself.
   */
  idMap: Record<string, string>

  setOnline: (online: boolean) => void
  setSyncing: (syncing: boolean) => void
  enqueue: (op: Omit<QueuedOperation, 'id' | 'created_at'>) => void
  dequeue: (id: string) => void
  clearQueue: () => void
  addConflict: (message: string) => void
  setLastSynced: (at: string) => void
  /**
   * Records that tempId now has a real server id, and — this is the part
   * a plain "set idMap" wouldn't do — rewrites the `resource` field of
   * every still-queued operation that referenced tempId (e.g. "create
   * activity under plan {tempId}", queued before the parent plan's own
   * create had synced) so they resolve against the real id instead of
   * 404ing against an id the server never issued.
   */
  resolveTempId: (tempId: string, realId: string) => void
  /** Looks up a possibly-temp id through idMap, returning it unchanged if it isn't one. */
  resolveId: (id: string) => string
}

export const useOfflineStore = create<OfflineState>()(
  persist(
    (set, get) => ({
      isOnline: navigator.onLine,
      isSyncing: false,
      pendingCount: 0,
      queue: [],
      lastSyncedAt: null,
      conflictLog: [],
      idMap: {},

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

      clearQueue: () => set({ queue: [], pendingCount: 0, idMap: {} }),

      addConflict: (message) => {
        set((s) => ({
          conflictLog: [
            ...s.conflictLog,
            { id: crypto.randomUUID(), message, at: new Date().toISOString() },
          ],
        }))
      },

      setLastSynced: (at) => set({ lastSyncedAt: at }),

      resolveTempId: (tempId, realId) => {
        set((s) => ({
          idMap: { ...s.idMap, [tempId]: realId },
          // Rewrite any still-queued operation whose resource path embeds
          // the tempId — e.g. a "create activity" queued against
          // `/plans/{tempId}/activities` before the parent plan's own
          // create had synced. A plain string replace is safe here since
          // resource paths are always ours (built from api/*Api.ts, never
          // user input) and a tempId is a full UUID, not a substring that
          // could accidentally collide with something else in the path.
          queue: s.queue.map((op) =>
            op.resource.includes(tempId)
              ? { ...op, resource: op.resource.replaceAll(tempId, realId) }
              : op,
          ),
        }))
      },

      resolveId: (id) => get().idMap[id] ?? id,
    }),
    {
      name: 'stratplan-offline',
      partialize: (state) => ({
        queue: state.queue,
        pendingCount: state.pendingCount,
        lastSyncedAt: state.lastSyncedAt,
        conflictLog: state.conflictLog,
        idMap: state.idMap,
      }),
    },
  ),
)