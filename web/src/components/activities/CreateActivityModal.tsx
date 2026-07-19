import React, { useState } from 'react'
import { X } from 'lucide-react'
import { Button, Input, Select } from '../ui'
import { activitiesApi } from '../../api/endpoints'
import { useToast } from '../../hooks'
import type { Phase, ActivityType } from '../../types'

const PHASE_ACTIVITY_TYPES: Record<Phase, { value: ActivityType; label: string }[]> = {
  P1: [
    { value: 'swot', label: 'SWOT Analysis' },
    { value: 'pestle', label: 'PESTLE Analysis' },
    { value: 'business_model_canvas', label: 'Business Model Canvas' },
    { value: 'stakeholder_map', label: 'Stakeholder Map' },
    { value: 'competitive_analysis', label: 'Competitive Analysis' },
    { value: 'risk_register', label: 'Risk Register' },
    { value: 'market_analysis', label: 'Market Analysis' },
  ],
  P2: [
    { value: 'vision_mission', label: 'Vision & Mission' },
    { value: 'strategic_objectives', label: 'Strategic Objectives' },
    { value: 'kpi_framework', label: 'KPI Framework' },
    { value: 'okr_balanced_scorecard', label: 'OKR / Balanced Scorecard' },
    { value: 'theory_of_change', label: 'Theory of Change' },
    { value: 'value_proposition', label: 'Value Proposition' },
    { value: 'strategic_initiatives', label: 'Strategic Initiatives' },
  ],
  P3: [
    { value: 'financial_projections', label: 'Financial Projections' },
    { value: 'budget_allocation', label: 'Budget Allocation' },
    { value: 'operational_roadmap', label: 'Operational Roadmap' },
    { value: 'resource_plan', label: 'Resource Plan' },
    { value: 'action_items', label: 'Action Items & Tasks' },
    { value: 'implementation_timeline', label: 'Implementation Timeline' },
    { value: 'procurement_plan', label: 'Procurement Plan' },
  ],
}

interface CreateActivityModalProps {
  planId: string
  defaultPhase?: Phase
  onCreated: () => void
  onClose: () => void
}

export const CreateActivityModal: React.FC<CreateActivityModalProps> = ({
  planId,
  defaultPhase = 'P1',
  onCreated,
  onClose,
}) => {
  const [phase, setPhase] = useState<Phase>(defaultPhase)
  const [type, setType] = useState<ActivityType>(PHASE_ACTIVITY_TYPES[defaultPhase][0].value)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [loading, setLoading] = useState(false)
  const { success, error } = useToast()

  const handlePhaseChange = (p: Phase) => {
    setPhase(p)
    setType(PHASE_ACTIVITY_TYPES[p][0].value)
  }

  const handleSubmit = async () => {
    if (!title.trim()) return
    setLoading(true)
    try {
      await activitiesApi.create(planId, {
        phase,
        type,
        title: title.trim(),
        due_date: dueDate || undefined,
        content: {},
      })
      success('Activity created')
      onCreated()
      onClose()
    } catch {
      error('Failed to create activity')
    } finally {
      setLoading(false)
    }
  }

  const typeOptions = PHASE_ACTIVITY_TYPES[phase].map((t) => ({
    value: t.value,
    label: t.label,
  }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-bold text-ink-900">Add activity</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700">
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Phase selector */}
          <div>
            <p className="text-sm font-medium text-ink-700 mb-1.5">Phase</p>
            <div className="flex gap-2">
              {(['P1', 'P2', 'P3'] as Phase[]).map((p) => (
                <button
                  key={p}
                  onClick={() => handlePhaseChange(p)}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                    phase === p
                      ? p === 'P1' ? 'bg-p1-light text-p1-dark'
                        : p === 'P2' ? 'bg-p2-light text-p2-dark'
                        : 'bg-p3-light text-p3-dark'
                      : 'bg-ink-50 text-ink-500 hover:bg-ink-100'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <Select
            label="Activity type"
            options={typeOptions}
            value={type}
            onChange={(e) => setType(e.target.value as ActivityType)}
          />

          <Input
            label="Title"
            placeholder="Enter a title for this activity"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <Input
            label="Due date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>

        <div className="flex gap-2 mt-6">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            loading={loading}
            disabled={!title.trim()}
            onClick={handleSubmit}
          >
            Create activity
          </Button>
        </div>
      </div>
    </div>
  )
}

export default CreateActivityModal