import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
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

const STEPS: { key: keyof TheoryOfChangeContent; labelKey: string; hintKey: string; icon: React.ReactNode; color: string }[] = [
  { key: 'inputs', labelKey: 'editors.theoryOfChange.inputs', hintKey: 'editors.theoryOfChange.inputsHint', icon: <Boxes className="size-3.5" />, color: 'border-ink-200 bg-ink-50' },
  { key: 'activities', labelKey: 'editors.theoryOfChange.activities', hintKey: 'editors.theoryOfChange.activitiesHint', icon: <Zap className="size-3.5" />, color: 'border-p1 bg-p1-light' },
  { key: 'outputs', labelKey: 'editors.theoryOfChange.outputs', hintKey: 'editors.theoryOfChange.outputsHint', icon: <Package className="size-3.5" />, color: 'border-p2 bg-p2-light' },
  { key: 'outcomes', labelKey: 'editors.theoryOfChange.outcomes', hintKey: 'editors.theoryOfChange.outcomesHint', icon: <TrendingUp className="size-3.5" />, color: 'border-p3 bg-p3-light' },
  { key: 'impact', labelKey: 'editors.theoryOfChange.impact', hintKey: 'editors.theoryOfChange.impactHint', icon: <Sparkles className="size-3.5" />, color: 'border-accent bg-accent-50' },
]

/** The standard Theory of Change logic chain: Inputs → Activities → Outputs → Outcomes → Impact. */
export const TheoryOfChangeEditor: React.FC<TheoryOfChangeEditorProps> = ({ value, onChange, readOnly }) => {
  const { t } = useTranslation()
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
            label={t(step.labelKey)}
            hint={t(step.hintKey)}
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