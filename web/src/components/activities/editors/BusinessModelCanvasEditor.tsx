import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Handshake, Zap, Boxes, Gem, Heart, Truck, Users, Receipt, DollarSign } from 'lucide-react'
import { EditorBlock } from './EditorBlock'

export interface BusinessModelCanvasContent {
  key_partners: string
  key_activities: string
  key_resources: string
  value_propositions: string
  customer_relationships: string
  channels: string
  customer_segments: string
  cost_structure: string
  revenue_streams: string
}

interface BusinessModelCanvasEditorProps {
  value: Partial<BusinessModelCanvasContent>
  onChange: (value: BusinessModelCanvasContent) => void
  readOnly?: boolean
}

const EMPTY: BusinessModelCanvasContent = {
  key_partners: '', key_activities: '', key_resources: '', value_propositions: '',
  customer_relationships: '', channels: '', customer_segments: '', cost_structure: '', revenue_streams: '',
}

/**
 * Classic Osterwalder Business Model Canvas — nine blocks arranged in their
 * standard positions (partners/activities/resources feeding the value
 * proposition, which feeds customer-facing blocks, with cost/revenue as the
 * foundation row) rather than a stack of generic textareas.
 */
export const BusinessModelCanvasEditor: React.FC<BusinessModelCanvasEditorProps> = ({ value, onChange, readOnly }) => {
  const { t } = useTranslation()
  const [content, setContent] = useState<BusinessModelCanvasContent>({ ...EMPTY, ...value })

  const set = (key: keyof BusinessModelCanvasContent, text: string) => {
    const updated = { ...content, [key]: text }
    setContent(updated)
    onChange(updated)
  }

  const block = (
    key: keyof BusinessModelCanvasContent,
    icon: React.ReactNode,
    label: string,
    colorClasses: string,
    gridClasses: string,
  ) => (
    <EditorBlock
      className={gridClasses}
      icon={icon}
      label={label}
      colorClasses={colorClasses}
      value={content[key]}
      onChange={(v) => set(key, v)}
      readOnly={readOnly}
      minHeight="min-h-20"
    />
  )

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-5">
        {block('key_partners', <Handshake className="size-3.5" />, t('editors.bmc.keyPartners'),
          'border-ink-200 bg-ink-50', 'lg:col-start-1 lg:row-start-1 lg:row-span-2')}

        {block('key_activities', <Zap className="size-3.5" />, t('editors.bmc.keyActivities'),
          'border-p1 bg-p1-light', 'lg:col-start-2 lg:row-start-1')}
        {block('key_resources', <Boxes className="size-3.5" />, t('editors.bmc.keyResources'),
          'border-p1 bg-p1-light', 'lg:col-start-2 lg:row-start-2')}

        {block('value_propositions', <Gem className="size-3.5" />, t('editors.bmc.valuePropositions'),
          'border-accent bg-accent-50', 'lg:col-start-3 lg:row-start-1 lg:row-span-2')}

        {block('customer_relationships', <Heart className="size-3.5" />, t('editors.bmc.customerRelationships'),
          'border-p2 bg-p2-light', 'lg:col-start-4 lg:row-start-1')}
        {block('channels', <Truck className="size-3.5" />, t('editors.bmc.channels'),
          'border-p2 bg-p2-light', 'lg:col-start-4 lg:row-start-2')}

        {block('customer_segments', <Users className="size-3.5" />, t('editors.bmc.customerSegments'),
          'border-p3 bg-p3-light', 'lg:col-start-5 lg:row-start-1 lg:row-span-2')}
      </div>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-5">
        {block('cost_structure', <Receipt className="size-3.5" />, t('editors.bmc.costStructure'),
          'border-red-200 bg-red-50', 'lg:col-start-1 lg:col-span-2')}
        {block('revenue_streams', <DollarSign className="size-3.5" />, t('editors.bmc.revenueStreams'),
          'border-green-200 bg-green-50', 'lg:col-start-3 lg:col-span-3')}
      </div>
    </div>
  )
}

export default BusinessModelCanvasEditor