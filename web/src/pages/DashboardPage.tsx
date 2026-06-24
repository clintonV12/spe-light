import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, AlertTriangle, TrendingUp, CheckCircle2,
  ChevronRight, Sparkles, Activity,
  FileText, GitBranch, UserCheck, BarChart2,
  FileOutput, RefreshCw,
} from 'lucide-react'
import { plansApi, auditApi } from '../api/endpoints'
import { useAuthStore } from '../store/auth'
import { usePermission } from '../hooks'
import { ProgressBar, EmptyState, Badge } from '../components/ui'
import CreatePlanModal from '../components/plans/CreatePlanModal'
import { SHORTCUT_CREATE_EVENT } from '../components/layout/AppShell'
import type { Plan, PlanStatus, AuditLog, AuditAction } from '../types'

// ─── Plan card ────────────────────────────────────────────────────────────────

const STATUS_META: Record<PlanStatus, { label: string; variant: 'neutral' | 'p1' | 'p2' | 'p3' | 'success' }> = {
  draft:     { label: 'Draft',     variant: 'neutral' },
  active:    { label: 'Active',    variant: 'p2' },
  review:    { label: 'Review',    variant: 'p1' },
  completed: { label: 'Completed', variant: 'success' },
  archived:  { label: 'Archived',  variant: 'neutral' },
}

function PlanCard({ plan, onClick }: { plan: Plan; onClick: () => void }) {
  const progress   = plan.progress
  const overallPct = progress?.overall_percent ?? 0
  const overdue    = progress?.overdue_count ?? 0
  const meta       = STATUS_META[plan.status]

  return (
    <div
      onClick={onClick}
      className="group bg-white rounded-2xl border border-ink-100 p-5 hover:shadow-md hover:border-ink-200 transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-ink-900 text-sm leading-snug truncate group-hover:text-accent transition-colors">
            {plan.title}
          </h3>
          {plan.description && (
            <p className="text-ink-400 text-xs mt-0.5 line-clamp-1">{plan.description}</p>
          )}
        </div>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>

      {progress && (
        <div className="space-y-2 mb-4">
          {progress.phases.map((p) => (
            <div key={p.phase} className="flex items-center gap-2">
              <span className={`text-xs font-bold w-6 shrink-0 ${
                p.phase === 'P1' ? 'text-p1-dark' : p.phase === 'P2' ? 'text-p2-dark' : 'text-p3-dark'
              }`}>{p.phase}</span>
              <ProgressBar value={p.percent} variant={p.phase.toLowerCase() as 'p1' | 'p2' | 'p3'} className="flex-1" />
              <span className="text-xs text-ink-400 w-8 text-right">{Math.round(p.percent)}%</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-ink-50">
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-400">{Math.round(overallPct)}% complete</span>
          {overdue > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
              <AlertTriangle className="size-3" /> {overdue} overdue
            </span>
          )}
        </div>
        <ChevronRight className="size-4 text-ink-300 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
      </div>
    </div>
  )
}

// ─── Activity feed ────────────────────────────────────────────────────────────

// Maps an audit action to an icon and a colour class used for the icon bg
const ACTION_DISPLAY: Partial<Record<AuditAction, {
  icon: React.ReactNode
  bg: string
  color: string
}>> = {
  'plan.created':            { icon: <FileText className="size-3.5" />,   bg: 'bg-p2-light',    color: 'text-p2-dark'    },
  'plan.updated':            { icon: <FileText className="size-3.5" />,   bg: 'bg-ink-100',     color: 'text-ink-500'    },
  'plan.archived':           { icon: <FileText className="size-3.5" />,   bg: 'bg-ink-100',     color: 'text-ink-400'    },
  'activity.created':        { icon: <Sparkles className="size-3.5" />,   bg: 'bg-accent-50',   color: 'text-accent'     },
  'activity.status_changed': { icon: <CheckCircle2 className="size-3.5" />,bg: 'bg-p2-light',   color: 'text-p2-dark'    },
  'activity.updated':        { icon: <Activity className="size-3.5" />,   bg: 'bg-ink-100',     color: 'text-ink-500'    },
  'link.created':            { icon: <GitBranch className="size-3.5" />,  bg: 'bg-p3-light',    color: 'text-p3-dark'    },
  'user.invited':            { icon: <UserCheck className="size-3.5" />,  bg: 'bg-p1-light',    color: 'text-p1-dark'    },
  'user.role_changed':       { icon: <UserCheck className="size-3.5" />,  bg: 'bg-p3-light',    color: 'text-p3-dark'    },
  'user.deactivated':        { icon: <UserCheck className="size-3.5" />,  bg: 'bg-red-50',      color: 'text-red-500'    },
  'report.generated':        { icon: <FileOutput className="size-3.5" />, bg: 'bg-p1-light',    color: 'text-p1-dark'    },
}

const DEFAULT_DISPLAY = { icon: <Activity className="size-3.5" />, bg: 'bg-ink-100', color: 'text-ink-500' }

// Short human-readable sentence for each action
function feedSentence(log: AuditLog): { verb: string; subject: string } {
  const label = log.record_label

  const map: Partial<Record<AuditAction, string>> = {
    'plan.created':            `created plan`,
    'plan.updated':            `updated plan`,
    'plan.archived':           `archived plan`,
    'plan.deleted':            `deleted plan`,
    'plan.duplicated':         `duplicated plan`,
    'activity.created':        `added activity`,
    'activity.updated':        `edited activity`,
    'activity.deleted':        `removed activity`,
    'activity.status_changed': `updated status of`,
    'link.created':            `linked`,
    'link.deleted':            `removed link`,
    'user.invited':            `invited`,
    'user.role_changed':       `changed role for`,
    'user.deactivated':        `deactivated`,
    'user.reactivated':        `reactivated`,
    'invitation.cancelled':    `cancelled invite for`,
    'invitation.resent':       `resent invite to`,
    'report.generated':        `generated report`,
  }

  return {
    verb: map[log.action] ?? log.action.replace('.', ' '),
    subject: label,
  }
}

// Diff badge — shows the before→after for status changes etc.
function DiffBadge({ diff }: { diff: AuditLog['diff'] }) {
  const keys = Object.keys(diff)
  if (keys.length === 0) return null
  const key = keys[0]
  const { from, to } = diff[key]
  if (from === null || to === null) return null

  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-ink-400 bg-ink-50 border border-ink-100 rounded px-1.5 py-0.5 mt-1">
      <span className="text-red-400 line-through">{String(from)}</span>
      <span className="text-ink-300">→</span>
      <span className="text-p2-dark">{String(to)}</span>
    </span>
  )
}

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

// Group feed entries by calendar day
function groupByDay(logs: AuditLog[]): Array<{ label: string; entries: AuditLog[] }> {
  const groups = new Map<string, AuditLog[]>()
  const now = new Date()

  logs.forEach((log) => {
    const d = new Date(log.created_at)
    const isToday     = d.toDateString() === now.toDateString()
    const isYesterday = d.toDateString() === new Date(Date.now() - 864e5).toDateString()
    const label = isToday
      ? 'Today'
      : isYesterday
        ? 'Yesterday'
        : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(log)
  })

  return [...groups.entries()].map(([label, entries]) => ({ label, entries }))
}

function ActivityFeed() {
  const navigate = useNavigate()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    auditApi.list({ limit: 25 })
      .then((r) => setLogs(r.logs))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const displayed = showAll ? logs : logs.slice(0, 12)
  const groups = groupByDay(displayed)

  const handleEntryClick = (log: AuditLog) => {
    // Navigate to the relevant plan or activity if we can infer it
    if (log.table_name === 'plans') navigate(`/plans/${log.record_id}`)
    else if (log.table_name === 'activities') {
      // We don't have plan_id on the log directly, so navigate to plans
      // In real mode the backend would return plan_id; for now go to plans
      navigate('/plans')
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden flex flex-col" style={{ maxHeight: 680 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-ink-100 shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-ink-400" />
          <h2 className="font-display text-sm font-bold text-ink-800">Recent activity</h2>
        </div>
        <button
          onClick={() => setLoading((v) => { /* re-fetch */ return v })}
          className="text-ink-300 hover:text-ink-600 transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      {/* Feed */}
      <div className="overflow-y-auto flex-1 px-4 py-3">
        {loading ? (
          <div className="space-y-4 py-2">
            {[1,2,3,4,5].map((i) => (
              <div key={i} className="flex gap-3 animate-pulse">
                <div className="size-7 rounded-full bg-ink-100 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1.5 pt-0.5">
                  <div className="h-3 bg-ink-100 rounded w-5/6" />
                  <div className="h-2.5 bg-ink-100 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Activity className="size-8 text-ink-200 mb-3" />
            <p className="text-sm text-ink-400">No activity yet</p>
            <p className="text-xs text-ink-300 mt-0.5">Changes will appear here as your team works.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {groups.map(({ label, entries }) => (
              <div key={label}>
                {/* Day separator */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-semibold text-ink-400 uppercase tracking-widest whitespace-nowrap">
                    {label}
                  </span>
                  <div className="flex-1 h-px bg-ink-100" />
                </div>

                {/* Entries */}
                <div className="space-y-3">
                  {entries.map((log) => {
                    const display = ACTION_DISPLAY[log.action] ?? DEFAULT_DISPLAY
                    const { verb, subject } = feedSentence(log)
                    const isClickable = log.table_name === 'plans' || log.table_name === 'activities'

                    return (
                      <div
                        key={log.id}
                        onClick={() => isClickable && handleEntryClick(log)}
                        className={`flex gap-3 group ${isClickable ? 'cursor-pointer' : ''}`}
                      >
                        {/* Action icon */}
                        <div className={`size-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${display.bg} ${display.color}`}>
                          {display.icon}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-ink-700 leading-relaxed">
                            <span className="font-semibold text-ink-900">
                              {log.user_name.split(' ')[0]}
                            </span>
                            {' '}
                            <span>{verb}</span>
                            {' '}
                            <span className={`font-medium truncate ${isClickable ? 'group-hover:text-accent transition-colors' : ''}`}>
                              "{subject.length > 40 ? subject.slice(0, 38) + '…' : subject}"
                            </span>
                          </p>

                          {/* Diff badge for status/role changes */}
                          {Object.keys(log.diff).length > 0 && (
                            <DiffBadge diff={log.diff} />
                          )}

                          <p className="text-[10px] text-ink-400 mt-0.5">
                            {relativeTime(log.created_at)}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Show more */}
            {!showAll && logs.length > 12 && (
              <button
                onClick={() => setShowAll(true)}
                className="w-full text-xs text-accent hover:text-accent-700 font-medium py-2 border-t border-ink-50 transition-colors"
              >
                Show {logs.length - 12} more events →
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer — link to full audit log */}
      <div className="px-5 py-3 border-t border-ink-100 bg-ink-50/50 shrink-0">
        <button
          onClick={() => navigate('/admin?tab=audit')}
          className="text-xs text-accent hover:text-accent-700 font-medium transition-colors"
        >
          View full audit log →
        </button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const org  = useAuthStore((s) => s.org)
  const { can } = usePermission()

  const [plans,      setPlans]      = useState<Plan[]>([])
  const [loading,    setLoading]    = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const load = async () => {
    try {
      setPlans(await plansApi.list())
    } catch { } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // 'c' shortcut — open create plan modal on the dashboard
  useEffect(() => {
    const handler = () => setShowCreate(true)
    window.addEventListener(SHORTCUT_CREATE_EVENT, handler)
    return () => window.removeEventListener(SHORTCUT_CREATE_EVENT, handler)
  }, [])

  const activePlans  = plans.filter((p) => p.status === 'active').length
  const totalOverdue = plans.reduce((sum, p) => sum + (p.progress?.overdue_count ?? 0), 0)
  const avgProgress  = plans.length
    ? Math.round(plans.reduce((sum, p) => sum + (p.progress?.overall_percent ?? 0), 0) / plans.length)
    : 0
  const recentPlans  = [...plans]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 6)

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  })()

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">
            {greeting}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}.
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">
            {org?.name ?? 'Your organisation'} · Strategic overview
          </p>
        </div>
        {can.createPlan && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors shrink-0"
          >
            <Plus className="size-4" /> New plan
          </button>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active plans',   value: activePlans,        icon: <TrendingUp  className="size-5 text-p2-dark"  />, bg: 'bg-p2-light',  alert: false },
          { label: 'Avg. progress',  value: `${avgProgress}%`,  icon: <CheckCircle2 className="size-5 text-accent"  />, bg: 'bg-accent-50', alert: false },
          { label: 'Overdue items',  value: totalOverdue,       icon: <AlertTriangle className="size-5 text-red-500" />, bg: 'bg-red-50',   alert: totalOverdue > 0 },
          { label: 'Total plans',    value: plans.length,       icon: <BarChart2   className="size-5 text-p3-dark"  />, bg: 'bg-p3-light',  alert: false },
        ].map(({ label, value, icon, bg, alert }) => (
          <div key={label} className={`rounded-2xl border ${alert ? 'border-red-200' : 'border-ink-100'} bg-white p-5`}>
            <div className={`size-10 rounded-xl ${bg} flex items-center justify-center mb-3`}>{icon}</div>
            <p className="text-2xl font-bold text-ink-900">{loading ? '—' : value}</p>
            <p className="text-xs text-ink-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Overdue alert */}
      {totalOverdue > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
          <AlertTriangle className="size-5 text-red-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-800">
              {totalOverdue} {totalOverdue === 1 ? 'activity is' : 'activities are'} overdue across your plans.
            </p>
            <p className="text-xs text-red-600 mt-0.5">Review your plans to reassign owners or adjust deadlines.</p>
          </div>
          <button onClick={() => navigate('/plans')} className="text-xs font-semibold text-red-700 hover:text-red-900 whitespace-nowrap">
            View plans →
          </button>
        </div>
      )}

      {/* Two-column body: plans + activity feed */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 items-start">

        {/* Left — Recent plans */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-bold text-ink-900">Recent plans</h2>
            <button onClick={() => navigate('/plans')} className="text-xs font-medium text-accent hover:text-accent-700 transition-colors">
              View all →
            </button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1,2,3,4].map((i) => (
                <div key={i} className="bg-white rounded-2xl border border-ink-100 p-5 animate-pulse">
                  <div className="h-4 bg-ink-100 rounded w-3/4 mb-3" />
                  <div className="h-3 bg-ink-100 rounded w-1/2 mb-4" />
                  <div className="space-y-2">{[1,2,3].map((j) => <div key={j} className="h-2 bg-ink-100 rounded" />)}</div>
                </div>
              ))}
            </div>
          ) : recentPlans.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="size-10" />}
              title="No plans yet"
              description="Create your first strategic plan to get started."
              action={can.createPlan ? (
                <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors">
                  <Plus className="size-4" /> Create your first plan
                </button>
              ) : undefined}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {recentPlans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  onClick={() => navigate(`/plans/${plan.id}`)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right — Activity feed */}
        <ActivityFeed />
      </div>

      {showCreate && <CreatePlanModal onCreated={load} onClose={() => setShowCreate(false)} />}
    </div>
  )
}
