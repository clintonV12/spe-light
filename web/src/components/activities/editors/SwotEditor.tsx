import React, { useState } from 'react'

interface SwotContent {
  strengths: string
  weaknesses: string
  opportunities: string
  threats: string
}

interface SwotEditorProps {
  value: Partial<SwotContent>
  onChange: (value: SwotContent) => void
  readOnly?: boolean
}

const quadrants: { key: keyof SwotContent; label: string; color: string }[] = [
  { key: 'strengths',     label: 'Strengths',     color: 'border-p2 bg-p2-light' },
  { key: 'weaknesses',    label: 'Weaknesses',     color: 'border-red-300 bg-red-50' },
  { key: 'opportunities', label: 'Opportunities',  color: 'border-p1 bg-p1-light' },
  { key: 'threats',       label: 'Threats',        color: 'border-p3 bg-p3-light' },
]

export const SwotEditor: React.FC<SwotEditorProps> = ({ value, onChange, readOnly }) => {
  const [content, setContent] = useState<SwotContent>({
    strengths: value.strengths ?? '',
    weaknesses: value.weaknesses ?? '',
    opportunities: value.opportunities ?? '',
    threats: value.threats ?? '',
  })

  const handleChange = (key: keyof SwotContent, text: string) => {
    const updated = { ...content, [key]: text }
    setContent(updated)
    onChange(updated)
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {quadrants.map(({ key, label, color }) => (
        <div key={key} className={`rounded-xl border-2 p-3 ${color}`}>
          <p className="text-xs font-bold uppercase tracking-wide text-ink-600 mb-2">{label}</p>
          <textarea
            className="w-full bg-transparent text-sm text-ink-800 resize-none outline-none min-h-28 placeholder:text-ink-400"
            placeholder={`Enter ${label.toLowerCase()}…`}
            value={content[key]}
            onChange={(e) => handleChange(key, e.target.value)}
            readOnly={readOnly}
          />
        </div>
      ))}
    </div>
  )
}

export default SwotEditor
