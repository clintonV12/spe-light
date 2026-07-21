import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Plus, ArrowLeft, BarChart2, Sparkles, AlertTriangle,
  ChevronRight, Clock, Square, CheckSquare,
  X, ChevronDown,
} from 'lucide-react'
import { plansApi, activitiesApi } from '../api/endpoints'
import { usePermission } from '../hooks'
import { ProgressBar, EmptyState } from '../components/ui'
import CreateActivityModal from '../components/activities/CreateActivityModal'
import { SHORTCUT_CREATE_EVENT } from '../components/layout/AppShell'
import type { Plan, Activity, Phase, ActivityStatus, PlanStatus } from '../types'

const PHASES: Phase[] = ['P1', 'P2', 'P3']

const PHASE_META: Record<Phase, { label: string; desc: string; color: string; bg: string; border: string }> = {
  P1: { label: 'Analysis',    desc: 'Understand the current state', color: 'text-p1-dark', bg: 'bg-p1-light', border: 'border-p1' },
  P2: { label: 'Strategy',    desc: 'Define the desired future',    color: 'text-p2-dark', bg: 'bg-p2-light', border: 'border-p2' },
  P3: { label: 'Operations',  desc: 'Plan how to get there',        color: 'text-p3-dark', bg: 'bg-p3-light', border: 'border-p3' },
}

const PLAN_STATUS_OPTIONS: { value: PlanStatus; label: string }[] = [
  { value: 'draft',     label: 'Draft' },
  { value: 'active',    label: 'Active' },
  { value: 'review',    label: 'Review' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived',  label: 'Archived' },
]

const PLAN_STATUS_DOT: Record<PlanStatus, string> = {
  draft:     'bg-ink-300',
  active:    'bg-p2',
  review:    'bg-p1',
  completed: 'bg-green-500',
  archived:  'bg-ink-400',
}

const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  draft:     'Draft',
  active:    'Active',
  review:    'Review',
  completed: 'Completed',
  archived:  'Archived',
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
  const [open, setOpen] = useState(false)

  if (disabled) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-600">
        <span className={`size-2 rounded-full shrink-0 ${PLAN_STATUS_DOT[status]}`} />
        {PLAN_STATUS_LABEL[status]}
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
        {PLAN_STATUS_LABEL[status]}
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-ink-100 bg-white shadow-lg py-1">
            {PLAN_STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => { onChange(o.value); setOpen(false) }}
                disabled={o.value === status}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-ink-700 hover:bg-ink-50 disabled:opacity-40 disabled:cursor-default"
              >
                <span className={`size-2 rounded-full shrink-0 ${PLAN_STATUS_DOT[o.value]}`} />
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
      {loading && <span className="ml-2 size-4 animate-spin rounded-full border-2 border-accent border-t-transparent inline-block align-middle" />}
    </div>
  )
}

const STATUS_OPTIONS: { value: ActivityStatus; label: string }[] = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  // Value was 'under_review' — the backend's models.go ActivityStatus enum
  // only ever defined "review", so every bulk-status-update using this
  // picker (handleBulkStatus below) was sending a value the backend
  // couldn't validate/match. See ActivityEditorPage.tsx for the same fix.
  { value: 'review', label: 'Under review' },
  { value: 'complete', label: 'Complete' },
]

const STATUS_DOT: Record<ActivityStatus, string> = {
  not_started: 'bg-ink-300',
  in_progress: 'bg-p2',
  review:      'bg-p1',
  complete:    'bg-green-500',
}

const STATUS_LABEL: Record<ActivityStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  review:      'Under review',
  complete:    'Complete',
}

// ─── Bulk action bar ──────────────────────────────────────────────────────────
function ActivityBulkBar({
  count, onStatusChange, onClear, loading,
}: {
  count: number
  onStatusChange: (s: ActivityStatus) => void
  onClear: () => void
  loading: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-accent-50 border border-accent-200 rounded-xl mb-3">
      <span className="text-sm font-semibold text-accent shrink-0">
        {count} selected
      </span>

      {/* Status picker */}
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-ink-200 bg-white text-sm text-ink-700 hover:bg-ink-50 transition-colors disabled:opacity-50"
        >
          Set status <ChevronDown className="size-3.5" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute left-0 z-20 mt-1 w-44 rounded-xl border border-ink-100 bg-white shadow-lg py-1">
              {STATUS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => { onStatusChange(o.value); setOpen(false) }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-ink-700 hover:bg-ink-50"
                >
                  <span className={`size-2 rounded-full shrink-0 ${STATUS_DOT[o.value]}`} />
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {loading && <span className="size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />}
      <button onClick={onClear} className="ml-auto text-ink-400 hover:text-ink-700 transition-colors">
        <X className="size-4" />
      </button>
    </div>
  )
}

// ─── Activity row ─────────────────────────────────────────────────────────────
function ActivityRow({
  activity, selected, onSelect, onClick, canEdit,
}: {
  activity: Activity
  selected: boolean
  onSelect: () => void
  onClick: () => void
  canEdit: boolean
}) {
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
        <p className="text-xs text-ink-400 mt-0.5 capitalize">
          {activity.type.replace(/_/g, ' ')} · {STATUS_LABEL[activity.status]}
        </p>
      </button>

      {overdue && (
        <span className="flex items-center gap-1 text-xs text-red-500 shrink-0">
          <AlertTriangle className="size-3" /> Overdue
        </span>
      )}
      {activity.due_date && !overdue && (
        <span className="flex items-center gap-1 text-xs text-ink-400 shrink-0">
          <Clock className="size-3" />
          {new Date(activity.due_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        </span>
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

  const [plan, setPlan] = useState<Plan | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [activePhase, setActivePhase] = useState<Phase>('P1')
  const [showCreate, setShowCreate] = useState(false)

  // ── Bulk selection (per-phase — clears when switching phase) ──────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)

  // ── Plan status ─────────────────────────────────────────────────────────
  const [planStatusLoading, setPlanStatusLoading] = useState(false)

  const load = async () => {
    if (!planId) return
    try {
      const [p, acts] = await Promise.all([plansApi.get(planId), activitiesApi.list(planId)])
      setPlan(p)
      setActivities(acts)
    } catch { } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [planId])

  // Clear selection when phase changes
  useEffect(() => { setSelected(new Set()) }, [activePhase])

  // 'c' keyboard shortcut opens the create activity modal
  useEffect(() => {
    const handler = () => setShowCreate(true)
    window.addEventListener(SHORTCUT_CREATE_EVENT, handler)
    return () => window.removeEventListener(SHORTCUT_CREATE_EVENT, handler)
  }, [])


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

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Back + Header */}
      <div>
        <button onClick={() => navigate('/plans')} className="flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-700 mb-3 transition-colors">
          <ArrowLeft className="size-4" /> Plans
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
              <BarChart2 className="size-4" /> Progress
            </button>
            {can.createPlan && (
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
              >
                <Plus className="size-4" /> Add activity
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Phase progress cards / tabs */}
      <div className="grid grid-cols-3 gap-4">
        {PHASES.map((phase) => {
          const phData = plan.progress?.phases.find((p) => p.phase === phase)
          const meta = PHASE_META[phase]
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
                  {phase} · {meta.label}
                </span>
                <span className={`text-sm font-bold ${activePhase === phase ? meta.color : 'text-ink-600'}`}>
                  {Math.round(pct)}%
                </span>
              </div>
              <ProgressBar value={pct} variant={phase.toLowerCase() as 'p1' | 'p2' | 'p3'} />
              <div className="flex items-center gap-3 mt-2 text-xs text-ink-400">
                <span>{phData?.complete ?? 0} done</span>
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
            <p className={`text-sm font-bold ${phaseMeta.color}`}>{activePhase} — {phaseMeta.label}</p>
            <p className="text-xs text-ink-500">{phaseMeta.desc}</p>
          </div>
          <div className="flex items-center gap-3">
            {can.editActivity && phaseActivities.length > 0 && (
              <button
                onClick={toggleAll}
                className="flex items-center gap-1.5 text-xs text-ink-400 hover:text-accent transition-colors"
              >
                {allPhaseSelected
                  ? <><CheckSquare className="size-3.5 text-accent" /> Deselect all</>
                  : <><Square className="size-3.5" /> Select all</>}
              </button>
            )}
            <span className="text-xs text-ink-400">
              {phaseActivities.length} {phaseActivities.length === 1 ? 'activity' : 'activities'}
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
              onClear={() => setSelected(new Set())}
            />
          )}

          {phaseActivities.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="size-8" />}
              title={`No ${phaseMeta.label.toLowerCase()} activities yet`}
              description={`Add a ${activePhase} activity like a ${activePhase === 'P1' ? 'SWOT or PESTLE' : activePhase === 'P2' ? 'Vision statement or KPI framework' : 'Roadmap or Action plan'} to get started.`}
              action={can.createPlan ? (
                <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors">
                  <Plus className="size-4" /> Add {activePhase} activity
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
                  canEdit={can.editActivity}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreate && planId && (
        <CreateActivityModal
          planId={planId}
          defaultPhase={activePhase}
          onCreated={load}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  )
}