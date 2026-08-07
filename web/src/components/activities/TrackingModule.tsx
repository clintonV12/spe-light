import React, { useEffect, useMemo, useState } from 'react'
import { TrendingUp, TrendingDown, AlertTriangle, Lock } from 'lucide-react'
import { activitiesApi, pillarsApi } from '../../api/endpoints'
import { useToast } from '../../hooks'
import type { Plan, Activity, KPI, KPIDirection, KPIPeriod, StrategicPillar, StrategicObjective } from '../../types'
import { KPI_PERIODS } from '../../types'

interface TrackingModuleProps {
  plan: Plan
  canEdit: boolean
}

const PERIOD_META: Record<KPIPeriod, { label: string; color: string }> = {
  monthly:   { label: 'Monthly',   color: 'border-p1 bg-p1-light' },
  quarterly: { label: 'Quarterly', color: 'border-p2 bg-p2-light' },
  annual:    { label: 'Annual',    color: 'border-p3 bg-p3-light' },
}

// ── Achievement math ─────────────────────────────────────────────────────
//
// Mirrors models.KPI's doc comment in the backend exactly, so the number
// shown here while typing — before the value is even saved — matches what
// the server holds once it is:
//
//   increase: pct = actual / target * 100   (higher actual is better)
//   decrease: pct = target / actual * 100   (lower actual is better)
//
// Not capped at 100 — overachievement is meaningful — but progress bars
// clamp their *width* at 100% so a 150% KPI doesn't overflow its box.

function computeAchievement(direction: KPIDirection | undefined, target?: number, actual?: number): number | null {
  if (target === undefined || target === null || actual === undefined || actual === null) return null
  if (direction === 'decrease') {
    if (actual === 0) return null
    return (target / actual) * 100
  }
  if (target === 0) return null
  return (actual / target) * 100
}

function achievementColor(pct: number): string {
  if (pct >= 75) return 'text-green-600'
  if (pct <= 50) return 'text-red-600'
  return 'text-yellow-600'
}

function achievementBarColor(pct: number): string {
  if (pct >= 75) return 'bg-green-500'
  if (pct <= 50) return 'bg-red-400'
  return 'bg-yellow-400'
}

/** Small horizontal achievement bar + percentage label. */
const AchievementBar: React.FC<{ pct: number | null }> = ({ pct }) => {
  if (pct === null) {
    return <p className="text-xs text-ink-300 mt-1.5">Enter target &amp; actual</p>
  }
  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between mb-0.5">
        <span className={`text-xs font-bold ${achievementColor(pct)}`}>{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-ink-100 overflow-hidden">
        <div className={`h-full rounded-full ${achievementBarColor(pct)}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
    </div>
  )
}

/** Radial gauge for the Monthly/Quarterly/Annual/Overall completion metrics. */
const RadialGauge: React.FC<{ pct: number | null; label: string; sublabel?: string }> = ({ pct, label, sublabel }) => {
  const r = 52
  const circumference = 2 * Math.PI * r
  const clamped = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  const offset = circumference * (1 - clamped / 100)
  return (
    <div className="flex flex-col items-center justify-center">
      <svg viewBox="0 0 120 120" className="size-32">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#f1f5f9" strokeWidth="12" />
        {pct !== null && (
          <circle
            cx="60" cy="60" r={r} fill="none"
            stroke={pct >= 75 ? '#22c55e' : pct <= 50 ? '#ef4444' : '#eab308'}
            strokeWidth="12" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={offset}
            transform="rotate(-90 60 60)"
          />
        )}
        <text x="60" y="66" textAnchor="middle" className="fill-ink-900 font-display font-bold" style={{ fontSize: 24 }}>
          {pct === null ? '—' : `${Math.round(pct)}%`}
        </text>
      </svg>
      <p className="text-xs font-bold uppercase tracking-wide text-ink-500 mt-1">{label}</p>
      {sublabel && <p className="text-[10px] text-ink-400">{sublabel}</p>}
    </div>
  )
}

// One (activity, kpi-index) pair — the actual unit the Tracking Module edits.
interface KpiRow {
  activity: Activity
  kpiIndex: number
  kpi: KPI
}

function achievementForRow(row: KpiRow): number | null {
  return computeAchievement(row.kpi.direction, row.kpi.target_value, row.kpi.actual_value)
}

// Grouped by KPI.target_period now, not Activity.target_period (migration
// 013 moved Budget/Responsibility/TargetPeriod off the activity and onto
// each KPI individually — two KPIs under the same activity can report on
// different cadences, so the gauge has to bucket at the KPI level too).
function periodCompletion(rows: KpiRow[], period: KPIPeriod): number | null {
  const values = rows
    .filter((r) => r.kpi.target_period === period)
    .map(achievementForRow)
    .filter((v): v is number => v !== null)
    // Capped here, not at the source — an individual KPI's own display
    // still shows genuine overachievement (e.g. 150%), but one KPI running
    // hot shouldn't be able to drag a whole period's average above 100%
    // and mask other KPIs that are behind.
    .map((v) => Math.min(100, v))
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

export const TrackingModule: React.FC<TrackingModuleProps> = ({ plan, canEdit }) => {
  const [activities, setActivities] = useState<Activity[]>([])
  const [pillars, setPillars] = useState<StrategicPillar[]>([])
  const [objectives, setObjectives] = useState<StrategicObjective[]>([])
  const [loading, setLoading] = useState(true)
  const { error } = useToast()

  useEffect(() => {
    Promise.all([
      activitiesApi.list(plan.id),
      pillarsApi.list(plan.id),
      pillarsApi.listObjectives(plan.id),
    ])
      .then(([acts, p, o]) => {
        setActivities(acts)
        setPillars(p)
        setObjectives(o)
      })
      .catch(() => error('Failed to load KPIs'))
      .finally(() => setLoading(false))
  }, [plan.id])

  const objectiveById = useMemo(() => new Map(objectives.map((o) => [o.id, o])), [objectives])
  const pillarById = useMemo(() => new Map(pillars.map((p) => [p.id, p])), [pillars])

  const breadcrumbFor = (activity: Activity): string => {
    const objective = activity.objective_id ? objectiveById.get(activity.objective_id) : undefined
    const pillar = objective ? pillarById.get(objective.pillar_id) : undefined
    if (pillar && objective) return `${pillar.title} › ${objective.title}`
    return objective?.title ?? ''
  }

  // Activities that actually carry trackable KPIs — everything else (an
  // activity with no kpis entered) has nothing for this screen to show.
  const trackedActivities = useMemo(
    () => activities.filter((a) => (a.kpis?.length ?? 0) > 0),
    [activities],
  )

  const rows: KpiRow[] = useMemo(
    () => trackedActivities.flatMap((activity) =>
      (activity.kpis ?? []).map((kpi, kpiIndex) => ({ activity, kpiIndex, kpi })),
    ),
    [trackedActivities],
  )

  // Unscheduled is now a per-KPI count, not a per-activity one — a single
  // activity can have some KPIs scheduled and others not.
  const unscheduledCount = useMemo(
    () => rows.filter((r) => !r.kpi.target_period).length,
    [rows],
  )

  const monthly = useMemo(() => periodCompletion(rows, 'monthly'), [rows])
  const quarterly = useMemo(() => periodCompletion(rows, 'quarterly'), [rows])
  const annual = useMemo(() => periodCompletion(rows, 'annual'), [rows])
  const overall = useMemo(() => {
    const parts = [monthly, quarterly, annual].filter((v): v is number => v !== null)
    if (parts.length === 0) return null
    return parts.reduce((a, b) => a + b, 0) / parts.length
  }, [monthly, quarterly, annual])

  const saveActivityKpis = async (activityId: string, newKpis: KPI[]) => {
    try {
      const updated = await activitiesApi.update(activityId, { kpis: newKpis })
      setActivities((prev) => prev.map((a) => (a.id === activityId ? updated : a)))
    } catch {
      error('Failed to save KPI')
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-ink-100 rounded-2xl animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Aggregated completion summary */}
      <div className="rounded-2xl border border-ink-100 bg-white p-5">
        <h3 className="font-display text-base font-bold text-ink-900 mb-4">Strategic Plan Completion</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-center justify-items-center">
          <RadialGauge pct={monthly} label="Monthly" />
          <RadialGauge pct={quarterly} label="Quarterly" />
          <RadialGauge pct={annual} label="Annual" />
          <div className="rounded-2xl border-2 border-accent bg-accent-50 p-3 w-full flex justify-center">
            <RadialGauge pct={overall} label="Overall" />
          </div>
        </div>
        {rows.length === 0 && (
          <p className="text-sm text-ink-400 text-center mt-3">
            No KPIs yet — add one when creating or editing an activity under Strategic Pillars.
          </p>
        )}
        {rows.length > 0 && unscheduledCount > 0 && (
          <div className="flex items-center gap-2 justify-center mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <AlertTriangle className="size-3.5 shrink-0" />
            {unscheduledCount} {unscheduledCount === 1 ? 'KPI has' : 'KPIs have'} no reporting period set —
            set one below so {unscheduledCount === 1 ? 'it counts' : 'they count'} toward a gauge above.
          </div>
        )}
      </div>

      {/* KPIs, grouped by activity */}
      <div className="space-y-4">
        {trackedActivities.length === 0 && (
          <div className="rounded-2xl border border-ink-100 bg-white p-5 text-center">
            <p className="text-sm text-ink-400">
              KPIs are tracked from the activities under Strategic Pillars. Add a KPI (with a target value) when
              creating or editing an activity, and it'll show up here.
            </p>
          </div>
        )}

        {trackedActivities.map((activity) => (
          <ActivityKpiCard
            key={activity.id}
            activity={activity}
            breadcrumb={breadcrumbFor(activity)}
            canEdit={canEdit}
            onSaveKpis={(newKpis) => saveActivityKpis(activity.id, newKpis)}
          />
        ))}
      </div>
    </div>
  )
}

const ActivityKpiCard: React.FC<{
  activity: Activity
  breadcrumb: string
  canEdit: boolean
  onSaveKpis: (kpis: KPI[]) => Promise<void>
}> = ({ activity, breadcrumb, canEdit, onSaveKpis }) => {
  const kpis = activity.kpis ?? []

  // Local per-cell draft values so typing doesn't fire a save on every
  // keystroke — persisted onBlur instead. Re-seeded whenever the parent
  // activity object changes identity (i.e. after a successful save).
  const [drafts, setDrafts] = useState<{ target: string; actual: string }[]>(() =>
    kpis.map((k) => ({ target: k.target_value?.toString() ?? '', actual: k.actual_value?.toString() ?? '' })),
  )
  useEffect(() => {
    setDrafts(kpis.map((k) => ({ target: k.target_value?.toString() ?? '', actual: k.actual_value?.toString() ?? '' })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.id, activity.updated_at])

  const setDraft = (i: number, field: 'target' | 'actual', value: string) => {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)))
  }

  const blur = (i: number) => {
    const d = drafts[i]
    const targetValue = d.target.trim() === '' ? undefined : Number(d.target)
    const actualValue = d.actual.trim() === '' ? undefined : Number(d.actual)
    if (Number.isNaN(targetValue ?? 0) || Number.isNaN(actualValue ?? 0)) return
    const current = kpis[i]
    if ((current.target_value ?? undefined) === targetValue && (current.actual_value ?? undefined) === actualValue) return
    const newKpis = kpis.map((k, idx) => (idx === i ? { ...k, target_value: targetValue, actual_value: actualValue } : k))
    void onSaveKpis(newKpis)
  }

  // Reporting period is now set per-KPI (see periodCompletion above) rather
  // than once for the whole activity, so the select moves into each KPI row
  // below instead of living in this card's header.
  const savePeriod = (i: number, period: KPIPeriod | '') => {
    const newKpis = kpis.map((k, idx) => (idx === i ? { ...k, target_period: period || undefined } : k))
    void onSaveKpis(newKpis)
  }

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <div className="mb-1">
        {breadcrumb && <p className="text-[11px] text-ink-400 mb-0.5">{breadcrumb}</p>}
        <p className="text-sm font-semibold text-ink-900">{activity.title}</p>
      </div>

      <div className="space-y-3 mt-3">
        {kpis.map((kpi, i) => {
          const pct = computeAchievement(
            kpi.direction,
            drafts[i]?.target.trim() === '' ? undefined : Number(drafts[i]?.target),
            drafts[i]?.actual.trim() === '' ? undefined : Number(drafts[i]?.actual),
          )
          const DirectionIcon = kpi.direction === 'decrease' ? TrendingDown : TrendingUp
          // Locked once a target_value already exists on this KPI (set in
          // Strategic Pillars, at creation) — Tracking Module is then only
          // for filling in Actual as progress comes in. If no target was
          // set there, it stays editable here as a fallback.
          const targetLocked = kpi.target_value !== undefined && kpi.target_value !== null
          const periodMeta = kpi.target_period ? PERIOD_META[kpi.target_period] : null
          return (
            <div key={i} className="rounded-xl border border-ink-100 bg-ink-50/40 p-3">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <DirectionIcon className="size-3.5 text-ink-400 shrink-0" />
                  <p className="text-sm text-ink-800 font-medium truncate">{kpi.indicator || 'Untitled KPI'}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {periodMeta ? (
                    <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-1 border-2 ${periodMeta.color}`}>
                      {periodMeta.label}
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-1">
                      No period
                    </span>
                  )}
                  {canEdit && (
                    <select
                      value={kpi.target_period ?? ''}
                      onChange={(e) => savePeriod(i, e.target.value as KPIPeriod | '')}
                      className="text-xs rounded-lg border border-ink-200 bg-white px-1.5 py-1 text-ink-700"
                      title="Reporting period"
                    >
                      <option value="">Set period…</option>
                      {KPI_PERIODS.map((p) => (
                        <option key={p} value={p}>{PERIOD_META[p].label}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {kpi.target && <p className="text-xs text-ink-400 mb-1">Target: {kpi.target}</p>}
              {(kpi.budget !== undefined || kpi.responsibility) && (
                <p className="text-xs text-ink-400 mb-2">
                  {kpi.budget !== undefined && <>Budget: {kpi.budget.toLocaleString()}</>}
                  {kpi.budget !== undefined && kpi.responsibility && ' · '}
                  {kpi.responsibility && <>Responsibility: {kpi.responsibility}</>}
                </p>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="h-3.5 flex items-center gap-1 whitespace-nowrap text-[10px] uppercase tracking-wide text-ink-400">
                    Target value
                    {targetLocked && <Lock className="size-2.5 shrink-0" />}
                  </label>
                  {targetLocked ? (
                    <p
                      className="w-full rounded-md border border-ink-100 bg-ink-100 px-2 py-1.5 text-sm text-ink-600"
                      title="Set on the activity in Strategic Pillars — edit it there to change."
                    >
                      {drafts[i]?.target}
                    </p>
                  ) : (
                    <input
                      type="number"
                      disabled={!canEdit}
                      value={drafts[i]?.target ?? ''}
                      onChange={(e) => setDraft(i, 'target', e.target.value)}
                      onBlur={() => blur(i)}
                      className="w-full rounded-md border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-accent disabled:bg-ink-50"
                    />
                  )}
                </div>
                <div>
                  <label className="h-3.5 flex items-center gap-1 whitespace-nowrap text-[10px] uppercase tracking-wide text-ink-400">
                    Actual value
                  </label>
                  <input
                    type="number"
                    disabled={!canEdit}
                    value={drafts[i]?.actual ?? ''}
                    onChange={(e) => setDraft(i, 'actual', e.target.value)}
                    onBlur={() => blur(i)}
                    className="w-full rounded-md border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-accent disabled:bg-ink-50"
                  />
                </div>
              </div>
              <AchievementBar pct={pct} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default TrackingModule