import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button, Input, Select } from '../ui'
import { activitiesApi } from '../../api/endpoints'
import { useToast } from '../../hooks'
import type { Phase, ActivityType } from '../../types'

// Labels come from t(`activityTypes.${value}`) — value stays the raw
// ActivityType id so the API contract and toastError etc are unaffected.
const PHASE_ACTIVITY_TYPES: Record<Phase, { value: ActivityType }[]> = {
  P1: [
    { value: 'swot' },
    { value: 'pestle' },
    { value: 'business_model_canvas' },
    { value: 'stakeholder_map' },
    { value: 'competitive_analysis' },
    { value: 'risk_register' },
    { value: 'market_analysis' },
  ],
  P2: [
    { value: 'vision_mission' },
    { value: 'strategic_objectives' },
    { value: 'kpi_framework' },
    { value: 'okr_balanced_scorecard' },
    { value: 'theory_of_change' },
    { value: 'value_proposition' },
    { value: 'strategic_initiatives' },
  ],
  P3: [
    { value: 'financial_projections' },
    { value: 'budget_allocation' },
    { value: 'operational_roadmap' },
    { value: 'resource_plan' },
    { value: 'action_items' },
    { value: 'implementation_timeline' },
    { value: 'procurement_plan' },
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
  const { t } = useTranslation()
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
      success(t('createActivityModal.created'))
      onCreated()
      onClose()
    } catch {
      error(t('createActivityModal.createFailed'))
    } finally {
      setLoading(false)
    }
  }

  const typeOptions = PHASE_ACTIVITY_TYPES[phase].map((tItem) => ({
    value: tItem.value,
    label: t(`activityTypes.${tItem.value}`),
  }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-bold text-ink-900">{t('createActivityModal.title')}</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700">
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Phase selector */}
          <div>
            <p className="text-sm font-medium text-ink-700 mb-1.5">{t('createActivityModal.phase')}</p>
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
            label={t('createActivityModal.activityType')}
            options={typeOptions}
            value={type}
            onChange={(e) => setType(e.target.value as ActivityType)}
          />

          <Input
            label={t('createActivityModal.titleLabel')}
            placeholder={t('createActivityModal.titlePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <Input
            label={t('createActivityModal.dueDate')}
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>

        <div className="flex gap-2 mt-6">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            className="flex-1"
            loading={loading}
            disabled={!title.trim()}
            onClick={handleSubmit}
          >
            {t('createActivityModal.submit')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default CreateActivityModal