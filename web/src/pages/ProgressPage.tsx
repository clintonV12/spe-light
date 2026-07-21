import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Clock, TrendingUp, GitBranch } from 'lucide-react'
import { plansApi, activitiesApi } from '../api/endpoints'
import { ProgressBar } from '../components/ui'
import TransPhaseNetwork from '../components/progress/TransPhaseNetwork'
import type { Plan, Phase, Activity, ActivityLink } from '../types'

function PlanProgressCard({ plan }: { plan: Plan }) {
  const { t, i18n } = useTranslation()
  const progress = plan.progress
  if (!progress) return null

  const PHASE_META: Record<Phase, { label: string; color: string; bar: 'p1' | 'p2' | 'p3' }> = {
    P1: { label: t('plan.phases.P1'), color: 'text-p1-dark', bar: 'p1' },
    P2: { label: t('plan.phases.P2'), color: 'text-p2-dark', bar: 'p2' },
    P3: { label: t('plan.phases.P3'), color: 'text-p3-dark', bar: 'p3' },
  }

  return (
    <div className="bg-white rounded-2xl border border-ink-100 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-ink-900 text-sm">{plan.title}</h3>
          {plan.end_date && (
            <p className="text-xs text-ink-400 mt-0.5 flex items-center gap-1">
              <Clock className="size-3" />
              {t('progressPage.target', {
                date: new Date(plan.end_date).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' }),
              })}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-ink-900">{Math.round(progress.overall.percent_complete)}%</p>
          <p className="text-xs text-ink-400">{t('progressPage.overall')}</p>
        </div>
      </div>

      <ProgressBar value={progress.overall.percent_complete} className="mb-5" />

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
                  <span>{t('progressPage.done', { complete: p.complete, total: p.total })}</span>
                  <span className={`font-semibold ${meta.color}`}>{Math.round(p.percent_complete)}%</span>
                </div>
              </div>
              <ProgressBar value={p.percent_complete} variant={meta.bar} />
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-4 mt-4 pt-4 border-t border-ink-50">
        <div className="flex items-center gap-1.5 text-xs text-ink-500">
          <CheckCircle2 className="size-3.5 text-p2-dark" />
          {progress.phases.reduce((s, p) => s + p.complete, 0)} {t('progressPage.complete')}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-500">
          <TrendingUp className="size-3.5 text-accent" />
          {progress.phases.reduce((s, p) => s + p.in_progress, 0)} {t('progressPage.inProgress')}
        </div>
        {progress.overall.overdue > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-red-500 font-medium ml-auto">
            <AlertTriangle className="size-3.5" />
            {t('progressPage.overdueCount', { count: progress.overall.overdue })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ProgressPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
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
      .then(async (data) => {
        const active = data.filter((p) => p.status === 'active' || p.status === 'review')
        const visible = filterPlan ? active.filter((p) => p.id === filterPlan) : active
        // Plan.progress is not part of the list response (see the type's
        // own doc comment) — it only comes back from GET /plans/{id}/progress.
        // Fetch it per plan and merge it in, or every card below has nothing
        // to render and silently returns null.
        const withProgress = await Promise.all(
          visible.map(async (p) => {
            try {
              const progress = await plansApi.progress(p.id)
              return { ...p, progress }
            } catch {
              return p
            }
          })
        )
        setPlans(withProgress)
        if (withProgress.length > 0 && !networkPlanId) {
          setNetworkPlanId(withProgress[0].id)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [filterPlan]) // eslint-disable-line react-hooks/exhaustive-deps

  // Extracted so it can be reused as TransPhaseNetwork's onLinksChanged
  // callback (after accepting an AI-suggested link) without duplicating the
  // fetch logic. `silent` skips the loading-skeleton toggle — the diagram
  // is already visible and interactive at that point, so swapping it for a
  // pulsing placeholder just to add one edge would be a jarring flash for
  // what's normally a near-instant refetch.
  const fetchNetworkData = useCallback((planId: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setNetworkLoading(true)
    return Promise.all([
      activitiesApi.list(planId),
      activitiesApi.listLinks(planId),
    ])
      .then(([acts, links]) => {
        setNetworkActivities(acts)
        setNetworkLinks(links)
      })
      .catch(() => {
        if (!opts?.silent) {
          setNetworkActivities([])
          setNetworkLinks([])
        }
        // A silent refresh failing just leaves existing data in place —
        // the newly-accepted link won't render until the next full load,
        // but that's preferable to blanking an otherwise-working diagram
        // over a transient refetch failure.
      })
      .finally(() => { if (!opts?.silent) setNetworkLoading(false) })
  }, [])

  useEffect(() => {
    if (!networkPlanId) return
    fetchNetworkData(networkPlanId)
  }, [networkPlanId, fetchNetworkData])

  const totalActivities = plans.reduce((s, p) => s + (p.progress?.phases.reduce((ps, ph) => ps + ph.total, 0) ?? 0), 0)
  const totalComplete = plans.reduce((s, p) => s + (p.progress?.phases.reduce((ps, ph) => ps + ph.complete, 0) ?? 0), 0)
  const totalOverdue = plans.reduce((s, p) => s + (p.progress?.overall.overdue ?? 0), 0)
  const avgProgress = plans.length
    ? Math.round(plans.reduce((s, p) => s + (p.progress?.overall.percent_complete ?? 0), 0) / plans.length)
    : 0

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink-900">{t('progressPage.title')}</h1>
        <p className="text-ink-500 text-sm mt-0.5">{t('progressPage.subtitle', { count: plans.length })}</p>
      </div>

      {/* Summary stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: t('progressPage.statAvgCompletion'),     value: `${avgProgress}%`,  icon: <TrendingUp className="size-5 text-accent" />,     bg: 'bg-accent-50' },
          { label: t('progressPage.statActivitiesComplete'), value: totalComplete,      icon: <CheckCircle2 className="size-5 text-p2-dark" />,  bg: 'bg-p2-light' },
          { label: t('progressPage.statTotalActivities'),    value: totalActivities,    icon: <Clock className="size-5 text-p3-dark" />,         bg: 'bg-p3-light' },
          { label: t('progressPage.statOverdue'),             value: totalOverdue,       icon: <AlertTriangle className="size-5 text-red-500" />, bg: 'bg-red-50', alert: totalOverdue > 0 },
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
          <h2 className="font-display text-sm font-bold text-ink-800 mb-4">{t('progressPage.phaseBreakdown')}</h2>
          <div className="space-y-4">
            {(['P1', 'P2', 'P3'] as Phase[]).map((phase) => {
              const meta = {
                P1: { label: t('plan.phases.P1'), color: 'text-p1-dark', bar: 'p1' as const },
                P2: { label: t('plan.phases.P2'), color: 'text-p2-dark', bar: 'p2' as const },
                P3: { label: t('plan.phases.P3'), color: 'text-p3-dark', bar: 'p3' as const },
              }[phase]
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

      {/* Selected plan detail — one plan at a time via the selector below,
          rather than rendering every plan's card in a row. With more than a
          handful of plans a full list gets long fast; this keeps the page a
          fixed height and reuses one selector for both the progress card and
          the dependency network instead of the two disconnected pickers this
          page used to have. */}
      {!loading && plans.length > 0 && (() => {
        const selectedPlan = plans.find((p) => p.id === networkPlanId) ?? plans[0]
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-bold text-ink-800">{t('progressPage.perPlanDetail')}</h2>
              {plans.length > 1 && (
                <select
                  value={networkPlanId}
                  onChange={(e) => setNetworkPlanId(e.target.value)}
                  className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 outline-none focus:ring-2 focus:ring-accent-400"
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              )}
            </div>

            {selectedPlan && <PlanProgressCard plan={selectedPlan} />}

            <div>
              <div className="flex items-center gap-2 mb-4">
                <GitBranch className="size-4 text-ink-400" />
                <h3 className="font-display text-sm font-bold text-ink-800">{t('progressPage.dependencyNetwork')}</h3>
              </div>
              {networkLoading ? (
                <div className="h-[560px] bg-ink-100 rounded-2xl animate-pulse" />
              ) : (
                <TransPhaseNetwork
                  activities={networkActivities}
                  links={networkLinks}
                  planId={networkPlanId}
                  onLinksChanged={() => fetchNetworkData(networkPlanId, { silent: true })}
                />
              )}
            </div>
          </div>
        )
      })()}

      {!loading && plans.length === 0 && (
        <div className="text-center py-16">
          <TrendingUp className="size-10 text-ink-200 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-ink-600">{t('progressPage.emptyTitle')}</h3>
          <p className="text-xs text-ink-400 mt-1">{t('progressPage.emptyDesc')}</p>
        </div>
      )}

      {loading && (
        <div className="space-y-4">
          {[1, 2].map((i) => <div key={i} className="h-48 bg-ink-100 rounded-2xl animate-pulse" />)}
        </div>
      )}
    </div>
  )
}