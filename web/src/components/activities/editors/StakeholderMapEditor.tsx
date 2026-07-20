import React, { useState } from 'react'
import { Building2, Globe2, Compass } from 'lucide-react'
import { EditorBlock } from './EditorBlock'

export interface StakeholderMapContent {
  internal: string
  external: string
  strategy: string
}

interface StakeholderMapEditorProps {
  value: Partial<StakeholderMapContent>
  onChange: (value: StakeholderMapContent) => void
  readOnly?: boolean
}

const EMPTY: StakeholderMapContent = { internal: '', external: '', strategy: '' }

/** Internal / external stakeholders side by side, engagement strategy anchored below both. */
export const StakeholderMapEditor: React.FC<StakeholderMapEditorProps> = ({ value, onChange, readOnly }) => {
  const [content, setContent] = useState<StakeholderMapContent>({ ...EMPTY, ...value })

  const set = (key: keyof StakeholderMapContent, text: string) => {
    const updated = { ...content, [key]: text }
    setContent(updated)
    onChange(updated)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <EditorBlock
          icon={<Building2 className="size-3.5" />}
          label="Internal Stakeholders"
          hint="Teams, leadership, and functions inside the organisation."
          colorClasses="border-p2 bg-p2-light"
          value={content.internal}
          onChange={(v) => set('internal', v)}
          readOnly={readOnly}
          minHeight="min-h-32"
        />
        <EditorBlock
          icon={<Globe2 className="size-3.5" />}
          label="External Stakeholders"
          hint="Customers, partners, regulators, and others outside the organisation."
          colorClasses="border-p3 bg-p3-light"
          value={content.external}
          onChange={(v) => set('external', v)}
          readOnly={readOnly}
          minHeight="min-h-32"
        />
      </div>
      <EditorBlock
        icon={<Compass className="size-3.5" />}
        label="Engagement Strategy"
        hint="How each group will be informed, consulted, or involved."
        colorClasses="border-accent bg-accent-50"
        value={content.strategy}
        onChange={(v) => set('strategy', v)}
        readOnly={readOnly}
        minHeight="min-h-20"
      />
    </div>
  )
}

export default StakeholderMapEditor