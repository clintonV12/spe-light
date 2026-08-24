import React, { useState } from 'react'
import { RefreshCw, Check, X } from 'lucide-react'
import { Button, Input } from '../ui'
import { aiApi } from '../../api/endpoints'
import { useToast } from '../../hooks'
import { LwaziFace } from './LwaziAvatar'
import type { KPI } from '../../types'

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

export interface DraftAttempt {
  draft: Record<string, unknown>
  model: string
  keywords: string
}

// A frontend-only "clipboard" of every draft generated in this panel
// session (not persisted — resets on refresh/navigation, same as the rest
// of this hook's state). Retry used to just overwrite `draft`, so a
// person who generated something decent, wasn't sure, and hit Retry to
// compare had no way back to the first version short of retrying again
// and hoping. `attempts` keeps every generation around; `currentIndex`
// points at whichever one is currently shown, and can be moved backward
// *and* forward across the list rather than only ever appending.
// extraContext lets a caller thread additional, activity-type-specific
// fields into the /ai/draft request body beyond the common plan_id/
// activity_type/keywords/activity_id shape — e.g. LocalPlanBoard's
// per-pillar "Suggest objectives" passes { pillar_id } so the backend can
// ground the draft in that one pillar's title rather than the plan in
// general. Backend contract: ai_service.go's handler for the given
// activity_type must read whatever keys this supplies (see its
// "local_pillar_objectives" case).
export function useAiDraft(
  planId: string,
  activityType: string,
  activityId?: string,
  extraContext?: Record<string, unknown>,
) {
  const [open, setOpen] = useState(false)
  const [keywords, setKeywords] = useState('')
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [attempts, setAttempts] = useState<DraftAttempt[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const { success, error } = useToast()

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
        // Only set once the activity actually exists (e.g. KPI suggestions
        // from LocalActivityEditor, editing an already-created activity) —
        // grounds the draft in that activity's own title/objective rather
        // than the plan in general. Omitted for chapter-level drafts and
        // for KPI suggestions made while an activity is still being
        // created in CreateActivityModal (no id yet).
        ...(activityId ? { activity_id: activityId } : {}),
        ...(extraContext ?? {}),
      })
      // Appended, never overwritten — the previous attempt (if any) stays
      // in the list so Retry reads as "generate another option" rather
      // than "throw the last one away".
      setAttempts((prev) => {
        const next = [...prev, { draft: result.draft, model: result.model, keywords: keywords.trim() }]
        setCurrentIndex(next.length - 1)
        return next
      })
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
    setAttempts([])
    setCurrentIndex(-1)
  }

  // Jump to any past attempt without losing the others — this is the
  // "select from clipboard" action, not a destructive swap.
  const selectAttempt = (index: number) => {
    if (index < 0 || index >= attempts.length) return
    setCurrentIndex(index)
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

  return {
    open, keywords, setKeywords, loading, applying, draft, model,
    attempts, currentIndex, selectAttempt,
    start, close, generate, accept,
  }
}

// Shared by LocalActivityEditor.tsx and CreateActivityModal.tsx — both parse
// the same `{"kpis": [{indicator, target, target_value?, direction?}]}`
// draft shape (see ai_service.go's "local_activity_kpis" case) into KPI[].
// Kept in one place after a bug where the backend had no case for that
// activity_type, silently fell through to the generic {content, notes}
// schema, and the caller's `if (suggested.length === 0) return` swallowed
// the mismatch — "AI draft applied" toasted with nothing actually saved.
// Throwing here instead of returning an empty array means
// useAiDraft.accept()'s catch block now surfaces that as a real error
// rather than a false success, whatever caused zero rows to come back.
export function parseKpiDraft(draft: Record<string, unknown>): KPI[] {
  const list = Array.isArray(draft.kpis) ? draft.kpis as unknown[] : []
  const suggested: KPI[] = []
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue
    const row = raw as {
      indicator?: unknown; target?: unknown; target_value?: unknown; direction?: unknown
      budget?: unknown; responsibility?: unknown; target_period?: unknown
    }
    const indicator = typeof row.indicator === 'string' ? row.indicator.trim() : ''
    const target = typeof row.target === 'string' ? row.target.trim() : ''
    if (!indicator && !target) continue
    // Numeric, tolerating a model that ignores the "plain number" instruction
    // and sends "20" or "20%" as a string.
    const targetValue = parseNumeric(row.target_value)
    const direction = row.direction === 'decrease' ? 'decrease' : row.direction === 'increase' ? 'increase' : undefined
    // budget/responsibility/target_period (migration 013 — moved from the
    // activity onto each KPI) are all optional per ai_service.go's prompt —
    // the model is told to omit rather than guess, so absence here is the
    // common case, not a parsing failure.
    const budget = parseNumeric(row.budget)
    const responsibility = typeof row.responsibility === 'string' && row.responsibility.trim() ? row.responsibility.trim() : undefined
    const targetPeriod = row.target_period === 'monthly' || row.target_period === 'quarterly' || row.target_period === 'annual'
      ? row.target_period
      : undefined
    suggested.push({
      indicator, target, target_value: targetValue, direction,
      budget, responsibility, target_period: targetPeriod,
    })
  }
  if (suggested.length === 0) {
    throw new Error('AI response did not contain any usable KPIs')
  }
  return suggested
}

// Tolerates a model that ignores the "plain number" instruction and sends
// e.g. "20" or "20%" as a string instead of a bare JSON number.
function parseNumeric(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const parsed = Number(v.replace(/[^0-9.-]/g, ''))
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

export const AiAssistTrigger: React.FC<{ onClick: () => void; label?: string }> = ({ onClick, label = 'Ask Lwazi' }) => {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex items-center gap-1.5 rounded-lg border border-accent-200 bg-accent-50 px-2.5 py-1.5 text-xs font-semibold text-accent hover:bg-accent-100 transition-colors shrink-0"
    >
      <LwaziFace size={16} state={hovered ? 'happy' : 'idle'} /> {label}
    </button>
  )
}

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
  if (typeof val === 'object' && val !== null) {
    const inline = renderInlineObject(val as Record<string, unknown>)
    if (!inline) return <p className="text-sm text-ink-400 italic">Nothing suggested.</p>
    return <p className="text-sm text-ink-800">{inline}</p>
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
  /** Every draft generated so far this session — the "clipboard" the person can jump back to. */
  attempts?: DraftAttempt[]
  /** Index into `attempts` currently shown. */
  currentIndex?: number
  onSelectAttempt?: (index: number) => void
}> = ({
  keywords, onKeywordsChange, loading, applying, draft, model, onGenerate, onRegenerate, onAccept, onClose,
  attempts = [], currentIndex = -1, onSelectAttempt,
}) => (
  <div className="w-full rounded-2xl border-2 border-accent bg-accent-50 p-4 mb-4 space-y-3">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <LwaziFace size={18} state={loading ? 'thinking' : keywords.trim() ? 'listening' : 'idle'} />
        <p className="text-xs font-bold uppercase tracking-wide text-accent">Call Lwazi</p>
      </div>
      <button onClick={onClose} className="text-ink-400 hover:text-ink-700">
        <X className="size-4" />
      </button>
    </div>

    {!loading && !draft && (
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

    {/* Shown for both the first generation and a Retry — a Retry keeps the
        prior attempt in state (see useAiDraft.generate), so without this
        branch the panel would render nothing at all while the new one is
        in flight instead of showing it's working. */}
    {loading && (
      <div className="rounded-xl bg-white p-6 flex flex-col items-center justify-center gap-2 text-center">
        <LwaziFace size={22} state="thinking" />
        <p className="text-sm text-ink-500">
          {draft ? 'Generating another option…' : 'Thinking…'}
        </p>
      </div>
    )}

    {!loading && draft && (
      <>
        {/* Shown from the very first draft, not just once there's a second
            one to compare — otherwise the clipboard is invisible until the
            person happens to hit Retry, which is exactly what made it hard
            to find in the Vision & Mission panel. */}
        {attempts.length > 0 && onSelectAttempt && (
          <AttemptClipboard attempts={attempts} currentIndex={currentIndex} onSelect={onSelectAttempt} />
        )}
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

// ── Attempt clipboard ────────────────────────────────────────────────────
//
// A row of "Attempt N" chips, most recent last, so Retry reads left-to-
// right the way the person generated them. The current attempt is
// highlighted; clicking any other one just swaps the preview below to
// that draft — nothing is discarded, so bouncing between two or three
// versions to compare them costs nothing. Only shown once there's
// something to compare (2+ attempts).
const AttemptClipboard: React.FC<{
  attempts: DraftAttempt[]
  currentIndex: number
  onSelect: (index: number) => void
}> = ({ attempts, currentIndex, onSelect }) => (
  <div className="space-y-1">
    <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">
      Attempts · {attempts.length}
    </p>
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
      {attempts.map((attempt, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          title={attempt.keywords || undefined}
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors ${
            i === currentIndex
              ? 'bg-accent text-white'
              : 'bg-white text-ink-500 border border-ink-200 hover:border-accent-200 hover:text-accent'
          }`}
        >
          Attempt {i + 1}
        </button>
      ))}
    </div>
  </div>
)