import { useState, useEffect, useRef, useCallback } from 'react'

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

interface UseAutoSaveOptions<T> {
  data: T
  onSave: (data: T) => Promise<void>
  /** Milliseconds to wait after last change before firing. Default: 1500 */
  debounceMs?: number
  /** If true, auto-save is disabled (e.g. read-only mode). */
  disabled?: boolean
  /** Milliseconds to show "Saved" before returning to idle. Default: 2500 */
  savedDuration?: number
}

interface UseAutoSaveReturn {
  saveState: SaveState
  /** Fire an immediate save regardless of debounce timer */
  saveNow: () => Promise<void>
  /** Mark data as dirty manually (call when you need to force a save cycle) */
  markDirty: () => void
}

export function useAutoSave<T>({
  data,
  onSave,
  debounceMs = 1500,
  disabled = false,
  savedDuration = 2500,
}: UseAutoSaveOptions<T>): UseAutoSaveReturn {
  const [saveState, setSaveState] = useState<SaveState>('idle')

  // Track whether we have unsaved changes
  const isDirtyRef = useRef(false)
  // Track whether an active save is in-flight to avoid double-saving
  const isSavingRef = useRef(false)
  // Keep a stable ref to the latest data so the debounced callback always
  // sees the current value without needing to re-register the timer
  const dataRef = useRef(data)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep dataRef current
  useEffect(() => {
    dataRef.current = data
  }, [data])

  const doSave = useCallback(async () => {
    if (isSavingRef.current || disabled) return
    isSavingRef.current = true
    isDirtyRef.current = false
    setSaveState('saving')
    try {
      await onSave(dataRef.current)
      setSaveState('saved')
      // Reset to idle after savedDuration
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => {
        setSaveState((s) => s === 'saved' ? 'idle' : s)
      }, savedDuration)
    } catch {
      setSaveState('error')
      isDirtyRef.current = true // mark dirty again so next change retries
    } finally {
      isSavingRef.current = false
    }
  }, [onSave, disabled, savedDuration])

  // Called whenever data changes — schedules a debounced save
  useEffect(() => {
    if (disabled) return
    // Skip the very first render (data hasn't changed yet, this is the initial load)
    if (saveState === 'idle' && !isDirtyRef.current) return

    isDirtyRef.current = true
    setSaveState('pending')

    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      doSave()
    }, debounceMs)

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, disabled, debounceMs])

  const saveNow = useCallback(async () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    await doSave()
  }, [doSave])

  const markDirty = useCallback(() => {
    isDirtyRef.current = true
    setSaveState('pending')
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  return { saveState, saveNow, markDirty }
}
