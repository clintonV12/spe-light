import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, BarChart2, ChevronDown } from 'lucide-react'
import { plansApi, activitiesApi } from '../api/endpoints'
import { usePermission } from '../hooks'
import LocalPlanChapters from '../components/activities/LocalPlanChapters'
import type { ChapterKey } from '../components/activities/LocalPlanChapters'
import type { Plan, Activity, PlanStatus } from '../types'

const PLAN_STATUS_ORDER: PlanStatus[] = ['draft', 'active', 'review', 'completed', 'archived']

const PLAN_STATUS_DOT: Record<PlanStatus, string> = {
  draft:     'bg-ink-300',
  active:    'bg-p2',
  review:    'bg-p1',
  completed: 'bg-green-500',
  archived:  'bg-ink-400',
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
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  // Sits in the header next to other controls (the Progress button, etc.)
  // with nothing else on the page to anchor it — without an explicit
  // label it can read as referring to whatever's currently in view (the
  // open chapter, an activity) rather than the plan as a whole. The
  // uppercase micro-label above makes that unambiguous.
  const label = (
    <p className="text-[10px] font-bold uppercase tracking-wide text-ink-300 mb-1">
      {t('planDetail.statusLabel', { defaultValue: 'Plan Status' })}
    </p>
  )

  if (disabled) {
    return (
      <div>
        {label}
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-600">
          <span className={`size-2 rounded-full shrink-0 ${PLAN_STATUS_DOT[status]}`} />
          {t(`plan.status.${status}`)}
        </span>
      </div>
    )
  }

  return (
    <div>
      {label}
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 hover:bg-ink-50 transition-colors disabled:opacity-50"
        >
          <span className={`size-2 rounded-full shrink-0 ${PLAN_STATUS_DOT[status]}`} />
          {t(`plan.status.${status}`)}
          <ChevronDown className="size-3.5" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-ink-100 bg-white shadow-lg py-1">
              {PLAN_STATUS_ORDER.map((value) => (
                <button
                  key={value}
                  onClick={() => { onChange(value); setOpen(false) }}
                  disabled={value === status}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-ink-700 hover:bg-ink-50 disabled:opacity-40 disabled:cursor-default"
                >
                  <span className={`size-2 rounded-full shrink-0 ${PLAN_STATUS_DOT[value]}`} />
                  {t(`plan.status.${value}`)}
                </button>
              ))}
            </div>
          </>
        )}
        {loading && <span className="ml-2 size-4 animate-spin rounded-full border-2 border-accent border-t-transparent inline-block align-middle" />}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
//
// Every plan is the pillar/objective (ex-"local") structure now — there is
// no more plan_type branch here. LocalPlanChapters owns the whole body of
// the page, including the optional Advanced Research tab (Chapter 8) for
// the handful of standalone research activities that used to live under
// the old international P1/P2/P3 model.
export default function PlanDetailPage() {
  const { planId } = useParams<{ planId: string }>()
  const [searchParams] = useSearchParams()
  const initialChapter = searchParams.get('tab') as ChapterKey | null
  const navigate = useNavigate()
  const { can } = usePermission()
  const { t } = useTranslation()

  const [plan, setPlan] = useState<Plan | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

  // ── Plan status ─────────────────────────────────────────────────────────
  const [planStatusLoading, setPlanStatusLoading] = useState(false)

  const load = async () => {
    if (!planId) return
    try {
      const [p, acts] = await Promise.all([plansApi.get(planId), activitiesApi.list(planId)])
      setPlan(p)
      setActivities(acts ?? [])
    } catch { } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [planId])

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

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Back + Header */}
      <div>
        <button onClick={() => navigate('/plans')} className="flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-700 mb-3 transition-colors">
          <ArrowLeft className="size-4" /> {t('planDetail.backToPlans')}
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink-900">{plan.title}</h1>
            {plan.description && <p className="text-ink-500 text-sm mt-0.5">{plan.description}</p>}
          </div>
          <div className="flex items-end gap-2 shrink-0">
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
              <BarChart2 className="size-4" /> {t('planDetail.progress')}
            </button>
          </div>
        </div>
      </div>

      <LocalPlanChapters
        plan={plan}
        activities={activities}
        canEdit={can.editActivity}
        canDelete={can.createPlan}
        onChanged={load}
        onPlanUpdated={setPlan}
        initialChapter={initialChapter ?? undefined}
      />
    </div>
  )
}