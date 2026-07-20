import React, { useState } from 'react'
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

const FACTORS: { key: keyof PestleContent; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'political', label: 'Political', icon: <Landmark className="size-3.5" />, color: 'border-blue-200 bg-blue-50' },
  { key: 'economic', label: 'Economic', icon: <TrendingUp className="size-3.5" />, color: 'border-emerald-200 bg-emerald-50' },
  { key: 'social', label: 'Social', icon: <Users className="size-3.5" />, color: 'border-violet-200 bg-violet-50' },
  { key: 'technological', label: 'Technological', icon: <Cpu className="size-3.5" />, color: 'border-cyan-200 bg-cyan-50' },
  { key: 'legal', label: 'Legal', icon: <Scale className="size-3.5" />, color: 'border-amber-200 bg-amber-50' },
  { key: 'environmental', label: 'Environmental', icon: <Leaf className="size-3.5" />, color: 'border-teal-200 bg-teal-50' },
]

/** Six-factor PESTLE grid — one colored, icon-labelled card per factor. */
export const PestleEditor: React.FC<PestleEditorProps> = ({ value, onChange, readOnly }) => {
  const [content, setContent] = useState<PestleContent>({ ...EMPTY, ...value })

  const set = (key: keyof PestleContent, text: string) => {
    const updated = { ...content, [key]: text }
    setContent(updated)
    onChange(updated)
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {FACTORS.map(({ key, label, icon, color }) => (
        <EditorBlock
          key={key}
          icon={icon}
          label={label}
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