import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Clock, TrendingUp, GitBranch } from 'lucide-react'
import { plansApi, activitiesApi } from '../api/endpoints'
import { ProgressBar } from '../components/ui'
import TransPhaseNetwork from '../components/progress/TransPhaseNetwork'
import type { Plan, Phase, Activity, ActivityLink } from '../types'

const PHASE_META: Record<Phase, { label: string; color: string; bar: 'p1' | 'p2' | 'p3' }> = {
  P1: { label: 'Analysis',   color: 'text-p1-dark', bar: 'p1' },
  P2: { label: 'Strategy',   color: 'text-p2-dark', bar: 'p2' },
  P3: { label: 'Operations', color: 'text-p3-dark', bar: 'p3' },
}

function PlanProgressCard({ plan }: { plan: Plan }) {
  const progress = plan.progress
  if (!progress) return null

  return (
    <div className="bg-white rounded-2xl border border-ink-100 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-ink-900 text-sm">{plan.title}</h3>
          {plan.end_date && (
            <p className="text-xs text-ink-400 mt-0.5 flex items-center gap-1">
              <Clock className="size-3" />
              Target: {new Date(plan.end_date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-ink-900">{Math.round(progress.overall_percent)}%</p>
          <p className="text-xs text-ink-400">overall</p>
        </div>
      </div>

      <ProgressBar value={progress.overall_percent} className="mb-5" />

      <div className="space-y-3">
        {progress.phases.map((p) => {
          const meta = PHASE_META[p.phase]
          return (
            <div key={p.phase}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${meta.color}`}>{p.phase}</span>
                  <span className="text-xs text-ink-500">{meta.label}</span>
                  {p.overdue > 0 && (
                    <span className="flex items-center gap-0.5 text-xs text-red-500">
                      <AlertTriangle className="size-3" /> {p.overdue}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-ink-400">
                  <span>{p.complete}/{p.total} done</span>
                  <span className={`font-semibold ${meta.color}`}>{Math.round(p.percent)}%</span>
                </div>
              </div>
              <ProgressBar value={p.percent} variant={meta.bar} />
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-4 mt-4 pt-4 border-t border-ink-50">
        <div className="flex items-center gap-1.5 text-xs text-ink-500">
          <CheckCircle2 className="size-3.5 text-p2-dark" />
          {progress.phases.reduce((s, p) => s + p.complete, 0)} complete
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-500">
          <TrendingUp className="size-3.5 text-accent" />
          {progress.phases.reduce((s, p) => s + p.in_progress, 0)} in progress
        </div>
        {progress.overdue_count > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-red-500 font-medium ml-auto">
            <AlertTriangle className="size-3.5" />
            {progress.overdue_count} overdue
          </div>
        )}
      </div>
    </div>
  )
}

export default function ProgressPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filterPlan = searchParams.get('plan')

  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)

  // Network diagram state — scoped to one plan at a time
  const [networkPlanId, setNetworkPlanId] = useState<string>('')
  const [networkActivities, setNetworkActivities] = useState<Activity[]>([])
  const [networkLinks, setNetworkLinks] = useState<ActivityLink[]>([])
  const [networkLoading, setNetworkLoading] = useState(false)

  useEffect(() => {
    plansApi.list()
      .then((data) => {
        const active = data.filter((p) => p.status === 'active' || p.status === 'review')
        const visible = filterPlan ? active.filter((p) => p.id === filterPlan) : active
        setPlans(visible)
        if (visible.length > 0 && !networkPlanId) {
          setNetworkPlanId(visible[0].id)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [filterPlan]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!networkPlanId) return
    setNetworkLoading(true)
    Promise.all([
      activitiesApi.list(networkPlanId),
      activitiesApi.listLinks(networkPlanId),
    ])
      .then(([acts, links]) => {
        setNetworkActivities(acts)
        setNetworkLinks(links)
      })
      .catch(() => {
        setNetworkActivities([])
        setNetworkLinks([])
      })
      .finally(() => setNetworkLoading(false))
  }, [networkPlanId])

  const totalActivities = plans.reduce((s, p) => s + (p.progress?.phases.reduce((ps, ph) => ps + ph.total, 0) ?? 0), 0)
  const totalComplete = plans.reduce((s, p) => s + (p.progress?.phases.reduce((ps, ph) => ps + ph.complete, 0) ?? 0), 0)
  const totalOverdue = plans.reduce((s, p) => s + (p.progress?.overdue_count ?? 0), 0)
  const avgProgress = plans.length
    ? Math.round(plans.reduce((s, p) => s + (p.progress?.overall_percent ?? 0), 0) / plans.length)
    : 0

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Progress</h1>
        <p className="text-ink-500 text-sm mt-0.5">Across {plans.length} active plan{plans.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Summary stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Avg. completion',     value: `${avgProgress}%`,  icon: <TrendingUp className="size-5 text-accent" />,     bg: 'bg-accent-50' },
          { label: 'Activities complete', value: totalComplete,      icon: <CheckCircle2 className="size-5 text-p2-dark" />,  bg: 'bg-p2-light' },
          { label: 'Total activities',    value: totalActivities,    icon: <Clock className="size-5 text-p3-dark" />,         bg: 'bg-p3-light' },
          { label: 'Overdue',             value: totalOverdue,       icon: <AlertTriangle className="size-5 text-red-500" />, bg: 'bg-red-50', alert: totalOverdue > 0 },
        ].map(({ label, value, icon, bg, alert }) => (
          <div key={label} className={`rounded-2xl border ${alert ? 'border-red-200' : 'border-ink-100'} bg-white p-5`}>
            <div className={`size-10 rounded-xl ${bg} flex items-center justify-center mb-3`}>{icon}</div>
            <p className="text-2xl font-bold text-ink-900">{loading ? '—' : value}</p>
            <p className="text-xs text-ink-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Phase summary bars */}
      {!loading && plans.length > 0 && (
        <div className="bg-white rounded-2xl border border-ink-100 p-5">
          <h2 className="font-display text-sm font-bold text-ink-800 mb-4">Phase breakdown — all plans</h2>
          <div className="space-y-4">
            {(['P1', 'P2', 'P3'] as Phase[]).map((phase) => {
              const meta = PHASE_META[phase]
              const all = plans.flatMap((p) => p.progress?.phases.filter((ph) => ph.phase === phase) ?? [])
              const total = all.reduce((s, p) => s + p.total, 0)
              const complete = all.reduce((s, p) => s + p.complete, 0)
              const pct = total > 0 ? Math.round((complete / total) * 100) : 0
              return (
                <div key={phase}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold w-6 ${meta.color}`}>{phase}</span>
                      <span className="text-xs text-ink-500">{meta.label}</span>
                    </div>
                    <span className={`text-xs font-semibold ${meta.color}`}>{pct}% · {complete}/{total}</span>
                  </div>
                  <ProgressBar value={pct} variant={meta.bar} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Trans-Phase Network Diagram */}
      {!loading && plans.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <GitBranch className="size-4 text-ink-400" />
              <h2 className="font-display text-sm font-bold text-ink-800">Activity dependency network</h2>
            </div>
            {plans.length > 1 && (
              <select
                value={networkPlanId}
                onChange={(e) => {
                  setNetworkPlanId(e.target.value)
                  setSearchParams({ plan: e.target.value })
                }}
                className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 outline-none focus:ring-2 focus:ring-accent-400"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            )}
          </div>

          {networkLoading ? (
            <div className="h-[560px] bg-ink-100 rounded-2xl animate-pulse" />
          ) : (
            <TransPhaseNetwork
              activities={networkActivities}
              links={networkLinks}
              planId={networkPlanId}
            />
          )}
        </div>
      )}

      {/* Per-plan cards */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => <div key={i} className="h-48 bg-ink-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : plans.length === 0 ? (
        <div className="text-center py-16">
          <TrendingUp className="size-10 text-ink-200 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-ink-600">No active plans</h3>
          <p className="text-xs text-ink-400 mt-1">Progress data appears when plans are active or under review.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="font-display text-sm font-bold text-ink-800">Per-plan detail</h2>
          {plans.map((plan) => <PlanProgressCard key={plan.id} plan={plan} />)}
        </div>
      )}
    </div>
  )
}
