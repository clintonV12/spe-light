import React, { useState } from 'react'
import { Users, AlertCircle, Lightbulb, Award, ArrowLeftRight } from 'lucide-react'
import { EditorBlock } from './EditorBlock'

export interface ValuePropositionContent {
  customer: string
  problem: string
  solution: string
  differentiator: string
}

interface ValuePropositionEditorProps {
  value: Partial<ValuePropositionContent>
  onChange: (value: ValuePropositionContent) => void
  readOnly?: boolean
}

const EMPTY: ValuePropositionContent = {
  customer: '', problem: '', solution: '', differentiator: '',
}

/**
 * Two-sided canvas: the customer's world on the left, our value map on the
 * right, meeting in the middle — the visual point of a value proposition
 * canvas (does the solution actually fit the customer?) rather than four
 * unrelated textareas.
 */
export const ValuePropositionEditor: React.FC<ValuePropositionEditorProps> = ({ value, onChange, readOnly }) => {
  const [content, setContent] = useState<ValuePropositionContent>({ ...EMPTY, ...value })

  const set = (key: keyof ValuePropositionContent, text: string) => {
    const updated = { ...content, [key]: text }
    setContent(updated)
    onChange(updated)
  }

  return (
    <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr]">
      {/* Customer side */}
      <div className="space-y-3 rounded-2xl border-2 border-p3 bg-p3-light/40 p-3">
        <p className="text-center text-xs font-bold uppercase tracking-wide text-p3-dark">Customer</p>
        <EditorBlock
          icon={<Users className="size-3.5" />}
          label="Who they are"
          colorClasses="border-p3/60 bg-white"
          value={content.customer}
          onChange={(v) => set('customer', v)}
          readOnly={readOnly}
          placeholder="Describe the target customer…"
        />
        <EditorBlock
          icon={<AlertCircle className="size-3.5" />}
          label="Problem they face"
          colorClasses="border-p3/60 bg-white"
          value={content.problem}
          onChange={(v) => set('problem', v)}
          readOnly={readOnly}
          placeholder="What pain or unmet need drives them?"
        />
      </div>

      {/* Fit connector — hidden on mobile, shown between the two panels on larger screens */}
      <div className="hidden items-center justify-center lg:flex">
        <div className="flex flex-col items-center gap-1 text-accent">
          <ArrowLeftRight className="size-5" />
          <span className="text-[10px] font-bold uppercase tracking-wide">Fit</span>
        </div>
      </div>

      {/* Our solution side */}
      <div className="space-y-3 rounded-2xl border-2 border-accent bg-accent-50/60 p-3">
        <p className="text-center text-xs font-bold uppercase tracking-wide text-accent">Our Solution</p>
        <EditorBlock
          icon={<Lightbulb className="size-3.5" />}
          label="What we offer"
          colorClasses="border-accent/60 bg-white"
          value={content.solution}
          onChange={(v) => set('solution', v)}
          readOnly={readOnly}
          placeholder="Describe the product or service…"
        />
        <EditorBlock
          icon={<Award className="size-3.5" />}
          label="Why us"
          colorClasses="border-accent/60 bg-white"
          value={content.differentiator}
          onChange={(v) => set('differentiator', v)}
          readOnly={readOnly}
          placeholder="What makes this better than the alternatives?"
        />
      </div>
    </div>
  )
}

export default ValuePropositionEditor