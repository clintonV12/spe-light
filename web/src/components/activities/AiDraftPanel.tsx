import React, { useState } from 'react'
import { Sparkles, RefreshCw, Check, X } from 'lucide-react'
import { Button, Input } from '../ui'
import { aiApi } from '../../api/endpoints'
import { useToast } from '../../hooks'
import { LwaziFace } from './LwaziAvatar'
import type { Phase, ActivityType } from '../../types'

interface AiDraftPanelProps {
  planId: string
  phase: Phase
  activityType: ActivityType
  onAccept: (draft: Record<string, unknown>) => void
  isOffline?: boolean
}

export const AiDraftPanel: React.FC<AiDraftPanelProps> = ({
  planId,
  phase,
  activityType,
  onAccept,
  isOffline,
}) => {
  const [keywords, setKeywords] = useState('')
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const [model, setModel] = useState('')
  const { error } = useToast()

  const generate = async () => {
    const kw = keywords.split(',').map((k) => k.trim()).filter(Boolean)
    if (kw.length === 0) return

    setLoading(true)
    setDraft(null)
    try {
      const result = await aiApi.draft({
        plan_id: planId,
        activity_type: activityType,
        keywords: kw,
        phase,
      })
      setDraft(result.draft)
      setModel(result.model)
    } catch {
      error('AI generation failed. Is Ollama running?')
    } finally {
      setLoading(false)
    }
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
        {loading ? 'Thinking…' : 'Generate ideas'}
      </Button>

      {draft && (
        <div className="rounded-lg border border-accent-200 bg-white p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-accent uppercase tracking-wide">
              AI Draft · {model}
            </p>
            <p className="text-xs text-ink-400">Review before accepting</p>
          </div>
          <pre className="text-xs text-ink-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
            {JSON.stringify(draft, null, 2)}
          </pre>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDraft(null)} className="flex-1">
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