import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Plus, ArrowLeft, BarChart2, Sparkles, AlertTriangle,
  ChevronRight, Clock, CheckCircle2,
} from 'lucide-react'
import { plansApi, activitiesApi } from '../api/endpoints'
import { usePermission } from '../hooks'
import { ProgressBar, EmptyState } from '../components/ui'
import CreateActivityModal from '../components/activities/CreateActivityModal'
import type { Plan, Activity, Phase, ActivityStatus } from '../types'

const PHASES: Phase[] = ['P1', 'P2', 'P3']

const PHASE_META: Record<Phase, { label: string; desc: string; color: string; bg: string; border: string }> = {
  P1: { label: 'Analysis',    desc: 'Understand the current state', color: 'text-p1-dark', bg: 'bg-p1-light', border: 'border-p1' },
  P2: { label: 'Strategy',    desc: 'Define the desired future',    color: 'text-p2-dark', bg: 'bg-p2-light', border: 'border-p2' },
  P3: { label: 'Operations',  desc: 'Plan how to get there',        color: 'text-p3-dark', bg: 'bg-p3-light', border: 'border-p3' },
}

const STATUS_META: Record<ActivityStatus, { label: string; icon: React.ReactNode }> = {
  not_started:  { label: 'Not started',  icon: <div className="size-2 rounded-full bg-ink-300" /> },
  in_progress:  { label: 'In progress',  icon: <div className="size-2 rounded-full bg-p2" /> },
  under_review: { label: 'Under review', icon: <div className="size-2 rounded-full bg-p1" /> },
  complete:     { label: 'Complete',     icon: <CheckCircle2 className="size-3.5 text-p2-dark" /> },
}

function ActivityRow({ activity, onClick }: { activity: Activity; onClick: () => void }) {
  const overdue = activity.due_date && activity.status !== 'complete'
    && new Date(activity.due_date) < new Date()
  const sm = STATUS_META[activity.status]

  return (
    <div
      onClick={onClick}
      className="group flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-ink-50 cursor-pointer transition-colors"
    >
      <span className="flex items-center justify-center shrink-0">{sm.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink-800 group-hover:text-accent truncate transition-colors">
          {activity.title}
        </p>
        <p className="text-xs text-ink-400 capitalize mt-0.5">{activity.type.replace(/_/g, ' ')}</p>
      </div>
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
      <ChevronRight className="size-4 text-ink-200 group-hover:text-accent shrink-0 transition-colors" />
    </div>
  )
}

export default function PlanDetailPage() {
  const { planId } = useParams<{ planId: string }>()
  const navigate = useNavigate()
  const { can } = usePermission()

  const [plan, setPlan] = useState<Plan | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [activePhase, setActivePhase] = useState<Phase>('P1')
  const [showCreate, setShowCreate] = useState(false)

  const load = async () => {
    if (!planId) return
    try {
      const [p, acts] = await Promise.all([
        plansApi.get(planId),
        activitiesApi.list(planId),
      ])
      setPlan(p)
      setActivities(acts)
    } catch { } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [planId])

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

  const phaseActivities = activities.filter((a) => a.phase === activePhase)
  const phaseMeta = PHASE_META[activePhase]

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Back + Header */}
      <div>
        <button
          onClick={() => navigate('/plans')}
          className="flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-700 mb-3 transition-colors"
        >
          <ArrowLeft className="size-4" /> Plans
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink-900">{plan.title}</h1>
            {plan.description && (
              <p className="text-ink-500 text-sm mt-0.5">{plan.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
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

      {/* Phase progress cards */}
      <div className="grid grid-cols-3 gap-4">
        {PHASES.map((phase) => {
          const phData = plan.progress?.phases.find((p) => p.phase === phase)
          const meta = PHASE_META[phase]
          const pct = phData?.percent ?? 0

          return (
            <button
              key={phase}
              onClick={() => setActivePhase(phase)}
              className={`text-left rounded-2xl border-2 p-4 transition-all ${
                activePhase === phase
                  ? `${meta.border} ${meta.bg}`
                  : 'border-ink-100 bg-white hover:border-ink-200'
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
              <ProgressBar
                value={pct}
                variant={phase.toLowerCase() as 'p1' | 'p2' | 'p3'}
              />
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

      {/* Phase detail */}
      <div className="bg-white rounded-2xl border border-ink-100">
        <div className={`flex items-center justify-between px-5 py-4 border-b ${phaseMeta.border} border-opacity-30 ${phaseMeta.bg} rounded-t-2xl`}>
          <div>
            <p className={`text-sm font-bold ${phaseMeta.color}`}>{activePhase} — {phaseMeta.label}</p>
            <p className="text-xs text-ink-500">{phaseMeta.desc}</p>
          </div>
          <span className="text-xs text-ink-400">
            {phaseActivities.length} {phaseActivities.length === 1 ? 'activity' : 'activities'}
          </span>
        </div>

        <div className="p-3">
          {phaseActivities.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="size-8" />}
              title={`No ${phaseMeta.label.toLowerCase()} activities yet`}
              description={`Add a ${activePhase} activity like a ${activePhase === 'P1' ? 'SWOT or PESTLE' : activePhase === 'P2' ? 'Vision statement or KPI framework' : 'Roadmap or Action plan'} to get started.`}
              action={
                can.createPlan ? (
                  <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
                  >
                    <Plus className="size-4" /> Add {activePhase} activity
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="divide-y divide-ink-50">
              {phaseActivities
                .sort((a, b) => a.user_order - b.user_order)
                .map((activity) => (
                  <ActivityRow
                    key={activity.id}
                    activity={activity}
                    onClick={() => navigate(`/plans/${planId}/activities/${activity.id}`)}
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
