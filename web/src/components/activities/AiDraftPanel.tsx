import React, { useState } from 'react'
import { Sparkles, RefreshCw, Check, X } from 'lucide-react'
import { Button, Input } from '../ui'
import { aiApi } from '../../api/endpoints'
import { useToast } from '../../hooks'
import { LwaziFace } from './LwaziAvatar'
import type { ActivityType } from '../../types'

interface AiDraftPanelProps {
  planId: string
  activityType: ActivityType
  onAccept: (draft: Record<string, unknown>) => void
  isOffline?: boolean
}

interface DraftAttempt {
  draft: Record<string, unknown>
  model: string
}

export const AiDraftPanel: React.FC<AiDraftPanelProps> = ({
  planId,
  activityType,
  onAccept,
  isOffline,
}) => {
  const [keywords, setKeywords] = useState('')
  const [loading, setLoading] = useState(false)
  // Frontend-only clipboard of every draft generated this session (not
  // persisted — resets on refresh). Retry used to overwrite the single
  // `draft` value, so someone unsure about a result but not ready to
  // discard it had no way back once they clicked Retry. Now every
  // generation is appended and `currentIndex` just points at whichever
  // one is on screen, so switching between attempts costs nothing.
  const [attempts, setAttempts] = useState<DraftAttempt[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const { error } = useToast()

  const draft = currentIndex >= 0 ? attempts[currentIndex]?.draft ?? null : null
  const model = currentIndex >= 0 ? attempts[currentIndex]?.model ?? '' : ''

  const generate = async () => {
    const kw = keywords.split(',').map((k) => k.trim()).filter(Boolean)
    if (kw.length === 0) return

    setLoading(true)
    try {
      const result = await aiApi.draft({
        plan_id: planId,
        activity_type: activityType,
        keywords: kw,
      })
      setAttempts((prev) => {
        const next = [...prev, { draft: result.draft, model: result.model }]
        setCurrentIndex(next.length - 1)
        return next
      })
    } catch {
      error('AI generation failed. Is Ollama running?')
    } finally {
      setLoading(false)
    }
  }

  const discard = () => {
    setAttempts([])
    setCurrentIndex(-1)
  }

  if (isOffline) {
    return (
      <div className="rounded-xl border border-ink-100 bg-ink-50 p-4 text-center">
        <Sparkles className="size-6 text-ink-300 mx-auto mb-2" />
        <p className="text-sm text-ink-500">AI is unavailable offline.</p>
        <p className="text-xs text-ink-400 mt-0.5">Reconnect to use Ollama.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-accent-200 bg-accent-50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <LwaziFace size={18} state={loading ? 'thinking' : keywords.trim() ? 'listening' : 'idle'} />
        <p className="text-sm font-semibold text-ink-800">Call Lwazi</p>
      </div>

      <Input
        placeholder="Enter keywords, separated by commas (e.g. fintech, East Africa, growth)"
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        hint="1–10 keywords describing your context"
      />

      <Button
        size="sm"
        loading={loading}
        disabled={!keywords.trim() || loading}
        onClick={generate}
        className="w-full"
      >
        {loading ? 'Thinking…' : draft ? 'Generate another' : 'Generate ideas'}
      </Button>

      {loading && attempts.length > 0 && (
        <div className="rounded-lg border border-accent-200 bg-white p-4 flex items-center justify-center gap-2 text-sm text-ink-500">
          <LwaziFace size={16} state="thinking" /> Generating another option…
        </div>
      )}

      {!loading && draft && (
        <div className="rounded-lg border border-accent-200 bg-white p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-accent uppercase tracking-wide">
              AI Draft · {model}
            </p>
            <p className="text-xs text-ink-400">Review before accepting</p>
          </div>

          {/* Shown from the very first draft, not just once there's a
              second one to compare — see AiChapterAssist.tsx for the same
              reasoning. */}
          {attempts.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">
                Attempts · {attempts.length}
              </p>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {attempts.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentIndex(i)}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                      i === currentIndex
                        ? 'bg-accent text-white'
                        : 'bg-ink-50 text-ink-500 border border-ink-200 hover:border-accent-200 hover:text-accent'
                    }`}
                  >
                    Attempt {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}

          <pre className="text-xs text-ink-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
            {JSON.stringify(draft, null, 2)}
          </pre>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={discard} className="flex-1">
              <X className="size-3.5" /> Discard
            </Button>
            <Button size="sm" onClick={() => generate()} className="flex-1" variant="ghost">
              <RefreshCw className="size-3.5" /> Retry
            </Button>
            <Button size="sm" onClick={() => onAccept(draft)} className="flex-1">
              <Check className="size-3.5" /> Accept
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default AiDraftPanel