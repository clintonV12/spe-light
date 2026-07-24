import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar } from 'lucide-react'

export interface RoadmapContent {
  q1: string
  q2: string
  q3: string
  q4: string
}

interface RoadmapEditorProps {
  value: Partial<RoadmapContent>
  onChange: (value: RoadmapContent) => void
  readOnly?: boolean
}

const EMPTY: RoadmapContent = { q1: '', q2: '', q3: '', q4: '' }

const QUARTERS: { key: keyof RoadmapContent; labelKey: string; color: string; dot: string }[] = [
  { key: 'q1', labelKey: 'editors.roadmap.q1', color: 'border-p1 bg-p1-light', dot: 'bg-p1' },
  { key: 'q2', labelKey: 'editors.roadmap.q2', color: 'border-p2 bg-p2-light', dot: 'bg-p2' },
  { key: 'q3', labelKey: 'editors.roadmap.q3', color: 'border-p3 bg-p3-light', dot: 'bg-p3' },
  { key: 'q4', labelKey: 'editors.roadmap.q4', color: 'border-accent bg-accent-50', dot: 'bg-accent' },
]

/** Four quarters laid out as a connected timeline rather than four stacked textareas. */
export const RoadmapEditor: React.FC<RoadmapEditorProps> = ({ value, onChange, readOnly }) => {
  const { t } = useTranslation()
  const [content, setContent] = useState<RoadmapContent>({ ...EMPTY, ...value })

  const set = (key: keyof RoadmapContent, text: string) => {
    const updated = { ...content, [key]: text }
    setContent(updated)
    onChange(updated)
  }

  return (
    <div className="relative">
      {/* Connecting line, desktop only */}
      <div className="absolute left-0 right-0 top-4 hidden h-0.5 bg-ink-100 lg:block" />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        {QUARTERS.map(({ key, labelKey, color, dot }) => {
          const label = t(labelKey)
          return (
            <div key={key} className="relative">
              <div className="relative z-10 mb-2 hidden items-center justify-center lg:flex">
                <span className={`size-3.5 rounded-full ring-4 ring-white ${dot}`} />
              </div>
              <div className={`flex h-full flex-col rounded-xl border-2 p-3 ${color}`}>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Calendar className="size-3.5 opacity-70" />
                  <p className="text-xs font-bold uppercase tracking-wide text-ink-600">{label} {t('editors.roadmap.milestonesSuffix')}</p>
                </div>
                <textarea
                  className="min-h-28 w-full flex-1 resize-none bg-transparent text-sm text-ink-800 outline-none placeholder:text-ink-400"
                  placeholder={t('editors.roadmap.placeholder', { quarter: label })}
                  value={content[key]}
                  onChange={(e) => set(key, e.target.value)}
                  readOnly={readOnly}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default RoadmapEditor