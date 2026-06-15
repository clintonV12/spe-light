import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, AlertTriangle, TrendingUp, CheckCircle2,
  Clock, ChevronRight, Sparkles,
} from 'lucide-react'
import { plansApi } from '../api/endpoints'
import { useAuthStore } from '../store/auth'
import { usePermission } from '../hooks'
import { ProgressBar, EmptyState, Badge } from '../components/ui'
import CreatePlanModal from '../components/plans/CreatePlanModal'
import type { Plan, PlanStatus } from '../types'

const STATUS_META: Record<PlanStatus, { label: string; variant: 'neutral' | 'p1' | 'p2' | 'p3' | 'success' }> = {
  draft:     { label: 'Draft',       variant: 'neutral' },
  active:    { label: 'Active',      variant: 'p2' },
  review:    { label: 'Review',      variant: 'p1' },
  completed: { label: 'Completed',   variant: 'success' },
  archived:  { label: 'Archived',    variant: 'neutral' },
}

function PlanCard({ plan, onClick }: { plan: Plan; onClick: () => void }) {
  const progress = plan.progress
  const overallPct = progress?.overall_percent ?? 0
  const overdue = progress?.overdue_count ?? 0
  const meta = STATUS_META[plan.status]

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

      {/* Phase progress bars */}
      {progress && (
        <div className="space-y-2 mb-4">
          {progress.phases.map((p) => (
            <div key={p.phase} className="flex items-center gap-2">
              <span className={`text-xs font-bold w-6 shrink-0 ${
                p.phase === 'P1' ? 'text-p1-dark' : p.phase === 'P2' ? 'text-p2-dark' : 'text-p3-dark'
              }`}>{p.phase}</span>
              <ProgressBar
                value={p.percent}
                variant={p.phase.toLowerCase() as 'p1' | 'p2' | 'p3'}
                className="flex-1"
              />
              <span className="text-xs text-ink-400 w-8 text-right">{Math.round(p.percent)}%</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-ink-50">
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-400">
            {Math.round(overallPct)}% complete
          </span>
          {overdue > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
              <AlertTriangle className="size-3" />
              {overdue} overdue
            </span>
          )}
        </div>
        <ChevronRight className="size-4 text-ink-300 group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const org = useAuthStore((s) => s.org)
  const { can } = usePermission()

  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const load = async () => {
    try {
      const data = await plansApi.list()
      setPlans(data)
    } catch {
      // silently fail — offline state handled by banner
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // Stats derived from plans
  const activePlans = plans.filter((p) => p.status === 'active').length
  const totalOverdue = plans.reduce((sum, p) => sum + (p.progress?.overdue_count ?? 0), 0)
  const avgProgress = plans.length
    ? Math.round(plans.reduce((sum, p) => sum + (p.progress?.overall_percent ?? 0), 0) / plans.length)
    : 0
  const recentPlans = [...plans]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 6)

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  })()

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
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
          {
            label: 'Active plans',
            value: activePlans,
            icon: <TrendingUp className="size-5 text-p2-dark" />,
            bg: 'bg-p2-light',
          },
          {
            label: 'Avg. progress',
            value: `${avgProgress}%`,
            icon: <CheckCircle2 className="size-5 text-accent" />,
            bg: 'bg-accent-50',
          },
          {
            label: 'Overdue items',
            value: totalOverdue,
            icon: <AlertTriangle className="size-5 text-red-500" />,
            bg: 'bg-red-50',
            alert: totalOverdue > 0,
          },
          {
            label: 'Total plans',
            value: plans.length,
            icon: <Clock className="size-5 text-p3-dark" />,
            bg: 'bg-p3-light',
          },
        ].map(({ label, value, icon, bg, alert }) => (
          <div key={label} className={`rounded-2xl border ${alert ? 'border-red-200' : 'border-ink-100'} bg-white p-5`}>
            <div className={`size-10 rounded-xl ${bg} flex items-center justify-center mb-3`}>
              {icon}
            </div>
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
            <p className="text-xs text-red-600 mt-0.5">
              Review your plans to reassign owners or adjust deadlines.
            </p>
          </div>
          <button
            onClick={() => navigate('/plans')}
            className="text-xs font-semibold text-red-700 hover:text-red-900 whitespace-nowrap"
          >
            View plans →
          </button>
        </div>
      )}

      {/* Recent plans */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-base font-bold text-ink-900">Recent plans</h2>
          <button
            onClick={() => navigate('/plans')}
            className="text-xs font-medium text-accent hover:text-accent-700 transition-colors"
          >
            View all →
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl border border-ink-100 p-5 animate-pulse">
                <div className="h-4 bg-ink-100 rounded w-3/4 mb-3" />
                <div className="h-3 bg-ink-100 rounded w-1/2 mb-4" />
                <div className="space-y-2">
                  {[1,2,3].map((j) => <div key={j} className="h-2 bg-ink-100 rounded" />)}
                </div>
              </div>
            ))}
          </div>
        ) : recentPlans.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="size-10" />}
            title="No plans yet"
            description="Create your first strategic plan to get started with P1 analysis, P2 strategy definition, and P3 execution."
            action={
              can.createPlan ? (
                <button
                  onClick={() => setShowCreate(true)}
                  className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
                >
                  <Plus className="size-4" /> Create your first plan
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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

      {showCreate && (
        <CreatePlanModal onCreated={load} onClose={() => setShowCreate(false)} />
      )}
    </div>
  )
}
