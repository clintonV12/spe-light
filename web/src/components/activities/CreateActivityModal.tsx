import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, X } from 'lucide-react'
import { Button, Input, Select } from '../ui'
import { activitiesApi, pillarsApi } from '../../api/endpoints'
import { useToast } from '../../hooks'
import type { ActivityType, Plan, StrategicPillar, StrategicObjective, KPI, KPIPeriod } from '../../types'
import { KPI_PERIODS } from '../../types'
import { useAiDraft, AiAssistTrigger, AiAssistPanel, parseKpiDraft } from './AiChapterAssist'

// Labels come from t(`activityTypes.${value}`) — value stays the raw
// ActivityType id so the API contract and toastError etc are unaffected.
// Fixed set of 7 — the rest of the old international activity-type list
// either moved to its own dedicated chapter UI (vision_mission, swot,
// pestle, strategic_objectives) or was dropped as redundant with
// per-activity KPIs / ordinary objective activities (kpi_framework,
// action_items, and the remaining unlisted former types).
export const ADVANCED_RESEARCH_TYPES: { value: ActivityType }[] = [
  { value: 'business_model_canvas' },
  { value: 'competitive_analysis' },
  { value: 'risk_register' },
  { value: 'financial_projections' },
  { value: 'operational_roadmap' },
  { value: 'resource_plan' },
  { value: 'budget_allocation' },
]

// Ordinary (objective-nested) activities don't offer a type picker — the
// ESWAMCU "Implementation Framework" doesn't distinguish activity types the
// way the old P1/P2/P3 model did. Every such activity gets this fixed type
// so downstream code (e.g. ActivityCard's t(`activityTypes.${type}`)
// lookup) still has something to resolve; add an
// `activityTypes.strategic_action` locale key alongside the existing
// activityTypes.* ones.
const LOCAL_ACTIVITY_TYPE = 'strategic_action'

function emptyKPI(): KPI {
  return { indicator: '', target: '', target_value: undefined }
}

interface CreateActivityModalProps {
  planId: string
  /** Retained for callers that still pass it, unused now that there's only one plan shape. */
  plan?: Plan
  /** Which objective the modal was opened from, if any. Ignored when `advanced` is set. */
  defaultObjectiveId?: string
  /**
   * Opens the modal in Advanced Research mode: a type picker restricted to
   * ADVANCED_RESEARCH_TYPES, no pillar/objective picker, no KPIs — the
   * created activity is standalone (category: 'advanced_research'), not
   * nested under any objective.
   */
  advanced?: boolean
  onCreated: () => void
  onClose: () => void
}

export const CreateActivityModal: React.FC<CreateActivityModalProps> = ({
  planId,
  defaultObjectiveId,
  advanced = false,
  onCreated,
  onClose,
}) => {
  const { t } = useTranslation()
  const { success, error } = useToast()

  // ── Advanced Research-only state ────────────────────────────────────────
  const [advancedType, setAdvancedType] = useState<ActivityType>(ADVANCED_RESEARCH_TYPES[0].value)

  // ── Objective-nested-only state ─────────────────────────────────────────
  const [pillars, setPillars] = useState<StrategicPillar[]>([])
  const [objectives, setObjectives] = useState<StrategicObjective[]>([])
  const [pillarsLoading, setPillarsLoading] = useState(!advanced)
  const [pillarId, setPillarId] = useState<string>('')
  const [objectiveId, setObjectiveId] = useState<string>(defaultObjectiveId ?? '')
  // Budget/Responsibility/Measurement Period used to be one set of fields
  // for the whole activity, entered here below the KPI list. As of
  // migration 013 they live on each KPI instead (two KPIs on the same
  // activity can have different owners, costs, and reporting cadences), so
  // they're now collected inline per-row in the KPI list below rather than
  // as separate top-level state.
  const [kpis, setKpis] = useState<KPI[]>([emptyKPI()])

  // ── Shared state ─────────────────────────────────────────────────────
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (advanced) return
    let cancelled = false
    setPillarsLoading(true)
    Promise.all([pillarsApi.list(planId), pillarsApi.listObjectives(planId)])
      .then(([p, o]) => {
        if (cancelled) return
        setPillars(p)
        setObjectives(o)
        // Preselect: prefer the objective we were opened with, otherwise
        // the first pillar/objective in the plan.
        if (defaultObjectiveId) {
          const preselected = o.find((obj) => obj.id === defaultObjectiveId)
          if (preselected) {
            setPillarId(preselected.pillar_id)
            setObjectiveId(preselected.id)
            return
          }
        }
        if (p.length > 0) {
          setPillarId(p[0].id)
          const firstObjective = o.find((obj) => obj.pillar_id === p[0].id)
          if (firstObjective) setObjectiveId(firstObjective.id)
        }
      })
      .finally(() => { if (!cancelled) setPillarsLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advanced, planId])

  const objectivesForPillar = useMemo(
    () => objectives.filter((o) => o.pillar_id === pillarId),
    [objectives, pillarId],
  )

  const handlePillarChange = (id: string) => {
    setPillarId(id)
    const firstObjective = objectives.find((o) => o.pillar_id === id)
    setObjectiveId(firstObjective?.id ?? '')
  }

  const updateKpi = (index: number, field: keyof KPI, value: string) => {
    setKpis((prev) => prev.map((k, i) => (i === index ? { ...k, [field]: value } : k)))
  }
  const updateKpiTargetValue = (index: number, value: string) => {
    const num = value.trim() === '' ? undefined : Number(value)
    setKpis((prev) => prev.map((k, i) => (i === index ? { ...k, target_value: num } : k)))
  }
  const updateKpiBudget = (index: number, value: string) => {
    const num = value.trim() === '' ? undefined : Number(value)
    setKpis((prev) => prev.map((k, i) => (i === index ? { ...k, budget: num } : k)))
  }
  const updateKpiPeriod = (index: number, value: KPIPeriod | '') => {
    setKpis((prev) => prev.map((k, i) => (i === index ? { ...k, target_period: value || undefined } : k)))
  }
  const addKpi = () => setKpis((prev) => [...prev, emptyKPI()])
  const removeKpi = (index: number) => setKpis((prev) => prev.filter((_, i) => i !== index))

  // ── AI-suggested KPIs ───────────────────────────────────────────────────
  //
  // No activity_id yet — the activity doesn't exist until submit — so this
  // is grounded only in whatever the person has typed as keywords, same as
  // the plan-wide chapter drafts in LocalPlanChapters.tsx. Once the
  // activity exists, LocalActivityEditor's own "Suggest KPIs" passes
  // activity_id for a more grounded follow-up draft.
  const ai = useAiDraft(planId, 'local_activity_kpis')
  const acceptAiKpis = async (draft: Record<string, unknown>) => {
    // Throws if the draft didn't contain any usable KPIs — let that
    // propagate to useAiDraft.accept()'s catch so the person sees an error
    // instead of a false "applied" toast with nothing actually added.
    const suggested = parseKpiDraft(draft)
    // Drop any still-empty rows (e.g. the single blank row the form starts
    // with) so accepting suggestions doesn't leave blank cards behind them.
    setKpis((prev) => {
      const existing = prev.filter((k) => k.indicator.trim() || k.target.trim())
      return [...existing, ...suggested]
    })
  }

  const canSubmit = title.trim().length > 0 && (advanced || objectiveId.length > 0)

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    try {
      if (advanced) {
        await activitiesApi.create(planId, {
          category: 'advanced_research',
          type: advancedType,
          title: title.trim(),
          due_date: dueDate || undefined,
          content: {},
        })
      } else {
        const cleanedKpis = kpis
          .map((k) => ({
            indicator: k.indicator.trim(),
            target: k.target.trim(),
            target_value: k.target_value,
            budget: k.budget,
            responsibility: k.responsibility?.trim() || undefined,
            target_period: k.target_period || undefined,
          }))
          .filter((k) =>
            k.indicator || k.target || k.target_value !== undefined ||
            k.budget !== undefined || k.responsibility || k.target_period,
          )
        await activitiesApi.create(planId, {
          objective_id: objectiveId,
          type: LOCAL_ACTIVITY_TYPE,
          title: title.trim(),
          content: {},
          kpis: cleanedKpis,
        })
      }
      success(t('createActivityModal.created'))
      onCreated()
      onClose()
    } catch {
      error(t('createActivityModal.createFailed'))
    } finally {
      setLoading(false)
    }
  }

  const advancedTypeOptions = ADVANCED_RESEARCH_TYPES.map((tItem) => ({
    value: tItem.value,
    label: t(`activityTypes.${tItem.value}`),
  }))
  const pillarOptions = pillars.map((p) => ({ value: p.id, label: p.title }))
  const objectiveOptions = objectivesForPillar.map((o) => ({ value: o.id, label: o.title }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-bold text-ink-900">{t('createActivityModal.title')}</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700">
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4">
          {!advanced ? (
            <>
              {pillarsLoading ? (
                <p className="text-sm text-ink-400">{t('common.loading')}</p>
              ) : pillars.length === 0 ? (
                <p className="text-sm text-ink-500">
                  {t('createActivityModal.noPillarsYet', {
                    defaultValue: 'Add a Strategic Pillar and Objective to this plan before creating activities.',
                  })}
                </p>
              ) : (
                <>
                  <Select
                    label={t('createActivityModal.pillar', { defaultValue: 'Strategic Pillar' })}
                    options={pillarOptions}
                    value={pillarId}
                    onChange={(e) => handlePillarChange(e.target.value)}
                  />
                  <Select
                    label={t('createActivityModal.objective', { defaultValue: 'Strategic Objective (KPA)' })}
                    options={objectiveOptions}
                    value={objectiveId}
                    onChange={(e) => setObjectiveId(e.target.value)}
                  />
                </>
              )}

              <Input
                label={t('createActivityModal.titleLabel')}
                placeholder={t('createActivityModal.titlePlaceholder')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />

              {/* KPIs — the ESWAMCU table commonly lists more than one per activity */}
              <div>
                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <p className="text-sm font-medium text-ink-700">
                    {t('createActivityModal.kpis', { defaultValue: 'Key Performance Indicators' })}
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <AiAssistTrigger onClick={ai.start} label="Suggest KPIs" />
                    <button onClick={addKpi} className="flex items-center gap-1 text-xs text-accent hover:text-accent-600">
                      <Plus className="size-3.5" /> {t('common.add', { defaultValue: 'Add' })}
                    </button>
                  </div>
                </div>

                {ai.open && (
                  <AiAssistPanel
                    keywords={ai.keywords}
                    onKeywordsChange={ai.setKeywords}
                    onGenerate={ai.generate}
                    loading={ai.loading}
                    applying={ai.applying}
                    draft={ai.draft}
                    model={ai.model}
                    onRegenerate={ai.generate}
                    onClose={ai.close}
                    onAccept={() => ai.accept(acceptAiKpis)}
                  />
                )}

                <div className="space-y-3">
                  {kpis.map((k, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="flex-1 space-y-1.5 rounded-lg border border-ink-100 p-2.5">
                        <input
                          value={k.indicator}
                          onChange={(e) => updateKpi(i, 'indicator', e.target.value)}
                          placeholder={t('createActivityModal.kpiIndicator', { defaultValue: 'Indicator' })}
                          className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent"
                        />
                        <input
                          value={k.target}
                          onChange={(e) => updateKpi(i, 'target', e.target.value)}
                          placeholder={t('createActivityModal.kpiTarget', { defaultValue: 'Target' })}
                          className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent"
                        />
                        <input
                          type="number"
                          value={k.target_value ?? ''}
                          onChange={(e) => updateKpiTargetValue(i, e.target.value)}
                          placeholder={t('createActivityModal.kpiTargetValue', { defaultValue: 'Target value (number, for tracking)' })}
                          className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent"
                        />

                        {/* Implementation details — Budget / Responsibility /
                            Measurement Period for this specific KPI (moved off
                            the activity in migration 013; each KPI can have a
                            different owner, cost, and reporting cadence). */}
                        <div className="pt-1.5 mt-1.5 border-t border-ink-100 space-y-1.5">
                          <input
                            type="number"
                            value={k.budget ?? ''}
                            onChange={(e) => updateKpiBudget(i, e.target.value)}
                            placeholder={t('createActivityModal.kpiBudget', { defaultValue: 'Budget' })}
                            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent"
                          />
                          <input
                            value={k.responsibility ?? ''}
                            onChange={(e) => updateKpi(i, 'responsibility', e.target.value)}
                            placeholder={t('createActivityModal.kpiResponsibility', { defaultValue: 'Responsibility, e.g. Board / HR Committee' })}
                            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-accent"
                          />
                          <select
                            value={k.target_period ?? ''}
                            onChange={(e) => updateKpiPeriod(i, e.target.value as KPIPeriod | '')}
                            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 outline-none focus:border-accent"
                          >
                            <option value="">{t('createActivityModal.periodUnset', { defaultValue: 'No measurement period' })}</option>
                            {KPI_PERIODS.map((p) => (
                              <option key={p} value={p}>
                                {t(`createActivityModal.period.${p}`, { defaultValue: p.charAt(0).toUpperCase() + p.slice(1) })}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {kpis.length > 1 && (
                        <button
                          onClick={() => removeKpi(i)}
                          className="mt-2 text-ink-300 hover:text-red-500 transition-colors"
                          aria-label={t('common.remove', { defaultValue: 'Remove' })}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-ink-400 mt-1.5">
                  {t('createActivityModal.periodHint', {
                    defaultValue: 'Measurement Period is what the Tracking Module groups each KPI by — set it per-KPI since KPIs on the same activity can report on different cadences.',
                  })}
                </p>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-500">
                {t('createActivityModal.advancedIntro', {
                  defaultValue: 'Standalone research tools — optional, and not tied to any Strategic Pillar.',
                })}
              </p>

              <Select
                label={t('createActivityModal.activityType')}
                options={advancedTypeOptions}
                value={advancedType}
                onChange={(e) => setAdvancedType(e.target.value as ActivityType)}
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
            </>
          )}
        </div>

        <div className="flex gap-2 mt-6">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            className="flex-1"
            loading={loading}
            disabled={!canSubmit}
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