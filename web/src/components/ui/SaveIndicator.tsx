import { CheckCircle2, Loader, AlertCircle, Clock } from 'lucide-react'
import type { SaveState } from '../../hooks/useAutoSave'

interface SaveIndicatorProps {
  state: SaveState
  onSaveNow?: () => void
}

export default function SaveIndicator({ state, onSaveNow }: SaveIndicatorProps) {
  if (state === 'idle') return null

  return (
    <div className="flex items-center gap-1.5 text-xs transition-all duration-200">
      {state === 'pending' && (
        <span className="flex items-center gap-1.5 text-ink-400">
          <Clock className="size-3.5" />
          <span>Unsaved</span>
          {onSaveNow && (
            <button
              onClick={onSaveNow}
              className="ml-1 text-accent hover:text-accent-700 font-medium transition-colors"
            >
              Save now
            </button>
          )}
        </span>
      )}

      {state === 'saving' && (
        <span className="flex items-center gap-1.5 text-ink-400">
          <Loader className="size-3.5 animate-spin" />
          <span>Saving…</span>
        </span>
      )}

      {state === 'saved' && (
        <span className="flex items-center gap-1.5 text-p2-dark animate-in fade-in duration-200">
          <CheckCircle2 className="size-3.5" />
          <span>Saved</span>
        </span>
      )}

      {state === 'error' && (
        <span className="flex items-center gap-1.5 text-red-500">
          <AlertCircle className="size-3.5" />
          <span>Save failed</span>
          {onSaveNow && (
            <button
              onClick={onSaveNow}
              className="ml-1 text-red-600 hover:text-red-800 font-medium underline transition-colors"
            >
              Retry
            </button>
          )}
        </span>
      )}
    </div>
  )
}
