import React from 'react'

interface Section {
  key: string
  label: string
  placeholder?: string
}

interface GenericEditorProps {
  sections: Section[]
  value: Record<string, string>
  onChange: (value: Record<string, string>) => void
  readOnly?: boolean
}

// Cycles through the app's existing phase/accent palette so each section
// reads as a distinct card without introducing new colors.
const ACCENTS = [
  'border-l-p1',
  'border-l-p2',
  'border-l-p3',
  'border-l-accent',
]

export const GenericEditor: React.FC<GenericEditorProps> = ({ sections, value, onChange, readOnly }) => {
  const handleChange = (key: string, text: string) => {
    onChange({ ...value, [key]: text })
  }

  return (
    <div className="space-y-3">
      {sections.map(({ key, label, placeholder }, i) => (
        <div
          key={key}
          className={`rounded-xl border border-ink-100 border-l-4 bg-white p-4 transition-colors focus-within:border-accent-400 focus-within:ring-2 focus-within:ring-accent-400/30 ${ACCENTS[i % ACCENTS.length]}`}
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[10px] font-bold text-ink-500">
              {i + 1}
            </span>
            <label className="text-sm font-semibold text-ink-700">{label}</label>
          </div>
          <textarea
            className="min-h-24 w-full resize-none rounded-lg bg-ink-50/60 px-3 py-2.5 text-sm text-ink-800 outline-none placeholder:text-ink-400"
            placeholder={placeholder ?? `Enter ${label.toLowerCase()}…`}
            value={value[key] ?? ''}
            onChange={(e) => handleChange(key, e.target.value)}
            readOnly={readOnly}
          />
        </div>
      ))}
    </div>
  )
}

export default GenericEditor