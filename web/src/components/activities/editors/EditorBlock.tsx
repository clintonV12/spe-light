import React from 'react'

interface EditorBlockProps {
  icon: React.ReactNode
  label: string
  hint?: string
  colorClasses: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  readOnly?: boolean
  className?: string
  minHeight?: string
}

/**
 * Presentational card used by the canvas-style editors (Business Model
 * Canvas, PESTLE, Value Proposition, Stakeholder Map, Competitive Analysis).
 * Mirrors the look SwotEditor already established (colored quadrant card +
 * borderless textarea) so every framework editor feels like one family.
 */
export const EditorBlock: React.FC<EditorBlockProps> = ({
  icon, label, hint, colorClasses, value, onChange, placeholder, readOnly, className, minHeight = 'min-h-24',
}) => {
  return (
    <div className={`flex h-full flex-col rounded-xl border-2 p-3 transition-colors focus-within:ring-2 focus-within:ring-accent-400/50 ${colorClasses} ${className ?? ''}`}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="shrink-0 opacity-80">{icon}</span>
        <p className="text-xs font-bold uppercase tracking-wide text-ink-600">{label}</p>
      </div>
      {hint && <p className="mb-1.5 text-[11px] leading-snug text-ink-400">{hint}</p>}
      <textarea
        className={`w-full flex-1 resize-none bg-transparent text-sm text-ink-800 outline-none placeholder:text-ink-400 ${minHeight}`}
        placeholder={placeholder ?? `Enter ${label.toLowerCase()}…`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
      />
    </div>
  )
}

export default EditorBlock