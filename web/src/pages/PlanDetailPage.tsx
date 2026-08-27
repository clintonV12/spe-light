import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import axios from 'axios'
import { ArrowLeft, ChevronDown } from 'lucide-react'
import { plansApi, activitiesApi } from '../api/endpoints'
import { useOfflineStore } from '../store/offline'
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

  // Sits in the header with nothing else on the page to anchor it — without an explicit
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
  // Set by ActivityEditorPage's backDestination() when returning from an
  // objective-nested activity, so the pillar the person was actually
  // working in re-expands instead of LocalPlanBoard defaulting to the
  // first pillar on this fresh mount.
  const initialPillarId = searchParams.get('pillar')
  const navigate = useNavigate()
  const { can } = usePermission()
  const { t } = useTranslation()

  const [plan, setPlan] = useState<Plan | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  // Set instead of `plan` when planId turns out to be a tempId whose
  // create hasn't synced yet (see load() below) — deliberately NOT the
  // same as `plan`/LocalPlanChapters, since every chapter (pillars,
  // vision/mission, SWOT, ...) makes its own API calls keyed off plan.id,
  // none of which are tempId-aware. Rendering the full editor against a
  // ghost id would 404 on every single one of those the moment it
  // mounted. A reduced placeholder is the honest scope for v1: the plan
  // shell itself can be created offline, but populating its chapters
  // still needs the real, server-assigned id first.
  const [pendingTitle, setPendingTitle] = useState<string | null>(null)

  // ── Plan status ─────────────────────────────────────────────────────────
  const [planStatusLoading, setPlanStatusLoading] = useState(false)

  const load = async () => {
    if (!planId) return

    // planId already resolved to a real id (its create synced at some
    // point after this URL was first opened, e.g. this tab was left
    // sitting on the pending placeholder while offline) — jump straight
    // to it rather than ever attempting plansApi.get(planId), which would
    // 404 against an id the server never issued.
    const resolved = useOfflineStore.getState().idMap[planId]
    if (resolved) {
      navigate(`/plans/${resolved}`, { replace: true })
      return
    }

    // planId is a tempId with a create still sitting in the queue —
    // render the lightweight pending placeholder below instead of
    // hitting the network at all.
    const pendingCreate = useOfflineStore.getState().queue.find(
      (op) => op.operation === 'create' && op.tempId === planId,
    )
    if (pendingCreate) {
      setPendingTitle(typeof pendingCreate.payload.title === 'string' ? pendingCreate.payload.title : null)
      setLoading(false)
      return
    }

    try {
      const [p, acts] = await Promise.all([plansApi.get(planId), activitiesApi.list(planId)])
      setPlan(p)
      setActivities(acts ?? [])
    } catch { } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [planId])

  // If this tab is sitting on a pending plan's placeholder when its
  // create finally syncs (useSyncEngine, running elsewhere — AppShell —
  // resolves it independently of whether this page is even focused),
  // jump to the real id automatically rather than leaving the person on
  // a permanently-stale "syncing" screen with no way forward short of a
  // manual reload.
  const resolvedId = useOfflineStore((s) => (planId ? s.idMap[planId] : undefined))
  useEffect(() => {
    if (resolvedId) navigate(`/plans/${resolvedId}`, { replace: true })
  }, [resolvedId, navigate])

  const handlePlanStatusChange = async (status: PlanStatus) => {
    if (!planId) return
    setPlanStatusLoading(true)
    try {
      const updated = await plansApi.update(planId, { status })
      setPlan(updated)
    } catch (err) {
      // Genuine network failure (no response ever received) — queue the
      // real write for useSyncEngine to replay once back online. Unlike
      // ActivityEditorPage's autosave, there's no server response to
      // adopt here (that's the whole problem), so the status change is
      // applied to local state optimistically instead — the alternative
      // is either silently discarding the person's click or leaving the
      // dropdown reverted to the old status with no explanation, both of
      // which are worse than assuming the queued write will eventually
      // succeed (which, functionally, is the same trust the rest of the
      // offline queue already relies on).
      if (axios.isAxiosError(err) && !err.response) {
        useOfflineStore.getState().enqueue({
          operation: 'update',
          resource: `/plans/${planId}`,
          payload: { status },
        })
        setPlan((prev) => (prev ? { ...prev, status } : prev))
      }
      // A real error (validation/permission) is swallowed here exactly as
      // before this change — PlanStatusPicker has no error-display affordance today.
    } finally {
      setPlanStatusLoading(false)
    }
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

  if (pendingTitle !== null) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <button onClick={() => navigate('/plans')} className="flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-700 mb-3 transition-colors">
          <ArrowLeft className="size-4" /> {t('planDetail.backToPlans')}
        </button>
        <div className="rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50 p-8 text-center space-y-2">
          <h1 className="font-display text-xl font-bold text-ink-900">{pendingTitle}</h1>
          <p className="text-sm text-ink-600">
            {t('planDetail.pendingSyncTitle', {
              defaultValue: 'This plan hasn\u2019t synced yet — it was created while offline.',
            })}
          </p>
          <p className="text-xs text-ink-400">
            {t('planDetail.pendingSyncDesc', {
              defaultValue: 'Once you\u2019re back online it\u2019ll upload automatically and this page will jump to it — Strategic Pillars and the other chapters open up from there.',
            })}
          </p>
        </div>
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
        initialExpandedPillarId={initialPillarId ?? undefined}
      />
    </div>
  )
}