import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Plus, ArrowLeft, BarChart2, Sparkles, AlertTriangle,
  ChevronRight, Clock, Square, CheckSquare,
  X, ChevronDown, Trash2,
} from 'lucide-react'
import { plansApi, activitiesApi } from '../api/endpoints'
import { usePermission } from '../hooks'
import { ProgressBar, EmptyState } from '../components/ui'
import CreateActivityModal from '../components/activities/CreateActivityModal'
import LocalPlanChapters from '../components/activities/LocalPlanChapters'
import { SHORTCUT_CREATE_EVENT } from '../components/layout/AppShell'
import type { Plan, Activity, Phase, ActivityStatus, PlanStatus } from '../types'

const PHASES: Phase[] = ['P1', 'P2', 'P3']

const PHASE_META: Record<Phase, { color: string; bg: string; border: string }> = {
  P1: { color: 'text-p1-dark', bg: 'bg-p1-light', border: 'border-p1' },
  P2: { color: 'text-p2-dark', bg: 'bg-p2-light', border: 'border-p2' },
  P3: { color: 'text-p3-dark', bg: 'bg-p3-light', border: 'border-p3' },
}

const PLAN_STATUS_ORDER: PlanStatus[] = ['draft', 'active', 'review', 'completed', 'archived']

const PLAN_STATUS_DOT: Record<PlanStatus, string> = {
  draft:     'bg-ink-300',
  active:    'bg-p2',
  review:    'bg-p1',
  completed: 'bg-green-500',
  archived:  'bg-ink-400',
}

// ─── Plan status picker ─────────────────────────────────────────────────────
function PlanStatusPicker({
  status, onChange, loading, disabled,
}: {
  status: PlanStatus
  onChange: (s: PlanStatus) => void
  loading: boolean
  disabled: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  if (disabled) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-600">
        <span className={`size-2 rounded-full shrink-0 ${PLAN_STATUS_DOT[status]}`} />
        {t(`plan.status.${status}`)}
      </span>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 hover:bg-ink-50 transition-colors disabled:opacity-50"
      >
        <span className={`size-2 rounded-full shrink-0 ${PLAN_STATUS_DOT[status]}`} />
        {t(`plan.status.${status}`)}
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-ink-100 bg-white shadow-lg py-1">
            {PLAN_STATUS_ORDER.map((value) => (
              <button
                key={value}
                onClick={() => { onChange(value); setOpen(false) }}
                disabled={value === status}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-ink-700 hover:bg-ink-50 disabled:opacity-40 disabled:cursor-default"
              >
                <span className={`size-2 rounded-full shrink-0 ${PLAN_STATUS_DOT[value]}`} />
                {t(`plan.status.${value}`)}
              </button>
            ))}
          </div>
        </>
      )}
      {loading && <span className="ml-2 size-4 animate-spin rounded-full border-2 border-accent border-t-transparent inline-block align-middle" />}
    </div>
  )
}

const STATUS_ORDER: ActivityStatus[] = ['not_started', 'in_progress', 'review', 'complete']

const STATUS_DOT: Record<ActivityStatus, string> = {
  not_started: 'bg-ink-300',
  in_progress: 'bg-p2',
  review:      'bg-p1',
  complete:    'bg-green-500',
}

const STATUS_I18N_KEY: Record<ActivityStatus, string> = {
  not_started: 'not_started',
  in_progress: 'in_progress',
  review:      'under_review',
  complete:    'complete',
}

// ─── Bulk action bar ──────────────────────────────────────────────────────────
function ActivityBulkBar({
  count, onStatusChange, onDelete, onClear, loading,
}: {
  count: number
  onStatusChange: (s: ActivityStatus) => void
  onDelete: () => void
  onClear: () => void
  loading: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-accent-50 border border-accent-200 rounded-xl mb-3">
      <span className="text-sm font-semibold text-accent shrink-0">
        {t('planDetail.selectedCount', { count })}
      </span>

      {/* Status picker */}
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-ink-200 bg-white text-sm text-ink-700 hover:bg-ink-50 transition-colors disabled:opacity-50"
        >
          {t('planDetail.setStatus')} <ChevronDown className="size-3.5" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute left-0 z-20 mt-1 w-44 rounded-xl border border-ink-100 bg-white shadow-lg py-1">
              {STATUS_ORDER.map((value) => (
                <button
                  key={value}
                  onClick={() => { onStatusChange(value); setOpen(false) }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-ink-700 hover:bg-ink-50"
                >
                  <span className={`size-2 rounded-full shrink-0 ${STATUS_DOT[value]}`} />
                  {t(`activity.status.${STATUS_I18N_KEY[value]}`)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <button
        onClick={onDelete}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-white text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
      >
        <Trash2 className="size-3.5" /> {t('planDetail.deleteAll')}
      </button>

      {loading && <span className="size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />}
      <button onClick={onClear} className="ml-auto text-ink-400 hover:text-ink-700 transition-colors">
        <X className="size-4" />
      </button>
    </div>
  )
}

// ─── Activity row ─────────────────────────────────────────────────────────────
function ActivityRow({
  activity, selected, onSelect, onClick, onDelete, canEdit, canDelete,
}: {
  activity: Activity
  selected: boolean
  onSelect: () => void
  onClick: () => void
  onDelete: () => void
  canEdit: boolean
  canDelete: boolean
}) {
  const { t } = useTranslation()
  const overdue = activity.due_date && activity.status !== 'complete'
    && new Date(activity.due_date) < new Date()

  return (
    <div className={`group flex items-center gap-3 px-4 py-3 rounded-xl transition-colors ${
      selected ? 'bg-accent-50' : 'hover:bg-ink-50'
    }`}>
      {/* Checkbox */}
      {canEdit && (
        <button
          onClick={(e) => { e.stopPropagation(); onSelect() }}
          className="shrink-0 text-ink-300 hover:text-accent transition-colors"
        >
          {selected
            ? <CheckSquare className="size-4 text-accent" />
            : <Square className="size-4" />}
        </button>
      )}

      {/* Status dot */}
      <span className={`size-2 rounded-full shrink-0 ${STATUS_DOT[activity.status]}`} />

      {/* Main content — clickable */}
      <button className="flex-1 min-w-0 text-left" onClick={onClick}>
        <p className={`text-sm font-medium truncate transition-colors ${
          selected ? 'text-accent' : 'text-ink-800 group-hover:text-accent'
        }`}>{activity.title}</p>
        <p className="text-xs text-ink-400 mt-0.5">
          {t(`activityTypes.${activity.type}`)} · {t(`activity.status.${STATUS_I18N_KEY[activity.status]}`)}
        </p>
      </button>

      {overdue && (
        <span className="flex items-center gap-1 text-xs text-red-500 shrink-0">
          <AlertTriangle className="size-3" /> {t('planDetail.overdue')}
        </span>
      )}
      {activity.due_date && !overdue && (
        <span className="flex items-center gap-1 text-xs text-ink-400 shrink-0">
          <Clock className="size-3" />
          {new Date(activity.due_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        </span>
      )}
      {canDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="shrink-0 p-1 rounded-lg text-ink-300 opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50 transition-colors"
          title={t('planDetail.deleteActivityConfirm')}
        >
          <Trash2 className="size-4" />
        </button>
      )}
      <ChevronRight className="size-4 text-ink-200 group-hover:text-accent shrink-0 transition-colors" onClick={onClick} />
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PlanDetailPage() {
  const { planId } = useParams<{ planId: string }>()
  const navigate = useNavigate()
  const { can } = usePermission()
  const { t } = useTranslation()

  const [plan, setPlan] = useState<Plan | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [activePhase, setActivePhase] = useState<Phase>('P1')
  const [showCreate, setShowCreate] = useState(false)

  // ── Bulk selection (per-phase — clears when switching phase) ──────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)

  // ── Delete (single + bulk) ──────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<Activity | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)

  // ── Plan status ─────────────────────────────────────────────────────────
  const [planStatusLoading, setPlanStatusLoading] = useState(false)

  const load = async () => {
    if (!planId) return
    try {
      const [p, acts] = await Promise.all([plansApi.get(planId), activitiesApi.list(planId)])
      setPlan(p)
      setActivities(acts ?? [])
    } catch { } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [planId])

  // Clear selection when phase changes
  useEffect(() => { setSelected(new Set()) }, [activePhase])

  // 'c' keyboard shortcut opens the create activity modal (disabled for local plans)
  useEffect(() => {
    const handler = () => {
      if (plan?.plan_type === 'local') return
      setShowCreate(true)
    }
    window.addEventListener(SHORTCUT_CREATE_EVENT, handler)
    return () => window.removeEventListener(SHORTCUT_CREATE_EVENT, handler)
  }, [plan?.plan_type])


  const phaseActivities = useMemo(
    () => activities.filter((a) => a.phase === activePhase).sort((a, b) => a.user_order - b.user_order),
    [activities, activePhase],
  )

  const allPhaseSelected = phaseActivities.length > 0 && phaseActivities.every((a) => selected.has(a.id))
  const someSelected = selected.size > 0

  const toggleAll = () => {
    if (allPhaseSelected) setSelected(new Set())
    else setSelected(new Set(phaseActivities.map((a) => a.id)))
  }

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleBulkStatus = async (status: ActivityStatus) => {
    setBulkLoading(true)
    try {
      await Promise.all([...selected].map((id) => activitiesApi.update(id, { status })))
      setSelected(new Set())
      await load()
    } catch { } finally { setBulkLoading(false) }
  }

  const handleDeleteActivity = async (activity: Activity) => {
    setDeleteLoading(true)
    try {
      await activitiesApi.delete(activity.id)
      await load()
    } catch { } finally { setDeleteLoading(false); setDeleteTarget(null) }
  }

  const handleBulkDeleteActivities = async () => {
    setBulkLoading(true)
    try {
      await Promise.all([...selected].map((id) => activitiesApi.delete(id)))
      setSelected(new Set())
      setBulkDeleteConfirm(false)
      await load()
    } catch { } finally { setBulkLoading(false) }
  }

  const handlePlanStatusChange = async (status: PlanStatus) => {
    if (!planId) return
    setPlanStatusLoading(true)
    try {
      const updated = await plansApi.update(planId, { status })
      setPlan(updated)
    } catch { } finally { setPlanStatusLoading(false) }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="h-6 bg-ink-100 rounded-lg w-1/3 animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          {[1,2,3].map((i) => <div key={i} className="h-24 bg-ink-100 rounded-2xl animate-pulse" />)}
        </div>
        <div className="h-64 bg-ink-100 rounded-2xl animate-pulse" />
      </div>
    )
  }

  if (!plan) return null

  const phaseMeta = PHASE_META[activePhase]
  const activePhaseLabel = t(`plan.phases.${activePhase}`)
  const activePhaseDesc = t(`planDetail.phaseDesc.${activePhase}`)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Back + Header */}
      <div>
        <button onClick={() => navigate('/plans')} className="flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-700 mb-3 transition-colors">
          <ArrowLeft className="size-4" /> {t('planDetail.backToPlans')}
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink-900">{plan.title}</h1>
            {plan.description && <p className="text-ink-500 text-sm mt-0.5">{plan.description}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <PlanStatusPicker
              status={plan.status}
              onChange={handlePlanStatusChange}
              loading={planStatusLoading}
              disabled={!can.createPlan}
            />
            <button
              onClick={() => navigate(`/progress?plan=${plan.id}`)}
              className="flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50 transition-colors"
            >
              <BarChart2 className="size-4" /> {t('planDetail.progress')}
            </button>
            {can.createPlan && plan.plan_type !== 'local' && (
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
              >
                <Plus className="size-4" /> {t('planDetail.addActivity')}
              </button>
            )}
          </div>
        </div>
      </div>

      {plan.plan_type === 'local' ? (
        <LocalPlanChapters
          plan={plan}
          activities={activities}
          canEdit={can.editActivity}
          canDelete={can.createPlan}
          onChanged={load}
         onPlanUpdated={setPlan}
        />
      ) : (
        <>
          {/* Phase progress cards / tabs */}
          <div className="grid grid-cols-3 gap-4">
            {PHASES.map((phase) => {
              const phData = plan.progress?.phases?.find((p) => p.phase === phase)
              const meta = PHASE_META[phase]
              const phaseLabel = t(`plan.phases.${phase}`)
              const pct = phData?.percent_complete ?? 0
              return (
                <button
                  key={phase}
                  onClick={() => setActivePhase(phase)}
                  className={`text-left rounded-2xl border-2 p-4 transition-all ${
                    activePhase === phase ? `${meta.border} ${meta.bg}` : 'border-ink-100 bg-white hover:border-ink-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-bold uppercase tracking-wide ${activePhase === phase ? meta.color : 'text-ink-400'}`}>
                      {phase} · {phaseLabel}
                    </span>
                    <span className={`text-sm font-bold ${activePhase === phase ? meta.color : 'text-ink-600'}`}>
                      {Math.round(pct)}%
                    </span>
                  </div>
                  <ProgressBar value={pct} variant={phase.toLowerCase() as 'p1' | 'p2' | 'p3'} />
                  <div className="flex items-center gap-3 mt-2 text-xs text-ink-400">
                    <span>{phData?.complete ?? 0} {t('planDetail.done')}</span>
                    {phData && phData.overdue > 0 && (
                      <span className="text-red-500 flex items-center gap-0.5">
                        <AlertTriangle className="size-3" /> {phData.overdue}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Phase detail panel */}
          <div className="bg-white rounded-2xl border border-ink-100">
            {/* Panel header */}
            <div className={`flex items-center justify-between px-5 py-4 border-b border-opacity-30 ${phaseMeta.bg} rounded-t-2xl ${phaseMeta.border}`}>
              <div>
                <p className={`text-sm font-bold ${phaseMeta.color}`}>{activePhase} — {activePhaseLabel}</p>
                <p className="text-xs text-ink-500">{activePhaseDesc}</p>
              </div>
              <div className="flex items-center gap-3">
                {can.editActivity && phaseActivities.length > 0 && (
                  <button
                    onClick={toggleAll}
                    className="flex items-center gap-1.5 text-xs text-ink-400 hover:text-accent transition-colors"
                  >
                    {allPhaseSelected
                      ? <><CheckSquare className="size-3.5 text-accent" /> {t('planDetail.deselectAll')}</>
                      : <><Square className="size-3.5" /> {t('planDetail.selectAll')}</>}
                  </button>
                )}
                <span className="text-xs text-ink-400">
                  {t('planDetail.activitiesCount', { count: phaseActivities.length })}
                </span>
              </div>
            </div>

            <div className="p-3">
              {/* Bulk action bar — only shown when activities are selected */}
              {someSelected && (
                <ActivityBulkBar
                  count={selected.size}
                  loading={bulkLoading}
                  onStatusChange={handleBulkStatus}
                  onDelete={() => setBulkDeleteConfirm(true)}
                  onClear={() => setSelected(new Set())}
                />
              )}

              {phaseActivities.length === 0 ? (
                <EmptyState
                  icon={<Sparkles className="size-8" />}
                  title={t('planDetail.emptyPhaseTitle', { phase: activePhaseLabel.toLowerCase() })}
                  description={t('planDetail.emptyPhaseDesc', {
                    phase: activePhase,
                    examples: t(`planDetail.phaseExamples${activePhase}`),
                  })}
                  action={can.createPlan ? (
                    <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors">
                      <Plus className="size-4" /> {t('planDetail.addPhaseActivity', { phase: activePhase })}
                    </button>
                  ) : undefined}
                />
              ) : (
                <div className="divide-y divide-ink-50">
                  {phaseActivities.map((activity) => (
                    <ActivityRow
                      key={activity.id}
                      activity={activity}
                      selected={selected.has(activity.id)}
                      onSelect={() => toggleOne(activity.id)}
                      onClick={() => navigate(`/plans/${planId}/activities/${activity.id}`)}
                      onDelete={() => setDeleteTarget(activity)}
                      canEdit={can.editActivity}
                      canDelete={can.createPlan}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {showCreate && planId && plan.plan_type !== 'local' && (
        <CreateActivityModal
          planId={planId}
          plan={plan}
          defaultPhase={activePhase}
          onCreated={load}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* Single-delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white rounded-2xl border border-ink-100 shadow-xl p-6 space-y-4">
            <div className="size-12 rounded-full bg-red-100 flex items-center justify-center">
              <Trash2 className="size-5 text-red-600" />
            </div>
            <div>
              <h3 className="font-display font-bold text-ink-900">{t('planDetail.deleteActivityTitle')}</h3>
              <p className="text-sm text-ink-500 mt-1">
                {t('planDetail.deleteActivityDesc', { title: deleteTarget.title })}
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-xl border border-ink-200 px-4 py-2.5 text-sm font-semibold text-ink-700 hover:bg-ink-50 transition-colors">{t('common.cancel')}</button>
              <button onClick={() => handleDeleteActivity(deleteTarget)} disabled={deleteLoading} className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50">
                {deleteLoading ? t('planDetail.deleting') : t('planDetail.deleteActivityConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete confirm */}
      {bulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white rounded-2xl border border-ink-100 shadow-xl p-6 space-y-4">
            <div className="size-12 rounded-full bg-red-100 flex items-center justify-center">
              <Trash2 className="size-5 text-red-600" />
            </div>
            <div>
              <h3 className="font-display font-bold text-ink-900">{t('planDetail.deleteBulkActivitiesTitle', { count: selected.size })}</h3>
              <p className="text-sm text-ink-500 mt-1">{t('planDetail.deleteBulkActivitiesDesc')}</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setBulkDeleteConfirm(false)} className="flex-1 rounded-xl border border-ink-200 px-4 py-2.5 text-sm font-semibold text-ink-700 hover:bg-ink-50 transition-colors">{t('common.cancel')}</button>
              <button onClick={handleBulkDeleteActivities} disabled={bulkLoading} className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50">
                {bulkLoading ? t('planDetail.deleting') : t('planDetail.deleteBulkActivitiesConfirm', { count: selected.size })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}