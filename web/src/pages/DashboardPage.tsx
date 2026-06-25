import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, AlertTriangle, TrendingUp, CheckCircle2,
  ArrowUpRight, Sparkles, Activity,
  FileText, GitBranch, UserCheck, BarChart2,
  FileOutput, RefreshCw, ArrowRight,
} from 'lucide-react'
import { plansApi, auditApi } from '../api/endpoints'
import { useAuthStore } from '../store/auth'
import { usePermission } from '../hooks'
import { EmptyState } from '../components/ui'
import CreatePlanModal from '../components/plans/CreatePlanModal'
import { SHORTCUT_CREATE_EVENT } from '../components/layout/AppShell'
import type { Plan, PlanStatus, AuditLog, AuditAction } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60)  return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7)   return `${d}d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function groupByDay(logs: AuditLog[]): Array<{ label: string; entries: AuditLog[] }> {
  const groups = new Map<string, AuditLog[]>()
  const now = new Date()
  logs.forEach((log) => {
    const d = new Date(log.created_at)
    const isToday     = d.toDateString() === now.toDateString()
    const isYesterday = d.toDateString() === new Date(Date.now() - 864e5).toDateString()
    const label = isToday ? 'Today'
      : isYesterday ? 'Yesterday'
      : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(log)
  })
  return [...groups.entries()].map(([label, entries]) => ({ label, entries }))
}

// ─── Plan card ────────────────────────────────────────────────────────────────

const PHASE_GRADIENT: Record<string, { track: string; bar: 'p1'|'p2'|'p3' }> = {
  P1: { track: 'bg-amber-50',   bar: 'p1' },
  P2: { track: 'bg-emerald-50', bar: 'p2' },
  P3: { track: 'bg-violet-50',  bar: 'p3' },
}

const STATUS_PILL: Record<PlanStatus, { label: string; cls: string }> = {
  draft:     { label: 'Draft',     cls: 'bg-ink-100 text-ink-500' },
  active:    { label: 'Active',    cls: 'bg-emerald-100 text-emerald-700' },
  review:    { label: 'Review',    cls: 'bg-amber-100 text-amber-700' },
  completed: { label: 'Completed', cls: 'bg-blue-100 text-blue-700' },
  archived:  { label: 'Archived',  cls: 'bg-ink-100 text-ink-400' },
}

function PlanCard({ plan, onClick }: { plan: Plan; onClick: () => void }) {
  const progress   = plan.progress
  const overallPct = progress?.overall_percent ?? 0
  const overdue    = progress?.overdue_count ?? 0
  const pill       = STATUS_PILL[plan.status]

  return (
    <button
      onClick={onClick}
      className="group w-full text-left bg-white rounded-2xl border border-ink-100 p-5
                 hover:border-accent/30 hover:shadow-[0_4px_24px_rgba(75,107,251,0.10)]
                 transition-all duration-200 cursor-pointer"
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-ink-900 text-sm leading-snug truncate group-hover:text-accent transition-colors duration-150">
            {plan.title}
          </p>
          {plan.description && (
            <p className="text-ink-400 text-xs mt-1 line-clamp-1">{plan.description}</p>
          )}
        </div>
        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full ${pill.cls}`}>
          {pill.label}
        </span>
      </div>

      {/* Phase bars — each has its own tinted track */}
      {progress && (
        <div className="space-y-2.5 mb-5">
          {progress.phases.map((p) => {
            const g = PHASE_GRADIENT[p.phase]
            return (
              <div key={p.phase} className="flex items-center gap-3">
                <span className="text-[10px] font-bold tracking-wider text-ink-400 w-5 shrink-0">
                  {p.phase}
                </span>
                <div className={`flex-1 h-1.5 rounded-full ${g.track} overflow-hidden`}>
                  <div
                    className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out ${
                      g.bar === 'p1' ? 'from-amber-400 to-amber-500'
                      : g.bar === 'p2' ? 'from-emerald-400 to-emerald-500'
                      : 'from-violet-400 to-violet-500'
                    }`}
                    style={{ width: `${Math.max(0, Math.min(100, p.percent))}%` }}
                  />
                </div>
                <span className="text-[10px] text-ink-400 tabular-nums w-7 text-right shrink-0">
                  {Math.round(p.percent)}%
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3.5 border-t border-ink-50">
        <div className="flex items-center gap-3">
          {/* Overall ring indicator */}
          <div className="relative size-8 shrink-0">
            <svg viewBox="0 0 32 32" className="size-8 -rotate-90">
              <circle cx="16" cy="16" r="13" fill="none" stroke="#F1F5F9" strokeWidth="3.5" />
              <circle
                cx="16" cy="16" r="13" fill="none"
                stroke={overallPct >= 80 ? '#10B981' : overallPct >= 40 ? '#4B6BFB' : '#94A3B8'}
                strokeWidth="3.5"
                strokeDasharray={`${(overallPct / 100) * 81.7} 81.7`}
                strokeLinecap="round"
                className="transition-all duration-700"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-ink-600 tabular-nums">
              {Math.round(overallPct)}
            </span>
          </div>
          {overdue > 0 ? (
            <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
              <AlertTriangle className="size-3" /> {overdue} overdue
            </span>
          ) : (
            <span className="text-xs text-ink-400">On track</span>
          )}
        </div>
        <ArrowUpRight className="size-4 text-ink-200 group-hover:text-accent group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-150" />
      </div>
    </button>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, loading, alert = false, sub }: {
  label: string
  value: string | number
  icon: React.ReactNode
  loading: boolean
  alert?: boolean
  sub?: string
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border bg-white p-5 ${alert ? 'border-red-200' : 'border-ink-100'}`}>
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

const VERB_MAP: Partial<Record<AuditAction, string>> = {
  'plan.created': 'created',  'plan.updated': 'updated',  'plan.archived': 'archived',
  'plan.deleted': 'deleted',  'plan.duplicated': 'duplicated',
  'activity.created': 'added',  'activity.updated': 'edited',
  'activity.deleted': 'removed', 'activity.status_changed': 'updated',
  'link.created': 'linked',   'link.deleted': 'unlinked',
  'user.invited': 'invited',  'user.role_changed': 'changed role for',
  'user.deactivated': 'deactivated', 'user.reactivated': 'reactivated',
  'invitation.cancelled': 'cancelled invite for', 'invitation.resent': 'resent invite to',
  'report.generated': 'generated report for',
}

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
  const groups    = groupByDay(displayed)

  return (
    <div className="bg-white rounded-2xl border border-ink-100 flex flex-col overflow-hidden" style={{ maxHeight: 660 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100 shrink-0">
        <div className="flex items-center gap-2">
          <div className="size-6 rounded-lg bg-ink-50 flex items-center justify-center">
            <Activity className="size-3.5 text-ink-400" />
          </div>
          <h2 className="font-display text-sm font-bold text-ink-800">Recent activity</h2>
        </div>
        <button onClick={fetchLogs} className="p-1.5 rounded-lg text-ink-300 hover:text-ink-600 hover:bg-ink-50 transition-colors" title="Refresh">
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
            <p className="text-sm text-ink-400">No activity yet</p>
            <p className="text-xs text-ink-300 mt-0.5">Changes appear here as your team works.</p>
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
                    const verb = VERB_MAP[log.action] ?? log.action.replace('.', ' ')
                    const clickable = ['plans', 'activities'].includes(log.table_name)
                    const firstName = log.user_name.split(' ')[0]
                    const subject = log.record_label.length > 38
                      ? log.record_label.slice(0, 36) + '…'
                      : log.record_label

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
                          {Object.keys(log.diff).length > 0 && (
                            <div className="mt-1"><DiffPill diff={log.diff} /></div>
                          )}
                          <p className="text-[10px] text-ink-300 mt-1">{relativeTime(log.created_at)}</p>
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
                {logs.length - 12} more <ArrowRight className="size-3" />
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
          Full audit log <ArrowUpRight className="size-3" />
        </button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate()
  const user     = useAuthStore((s) => s.user)
  const org      = useAuthStore((s) => s.org)
  const { can }  = usePermission()

  const [plans,      setPlans]      = useState<Plan[]>([])
  const [loading,    setLoading]    = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const load = async () => {
    try { setPlans(await plansApi.list()) }
    catch { } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const h = () => setShowCreate(true)
    window.addEventListener(SHORTCUT_CREATE_EVENT, h)
    return () => window.removeEventListener(SHORTCUT_CREATE_EVENT, h)
  }, [])

  const activePlans  = plans.filter((p) => p.status === 'active').length
  const totalOverdue = plans.reduce((s, p) => s + (p.progress?.overdue_count ?? 0), 0)
  const avgProgress  = plans.length
    ? Math.round(plans.reduce((s, p) => s + (p.progress?.overall_percent ?? 0), 0) / plans.length) : 0
  const recentPlans  = [...plans]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 6)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-7">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">
            {greeting}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}.
          </h1>
          <p className="text-ink-400 text-sm mt-0.5">
            {org?.name ?? 'Your organisation'} · Strategic overview
          </p>
        </div>
        {can.createPlan && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 shadow-sm shadow-accent/20 transition-all shrink-0"
          >
            <Plus className="size-4" /> New plan
          </button>
        )}
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active plans" loading={loading} value={activePlans}
          sub={activePlans === 1 ? '1 plan in motion' : `${activePlans} plans in motion`}
          icon={<div className="size-9 rounded-xl bg-emerald-50 flex items-center justify-center"><TrendingUp className="size-4 text-emerald-600" /></div>}
        />
        <StatCard
          label="Avg. progress" loading={loading} value={`${avgProgress}%`}
          sub="Across all active plans"
          icon={<div className="size-9 rounded-xl bg-blue-50 flex items-center justify-center"><CheckCircle2 className="size-4 text-blue-500" /></div>}
        />
        <StatCard
          label="Overdue" loading={loading} value={totalOverdue} alert={totalOverdue > 0}
          sub={totalOverdue > 0 ? 'Needs attention' : 'All on schedule'}
          icon={<div className={`size-9 rounded-xl flex items-center justify-center ${totalOverdue > 0 ? 'bg-red-50' : 'bg-ink-50'}`}><AlertTriangle className={`size-4 ${totalOverdue > 0 ? 'text-red-500' : 'text-ink-300'}`} /></div>}
        />
        <StatCard
          label="Total plans" loading={loading} value={plans.length}
          sub={`${plans.filter(p => p.status === 'completed').length} completed`}
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
              {totalOverdue} {totalOverdue === 1 ? 'activity is' : 'activities are'} overdue.
            </p>
            <p className="text-xs text-red-500 mt-0.5">Review your plans to reassign or reschedule.</p>
          </div>
          <button
            onClick={() => navigate('/plans')}
            className="flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-800 bg-red-100 hover:bg-red-200 rounded-lg px-3 py-2 transition-colors shrink-0"
          >
            View plans <ArrowRight className="size-3" />
          </button>
        </div>
      )}

      {/* ── Two-column body ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 items-start">

        {/* Plans grid */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-bold text-ink-900">Recent plans</h2>
            <button
              onClick={() => navigate('/plans')}
              className="flex items-center gap-1 text-xs font-medium text-ink-400 hover:text-accent transition-colors"
            >
              View all <ArrowRight className="size-3" />
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
                title="No plans yet"
                description="Create your first strategic plan to get started with P1 analysis, P2 strategy, and P3 execution."
                action={can.createPlan ? (
                  <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
                  >
                    <Plus className="size-4" /> Create your first plan
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
