import React, { useState } from 'react'
import { Boxes, Zap, Package, TrendingUp, Sparkles, ArrowRight, ArrowDown } from 'lucide-react'
import { EditorBlock } from './EditorBlock'

export interface TheoryOfChangeContent {
  inputs: string
  activities: string
  outputs: string
  outcomes: string
  impact: string
}

interface TheoryOfChangeEditorProps {
  value: Partial<TheoryOfChangeContent>
  onChange: (value: TheoryOfChangeContent) => void
  readOnly?: boolean
}

const EMPTY: TheoryOfChangeContent = {
  inputs: '', activities: '', outputs: '', outcomes: '', impact: '',
}

const STEPS: { key: keyof TheoryOfChangeContent; label: string; hint: string; icon: React.ReactNode; color: string }[] = [
  { key: 'inputs', label: 'Inputs', hint: 'Resources invested', icon: <Boxes className="size-3.5" />, color: 'border-ink-200 bg-ink-50' },
  { key: 'activities', label: 'Activities', hint: 'What gets done', icon: <Zap className="size-3.5" />, color: 'border-p1 bg-p1-light' },
  { key: 'outputs', label: 'Outputs', hint: 'Direct deliverables', icon: <Package className="size-3.5" />, color: 'border-p2 bg-p2-light' },
  { key: 'outcomes', label: 'Outcomes', hint: 'Resulting change', icon: <TrendingUp className="size-3.5" />, color: 'border-p3 bg-p3-light' },
  { key: 'impact', label: 'Impact', hint: 'Long-term effect', icon: <Sparkles className="size-3.5" />, color: 'border-accent bg-accent-50' },
]

/** The standard Theory of Change logic chain: Inputs → Activities → Outputs → Outcomes → Impact. */
export const TheoryOfChangeEditor: React.FC<TheoryOfChangeEditorProps> = ({ value, onChange, readOnly }) => {
  const [content, setContent] = useState<TheoryOfChangeContent>({ ...EMPTY, ...value })

  const set = (key: keyof TheoryOfChangeContent, text: string) => {
    const updated = { ...content, [key]: text }
    setContent(updated)
    onChange(updated)
  }

  return (
    <div className="grid grid-cols-1 items-stretch gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr]">
      {STEPS.map((step, i) => (
        <React.Fragment key={step.key}>
          <EditorBlock
            icon={step.icon}
            label={step.label}
            hint={step.hint}
            colorClasses={step.color}
            value={content[step.key]}
            onChange={(v) => set(step.key, v)}
            readOnly={readOnly}
            minHeight="min-h-32"
          />
          {i < STEPS.length - 1 && (
            <div className="flex items-center justify-center text-ink-300">
              <ArrowRight className="hidden size-5 lg:block" />
              <ArrowDown className="size-5 lg:hidden" />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

export default TheoryOfChangeEditor