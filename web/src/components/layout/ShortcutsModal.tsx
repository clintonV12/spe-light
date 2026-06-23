import { useEffect } from 'react'
import { X, Keyboard } from 'lucide-react'
import { SHORTCUT_DEFS } from '../../hooks/useKeyboardShortcuts'
import type { ShortcutDefinition } from '../../hooks/useKeyboardShortcuts'

interface ShortcutsModalProps {
  open: boolean
  onClose: () => void
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[26px] h-6 px-1.5 rounded-md bg-ink-100 border border-ink-200 text-[11px] font-mono font-semibold text-ink-600 shadow-[0_1px_0_rgba(0,0,0,0.12)]">
      {children}
    </kbd>
  )
}

export default function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  // Group shortcuts
  const groups = ['Navigate', 'Actions', 'Editor']
  const byGroup = Object.fromEntries(
    groups.map((g) => [g, SHORTCUT_DEFS.filter((s) => s.group === g)])
  )

  // De-duplicate search entries (/ and ⌘K both open search)
  const deduped: Record<string, ShortcutDefinition[]> = {
    ...byGroup,
    Actions: byGroup.Actions.filter((s: ShortcutDefinition, i: number, arr: ShortcutDefinition[]) =>
      arr.findIndex((x: ShortcutDefinition) => x.description === s.description) === i
    ),
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-ink-100 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100">
          <div className="flex items-center gap-2.5">
            <Keyboard className="size-4 text-ink-400" />
            <h2 className="font-display text-sm font-bold text-ink-800">Keyboard shortcuts</h2>
          </div>
          <button onClick={onClose} className="text-ink-300 hover:text-ink-600 transition-colors">
            <X className="size-4" />
          </button>
        </div>

        {/* Shortcut groups */}
        <div className="p-5 space-y-6">
          {groups.map((group) => (
            <div key={group}>
              <p className="text-[11px] font-semibold text-ink-400 uppercase tracking-widest mb-3">
                {group}
              </p>
              <div className="space-y-2">
                {(deduped[group] ?? []).map((shortcut: ShortcutDefinition, idx: number) => (
                  <div key={idx} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-ink-700">{shortcut.description}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {shortcut.keys.map((key: string, ki: number) => (
                        <span key={ki} className="flex items-center gap-1">
                          <Kbd>{key}</Kbd>
                          {ki < shortcut.keys.length - 1 && (
                            <span className="text-[10px] text-ink-300 mx-0.5">then</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-ink-100 bg-ink-50/50">
          <p className="text-xs text-ink-400 text-center">
            Press <Kbd>?</Kbd> anywhere to toggle this panel · <Kbd>Esc</Kbd> to close
          </p>
        </div>
      </div>
    </div>
  )
}
