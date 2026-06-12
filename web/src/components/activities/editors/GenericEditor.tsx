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

export const GenericEditor: React.FC<GenericEditorProps> = ({ sections, value, onChange, readOnly }) => {
  const handleChange = (key: string, text: string) => {
    onChange({ ...value, [key]: text })
  }

  return (
    <div className="space-y-4">
      {sections.map(({ key, label, placeholder }) => (
        <div key={key}>
          <label className="block text-sm font-semibold text-ink-700 mb-1">{label}</label>
          <textarea
            className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-800 resize-none outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent min-h-24 placeholder:text-ink-400"
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
