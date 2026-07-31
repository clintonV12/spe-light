import React, { useState } from 'react'
import { Sparkles, RefreshCw, Check, X } from 'lucide-react'
import { Button, Input } from '../ui'
import { aiApi } from '../../api/endpoints'
import { useToast } from '../../hooks'

// ── Shared "Call Lwazi" AI-draft widget for local-plan chapters ────────────
//
// AiDraftPanel.tsx (used by international activities) is wired to a single
// Activity's phase/type/content and is meant to sit in its own sidebar
// column. The local-plan chapters (LocalPlanChapters.tsx, LocalPlanBoard.tsx)
// have no backing Activity at all for most of their data — each chapter is
// its own table (CoreValue, Stakeholder, PESTELItem, OrgStructureRole,
// MEItem, StrategicPillar/Objective) — so accepting a draft here means
// fanning it out into several create-API calls rather than writing one
// activity's `content`.
//
// This is split into three pieces on purpose:
//   - useAiDraft(planId, activityType) — all the state/network logic
//   - AiAssistTrigger — the small button that lives inline in a section
//     header (e.g. next to "SWOT analysis")
//   - AiAssistPanel — the actual draft preview + accept/retry UI, rendered
//     as its own full-width block *below* the header, never squeezed into
//     the header's flex row. That squeeze was why the panel looked broken
//     previously — cramming a growing card into a `justify-between` row
//     next to a title left it fighting for width instead of owning a row.

export function useAiDraft(planId: string, activityType: string) {
  const [open, setOpen] = useState(false)
  const [keywords, setKeywords] = useState('')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const [model, setModel] = useState('')
  const { success, error } = useToast()

  const generate = async () => {
    const kw = keywords.split(',').map((k) => k.trim()).filter(Boolean)
    if (kw.length === 0) return

    setLoading(true)
    setDraft(null)
    try {
      const result = await aiApi.draft({ plan_id: planId, activity_type: activityType, keywords: kw })
      setDraft(result.draft)
      setModel(result.model)
    } catch {
      error('AI generation failed. Is Ollama running?')
    } finally {
      setLoading(false)
    }
  }

  // Opens the panel so the person can enter keywords first — it no longer
  // generates immediately on open. Without context to ground it, the model
  // has nothing to work from and tends to produce generic, meaningless text.
  const start = () => setOpen(true)

  const close = () => {
    setOpen(false)
    setDraft(null)
  }

  const accept = async (onAccept: (draft: Record<string, unknown>) => Promise<void>) => {
    if (!draft) return
    setApplying(true)
    try {
      await onAccept(draft)
      success('AI draft applied')
      close()
    } catch {
      error('Some items failed to save — please check the list and retry')
    } finally {
      setApplying(false)
    }
  }

  return { open, keywords, setKeywords, loading, applying, draft, model, start, close, generate, accept }
}

export const AiAssistTrigger: React.FC<{ onClick: () => void; label?: string }> = ({ onClick, label = 'Draft with AI' }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-1.5 rounded-lg border border-accent-200 bg-accent-50 px-2.5 py-1.5 text-xs font-semibold text-accent hover:bg-accent-100 transition-colors shrink-0"
  >
    <Sparkles className="size-3.5" /> {label}
  </button>
)

function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function renderInlineObject(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${humanizeKey(k)}: ${String(v)}`)
    .join(' · ')
}

function renderDraftValue(val: unknown): React.ReactNode {
  if (typeof val === 'string') {
    if (!val.trim()) return <p className="text-sm text-ink-400 italic">Nothing suggested.</p>
    // Bulleted strings (e.g. "- point one\n- point two") render as a list,
    // plain prose renders as a paragraph — both formats show up across the
    // different draft shapes (SWOT bullets vs. Vision prose).
    const lines = val.split('\n').map((l) => l.replace(/^[-•\s]+/, '').trim()).filter(Boolean)
    if (lines.length > 1) {
      return (
        <ul className="space-y-1 list-disc list-inside">
          {lines.map((l, i) => <li key={i} className="text-sm text-ink-800">{l}</li>)}
        </ul>
      )
    }
    return <p className="text-sm text-ink-800 whitespace-pre-wrap">{val}</p>
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return <p className="text-sm text-ink-400 italic">Nothing suggested.</p>
    return (
      <ul className="space-y-1">
        {val.map((item, i) => (
          <li key={i} className="text-sm text-ink-800 bg-ink-50 rounded-md px-2.5 py-1.5">
            {typeof item === 'string'
              ? item
              : typeof item === 'object' && item !== null
                ? renderInlineObject(item as Record<string, unknown>)
                : String(item)}
          </li>
        ))}
      </ul>
    )
  }
  return <p className="text-sm text-ink-800">{String(val)}</p>
}

/** Turns a raw draft object into readable labeled sections instead of a JSON dump. */
export function renderDraftPreview(draft: Record<string, unknown>): React.ReactNode {
  const entries = Object.entries(draft)
  if (entries.length === 0) return <p className="text-sm text-ink-400 italic">Nothing suggested.</p>
  return (
    <div className="space-y-3">
      {entries.map(([key, val]) => (
        <div key={key}>
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500 mb-1">{humanizeKey(key)}</p>
          {renderDraftValue(val)}
        </div>
      ))}
    </div>
  )
}

export const AiAssistPanel: React.FC<{
  keywords: string
  onKeywordsChange: (value: string) => void
  loading: boolean
  applying: boolean
  draft: Record<string, unknown> | null
  model: string
  onGenerate: () => void
  onRegenerate: () => void
  onAccept: () => void
  onClose: () => void
}> = ({ keywords, onKeywordsChange, loading, applying, draft, model, onGenerate, onRegenerate, onAccept, onClose }) => (
  <div className="w-full rounded-2xl border-2 border-accent bg-accent-50 p-4 mb-4 space-y-3">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <Sparkles className="size-4 text-accent" />
        <p className="text-xs font-bold uppercase tracking-wide text-accent">Call Lwazi</p>
      </div>
      <button onClick={onClose} className="text-ink-400 hover:text-ink-700">
        <X className="size-4" />
      </button>
    </div>

    {!draft && (
      <>
        <Input
          placeholder="Enter keywords, separated by commas (e.g. fintech, East Africa, growth)"
          value={keywords}
          onChange={(e) => onKeywordsChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !loading && keywords.trim() && onGenerate()}
          hint="1–10 keywords describing your context — the more specific, the better the draft"
        />
        <Button
          size="sm"
          loading={loading}
          disabled={!keywords.trim() || loading}
          onClick={onGenerate}
          className="w-full"
        >
          {loading ? 'Generating…' : 'Generate ideas'}
        </Button>
      </>
    )}

    {!loading && draft && (
      <>
        <div className="rounded-xl bg-white p-3 max-h-72 overflow-y-auto">
          {renderDraftPreview(draft)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-ink-400">Model: {model} · review before accepting</p>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="ghost" onClick={onRegenerate}>
              <RefreshCw className="size-3.5" /> Retry
            </Button>
            <Button size="sm" loading={applying} onClick={onAccept}>
              <Check className="size-3.5" /> Accept all
            </Button>
          </div>
        </div>
      </>
    )}
  </div>
)