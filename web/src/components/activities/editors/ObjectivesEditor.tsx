import React, { useMemo, useState } from 'react'
import { ListChecks, MessageSquareQuote } from 'lucide-react'

export interface ObjectivesContent {
  objectives: string
  rationale: string
}

interface ObjectivesEditorProps {
  value: Partial<ObjectivesContent>
  onChange: (value: ObjectivesContent) => void
  readOnly?: boolean
}

const EMPTY: ObjectivesContent = { objectives: '', rationale: '' }

/**
 * Objectives as a numbered list (one line = one objective) with a live count
 * badge, plus rationale as a distinct "why" panel below.
 */
export const ObjectivesEditor: React.FC<ObjectivesEditorProps> = ({ value, onChange, readOnly }) => {
  const [content, setContent] = useState<ObjectivesContent>({ ...EMPTY, ...value })

  const set = (key: keyof ObjectivesContent, text: string) => {
    const updated = { ...content, [key]: text }
    setContent(updated)
    onChange(updated)
  }

  const lines = useMemo(
    () => content.objectives.split('\n').map((l) => l.trim()).filter(Boolean),
    [content.objectives],
  )

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border-2 border-p1 bg-p1-light p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListChecks className="size-4 text-p1-dark" />
            <p className="text-xs font-bold uppercase tracking-wide text-p1-dark">Strategic Objectives</p>
          </div>
          {lines.length > 0 && (
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-p1-dark shadow-sm">
              {lines.length} {lines.length === 1 ? 'objective' : 'objectives'}
            </span>
          )}
        </div>

        {lines.length > 0 && !readOnly && (
          <div className="mb-3 space-y-1.5">
            {lines.map((line, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg bg-white/70 px-2.5 py-1.5">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-p1 text-[10px] font-bold text-white">
                  {i + 1}
                </span>
                <p className="text-sm text-ink-800">{line}</p>
              </div>
            ))}
          </div>
        )}

        <textarea
          className="w-full resize-none rounded-lg bg-white/60 px-3 py-2 text-sm text-ink-800 outline-none placeholder:text-ink-400 min-h-24"
          placeholder="One objective per line…"
          value={content.objectives}
          onChange={(e) => set('objectives', e.target.value)}
          readOnly={readOnly}
        />
      </div>

      <div className="rounded-2xl border-2 border-ink-200 bg-ink-50 p-5">
        <div className="mb-2 flex items-center gap-2">
          <MessageSquareQuote className="size-4 text-ink-500" />
          <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Rationale</p>
        </div>
        <textarea
          className="w-full resize-none bg-transparent text-sm text-ink-800 outline-none placeholder:text-ink-400 min-h-20"
          placeholder="Why these objectives, and why now?"
          value={content.rationale}
          onChange={(e) => set('rationale', e.target.value)}
          readOnly={readOnly}
        />
      </div>
    </div>
  )
}

export default ObjectivesEditor