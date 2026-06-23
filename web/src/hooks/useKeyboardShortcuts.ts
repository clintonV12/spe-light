import { useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

export interface ShortcutDefinition {
  keys: string[]          // display labels, e.g. ['g', 'd']
  description: string
  group: string
}

export const SHORTCUT_DEFS: ShortcutDefinition[] = [
  // Navigation — g prefix
  { keys: ['g', 'd'], description: 'Go to Dashboard',  group: 'Navigate' },
  { keys: ['g', 'p'], description: 'Go to Plans',      group: 'Navigate' },
  { keys: ['g', 'r'], description: 'Go to Progress',   group: 'Navigate' },
  { keys: ['g', 'e'], description: 'Go to Reports',    group: 'Navigate' },
  { keys: ['g', 'a'], description: 'Go to Admin',      group: 'Navigate' },
  // Actions
  { keys: ['/'],       description: 'Open search',     group: 'Actions' },
  { keys: ['⌘', 'K'], description: 'Open search',     group: 'Actions' },
  { keys: ['⌘', 'S'], description: 'Save (in editor)', group: 'Actions' },
  { keys: ['?'],       description: 'Show shortcuts',  group: 'Actions' },
  // Editor
  { keys: ['Esc'],     description: 'Close modal / panel', group: 'Editor' },
]

type ShortcutHandler = () => void

interface UseKeyboardShortcutsOptions {
  onOpenSearch: ShortcutHandler
  onOpenCreate: ShortcutHandler
  onOpenHelp:   ShortcutHandler
}

export function useKeyboardShortcuts({
  onOpenSearch,
  onOpenCreate,
  onOpenHelp,
}: UseKeyboardShortcutsOptions) {
  const navigate = useNavigate()
  // g-chord state: after pressing 'g', wait for the second key
  const gChordActive = useRef(false)
  const gChordTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetGChord = useCallback(() => {
    gChordActive.current = false
    if (gChordTimer.current) clearTimeout(gChordTimer.current)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isEditing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.isContentEditable

      // ── Cmd/Ctrl combos — work even inside inputs ───────────────────────
      if (e.metaKey || e.ctrlKey) {
        // Cmd+K handled by AppShell search listener — skip here
        // Cmd+S handled inside ActivityEditorPage — skip here
        return
      }

      // ── All other shortcuts — skip when typing ──────────────────────────
      if (isEditing) {
        resetGChord()
        return
      }

      // ── g-chord: press g then a second key within 1.5 s ─────────────────
      if (gChordActive.current) {
        resetGChord()
        switch (e.key.toLowerCase()) {
          case 'd': navigate('/dashboard'); break
          case 'p': navigate('/plans');     break
          case 'r': navigate('/progress');  break
          case 'e': navigate('/reports');   break
          case 'a': navigate('/admin');     break
        }
        e.preventDefault()
        return
      }

      if (e.key.toLowerCase() === 'g') {
        e.preventDefault()
        gChordActive.current = true
        // Auto-cancel after 1.5 s if no second key arrives
        if (gChordTimer.current) clearTimeout(gChordTimer.current)
        gChordTimer.current = setTimeout(resetGChord, 1500)
        return
      }

      // ── Single-key shortcuts ─────────────────────────────────────────────
      switch (e.key) {
        case '?':
          e.preventDefault()
          onOpenHelp()
          break
        case 'c':
          e.preventDefault()
          onOpenCreate()
          break
        // '/' is handled by AppShell search listener — skip here
      }
    }

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      if (gChordTimer.current) clearTimeout(gChordTimer.current)
    }
  }, [navigate, onOpenSearch, onOpenCreate, onOpenHelp, resetGChord])
}
