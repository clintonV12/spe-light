import React, { useMemo, useState } from 'react'
import { Eye, Target, Gem } from 'lucide-react'

export interface VisionMissionContent {
  vision: string
  mission: string
  values: string
}

interface VisionMissionEditorProps {
  value: Partial<VisionMissionContent>
  onChange: (value: VisionMissionContent) => void
  readOnly?: boolean
}

const EMPTY: VisionMissionContent = { vision: '', mission: '', values: '' }

/**
 * Vision/Mission as large statement cards (the way these are actually
 * presented in a strategy deck) with Core Values rendered as chips derived
 * live from comma or newline separated input.
 */
export const VisionMissionEditor: React.FC<VisionMissionEditorProps> = ({ value, onChange, readOnly }) => {
  const [content, setContent] = useState<VisionMissionContent>({ ...EMPTY, ...value })

  const set = (key: keyof VisionMissionContent, text: string) => {
    const updated = { ...content, [key]: text }
    setContent(updated)
    onChange(updated)
  }

  const valueChips = useMemo(
    () => content.values.split(/[,\n]/).map((v) => v.trim()).filter(Boolean),
    [content.values],
  )

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border-2 border-accent bg-accent-50 p-5">
        <div className="mb-2 flex items-center gap-2">
          <Eye className="size-4 text-accent" />
          <p className="text-xs font-bold uppercase tracking-wide text-accent">Vision</p>
        </div>
        <textarea
          className="w-full resize-none bg-transparent text-lg font-medium italic leading-snug text-ink-800 outline-none placeholder:text-ink-400 placeholder:not-italic min-h-20"
          placeholder="Where is the organisation headed, ultimately?"
          value={content.vision}
          onChange={(e) => set('vision', e.target.value)}
          readOnly={readOnly}
        />
      </div>

      <div className="rounded-2xl border-2 border-p2 bg-p2-light p-5">
        <div className="mb-2 flex items-center gap-2">
          <Target className="size-4 text-p2-dark" />
          <p className="text-xs font-bold uppercase tracking-wide text-p2-dark">Mission</p>
        </div>
        <textarea
          className="w-full resize-none bg-transparent text-base leading-snug text-ink-800 outline-none placeholder:text-ink-400 min-h-20"
          placeholder="What does the organisation do, day to day, to get there?"
          value={content.mission}
          onChange={(e) => set('mission', e.target.value)}
          readOnly={readOnly}
        />
      </div>

      <div className="rounded-2xl border-2 border-p3 bg-p3-light p-5">
        <div className="mb-2 flex items-center gap-2">
          <Gem className="size-4 text-p3-dark" />
          <p className="text-xs font-bold uppercase tracking-wide text-p3-dark">Core Values</p>
        </div>
        <textarea
          className="w-full resize-none bg-transparent text-sm text-ink-800 outline-none placeholder:text-ink-400 min-h-16"
          placeholder="Separate values with a comma or a new line…"
          value={content.values}
          onChange={(e) => set('values', e.target.value)}
          readOnly={readOnly}
        />
        {valueChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-p3/30 pt-3">
            {valueChips.map((v, i) => (
              <span key={i} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-p3-dark shadow-sm">
                {v}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default VisionMissionEditor