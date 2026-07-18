/**
 * hooks/useAutoSave.ts
 *
 * Debounced auto-save for the ActivityEditorPage.
 *
 * Behaviour:
 *   - After data changes (markDirty called), waits `debounceMs` before saving.
 *   - Exposes `saveState`: 'idle' | 'pending' | 'saving' | 'saved' | 'error'
 *   - `saveNow()` flushes the debounce immediately (used by Cmd+S).
 *   - Skips saving if `disabled` is true (read-only or uninitialised).
 *   - Clears the "saved" state back to "idle" after 3 seconds.
 *
 * Usage:
 *   const { saveState, saveNow, markDirty } = useAutoSave({
 *     data:        { content, status },
 *     onSave:      async (data) => { await activitiesApi.update(id, data) },
 *     debounceMs:  1500,
 *     disabled:    !canEdit,
 *   })
 */

import { useRef, useCallback, useState, useEffect } from 'react'

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

interface UseAutoSaveOptions<T> {
  data:        T
  onSave:      (data: T) => Promise<void>
  debounceMs?: number
  disabled?:   boolean
}

export function useAutoSave<T>({
  data,
  onSave,
  debounceMs = 1500,
  disabled   = false,
}: UseAutoSaveOptions<T>): {
  saveState: SaveState
  saveNow:   () => void
  markDirty: () => void
} {
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestData   = useRef<T>(data)
  const isSaving     = useRef(false)
  const isDirty      = useRef(false)

  // Keep latestData in sync without triggering re-renders
  useEffect(() => { latestData.current = data }, [data])

  const clearTimers = useCallback(() => {
    if (timerRef.current)   clearTimeout(timerRef.current)
    if (savedTimer.current) clearTimeout(savedTimer.current)
  }, [])

  const doSave = useCallback(async () => {
    if (disabled || isSaving.current || !isDirty.current) return
    isSaving.current = true
    isDirty.current  = false
    setSaveState('saving')
    try {
      await onSave(latestData.current)
      setSaveState('saved')
      // Reset to idle after 3 seconds
      savedTimer.current = setTimeout(() => setSaveState('idle'), 3_000)
    } catch {
      setSaveState('error')
      isDirty.current = true // allow retry
    } finally {
      isSaving.current = false
    }
  }, [disabled, onSave])

  const markDirty = useCallback(() => {
    if (disabled) return
    isDirty.current = true
    setSaveState('pending')
    // Reset the debounce timer
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(doSave, debounceMs)
  }, [disabled, debounceMs, doSave])

  const saveNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    doSave()
  }, [doSave])

  // Cleanup on unmount
  useEffect(() => () => clearTimers(), [clearTimers])

  return { saveState, saveNow, markDirty }
}