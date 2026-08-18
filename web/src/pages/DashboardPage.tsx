import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, AlertTriangle, TrendingUp, CheckCircle2,
  ArrowUpRight, Sparkles, Activity,
  FileText, GitBranch, UserCheck, BarChart2,
  FileOutput, RefreshCw, ArrowRight, Target,
} from 'lucide-react'
import { plansApi, auditApi } from '../api/endpoints'
import { useAuthStore } from '../store/auth'
import { usePermission } from '../hooks'
import { EmptyState } from '../components/ui'
import CreatePlanModal from '../components/plans/CreatePlanModal'
import { SHORTCUT_CREATE_EVENT } from '../components/layout/AppShell'
import { fetchPlanKpiSummary } from '../components/activities/TrackingModule'
import type { Plan, PlanStatus, AuditLog, AuditAction } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60)  return t('auditLog.justNow')
  const m = Math.floor(s / 60)
  if (m < 60)  return t('auditLog.minutesAgo', { count: m })
  const h = Math.floor(m / 60)
  if (h < 24)  return t('auditLog.hoursAgo', { count: h })
  const d = Math.floor(h / 24)
  if (d === 1) return t('dashboard.activityFeed.yesterday')
  if (d < 7)   return t('auditLog.daysAgo', { count: d })
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function groupByDay(logs: AuditLog[], t: (key: string) => string): Array<{ label: string; entries: AuditLog[] }> {
  const groups = new Map<string, AuditLog[]>()
  const now = new Date()
  logs.forEach((log) => {
    const d = new Date(log.created_at)
    const isToday     = d.toDateString() === now.toDateString()
    const isYesterday = d.toDateString() === new Date(Date.now() - 864e5).toDateString()
    const label = isToday ? t('dashboard.activityFeed.today')
      : isYesterday ? t('dashboard.activityFeed.yesterday')
      : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(log)
  })
  return [...groups.entries()].map(([label, entries]) => ({ label, entries }))
}

// ─── Plan card ────────────────────────────────────────────────────────────────

const STATUS_PILL_CLS: Record<PlanStatus, string> = {
  draft:     'bg-ink-100 text-ink-500',
  active:    'bg-emerald-100 text-emerald-700',
  review:    'bg-amber-100 text-amber-700',
  completed: 'bg-blue-100 text-blue-700',
  archived:  'bg-ink-100 text-ink-400',
}

// Same rail color per status as the pill above, used as a left accent bar
// on the card so a whole row of cards can be status-scanned at a glance
// without reading each pill individually.
const STATUS_RAIL_CLS: Record<PlanStatus, string> = {
  draft:     'bg-ink-300',
  active:    'bg-emerald-400',
  review:    'bg-amber-400',
  completed: 'bg-blue-400',
  archived:  'bg-ink-200',
}

function PlanCard({ plan, onClick }: { plan: Plan; onClick: () => void }) {
  const { t } = useTranslation()
  const progress = plan.progress
  const overdue  = progress?.overall.overdue ?? 0
  const pillCls  = STATUS_PILL_CLS[plan.status]
  const railCls  = STATUS_RAIL_CLS[plan.status]

  // "Progress" means KPI achievement now (actual vs. target), not "% of
  // activities marked complete" — the ring and the "on track" line below
  // are both KPI-based, matching TrackingModule.tsx and ProgressPage.tsx.
  // Falls back to activity-status percent_complete only for a plan with no
  // KPIs scored yet, so a brand-new plan doesn't just show an empty ring.
  const kpiPct = plan.kpi_achievement
  const overallPct = kpiPct ?? progress?.overall.percent_complete ?? 0
  const kpiScored = plan.kpi_scored ?? 0
  const kpiOnTrack = plan.kpi_on_track ?? 0
  const ringColor = kpiPct === null ? '#CBD5E1' : overallPct >= 80 ? '#10B981' : overallPct >= 40 ? '#4B6BFB' : '#EF4444'

  return (
    <button
      onClick={onClick}
      className="group relative w-full text-left bg-white rounded-2xl border border-ink-100 pl-6 pr-5 py-5 overflow-hidden
                 hover:border-accent/30 hover:shadow-[0_8px_30px_rgba(15,23,42,0.08)] hover:-translate-y-0.5
                 transition-all duration-200 cursor-pointer"
    >
      {/* Status rail */}
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${railCls}`} />

      {/* Title row */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-ink-900 text-[15px] leading-snug truncate group-hover:text-accent transition-colors duration-150">
            {plan.title}
          </p>
          {plan.description && (
            <p className="text-ink-400 text-xs mt-1 line-clamp-1">{plan.description}</p>
          )}
        </div>
        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${pillCls}`}>
          {t(`plan.status.${plan.status}`)}
        </span>
      </div>

      {/* KPI achievement — ring + "on track" readout */}
      <div className="flex items-center gap-4 py-3 px-3.5 rounded-xl bg-ink-50/60 mb-4">
        <div className="relative size-14 shrink-0">
          <svg viewBox="0 0 44 44" className="size-14 -rotate-90">
            <circle cx="22" cy="22" r="18.5" fill="none" stroke="#E2E8F0" strokeWidth="4" />
            <circle
              cx="22" cy="22" r="18.5" fill="none"
              stroke={ringColor}
              strokeWidth="4"
              strokeDasharray={`${(overallPct / 100) * 116.2} 116.2`}
              strokeLinecap="round"
              className="transition-all duration-700"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-ink-800 tabular-nums">
            {Math.round(overallPct)}%
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-ink-700 flex items-center gap-1.5">
            <Target className="size-3 text-ink-400 shrink-0" />
            {kpiScored > 0
              ? t('dashboard.kpisOnTrack', { onTrack: kpiOnTrack, scored: kpiScored, defaultValue: `${kpiOnTrack} of ${kpiScored} KPIs on track` })
              : t('dashboard.noKpisScored', { defaultValue: 'No KPIs scored yet' })}
          </p>
          {overdue > 0 ? (
            <p className="flex items-center gap-1 text-xs text-red-500 font-medium mt-0.5">
              <AlertTriangle className="size-3" /> {t('dashboard.overdueBadge', { count: overdue })}
            </p>
          ) : (
            <p className="text-xs text-ink-400 mt-0.5">{t('dashboard.onTrack')}</p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end">
        <span className="flex items-center gap-1 text-xs font-medium text-ink-300 group-hover:text-accent transition-colors duration-150">
          {t('dashboard.viewPlan', { defaultValue: 'View plan' })}
          <ArrowUpRight className="size-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-150" />
        </span>
      </div>
    </button>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, loading, alert = false, sub, accent }: {
  label: string
  value: string | number
  icon: React.ReactNode
  loading: boolean
  alert?: boolean
  sub?: string
  /** Tailwind bg-* class for the top accent bar, e.g. 'bg-emerald-400'. */
  accent: string
}) {
  return (
    <div className={`group relative overflow-hidden rounded-2xl border bg-white p-5 hover:shadow-[0_8px_30px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 transition-all duration-200 ${alert ? 'border-red-200' : 'border-ink-100'}`}>
      {/* Top accent bar */}
      <span className={`absolute top-0 left-0 right-0 h-[3px] ${alert ? 'bg-red-400' : accent}`} />
      {/* Subtle gradient wash in corner */}
      <div className={`absolute -top-4 -right-4 size-20 rounded-full opacity-40 blur-2xl pointer-events-none ${alert ? 'bg-red-200' : 'bg-accent-100'}`} />

      <div className="relative">
        <div className="mb-4">{icon}</div>
        <p className={`text-3xl font-bold tabular-nums ${alert ? 'text-red-600' : 'text-ink-900'}`}>
          {loading ? (
            <span className="inline-block h-8 w-16 bg-ink-100 rounded-lg animate-pulse" />
          ) : value}
        </p>
        <p className="text-xs text-ink-400 mt-1 font-medium">{label}</p>
        {sub && !loading && (
          <p className="text-[10px] text-ink-300 mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  )
}

// ─── Activity feed ────────────────────────────────────────────────────────────

const ACTION_DISPLAY: Partial<Record<AuditAction, { icon: React.ReactNode; bg: string; color: string }>> = {
  'plan.created':            { icon: <FileText    className="size-3" />,    bg: 'bg-emerald-100', color: 'text-emerald-600' },
  'plan.updated':            { icon: <FileText    className="size-3" />,    bg: 'bg-ink-100',     color: 'text-ink-400'     },
  'plan.archived':           { icon: <FileText    className="size-3" />,    bg: 'bg-ink-100',     color: 'text-ink-300'     },
  'activity.created':        { icon: <Sparkles   className="size-3" />,    bg: 'bg-blue-100',    color: 'text-blue-500'    },
  'activity.status_changed': { icon: <CheckCircle2 className="size-3" />,  bg: 'bg-emerald-100', color: 'text-emerald-600' },
  'activity.updated':        { icon: <Activity   className="size-3" />,    bg: 'bg-ink-100',     color: 'text-ink-400'     },
  'link.created':            { icon: <GitBranch  className="size-3" />,    bg: 'bg-violet-100',  color: 'text-violet-600'  },
  'user.invited':            { icon: <UserCheck  className="size-3" />,    bg: 'bg-amber-100',   color: 'text-amber-600'   },
  'user.role_changed':       { icon: <UserCheck  className="size-3" />,    bg: 'bg-violet-100',  color: 'text-violet-600'  },
  'user.deactivated':        { icon: <UserCheck  className="size-3" />,    bg: 'bg-red-100',     color: 'text-red-500'     },
  'report.generated':        { icon: <FileOutput className="size-3" />,    bg: 'bg-amber-100',   color: 'text-amber-600'   },
}

const DEFAULT_DISPLAY = { icon: <Activity className="size-3" />, bg: 'bg-ink-100', color: 'text-ink-400' }

// Verb text comes from t(`activityVerbs.${log.action}`) — same dot-key
// mapping pattern as auditActions in AdminPage/PlatformAdminPage.

function DiffPill({ diff }: { diff: AuditLog['diff'] }) {
  const keys = Object.keys(diff)
  if (!keys.length) return null
  const { from, to } = diff[keys[0]]
  if (from === null || to === null) return null
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono bg-ink-50 border border-ink-100 rounded-md px-1.5 py-0.5">
      <span className="text-red-400">{String(from)}</span>
      <span className="text-ink-300 mx-0.5">→</span>
      <span className="text-emerald-600 font-semibold">{String(to)}</span>
    </span>
  )
}

function ActivityFeed() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [logs, setLogs]       = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  const fetchLogs = () => {
    setLoading(true)
    auditApi.list({ limit: 25 })
      .then((r) => setLogs(r.logs))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchLogs() }, [])

  const displayed = showAll ? logs : logs.slice(0, 12)
  const groups    = groupByDay(displayed, t)

  return (
    <div className="bg-white rounded-2xl border border-ink-100 flex flex-col overflow-hidden" style={{ maxHeight: 660 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100 shrink-0">
        <div className="flex items-center gap-2">
          <div className="size-6 rounded-lg bg-ink-50 flex items-center justify-center">
            <Activity className="size-3.5 text-ink-400" />
          </div>
          <h2 className="font-display text-sm font-bold text-ink-800">{t('dashboard.activityFeed.title')}</h2>
        </div>
        <button onClick={fetchLogs} className="p-1.5 rounded-lg text-ink-300 hover:text-ink-600 hover:bg-ink-50 transition-colors" title={t('dashboard.activityFeed.refresh')}>
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      {/* Scrollable feed */}
      <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
        {loading ? (
          <div className="space-y-4">
            {[1,2,3,4,5,6].map((i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="size-6 rounded-full bg-ink-100 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1.5 pt-0.5">
                  <div className="h-3 bg-ink-100 rounded w-5/6" />
                  <div className="h-2.5 bg-ink-100 rounded w-2/5" />
                </div>
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Activity className="size-8 text-ink-200 mb-3" />
            <p className="text-sm text-ink-400">{t('dashboard.activityFeed.empty')}</p>
            <p className="text-xs text-ink-300 mt-0.5">{t('dashboard.activityFeed.emptySub')}</p>
          </div>
        ) : (
          <>
            {groups.map(({ label, entries }) => (
              <div key={label}>
                {/* Day label */}
                <div className="flex items-center gap-2 mb-3 sticky top-0 bg-white py-1 -mx-5 px-5">
                  <span className="text-[10px] font-bold text-ink-300 uppercase tracking-widest whitespace-nowrap">{label}</span>
                  <div className="flex-1 h-px bg-ink-100" />
                </div>

                <div className="space-y-3.5">
                  {entries.map((log) => {
                    const display = ACTION_DISPLAY[log.action] ?? DEFAULT_DISPLAY
                    const verb = t(`activityVerbs.${log.action}`, log.action.replace('.', ' '))
                    const clickable = ['plans', 'activities'].includes(log.table_name)
                    // Some audit actions (e.g. invitation.accepted) aren't
                    // guaranteed to have a denormalised label/name from the
                    // backend yet — fall back rather than crash the feed.
                    const userName = log.user_name || t('dashboard.activityFeed.someone')
                    const firstName = userName.split(' ')[0]
                    const recordLabel = log.record_label || '—'
                    const subject = recordLabel.length > 38
                      ? recordLabel.slice(0, 36) + '…'
                      : recordLabel

                    return (
                      <div
                        key={log.id}
                        onClick={() => clickable && navigate(log.table_name === 'plans' ? `/plans/${log.record_id}` : '/plans')}
                        className={`flex gap-3 group ${clickable ? 'cursor-pointer' : ''}`}
                      >
                        {/* Action icon */}
                        <div className={`size-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${display.bg} ${display.color}`}>
                          {display.icon}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-ink-700 leading-relaxed">
                            <span className="font-semibold text-ink-900">{firstName}</span>
                            {' '}
                            <span className="text-ink-500">{verb}</span>
                            {' '}
                            <span className={`font-medium ${clickable ? 'group-hover:text-accent transition-colors' : ''}`}>
                              "{subject}"
                            </span>
                          </p>
                          {Object.keys(log.diff ?? {}).length > 0 && (
                            <div className="mt-1"><DiffPill diff={log.diff} /></div>
                          )}
                          <p className="text-[10px] text-ink-300 mt-1">{relativeTime(log.created_at, t)}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {!showAll && logs.length > 12 && (
              <button
                onClick={() => setShowAll(true)}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-ink-400 hover:text-accent font-medium py-2 border-t border-ink-50 transition-colors"
              >
                {t('dashboard.activityFeed.more', { count: logs.length - 12 })} <ArrowRight className="size-3" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-ink-100 shrink-0">
        <button
          onClick={() => navigate('/admin?tab=audit')}
          className="flex items-center gap-1.5 text-xs text-ink-400 hover:text-accent font-medium transition-colors"
        >
          {t('dashboard.activityFeed.fullAuditLog')} <ArrowUpRight className="size-3" />
        </button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user     = useAuthStore((s) => s.user)
  const org      = useAuthStore((s) => s.org)
  const { can }  = usePermission()

  const [plans,      setPlans]      = useState<Plan[]>([])
  const [loading,    setLoading]    = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const load = async () => {
    try {
      const data = await plansApi.list()
      // GET /api/v1/plans never returns `progress` — it's explicitly not a
      // backend field on Plan (see the type's own doc comment); it only
      // comes back from GET /plans/{id}/progress. Without this extra
      // fetch-and-merge step every PlanCard's ring and this page's own
      // avg-progress/overdue stats always read as zero, even though
      // ProgressPage.tsx (which does fetch it per plan) shows the real
      // numbers for the same plans. kpi_achievement/kpi_on_track/kpi_scored
      // are fetched the same way, from each plan's activities — see
      // fetchPlanKpiSummary.
      const withProgress = await Promise.all(
        data.map(async (p) => {
          const [progress, kpiSummary] = await Promise.all([
            plansApi.progress(p.id).catch(() => undefined),
            fetchPlanKpiSummary(p.id),
          ])
          const withKpi = { ...p, kpi_achievement: kpiSummary.achievement, kpi_on_track: kpiSummary.onTrack, kpi_scored: kpiSummary.scored }
          return progress ? { ...withKpi, progress } : withKpi
        })
      )
      setPlans(withProgress)
    } catch {
      // leave plans empty
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const h = () => setShowCreate(true)
    window.addEventListener(SHORTCUT_CREATE_EVENT, h)
    return () => window.removeEventListener(SHORTCUT_CREATE_EVENT, h)
  }, [])

  const activePlans  = plans.filter((p) => p.status === 'active').length
  const totalOverdue = plans.reduce((s, p) => s + (p.progress?.overall.overdue ?? 0), 0)
  // Same KPI-achievement-first, activity-status-fallback rule as PlanCard's
  // ring — see the Plan.kpi_achievement doc comment in types/index.ts.
  const avgProgress  = plans.length
    ? Math.round(plans.reduce((s, p) => s + (p.kpi_achievement ?? p.progress?.overall.percent_complete ?? 0), 0) / plans.length) : 0
  const recentPlans  = [...plans]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 6)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? t('dashboard.greetingMorning') : hour < 17 ? t('dashboard.greetingAfternoon') : t('dashboard.greetingEvening')
  const orgInitial = (org?.name ?? t('dashboard.orgFallback')).trim().charAt(0).toUpperCase()
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-7">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="size-11 rounded-2xl bg-gradient-to-br from-accent to-accent-600 flex items-center justify-center text-white font-display font-bold text-lg shrink-0 shadow-sm shadow-accent/25">
            {orgInitial}
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-ink-300 mb-0.5">{today}</p>
            <h1 className="font-display text-2xl font-bold text-ink-900 leading-tight">
              {greeting}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}.
            </h1>
            <p className="text-ink-400 text-sm mt-0.5">
              {org?.name ?? t('dashboard.orgFallback')} · {t('dashboard.subtitle')}
            </p>
          </div>
        </div>
        {can.createPlan && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 shadow-sm shadow-accent/20 transition-all shrink-0"
          >
            <Plus className="size-4" /> {t('dashboard.newPlan')}
          </button>
        )}
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label={t('dashboard.statActivePlans')} loading={loading} value={activePlans}
          sub={t('dashboard.statActivePlansSub', { count: activePlans })}
          accent="bg-emerald-400"
          icon={<div className="size-9 rounded-xl bg-emerald-50 flex items-center justify-center"><TrendingUp className="size-4 text-emerald-600" /></div>}
        />
        <StatCard
          label={t('dashboard.statAvgProgress')} loading={loading} value={`${avgProgress}%`}
          sub={t('dashboard.statAvgProgressSub')}
          accent="bg-blue-400"
          icon={<div className="size-9 rounded-xl bg-blue-50 flex items-center justify-center"><CheckCircle2 className="size-4 text-blue-500" /></div>}
        />
        <StatCard
          label={t('dashboard.statOverdue')} loading={loading} value={totalOverdue} alert={totalOverdue > 0}
          sub={totalOverdue > 0 ? t('dashboard.statOverdueSubAlert') : t('dashboard.statOverdueSubOk')}
          accent="bg-ink-300"
          icon={<div className={`size-9 rounded-xl flex items-center justify-center ${totalOverdue > 0 ? 'bg-red-50' : 'bg-ink-50'}`}><AlertTriangle className={`size-4 ${totalOverdue > 0 ? 'text-red-500' : 'text-ink-300'}`} /></div>}
        />
        <StatCard
          label={t('dashboard.statTotalPlans')} loading={loading} value={plans.length}
          sub={t('dashboard.statTotalPlansSub', { count: plans.filter(p => p.status === 'completed').length })}
          accent="bg-violet-400"
          icon={<div className="size-9 rounded-xl bg-violet-50 flex items-center justify-center"><BarChart2 className="size-4 text-violet-500" /></div>}
        />
      </div>

      {/* ── Overdue alert ───────────────────────────────────────────────────── */}
      {totalOverdue > 0 && (
        <div className="flex items-center gap-4 rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 to-white px-5 py-4">
          <div className="size-9 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="size-4 text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-800">
              {t('dashboard.overdueAlert', { count: totalOverdue })}
            </p>
            <p className="text-xs text-red-500 mt-0.5">{t('dashboard.overdueAlertSub')}</p>
          </div>
          <button
            onClick={() => navigate('/plans')}
            className="flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-800 bg-red-100 hover:bg-red-200 rounded-lg px-3 py-2 transition-colors shrink-0"
          >
            {t('dashboard.viewPlans')} <ArrowRight className="size-3" />
          </button>
        </div>
      )}

      {/* ── Two-column body ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 items-start">

        {/* Plans grid */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-bold text-ink-900">{t('dashboard.recentPlans')}</h2>
            <button
              onClick={() => navigate('/plans')}
              className="flex items-center gap-1 text-xs font-medium text-ink-400 hover:text-accent transition-colors"
            >
              {t('dashboard.viewAll')} <ArrowRight className="size-3" />
            </button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1,2,3,4].map((i) => (
                <div key={i} className="bg-white rounded-2xl border border-ink-100 p-5 animate-pulse space-y-3">
                  <div className="h-4 bg-ink-100 rounded-lg w-3/4" />
                  <div className="h-3 bg-ink-100 rounded w-1/2" />
                  <div className="space-y-2 pt-1">
                    {[1,2,3].map((j) => <div key={j} className="h-1.5 bg-ink-100 rounded-full" />)}
                  </div>
                </div>
              ))}
            </div>
          ) : recentPlans.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-ink-200 p-12">
              <EmptyState
                icon={<Sparkles className="size-10 text-ink-200" />}
                title={t('dashboard.emptyTitle')}
                description={t('dashboard.emptyDesc')}
                action={can.createPlan ? (
                  <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
                  >
                    <Plus className="size-4" /> {t('dashboard.createFirstPlan')}
                  </button>
                ) : undefined}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {recentPlans.map((plan) => (
                <PlanCard key={plan.id} plan={plan} onClick={() => navigate(`/plans/${plan.id}`)} />
              ))}
            </div>
          )}
        </div>

        {/* Activity feed */}
        <ActivityFeed />
      </div>

      {showCreate && <CreatePlanModal onCreated={load} onClose={() => setShowCreate(false)} />}
    </div>
  )
}