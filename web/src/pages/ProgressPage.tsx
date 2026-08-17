import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Clock, TrendingUp, FlaskConical, Target } from 'lucide-react'
import { plansApi, activitiesApi } from '../api/endpoints'
import { ProgressBar } from '../components/ui'
import {
  overallKpiCompletion, periodCompletion, fetchPlanKpiAchievement,
  PERIOD_META, achievementColor,
} from '../components/activities/TrackingModule'
import type { Plan, Activity } from '../types'
import { KPI_PERIODS } from '../types'

// ─── Per-plan progress card ─────────────────────────────────────────────────
//
// "Progress" means KPI achievement now (actual vs. target), not "% of
// activities marked complete." A breakdown *by Strategic Pillar* doesn't fit
// that well any more — pillars are free-text, self-defined per plan, so
// there's no consistent axis to compare across plans, and a pillar with
// zero KPIs on it (only status-tracked activities) would show a misleading
// 0%. Breaking down by KPI reporting cadence (Monthly/Quarterly/Annual)
// instead is a property every KPI actually has, comparable across any plan,
// and answers the question a KPI-tracking-focused progress page should
// answer: "how are we doing on the things we're measuring, and how often
// do we expect to check."
function PlanProgressCard({ plan, activities }: { plan: Plan; activities: Activity[] }) {
  const { t, i18n } = useTranslation()
  const progress = plan.progress
  if (!progress) return null

  const allKpis = activities.flatMap((a) => a.kpis ?? [])
  const kpiAchievement = overallKpiCompletion(allKpis)
  // Falls back to the activity-status percent_complete only when the plan
  // has no scored KPIs at all yet, so a brand-new plan still shows
  // *something* meaningful instead of an empty bar.
  const overallDisplayPct = kpiAchievement ?? progress.overall.percent_complete

  const periodRows = KPI_PERIODS.map((period) => ({
    period,
    pct: periodCompletion(allKpis, period),
    count: allKpis.filter((k) => k.target_period === period).length,
  }))

  const advancedResearchCount = activities.filter((a) => a.category === 'advanced_research').length

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
          <p className={`text-2xl font-bold ${kpiAchievement !== null ? achievementColor(overallDisplayPct) : 'text-ink-900'}`}>
            {Math.round(overallDisplayPct)}%
          </p>
          <p className="text-xs text-ink-400 flex items-center gap-1 justify-end">
            {kpiAchievement !== null && <Target className="size-3" />}
            {kpiAchievement !== null
              ? t('progressPage.overall')
              : t('progressPage.noKpisScored', { defaultValue: 'No KPIs scored yet' })}
          </p>
        </div>
      </div>

      <ProgressBar value={overallDisplayPct} className="mb-5" />

      {/* KPI breakdown by reporting cadence */}
      <div className="space-y-3">
        {periodRows.map(({ period, pct, count }) => (
          <div key={period}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-ink-700">{PERIOD_META[period].label}</span>
              <div className="flex items-center gap-3 text-xs text-ink-400">
                <span>{t('progressPage.kpiCount', { count, defaultValue: `${count} KPI${count === 1 ? '' : 's'}` })}</span>
                <span className={`font-semibold ${pct !== null ? achievementColor(pct) : 'text-ink-300'}`}>
                  {pct !== null ? `${Math.round(pct)}%` : '—'}
                </span>
              </div>
            </div>
            <ProgressBar value={pct ?? 0} />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 mt-4 pt-4 border-t border-ink-50">
        <div className="flex items-center gap-1.5 text-xs text-ink-500">
          <CheckCircle2 className="size-3.5 text-p2-dark" />
          {progress.overall.complete} {t('progressPage.complete')}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-ink-500">
          <TrendingUp className="size-3.5 text-accent" />
          {progress.overall.in_progress} {t('progressPage.inProgress')}
        </div>
        {advancedResearchCount > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-ink-500">
            <FlaskConical className="size-3.5 text-ink-400" />
            {advancedResearchCount} {t('progressPage.advancedResearch', { defaultValue: 'Advanced Research' })}
          </div>
        )}
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

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ProgressPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const filterPlan = searchParams.get('plan')

  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)

  // Selected-plan detail state — just the one plan's activities, to feed
  // the KPI breakdown above. No links/pillars/objectives needed any more:
  // the dependency network (and activity linking generally) was removed —
  // that kind of cross-activity linking is no longer part of the product.
  const [selectedPlanId, setSelectedPlanId] = useState<string>('')
  const [selectedPlanActivities, setSelectedPlanActivities] = useState<Activity[]>([])
  const [selectedPlanLoading, setSelectedPlanLoading] = useState(false)

  useEffect(() => {
    plansApi.list()
      .then(async (data) => {
        const active = data.filter((p) => p.status === 'active' || p.status === 'review')
        const visible = filterPlan ? active.filter((p) => p.id === filterPlan) : active
        // Plan.progress is not part of the list response (see the type's
        // own doc comment) — it only comes back from GET /plans/{id}/progress.
        // Fetch it per plan and merge it in, or every card below has nothing
        // to render and silently returns null. kpi_achievement is fetched
        // the same way, from each plan's activities.
        const withProgress = await Promise.all(
          visible.map(async (p) => {
            const [progress, kpi_achievement] = await Promise.all([
              plansApi.progress(p.id).catch(() => undefined),
              fetchPlanKpiAchievement(p.id),
            ])
            return progress ? { ...p, progress, kpi_achievement } : { ...p, kpi_achievement }
          })
        )
        setPlans(withProgress)
        if (withProgress.length > 0 && !selectedPlanId) {
          setSelectedPlanId(withProgress[0].id)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [filterPlan]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedPlanId) return
    setSelectedPlanLoading(true)
    activitiesApi.list(selectedPlanId)
      .then(setSelectedPlanActivities)
      .catch(() => setSelectedPlanActivities([]))
      .finally(() => setSelectedPlanLoading(false))
  }, [selectedPlanId])

  // overall is populated for every plan (pillar-attached + Advanced
  // Research activities combined) — no more plan-type branching needed here.
  const totalActivities = plans.reduce((s, p) => s + (p.progress?.overall.total ?? 0), 0)
  const totalComplete = plans.reduce((s, p) => s + (p.progress?.overall.complete ?? 0), 0)
  const totalOverdue = plans.reduce((s, p) => s + (p.progress?.overall.overdue ?? 0), 0)
  // KPI achievement first, activity-status percent_complete as the
  // fallback for a plan with no KPIs scored yet — same rule as every other
  // progress figure on this page and on the Dashboard/Plans list (see the
  // Plan.kpi_achievement doc comment in types/index.ts).
  const avgProgress = plans.length
    ? Math.round(plans.reduce((s, p) => s + (p.kpi_achievement ?? p.progress?.overall.percent_complete ?? 0), 0) / plans.length)
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

      {/* Selected plan detail — one plan at a time via the selector below,
          rather than rendering every plan's card in a row. With more than a
          handful of plans a full list gets long fast; this keeps the page a
          fixed height and reuses one selector for the progress card. */}
      {!loading && plans.length > 0 && (() => {
        const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? plans[0]
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-bold text-ink-800">{t('progressPage.perPlanDetail')}</h2>
              {plans.length > 1 && (
                <select
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value)}
                  className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 outline-none focus:ring-2 focus:ring-accent-400"
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              )}
            </div>

            {selectedPlan && (
              selectedPlanLoading && selectedPlanId === selectedPlan.id ? (
                <div className="h-64 bg-ink-100 rounded-2xl animate-pulse" />
              ) : (
                <PlanProgressCard
                  plan={selectedPlan}
                  // Lags one tick behind selectedPlanId during a plan
                  // switch, so guard against showing a stale plan's KPIs.
                  activities={selectedPlanId === selectedPlan.id ? selectedPlanActivities : []}
                />
              )
            )}
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