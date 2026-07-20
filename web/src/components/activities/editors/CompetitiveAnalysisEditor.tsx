import React, { useState } from 'react'
import { Swords, Compass, Trophy, ArrowRight, ArrowDown } from 'lucide-react'
import { EditorBlock } from './EditorBlock'

export interface CompetitiveAnalysisContent {
  competitors: string
  positioning: string
  differentiators: string
}

interface CompetitiveAnalysisEditorProps {
  value: Partial<CompetitiveAnalysisContent>
  onChange: (value: CompetitiveAnalysisContent) => void
  readOnly?: boolean
}

const EMPTY: CompetitiveAnalysisContent = { competitors: '', positioning: '', differentiators: '' }

/**
 * A left-to-right analysis flow: who's out there → where the market sits →
 * what sets us apart. The arrows make the reasoning order explicit instead
 * of three textareas with no relationship to each other.
 */
export const CompetitiveAnalysisEditor: React.FC<CompetitiveAnalysisEditorProps> = ({ value, onChange, readOnly }) => {
  const [content, setContent] = useState<CompetitiveAnalysisContent>({ ...EMPTY, ...value })

  const set = (key: keyof CompetitiveAnalysisContent, text: string) => {
    const updated = { ...content, [key]: text }
    setContent(updated)
    onChange(updated)
  }

  return (
    <div className="grid grid-cols-1 items-stretch gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
      <EditorBlock
        icon={<Swords className="size-3.5" />}
        label="Key Competitors"
        colorClasses="border-ink-200 bg-ink-50"
        value={content.competitors}
        onChange={(v) => set('competitors', v)}
        readOnly={readOnly}
        placeholder="Who are we up against?"
        minHeight="min-h-32"
      />

      <div className="flex items-center justify-center text-ink-300">
        <ArrowRight className="hidden size-5 lg:block" />
        <ArrowDown className="size-5 lg:hidden" />
      </div>

      <EditorBlock
        icon={<Compass className="size-3.5" />}
        label="Market Positioning"
        colorClasses="border-p1 bg-p1-light"
        value={content.positioning}
        onChange={(v) => set('positioning', v)}
        readOnly={readOnly}
        placeholder="Where do we sit in the market relative to them?"
        minHeight="min-h-32"
      />

      <div className="flex items-center justify-center text-ink-300">
        <ArrowRight className="hidden size-5 lg:block" />
        <ArrowDown className="size-5 lg:hidden" />
      </div>

      <EditorBlock
        icon={<Trophy className="size-3.5" />}
        label="Our Differentiators"
        colorClasses="border-accent bg-accent-50"
        value={content.differentiators}
        onChange={(v) => set('differentiators', v)}
        readOnly={readOnly}
        placeholder="What sets us apart?"
        minHeight="min-h-32"
      />
    </div>
  )
}

export default CompetitiveAnalysisEditor