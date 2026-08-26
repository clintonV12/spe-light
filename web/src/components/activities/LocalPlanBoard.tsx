import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown, ChevronRight, Plus, Trash2, Pencil, Check, X, Layers, Target, Clock,
} from 'lucide-react'
import { pillarsApi, activitiesApi } from '../../api/endpoints'
import { useToast } from '../../hooks'
import { EmptyState } from '../ui'
import CreateActivityModal, { LOCAL_ACTIVITY_TYPE } from './CreateActivityModal'
import { useAiDraft, AiAssistTrigger, AiAssistPanel } from './AiChapterAssist'
import type { Plan, Activity, StrategicPillar, StrategicObjective, ActivityStatus, KPIPeriod } from '../../types'

const STATUS_DOT: Record<ActivityStatus, string> = {
  not_started: 'bg-ink-300',
  in_progress: 'bg-p2',
  review:      'bg-p1',
  complete:    'bg-green-500',
}

// Budget/Responsibility/Target Period live on each KPI, not on Activity
// itself (an activity can carry several KPIs with different values for all
// three) — see the KPI doc comment in types/index.ts. For the compact
// activity row below, summarise across an activity's KPIs rather than
// reading a field that no longer exists on Activity: total budget is the
// sum of every KPI that has one set, and the period shown is the first
// KPI's target_period (activities' KPIs are usually tracked on the same
// cadence in practice, so showing just one avoids a cluttered row).
function activityKpiSummary(activity: Activity): { period?: KPIPeriod; totalBudget?: number } {
  const kpis = activity.kpis ?? []
  const period = kpis.find((k) => k.target_period)?.target_period
  const budgets = kpis.map((k) => k.budget).filter((b): b is number => typeof b === 'number')
  const totalBudget = budgets.length > 0 ? budgets.reduce((sum, b) => sum + b, 0) : undefined
  return { period, totalBudget }
}

interface LocalPlanBoardProps {
  plan: Plan
  activities: Activity[]
  canEdit: boolean
  /** Mirrors PlanDetailPage's canDelete (can.createPlan) for parity with the international view's delete UI. */
  canDelete: boolean
  /** Re-fetches plan + activities (and, inside this component, pillars/objectives) */
  onChanged: () => void
  /**
   * Pillar id to expand on initial load instead of defaulting to the first
   * pillar — set by PlanDetailPage from the `pillar` query param when
   * returning from an activity/KPI editor (see ActivityEditorPage's
   * backDestination). Without this, every save-and-return remounts this
   * component with a fresh `expanded` set and silently snaps back to
   * pillar one, regardless of which pillar was actually being worked on.
   */
  initialExpandedPillarId?: string
}

// ─── Inline "add pillar" / "add objective" row ─────────────────────────────
function InlineAddRow({ placeholder, onSubmit, loading }: {
  placeholder: string
  onSubmit: (title: string) => void
  loading: boolean
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const submit = () => {
    if (!value.trim()) return
    onSubmit(value.trim())
    setValue('')
  }
  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        placeholder={placeholder}
        className="flex-1 rounded-lg border border-dashed border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-accent focus:border-solid"
      />
      <button
        onClick={submit}
        disabled={loading || !value.trim()}
        className="flex items-center gap-1 rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100 transition-colors disabled:opacity-50"
      >
        <Plus className="size-3.5" /> {t('common.add', { defaultValue: 'Add' })}
      </button>
    </div>
  )
}

// ─── Inline "rename" text — click the pencil to swap a title for a text
// input, Enter/checkmark to save, Escape/X to cancel. Shared by the pillar
// header and the objective row so both get the same edit affordance instead
// of only offering delete. ───────────────────────────────────────────────
function EditableTitle({ value, onSave, saving, textClassName, inputClassName }: {
  value: string
  onSave: (title: string) => void
  saving: boolean
  textClassName: string
  inputClassName: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const start = (e: ReactMouseEvent) => {
    e.stopPropagation()
    setDraft(value)
    setEditing(true)
  }
  const cancel = (e?: ReactMouseEvent | ReactKeyboardEvent) => {
    e?.stopPropagation()
    setEditing(false)
    setDraft(value)
  }
  const commit = (e?: ReactMouseEvent | ReactKeyboardEvent) => {
    e?.stopPropagation()
    const trimmed = draft.trim()
    if (!trimmed || trimmed === value) {
      setEditing(false)
      return
    }
    onSave(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <span className="flex-1 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e)
            if (e.key === 'Escape') cancel(e)
          }}
          onBlur={() => commit()}
          className={inputClassName}
        />
        <button onMouseDown={(e) => commit(e)} disabled={saving} className="text-accent hover:text-accent-600 shrink-0 p-0.5">
          <Check className="size-3.5" />
        </button>
        <button onMouseDown={(e) => cancel(e)} disabled={saving} className="text-ink-300 hover:text-ink-600 shrink-0 p-0.5">
          <X className="size-3.5" />
        </button>
      </span>
    )
  }

  return (
    <span className="flex-1 flex items-center gap-1.5 min-w-0 group">
      <span className={textClassName}>{value}</span>
      <button
        onClick={start}
        className="shrink-0 p-0.5 text-ink-300 opacity-0 group-hover:opacity-100 hover:text-accent transition-opacity"
      >
        <Pencil className="size-3" />
      </button>
    </span>
  )
}

// Draft shape shared by the per-pillar "Suggest objectives" and per-
// objective "Suggest activities" generations — both are tolerant of either
// a plain string array or `{title}` objects, matching the same defensive-
// parsing style parseKpiDraft (AiChapterAssist.tsx) uses for other
// structured draft types, since the exact shape depends on ai_service.go's
// prompt and is easy to get subtly wrong on either side.
function parseTitleListDraft(draft: Record<string, unknown>, key: string): string[] {
  const list = Array.isArray(draft[key]) ? draft[key] as unknown[] : []
  const titles: string[] = []
  for (const raw of list) {
    const title = typeof raw === 'string'
      ? raw.trim()
      : typeof raw === 'object' && raw !== null && typeof (raw as { title?: unknown }).title === 'string'
        ? ((raw as { title: string }).title).trim()
        : ''
    if (title) titles.push(title)
  }
  return titles
}

// One Strategic Pillar's row, including its own "Suggest objectives" AI
// flow. Pulled out into its own component (rather than inlined in
// LocalPlanBoard's pillars.map) specifically so each pillar gets its own
// useAiDraft() hook instance — hooks can't be called conditionally/in a
// loop within one component, and each pillar needs an independent
// draft/attempts session scoped to just that pillar's own generation.
function PillarSection({
  plan, pillar, pillarObjectives, activitiesByObjective, isOpen, onToggle,
  canEdit, canDelete, busy,
  onRenamePillar, onDeletePillar, onRenameObjective, onDeleteObjective,
  onAddObjective, onAddActivityFor, onDeleteActivityRequest, onObjectivesGenerated,
  navigate, t,
}: {
  plan: Plan
  pillar: StrategicPillar
  pillarObjectives: StrategicObjective[]
  activitiesByObjective: Map<string, Activity[]>
  isOpen: boolean
  onToggle: () => void
  canEdit: boolean
  canDelete: boolean
  busy: boolean
  onRenamePillar: (title: string) => void
  onDeletePillar: () => void
  onRenameObjective: (objectiveId: string, title: string) => void
  onDeleteObjective: (objectiveId: string) => void
  onAddObjective: (title: string) => void
  onAddActivityFor: (objectiveId: string) => void
  onDeleteActivityRequest: (activity: Activity) => void
  /** Called after objectives are created from an accepted draft, so the parent reloads pillars/objectives and activities. */
  onObjectivesGenerated: () => void
  navigate: ReturnType<typeof useNavigate>
  t: ReturnType<typeof useTranslation>['t']
}) {
  // Grounded in this one pillar via pillar_id — see useAiDraft's
  // extraContext param (AiChapterAssist.tsx) and ai_service.go's
  // "local_pillar_objectives" case, which must read pillar_id (and the
  // pillar's own title, looked up server-side) rather than generating
  // generic objectives detached from the pillar they'll be saved under.
  const ai = useAiDraft(plan.id, 'local_pillar_objectives', undefined, { pillar_id: pillar.id })

  const handleAiAcceptObjectives = async (draft: Record<string, unknown>) => {
    const titles = parseTitleListDraft(draft, 'objectives')
    for (const title of titles) {
      try {
        await pillarsApi.createObjective(pillar.id, { title })
      } catch {
        // best-effort — skip an objective that fails to save rather than aborting the rest
      }
    }
    onObjectivesGenerated()
  }

  return (
    <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle() }}
        className="w-full flex items-center gap-2 px-5 py-4 hover:bg-ink-50 transition-colors text-left cursor-pointer"
      >
        {isOpen ? <ChevronDown className="size-4 text-ink-400 shrink-0" /> : <ChevronRight className="size-4 text-ink-400 shrink-0" />}
        <Layers className="size-4 text-accent shrink-0" />
        {canEdit ? (
          <EditableTitle
            value={pillar.title}
            onSave={onRenamePillar}
            saving={busy}
            textClassName="font-display font-bold text-sm text-ink-900"
            inputClassName="flex-1 min-w-0 rounded-lg border border-accent-200 px-2 py-1 text-sm font-display font-bold text-ink-900 outline-none focus:border-accent"
          />
        ) : (
          <span className="font-display font-bold text-sm text-ink-900 flex-1">{pillar.title}</span>
        )}
        <span className="text-xs text-ink-400">
          {t('localPlan.objectiveCount', { count: pillarObjectives.length, defaultValue: `${pillarObjectives.length} objectives` })}
        </span>
        {canEdit && (
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); onDeletePillar() }}
            className="text-ink-300 hover:text-red-500 transition-colors p-1"
          >
            <Trash2 className="size-3.5" />
          </span>
        )}
      </div>

      {isOpen && (
        <div className="px-5 pb-4 space-y-3 border-t border-ink-50 pt-3">
          {canEdit && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-xs text-ink-400">
                {t('localPlan.objectivesSubtitle', { defaultValue: 'Strategic Objectives (KPAs) under this pillar.' })}
              </p>
              <AiAssistTrigger onClick={ai.start} label="Suggest objectives" />
            </div>
          )}

          {ai.open && (
            <AiAssistPanel
              keywords={ai.keywords}
              onKeywordsChange={ai.setKeywords}
              onGenerate={ai.generate}
              loading={ai.loading}
              applying={ai.applying}
              draft={ai.draft}
              model={ai.model}
              attempts={ai.attempts}
              currentIndex={ai.currentIndex}
              onSelectAttempt={ai.selectAttempt}
              onRegenerate={ai.generate}
              onClose={ai.close}
              onAccept={() => ai.accept(handleAiAcceptObjectives)}
            />
          )}

          {pillarObjectives.map((objective) => (
            <ObjectiveRow
              key={objective.id}
              plan={plan}
              objective={objective}
              objActivities={activitiesByObjective.get(objective.id) ?? []}
              canEdit={canEdit}
              canDelete={canDelete}
              busy={busy}
              onRenameObjective={(title) => onRenameObjective(objective.id, title)}
              onDeleteObjective={() => onDeleteObjective(objective.id)}
              onAddActivityFor={() => onAddActivityFor(objective.id)}
              onDeleteActivityRequest={onDeleteActivityRequest}
              onActivitiesGenerated={onObjectivesGenerated}
              navigate={navigate}
              t={t}
            />
          ))}

          {canEdit && (
            <InlineAddRow
              placeholder={t('localPlan.newObjectivePlaceholder', { defaultValue: 'New Strategic Objective (KPA)…' })}
              onSubmit={onAddObjective}
              loading={busy}
            />
          )}
        </div>
      )}
    </div>
  )
}

// One Strategic Objective's row, including its own "Suggest activities" AI
// flow. Pulled out into its own component for the same reason PillarSection
// was: each objective needs an independent useAiDraft() hook instance,
// which isn't possible calling the hook inside PillarSection's own
// pillarObjectives.map() loop.
function ObjectiveRow({
  plan, objective, objActivities, canEdit, canDelete, busy,
  onRenameObjective, onDeleteObjective, onAddActivityFor, onDeleteActivityRequest,
  onActivitiesGenerated, navigate, t,
}: {
  plan: Plan
  objective: StrategicObjective
  objActivities: Activity[]
  canEdit: boolean
  canDelete: boolean
  busy: boolean
  onRenameObjective: (title: string) => void
  onDeleteObjective: () => void
  onAddActivityFor: () => void
  onDeleteActivityRequest: (activity: Activity) => void
  /** Called after activities are created from an accepted draft, so the parent reloads pillars/objectives and activities. */
  onActivitiesGenerated: () => void
  navigate: ReturnType<typeof useNavigate>
  t: ReturnType<typeof useTranslation>['t']
}) {
  // Grounded in this one objective via objective_id — see useAiDraft's
  // extraContext param (AiChapterAssist.tsx) and ai_service.go's
  // "local_objective_activities" case, which must read objective_id (and
  // the objective's own title, plus its pillar's title, looked up
  // server-side) rather than generating generic activities detached from
  // the objective they'll be saved under.
  const ai = useAiDraft(plan.id, 'local_objective_activities', undefined, { objective_id: objective.id })

  const handleAiAcceptActivities = async (draft: Record<string, unknown>) => {
    const titles = parseTitleListDraft(draft, 'activities')
    for (const title of titles) {
      try {
        // Same shape CreateActivityModal.tsx creates an ordinary
        // objective-nested activity with — LOCAL_ACTIVITY_TYPE is
        // imported from there rather than redeclared, so an
        // AI-generated activity is indistinguishable from a hand-created
        // one everywhere downstream (ActivityCard's type lookup, etc.).
        await activitiesApi.create(plan.id, {
          objective_id: objective.id,
          type: LOCAL_ACTIVITY_TYPE,
          title,
          content: {},
        })
      } catch {
        // best-effort — skip an activity that fails to save rather than aborting the rest
      }
    }
    onActivitiesGenerated()
  }

  return (
    <div className="rounded-xl border border-ink-100 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Target className="size-3.5 text-p2 shrink-0" />
        {canEdit ? (
          <EditableTitle
            value={objective.title}
            onSave={onRenameObjective}
            saving={busy}
            textClassName="text-sm font-semibold text-ink-800"
            inputClassName="flex-1 min-w-0 rounded-lg border border-accent-200 px-2 py-1 text-sm font-semibold text-ink-800 outline-none focus:border-accent"
          />
        ) : (
          <p className="text-sm font-semibold text-ink-800 flex-1">{objective.title}</p>
        )}
        {canEdit && (
          <>
            <AiAssistTrigger onClick={ai.start} label="Suggest activities" />
            <button
              onClick={onAddActivityFor}
              className="flex items-center gap-1 text-xs text-accent hover:text-accent-600 transition-colors"
            >
              <Plus className="size-3.5" /> {t('localPlan.addActivity', { defaultValue: 'Activity' })}
            </button>
            <button
              onClick={onDeleteObjective}
              className="text-ink-300 hover:text-red-500 transition-colors"
            >
              <Trash2 className="size-3.5" />
            </button>
          </>
        )}
      </div>

      {ai.open && (
        <div className="mb-2">
          <AiAssistPanel
            keywords={ai.keywords}
            onKeywordsChange={ai.setKeywords}
            onGenerate={ai.generate}
            loading={ai.loading}
            applying={ai.applying}
            draft={ai.draft}
            model={ai.model}
            attempts={ai.attempts}
            currentIndex={ai.currentIndex}
            onSelectAttempt={ai.selectAttempt}
            onRegenerate={ai.generate}
            onClose={ai.close}
            onAccept={() => ai.accept(handleAiAcceptActivities)}
          />
        </div>
      )}

      {objActivities.length === 0 ? (
        <p className="text-xs text-ink-300 italic pl-5">
          {t('localPlan.noActivities', { defaultValue: 'No activities yet' })}
        </p>
      ) : (
        <div className="divide-y divide-ink-50 pl-5">
          {objActivities.map((a) => {
            const { period, totalBudget } = activityKpiSummary(a)
            return (
            <div
              key={a.id}
              className="group w-full flex items-center gap-2 py-2 hover:bg-ink-50 -mx-2 px-2 rounded-lg transition-colors"
            >
              <button
                onClick={() => navigate(`/plans/${plan.id}/activities/${a.id}`)}
                className="flex-1 min-w-0 flex items-center gap-2 text-left"
              >
                <span className={`size-2 rounded-full shrink-0 ${STATUS_DOT[a.status]}`} />
                <span className="flex-1 min-w-0 text-sm text-ink-700 truncate">{a.title}</span>
                {period && (
                  <span className="flex items-center gap-1 text-[11px] text-ink-400 shrink-0">
                    <Clock className="size-3" /> {period.charAt(0).toUpperCase() + period.slice(1)}
                  </span>
                )}
                {typeof totalBudget === 'number' && (
                  <span className="text-[11px] text-ink-400 shrink-0">
                    {totalBudget.toLocaleString(undefined, { style: 'currency', currency: 'SZL', maximumFractionDigits: 0 })}
                  </span>
                )}
              </button>
              {canDelete && (
                <button
                  onClick={() => onDeleteActivityRequest(a)}
                  className="shrink-0 p-1 rounded-lg text-ink-300 opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title={t('planDetail.deleteActivityConfirm', { defaultValue: 'Delete activity' })}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          )})}
        </div>
      )}
    </div>
  )
}

export default function LocalPlanBoard({ plan, activities, canEdit, canDelete, onChanged, initialExpandedPillarId }: LocalPlanBoardProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { success, error: toastError } = useToast()

  const [pillars, setPillars] = useState<StrategicPillar[]>([])
  const [objectives, setObjectives] = useState<StrategicObjective[]>([])
  const [loading, setLoading] = useState(true)
  // Left empty here on purpose — we don't yet know if initialExpandedPillarId
  // (from the URL) actually refers to a real pillar. Resolved once pillars
  // have loaded, in `load()` below.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [addActivityFor, setAddActivityFor] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Activity | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const ai = useAiDraft(plan.id, 'local_pillars')

  const load = () => {
    setLoading(true)
    Promise.all([pillarsApi.list(plan.id), pillarsApi.listObjectives(plan.id)])
      .then(([p, o]) => {
        const pillarList = p ?? []
        const objectiveList = o ?? []
        setPillars(pillarList)
        setObjectives(objectiveList)
        // Default to the pillar we were asked to return to (see
        // initialExpandedPillarId), falling back to the first pillar only
        // so the board isn't empty-looking when there's no such request —
        // e.g. landing here fresh from the plan list rather than coming
        // back from an activity/KPI save.
        if (pillarList.length > 0) {
          setExpanded((prev) => {
            if (prev.size > 0) return prev
            const target = initialExpandedPillarId && pillarList.some((p) => p.id === initialExpandedPillarId)
              ? initialExpandedPillarId
              : pillarList[0].id
            return new Set([target])
          })
        }
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [plan.id])

  const activitiesByObjective = useMemo(() => {
    const map = new Map<string, Activity[]>()
    for (const a of activities) {
      if (!a.objective_id) continue
      const list = map.get(a.objective_id) ?? []
      list.push(a)
      map.set(a.objective_id, list)
    }
    return map
  }, [activities])

  const objectivesByPillar = useMemo(() => {
    const map = new Map<string, StrategicObjective[]>()
    for (const o of objectives) {
      const list = map.get(o.pillar_id) ?? []
      list.push(o)
      map.set(o.pillar_id, list)
    }
    return map
  }, [objectives])

  const togglePillar = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAddPillar = async (title: string) => {
    setBusy(true)
    try {
      await pillarsApi.create(plan.id, { title })
      success(t('localPlan.pillarAdded', { defaultValue: 'Pillar added' }))
      load()
    } catch {
      toastError(t('localPlan.pillarAddFailed', { defaultValue: 'Could not add pillar' }))
    } finally {
      setBusy(false)
    }
  }

  const handleAddObjective = async (pillarId: string, title: string) => {
    setBusy(true)
    try {
      await pillarsApi.createObjective(pillarId, { title })
      success(t('localPlan.objectiveAdded', { defaultValue: 'Objective added' }))
      load()
    } catch {
      toastError(t('localPlan.objectiveAddFailed', { defaultValue: 'Could not add objective' }))
    } finally {
      setBusy(false)
    }
  }

  const handleRenamePillar = async (pillarId: string, title: string) => {
    setBusy(true)
    try {
      await pillarsApi.update(pillarId, { title })
      success(t('localPlan.pillarRenamed', { defaultValue: 'Pillar updated' }))
      load()
    } catch {
      toastError(t('localPlan.pillarRenameFailed', { defaultValue: 'Could not update pillar' }))
    } finally {
      setBusy(false)
    }
  }

  const handleDeletePillar = async (pillarId: string) => {
    setBusy(true)
    try {
      await pillarsApi.delete(pillarId)
      success(t('localPlan.pillarDeleted', { defaultValue: 'Pillar deleted' }))
      load()
    } catch {
      toastError(t('localPlan.pillarDeleteFailed', {
        defaultValue: 'Could not delete pillar — remove its objectives first',
      }))
    } finally {
      setBusy(false)
    }
  }

  const handleRenameObjective = async (objectiveId: string, title: string) => {
    setBusy(true)
    try {
      await pillarsApi.updateObjective(objectiveId, { title })
      success(t('localPlan.objectiveRenamed', { defaultValue: 'Objective updated' }))
      load()
    } catch {
      toastError(t('localPlan.objectiveRenameFailed', { defaultValue: 'Could not update objective' }))
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteObjective = async (objectiveId: string) => {
    setBusy(true)
    try {
      await pillarsApi.deleteObjective(objectiveId)
      success(t('localPlan.objectiveDeleted', { defaultValue: 'Objective deleted' }))
      load()
    } catch {
      toastError(t('localPlan.objectiveDeleteFailed', {
        defaultValue: 'Could not delete objective — remove its activities first',
      }))
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteActivity = async (activity: Activity) => {
    setDeleteLoading(true)
    try {
      await activitiesApi.delete(activity.id)
      success(t('planDetail.deleteActivityConfirm', { defaultValue: 'Activity deleted' }))
      onChanged()
    } catch {
      toastError(t('localPlan.activityDeleteFailed', { defaultValue: 'Could not delete activity' }))
    } finally {
      setDeleteLoading(false)
      setDeleteTarget(null)
    }
  }

  const handleAiAcceptPillars = async (draft: Record<string, unknown>) => {
    // Pillars only — objectives are a separate, per-pillar generation now
    // (see PillarSection's own `ai` below), so any `objectives` field the
    // backend still returns on this draft shape is intentionally ignored
    // here rather than silently bulk-creating them alongside the pillars.
    const list = Array.isArray(draft.pillars) ? draft.pillars as unknown[] : []
    for (const raw of list) {
      if (typeof raw !== 'object' || raw === null) continue
      const row = raw as { title?: unknown }
      const pillarTitle = typeof row.title === 'string' ? row.title.trim() : ''
      if (!pillarTitle) continue
      try {
        await pillarsApi.create(plan.id, { title: pillarTitle })
      } catch {
        // best-effort — skip a pillar that fails to save rather than aborting the rest
      }
    }
    load()
    onChanged()
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-ink-100 rounded-2xl animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-bold text-ink-900">Strategic Pillars</h3>
          <p className="text-xs text-ink-400">Pillars, their Strategic Objectives (KPAs), and the activities under each.</p>
        </div>
        {canEdit && <AiAssistTrigger onClick={ai.start} label="Suggest pillars" />}
      </div>

      {ai.open && (
        <AiAssistPanel
          keywords={ai.keywords}
          onKeywordsChange={ai.setKeywords}
          onGenerate={ai.generate}
          loading={ai.loading}
          applying={ai.applying}
          draft={ai.draft}
          model={ai.model}
          attempts={ai.attempts}
          currentIndex={ai.currentIndex}
          onSelectAttempt={ai.selectAttempt}
          onRegenerate={ai.generate}
          onClose={ai.close}
          onAccept={() => ai.accept(handleAiAcceptPillars)}
        />
      )}

      {pillars.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-100 p-6">
          <EmptyState
            icon={<Layers className="size-8" />}
            title={t('localPlan.emptyTitle', { defaultValue: 'No Strategic Pillars yet' })}
            description={t('localPlan.emptyDesc', {
              defaultValue: 'Start by adding the Strategic Pillars for this plan (e.g. Leadership & Governance, Financial Stability).',
            })}
          />
          {canEdit && (
            <div className="mt-4 max-w-sm mx-auto">
              <InlineAddRow
                placeholder={t('localPlan.newPillarPlaceholder', { defaultValue: 'New Strategic Pillar name…' })}
                onSubmit={handleAddPillar}
                loading={busy}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          {pillars.map((pillar) => (
            <PillarSection
              key={pillar.id}
              plan={plan}
              pillar={pillar}
              pillarObjectives={objectivesByPillar.get(pillar.id) ?? []}
              activitiesByObjective={activitiesByObjective}
              isOpen={expanded.has(pillar.id)}
              onToggle={() => togglePillar(pillar.id)}
              canEdit={canEdit}
              canDelete={canDelete}
              busy={busy}
              onRenamePillar={(title) => handleRenamePillar(pillar.id, title)}
              onDeletePillar={() => handleDeletePillar(pillar.id)}
              onRenameObjective={handleRenameObjective}
              onDeleteObjective={handleDeleteObjective}
              onAddObjective={(title) => handleAddObjective(pillar.id, title)}
              onAddActivityFor={setAddActivityFor}
              onDeleteActivityRequest={setDeleteTarget}
              onObjectivesGenerated={() => { load(); onChanged() }}
              navigate={navigate}
              t={t}
            />
          ))}

          {canEdit && (
            <div className="bg-white rounded-2xl border border-ink-100 p-4">
              <InlineAddRow
                placeholder={t('localPlan.newPillarPlaceholder', { defaultValue: 'New Strategic Pillar name…' })}
                onSubmit={handleAddPillar}
                loading={busy}
              />
            </div>
          )}
        </>
      )}

      {addActivityFor && (
        <CreateActivityModal
          planId={plan.id}
          plan={plan}
          defaultObjectiveId={addActivityFor}
          onCreated={() => { load(); onChanged() }}
          onClose={() => setAddActivityFor(null)}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white rounded-2xl border border-ink-100 shadow-xl p-6 space-y-4">
            <div className="size-12 rounded-full bg-red-100 flex items-center justify-center">
              <Trash2 className="size-5 text-red-600" />
            </div>
            <div>
              <h3 className="font-display font-bold text-ink-900">
                {t('planDetail.deleteActivityTitle', { defaultValue: 'Delete activity?' })}
              </h3>
              <p className="text-sm text-ink-500 mt-1">
                {t('planDetail.deleteActivityDesc', { title: deleteTarget.title, defaultValue: `Delete "${deleteTarget.title}"? This cannot be undone.` })}
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-xl border border-ink-200 px-4 py-2.5 text-sm font-semibold text-ink-700 hover:bg-ink-50 transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleDeleteActivity(deleteTarget)}
                disabled={deleteLoading}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleteLoading ? t('planDetail.deleting', { defaultValue: 'Deleting…' }) : t('planDetail.deleteActivityConfirm', { defaultValue: 'Delete' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}