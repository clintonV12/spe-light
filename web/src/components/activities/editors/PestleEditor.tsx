import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Landmark, TrendingUp, Users, Cpu, Scale, Leaf } from 'lucide-react'
import { EditorBlock } from './EditorBlock'

export interface PestleContent {
  political: string
  economic: string
  social: string
  technological: string
  legal: string
  environmental: string
}

interface PestleEditorProps {
  value: Partial<PestleContent>
  onChange: (value: PestleContent) => void
  readOnly?: boolean
}

const EMPTY: PestleContent = {
  political: '', economic: '', social: '', technological: '', legal: '', environmental: '',
}

// Reuses the activityEditor.sections.* labels — the same PESTLE factor
// names already translated for the generic activity editor sections.
const FACTORS: { key: keyof PestleContent; labelKey: string; icon: React.ReactNode; color: string }[] = [
  { key: 'political', labelKey: 'activityEditor.sections.political', icon: <Landmark className="size-3.5" />, color: 'border-blue-200 bg-blue-50' },
  { key: 'economic', labelKey: 'activityEditor.sections.economic', icon: <TrendingUp className="size-3.5" />, color: 'border-emerald-200 bg-emerald-50' },
  { key: 'social', labelKey: 'activityEditor.sections.social', icon: <Users className="size-3.5" />, color: 'border-violet-200 bg-violet-50' },
  { key: 'technological', labelKey: 'activityEditor.sections.technological', icon: <Cpu className="size-3.5" />, color: 'border-cyan-200 bg-cyan-50' },
  { key: 'legal', labelKey: 'activityEditor.sections.legal', icon: <Scale className="size-3.5" />, color: 'border-amber-200 bg-amber-50' },
  { key: 'environmental', labelKey: 'activityEditor.sections.environmental', icon: <Leaf className="size-3.5" />, color: 'border-teal-200 bg-teal-50' },
]

/** Six-factor PESTLE grid — one colored, icon-labelled card per factor. */
export const PestleEditor: React.FC<PestleEditorProps> = ({ value, onChange, readOnly }) => {
  const { t } = useTranslation()
  const [content, setContent] = useState<PestleContent>({ ...EMPTY, ...value })

  const set = (key: keyof PestleContent, text: string) => {
    const updated = { ...content, [key]: text }
    setContent(updated)
    onChange(updated)
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {FACTORS.map(({ key, labelKey, icon, color }) => (
        <EditorBlock
          key={key}
          icon={icon}
          label={t(labelKey)}
          colorClasses={color}
          value={content[key]}
          onChange={(v) => set(key, v)}
          readOnly={readOnly}
        />
      ))}
    </div>
  )
}

export default PestleEditor