import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown, ChevronRight, Plus, Trash2, Layers, Target, Clock,
} from 'lucide-react'
import { pillarsApi, activitiesApi } from '../../api/endpoints'
import { useToast } from '../../hooks'
import { EmptyState } from '../ui'
import CreateActivityModal from './CreateActivityModal'
import { useAiDraft, AiAssistTrigger, AiAssistPanel } from './AiChapterAssist'
import type { Plan, Activity, StrategicPillar, StrategicObjective, ActivityStatus } from '../../types'

const STATUS_DOT: Record<ActivityStatus, string> = {
  not_started: 'bg-ink-300',
  in_progress: 'bg-p2',
  review:      'bg-p1',
  complete:    'bg-green-500',
}

interface LocalPlanBoardProps {
  plan: Plan
  activities: Activity[]
  canEdit: boolean
  /** Mirrors PlanDetailPage's canDelete (can.createPlan) for parity with the international view's delete UI. */
  canDelete: boolean
  /** Re-fetches plan + activities (and, inside this component, pillars/objectives) */
  onChanged: () => void
}

// ─── Inline "add pillar" / "add objective" row ─────────────────────────────
function InlineAddRow({ placeholder, onSubmit, loading }: {
  placeholder: string
  onSubmit: (title: string) => void
  loading: boolean
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const submit = () => {
    if (!value.trim()) return
    onSubmit(value.trim())
    setValue('')
  }
  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        placeholder={placeholder}
        className="flex-1 rounded-lg border border-dashed border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-accent focus:border-solid"
      />
      <button
        onClick={submit}
        disabled={loading || !value.trim()}
        className="flex items-center gap-1 rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100 transition-colors disabled:opacity-50"
      >
        <Plus className="size-3.5" /> {t('common.add', { defaultValue: 'Add' })}
      </button>
    </div>
  )
}

export default function LocalPlanBoard({ plan, activities, canEdit, canDelete, onChanged }: LocalPlanBoardProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { success, error: toastError } = useToast()

  const [pillars, setPillars] = useState<StrategicPillar[]>([])
  const [objectives, setObjectives] = useState<StrategicObjective[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [addActivityFor, setAddActivityFor] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Activity | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const ai = useAiDraft(plan.id, 'local_pillars')

  const load = () => {
    setLoading(true)
    Promise.all([pillarsApi.list(plan.id), pillarsApi.listObjectives(plan.id)])
      .then(([p, o]) => {
        const pillarList = p ?? []
        const objectiveList = o ?? []
        setPillars(pillarList)
        setObjectives(objectiveList)
        // Default to the first pillar expanded so the board isn't empty-looking.
        if (pillarList.length > 0) {
          setExpanded((prev) => (prev.size === 0 ? new Set([pillarList[0].id]) : prev))
        }
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [plan.id])

  const activitiesByObjective = useMemo(() => {
    const map = new Map<string, Activity[]>()
    for (const a of activities) {
      if (!a.objective_id) continue
      const list = map.get(a.objective_id) ?? []
      list.push(a)
      map.set(a.objective_id, list)
    }
    return map
  }, [activities])

  const objectivesByPillar = useMemo(() => {
    const map = new Map<string, StrategicObjective[]>()
    for (const o of objectives) {
      const list = map.get(o.pillar_id) ?? []
      list.push(o)
      map.set(o.pillar_id, list)
    }
    return map
  }, [objectives])

  const togglePillar = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAddPillar = async (title: string) => {
    setBusy(true)
    try {
      await pillarsApi.create(plan.id, { title })
      success(t('localPlan.pillarAdded', { defaultValue: 'Pillar added' }))
      load()
    } catch {
      toastError(t('localPlan.pillarAddFailed', { defaultValue: 'Could not add pillar' }))
    } finally {
      setBusy(false)
    }
  }

  const handleAddObjective = async (pillarId: string, title: string) => {
    setBusy(true)
    try {
      await pillarsApi.createObjective(pillarId, { title })
      success(t('localPlan.objectiveAdded', { defaultValue: 'Objective added' }))
      load()
    } catch {
      toastError(t('localPlan.objectiveAddFailed', { defaultValue: 'Could not add objective' }))
    } finally {
      setBusy(false)
    }
  }

  const handleDeletePillar = async (pillarId: string) => {
    setBusy(true)
    try {
      await pillarsApi.delete(pillarId)
      success(t('localPlan.pillarDeleted', { defaultValue: 'Pillar deleted' }))
      load()
    } catch {
      toastError(t('localPlan.pillarDeleteFailed', {
        defaultValue: 'Could not delete pillar — remove its objectives first',
      }))
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteObjective = async (objectiveId: string) => {
    setBusy(true)
    try {
      await pillarsApi.deleteObjective(objectiveId)
      success(t('localPlan.objectiveDeleted', { defaultValue: 'Objective deleted' }))
      load()
    } catch {
      toastError(t('localPlan.objectiveDeleteFailed', {
        defaultValue: 'Could not delete objective — remove its activities first',
      }))
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteActivity = async (activity: Activity) => {
    setDeleteLoading(true)
    try {
      await activitiesApi.delete(activity.id)
      success(t('planDetail.deleteActivityConfirm', { defaultValue: 'Activity deleted' }))
      onChanged()
    } catch {
      toastError(t('localPlan.activityDeleteFailed', { defaultValue: 'Could not delete activity' }))
    } finally {
      setDeleteLoading(false)
      setDeleteTarget(null)
    }
  }

  const handleAiAcceptPillars = async (draft: Record<string, unknown>) => {
    const list = Array.isArray(draft.pillars) ? draft.pillars as unknown[] : []
    for (const raw of list) {
      if (typeof raw !== 'object' || raw === null) continue
      const row = raw as { title?: unknown; objectives?: unknown }
      const pillarTitle = typeof row.title === 'string' ? row.title.trim() : ''
      if (!pillarTitle) continue
      try {
        const pillar = await pillarsApi.create(plan.id, { title: pillarTitle })
        const objectiveTitles = Array.isArray(row.objectives)
          ? row.objectives.filter((o): o is string => typeof o === 'string')
          : []
        for (const objTitle of objectiveTitles) {
          const trimmed = objTitle.trim()
          if (!trimmed) continue
          try {
            await pillarsApi.createObjective(pillar.id, { title: trimmed })
          } catch {
            // best-effort — skip an objective that fails to save rather than aborting the rest
          }
        }
      } catch {
        // best-effort — skip a pillar that fails to save rather than aborting the rest
      }
    }
    load()
    onChanged()
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-ink-100 rounded-2xl animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-bold text-ink-900">Strategic Pillars</h3>
          <p className="text-xs text-ink-400">Pillars, their Strategic Objectives (KPAs), and the activities under each.</p>
        </div>
        {canEdit && <AiAssistTrigger onClick={ai.start} label="Suggest pillars & objectives" />}
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
          onAccept={() => ai.accept(handleAiAcceptPillars)}
        />
      )}

      {pillars.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-100 p-6">
          <EmptyState
            icon={<Layers className="size-8" />}
            title={t('localPlan.emptyTitle', { defaultValue: 'No Strategic Pillars yet' })}
            description={t('localPlan.emptyDesc', {
              defaultValue: 'Start by adding the Strategic Pillars for this plan (e.g. Leadership & Governance, Financial Stability).',
            })}
          />
          {canEdit && (
            <div className="mt-4 max-w-sm mx-auto">
              <InlineAddRow
                placeholder={t('localPlan.newPillarPlaceholder', { defaultValue: 'New Strategic Pillar name…' })}
                onSubmit={handleAddPillar}
                loading={busy}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          {pillars.map((pillar) => {
            const pillarObjectives = objectivesByPillar.get(pillar.id) ?? []
            const isOpen = expanded.has(pillar.id)
            return (
              <div key={pillar.id} className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
                <button
                  onClick={() => togglePillar(pillar.id)}
                  className="w-full flex items-center gap-2 px-5 py-4 hover:bg-ink-50 transition-colors text-left"
                >
                  {isOpen ? <ChevronDown className="size-4 text-ink-400 shrink-0" /> : <ChevronRight className="size-4 text-ink-400 shrink-0" />}
                  <Layers className="size-4 text-accent shrink-0" />
                  <span className="font-display font-bold text-sm text-ink-900 flex-1">{pillar.title}</span>
                  <span className="text-xs text-ink-400">
                    {t('localPlan.objectiveCount', { count: pillarObjectives.length, defaultValue: `${pillarObjectives.length} objectives` })}
                  </span>
                  {canEdit && (
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); handleDeletePillar(pillar.id) }}
                      className="text-ink-300 hover:text-red-500 transition-colors p-1"
                    >
                      <Trash2 className="size-3.5" />
                    </span>
                  )}
                </button>

                {isOpen && (
                  <div className="px-5 pb-4 space-y-3 border-t border-ink-50 pt-3">
                    {pillarObjectives.map((objective) => {
                      const objActivities = activitiesByObjective.get(objective.id) ?? []
                      return (
                        <div key={objective.id} className="rounded-xl border border-ink-100 p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Target className="size-3.5 text-p2 shrink-0" />
                            <p className="text-sm font-semibold text-ink-800 flex-1">{objective.title}</p>
                            {canEdit && (
                              <>
                                <button
                                  onClick={() => setAddActivityFor(objective.id)}
                                  className="flex items-center gap-1 text-xs text-accent hover:text-accent-600 transition-colors"
                                >
                                  <Plus className="size-3.5" /> {t('localPlan.addActivity', { defaultValue: 'Activity' })}
                                </button>
                                <button
                                  onClick={() => handleDeleteObjective(objective.id)}
                                  className="text-ink-300 hover:text-red-500 transition-colors"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </>
                            )}
                          </div>

                          {objActivities.length === 0 ? (
                            <p className="text-xs text-ink-300 italic pl-5">
                              {t('localPlan.noActivities', { defaultValue: 'No activities yet' })}
                            </p>
                          ) : (
                            <div className="divide-y divide-ink-50 pl-5">
                              {objActivities.map((a) => (
                                <div
                                  key={a.id}
                                  className="group w-full flex items-center gap-2 py-2 hover:bg-ink-50 -mx-2 px-2 rounded-lg transition-colors"
                                >
                                  <button
                                    onClick={() => navigate(`/plans/${plan.id}/activities/${a.id}`)}
                                    className="flex-1 min-w-0 flex items-center gap-2 text-left"
                                  >
                                    <span className={`size-2 rounded-full shrink-0 ${STATUS_DOT[a.status]}`} />
                                    <span className="flex-1 min-w-0 text-sm text-ink-700 truncate">{a.title}</span>
                                    {a.target_period && (
                                      <span className="flex items-center gap-1 text-[11px] text-ink-400 shrink-0">
                                        <Clock className="size-3" /> {a.target_period}
                                      </span>
                                    )}
                                    {typeof a.budget === 'number' && (
                                      <span className="text-[11px] text-ink-400 shrink-0">
                                        {a.budget.toLocaleString(undefined, { style: 'currency', currency: 'SZL', maximumFractionDigits: 0 })}
                                      </span>
                                    )}
                                  </button>
                                  {canDelete && (
                                    <button
                                      onClick={() => setDeleteTarget(a)}
                                      className="shrink-0 p-1 rounded-lg text-ink-300 opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50 transition-colors"
                                      title={t('planDetail.deleteActivityConfirm', { defaultValue: 'Delete activity' })}
                                    >
                                      <Trash2 className="size-3.5" />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {canEdit && (
                      <InlineAddRow
                        placeholder={t('localPlan.newObjectivePlaceholder', { defaultValue: 'New Strategic Objective (KPA)…' })}
                        onSubmit={(title) => handleAddObjective(pillar.id, title)}
                        loading={busy}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {canEdit && (
            <div className="bg-white rounded-2xl border border-ink-100 p-4">
              <InlineAddRow
                placeholder={t('localPlan.newPillarPlaceholder', { defaultValue: 'New Strategic Pillar name…' })}
                onSubmit={handleAddPillar}
                loading={busy}
              />
            </div>
          )}
        </>
      )}

      {addActivityFor && (
        <CreateActivityModal
          planId={plan.id}
          plan={plan}
          defaultObjectiveId={addActivityFor}
          onCreated={() => { load(); onChanged() }}
          onClose={() => setAddActivityFor(null)}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white rounded-2xl border border-ink-100 shadow-xl p-6 space-y-4">
            <div className="size-12 rounded-full bg-red-100 flex items-center justify-center">
              <Trash2 className="size-5 text-red-600" />
            </div>
            <div>
              <h3 className="font-display font-bold text-ink-900">
                {t('planDetail.deleteActivityTitle', { defaultValue: 'Delete activity?' })}
              </h3>
              <p className="text-sm text-ink-500 mt-1">
                {t('planDetail.deleteActivityDesc', { title: deleteTarget.title, defaultValue: `Delete "${deleteTarget.title}"? This cannot be undone.` })}
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-xl border border-ink-200 px-4 py-2.5 text-sm font-semibold text-ink-700 hover:bg-ink-50 transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleDeleteActivity(deleteTarget)}
                disabled={deleteLoading}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleteLoading ? t('planDetail.deleting', { defaultValue: 'Deleting…' }) : t('planDetail.deleteActivityConfirm', { defaultValue: 'Delete' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}