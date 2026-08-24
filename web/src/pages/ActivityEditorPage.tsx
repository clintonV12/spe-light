import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft, Sparkles, Clock, User, AlertTriangle, ChevronDown, Check, X, Trash2,
} from 'lucide-react'
import { activitiesApi, pillarsApi } from '../api/endpoints'
import { useOfflineStore } from '../store/offline'
import { usePermission } from '../hooks'
import { useAutoSave } from '../hooks/useAutoSave'
import SaveIndicator from '../components/ui/SaveIndicator'
import AiDraftPanel from '../components/activities/AiDraftPanel'
import { LwaziFace } from '../components/activities/LwaziAvatar'
import LocalActivityEditor from '../components/activities/LocalActivityEditor'
import SwotEditor from '../components/activities/editors/SwotEditor'
import KpiEditor from '../components/activities/editors/KpiEditor'
import type { KpiRow, ObjectiveOption } from '../components/activities/editors/KpiEditor'
import RiskRegisterEditor from '../components/activities/editors/RiskRegisterEditor'
import type { RiskRow } from '../components/activities/editors/RiskRegisterEditor'
import GenericEditor from '../components/activities/editors/GenericEditor'
import BusinessModelCanvasEditor from '../components/activities/editors/BusinessModelCanvasEditor'
import PestleEditor from '../components/activities/editors/PestleEditor'
import ValuePropositionEditor from '../components/activities/editors/ValuePropositionEditor'
import StakeholderMapEditor from '../components/activities/editors/StakeholderMapEditor'
import CompetitiveAnalysisEditor from '../components/activities/editors/CompetitiveAnalysisEditor'
import VisionMissionEditor from '../components/activities/editors/VisionMissionEditor'
import ObjectivesEditor from '../components/activities/editors/ObjectivesEditor'
import TheoryOfChangeEditor from '../components/activities/editors/TheoryOfChangeEditor'
import RoadmapEditor from '../components/activities/editors/RoadmapEditor'
import FinancialProjectionsEditor from '../components/activities/editors/FinancialProjectionsEditor'
import type { FinancialProjectionsContent } from '../components/activities/editors/FinancialProjectionsEditor'
import TableEditor from '../components/activities/editors/TableEditor'
import type { TableColumn, ChartConfig, TableRow } from '../components/activities/editors/TableEditor'
import type { Activity, ActivityStatus, ActivityType, StrategicObjective } from '../types'

const STATUS_COLORS: Record<ActivityStatus, string> = {
  not_started: 'bg-ink-100 text-ink-600',
  in_progress: 'bg-p2-light text-p2-dark',
  review:      'bg-p1-light text-p1-dark',
  complete:    'bg-green-100 text-green-700',
}

// ─── Table-shaped activity types ───────────────────────────────────────────────
//
// Types that are naturally a list of records (budget lines, procurement
// items, timeline phases, etc.) are routed through the shared TableEditor
// instead of stacked free-text fields. Each gets a column layout and an
// optional chart config — the chart is a frontend-only view over the current
// rows and is never written back to `content`; only the rows are persisted.
// This mirrors how kpi_framework/risk_register already store `{ rows }`.

const TABLE_CONFIGS: Record<string, { columns: TableColumn[]; chart?: ChartConfig; addLabel?: string }> = {
  market_analysis: {
    addLabel: 'Add market segment',
    columns: [
      { key: 'segment', label: 'Market Segment', type: 'text', width: 'min-w-40' },
      { key: 'market_size', label: 'Market Size (SZLM)', type: 'number', width: 'min-w-28' },
      { key: 'growth_rate', label: 'Growth Rate (%)', type: 'number', width: 'min-w-28' },
      { key: 'notes', label: 'Notes', type: 'text', width: 'min-w-48' },
    ],
    chart: {
      labelColumn: 'segment',
      series: [
        { key: 'market_size', label: 'Market Size (SZLM)', color: '#3b82f6' },
        { key: 'growth_rate', label: 'Growth Rate (%)', color: '#10b981' },
      ],
    },
  },
  strategic_initiatives: {
    addLabel: 'Add initiative',
    columns: [
      { key: 'initiative', label: 'Initiative', type: 'text', width: 'min-w-48' },
      { key: 'priority', label: 'Priority', type: 'select', options: ['High', 'Medium', 'Low'], width: 'min-w-28' },
      { key: 'owner', label: 'Owner', type: 'text', width: 'min-w-32' },
      { key: 'timeline', label: 'Target Timeframe', type: 'text', width: 'min-w-32' },
    ],
    chart: { labelColumn: 'initiative', groupByColumn: 'priority' },
  },
  // financial_projections used to live here as a flat Period/Revenue/Costs/
  // Profit table — moved to its own dedicated FinancialProjectionsEditor
  // (below, alongside the other content-object editors like PestleEditor)
  // since a real P&L needs sectioned line items and computed subtotals,
  // not a handful of flat TableEditor columns.
  budget_allocation: {
    addLabel: 'Add budget line',
    columns: [
      { key: 'category', label: 'Category', type: 'text', width: 'min-w-40' },
      { key: 'amount', label: 'Amount (SZL)', type: 'number', width: 'min-w-28' },
      { key: 'notes', label: 'Notes', type: 'text', width: 'min-w-48' },
    ],
    chart: { labelColumn: 'category', series: [{ key: 'amount', label: 'Amount (SZL)', color: '#3b82f6' }] },
  },
  resource_plan: {
    addLabel: 'Add resource',
    columns: [
      { key: 'resource', label: 'Resource', type: 'text', width: 'min-w-40' },
      { key: 'type', label: 'Type', type: 'text', placeholder: 'People / Budget / Equipment', width: 'min-w-40' },
      { key: 'allocation_pct', label: 'Allocation (%)', type: 'number', width: 'min-w-28' },
      { key: 'notes', label: 'Notes', type: 'text', width: 'min-w-48' },
    ],
    chart: { labelColumn: 'resource', series: [{ key: 'allocation_pct', label: 'Allocation (%)', color: '#8b5cf6' }] },
  },
  action_items: {
    addLabel: 'Add action item',
    columns: [
      { key: 'action', label: 'Action', type: 'text', width: 'min-w-48' },
      { key: 'owner', label: 'Owner', type: 'text', width: 'min-w-32' },
      { key: 'status', label: 'Status', type: 'select', options: ['Open', 'In Progress', 'Blocked', 'Done'], width: 'min-w-32' },
    ],
    chart: { labelColumn: 'action', groupByColumn: 'status' },
  },
  implementation_timeline: {
    addLabel: 'Add phase',
    columns: [
      { key: 'phase', label: 'Phase', type: 'text', width: 'min-w-40' },
      { key: 'start_date', label: 'Start', type: 'date', width: 'min-w-32' },
      { key: 'end_date', label: 'End', type: 'date', width: 'min-w-32' },
      { key: 'status', label: 'Status', type: 'select', options: ['Not started', 'In progress', 'Complete', 'Delayed'], width: 'min-w-32' },
    ],
    chart: { labelColumn: 'phase', groupByColumn: 'status' },
  },
  procurement_plan: {
    addLabel: 'Add item',
    columns: [
      { key: 'item', label: 'Item', type: 'text', width: 'min-w-40' },
      { key: 'quantity', label: 'Quantity', type: 'number', width: 'min-w-24' },
      { key: 'estimated_cost', label: 'Estimated Cost (SZL)', type: 'number', width: 'min-w-28' },
      { key: 'vendor', label: 'Vendor', type: 'text', width: 'min-w-32' },
      { key: 'status', label: 'Status', type: 'select', options: ['Pending', 'Ordered', 'Received', 'Cancelled'], width: 'min-w-28' },
    ],
    chart: { labelColumn: 'item', series: [{ key: 'estimated_cost', label: 'Estimated Cost (SZL)', color: '#f59e0b' }] },
  },
}

// ─── Type-routed editor ───────────────────────────────────────────────────────

function ActivityEditor({ activity, onChange, readOnly, objectives }: {
  activity: Activity
  onChange: (content: Record<string, unknown>) => void
  readOnly: boolean
  /** Strategic Objectives this plan's KPIs can link to — see objectiveOptions in the page component. */
  objectives: ObjectiveOption[]
}) {
  const { t } = useTranslation()
  const content = activity.content ?? {}
  const type = activity.type

  if (type === 'swot') {
    return (
      <SwotEditor
        value={content as Parameters<typeof SwotEditor>[0]['value']}
        onChange={(v) => onChange(v as unknown as Record<string, unknown>)}
        readOnly={readOnly}
      />
    )
  }
  if (type === 'kpi_framework' || type === 'okr_balanced_scorecard') {
    return (
      <KpiEditor
        value={(content.rows as KpiRow[]) ?? []}
        onChange={(rows) => onChange({ rows })}
        readOnly={readOnly}
        objectives={objectives}
      />
    )
  }
  if (type === 'risk_register') {
    return (
      <RiskRegisterEditor
        value={(content.rows as RiskRow[]) ?? []}
        onChange={(rows) => onChange({ rows })}
        readOnly={readOnly}
      />
    )
  }
  if (type === 'business_model_canvas') {
    return (
      <BusinessModelCanvasEditor
        value={content as Parameters<typeof BusinessModelCanvasEditor>[0]['value']}
        onChange={(v) => onChange(v as unknown as Record<string, unknown>)}
        readOnly={readOnly}
      />
    )
  }
  if (type === 'pestle') {
    return (
      <PestleEditor
        value={content as Parameters<typeof PestleEditor>[0]['value']}
        onChange={(v) => onChange(v as unknown as Record<string, unknown>)}
        readOnly={readOnly}
      />
    )
  }
  if (type === 'value_proposition') {
    return (
      <ValuePropositionEditor
        value={content as Parameters<typeof ValuePropositionEditor>[0]['value']}
        onChange={(v) => onChange(v as unknown as Record<string, unknown>)}
        readOnly={readOnly}
      />
    )
  }
  if (type === 'stakeholder_map') {
    return (
      <StakeholderMapEditor
        value={content as Parameters<typeof StakeholderMapEditor>[0]['value']}
        onChange={(v) => onChange(v as unknown as Record<string, unknown>)}
        readOnly={readOnly}
      />
    )
  }
  if (type === 'competitive_analysis') {
    return (
      <CompetitiveAnalysisEditor
        value={content as Parameters<typeof CompetitiveAnalysisEditor>[0]['value']}
        onChange={(v) => onChange(v as unknown as Record<string, unknown>)}
        readOnly={readOnly}
      />
    )
  }
  if (type === 'vision_mission') {
    return (
      <VisionMissionEditor
        value={content as Parameters<typeof VisionMissionEditor>[0]['value']}
        onChange={(v) => onChange(v as unknown as Record<string, unknown>)}
        readOnly={readOnly}
      />
    )
  }
  if (type === 'strategic_objectives') {
    return (
      <ObjectivesEditor
        value={content as Parameters<typeof ObjectivesEditor>[0]['value']}
        onChange={(v) => onChange(v as unknown as Record<string, unknown>)}
        readOnly={readOnly}
      />
    )
  }
  if (type === 'theory_of_change') {
    return (
      <TheoryOfChangeEditor
        value={content as Parameters<typeof TheoryOfChangeEditor>[0]['value']}
        onChange={(v) => onChange(v as unknown as Record<string, unknown>)}
        readOnly={readOnly}
      />
    )
  }
  if (type === 'operational_roadmap') {
    return (
      <RoadmapEditor
        value={content as Parameters<typeof RoadmapEditor>[0]['value']}
        onChange={(v) => onChange(v as unknown as Record<string, unknown>)}
        readOnly={readOnly}
      />
    )
  }
  if (type === 'financial_projections') {
    return (
      <FinancialProjectionsEditor
        value={content as Partial<FinancialProjectionsContent>}
        onChange={(v) => onChange(v as unknown as Record<string, unknown>)}
        readOnly={readOnly}
      />
    )
  }

  const tableConfig = TABLE_CONFIGS[type]
  if (tableConfig) {
    return (
      <TableEditor
        columns={tableConfig.columns}
        chart={tableConfig.chart}
        addLabel={tableConfig.addLabel}
        value={(content.rows as TableRow[]) ?? []}
        onChange={(rows) => onChange({ rows })}
        readOnly={readOnly}
      />
    )
  }

  // Fallback for any future/unmapped activity type — plain labelled fields.
  const sections = [
    { key: 'content', label: t('activityEditor.sections.content'), placeholder: t('activityEditor.sections.contentPlaceholder') },
    { key: 'notes', label: t('activityEditor.sections.notes') },
  ]
  return (
    <GenericEditor
      sections={sections}
      value={content as Record<string, string>}
      onChange={(v) => onChange(v as Record<string, unknown>)}
      readOnly={readOnly}
    />
  )
}

// Where "back"/delete should return to: the Strategic Pillars tab for an
// ordinary objective-nested activity, the Advanced Research tab for a
// standalone one, or LocalPlanChapters' default tab if we don't know yet
// (activity not loaded).
//
// For an objective-nested activity we also thread the pillar id through as
// a `pillar` query param, so LocalPlanBoard can re-expand the pillar the
// person was actually working in instead of always falling back to the
// first one on remount. `formalObjectives` is optional — if it hasn't
// loaded yet we still land on the right tab, just without the pillar
// pre-expanded.
function backDestination(planId: string, activity: Activity | null, formalObjectives: StrategicObjective[] = []): string {
  if (activity?.objective_id) {
    const objective = formalObjectives.find((o) => o.id === activity.objective_id)
    return objective
      ? `/plans/${planId}?tab=pillars&pillar=${objective.pillar_id}`
      : `/plans/${planId}?tab=pillars`
  }
  if (activity?.category === 'advanced_research') return `/plans/${planId}?tab=advanced`
  return `/plans/${planId}`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ActivityEditorPage() {
  const { t, i18n } = useTranslation()
  const { planId, activityId } = useParams<{ planId: string; activityId: string }>()
  const navigate = useNavigate()
  const { can } = usePermission()
  const isOnline = useOfflineStore((s) => s.isOnline)

  const STATUS_OPTIONS: { value: ActivityStatus; label: string }[] = [
    { value: 'not_started', label: t('activity.status.not_started') },
    { value: 'in_progress', label: t('activity.status.in_progress') },
    // NOTE: value + i18n key changed from 'under_review' to 'review' to match
    // the backend's models.go ActivityStatus enum ("review") — this was
    // previously sending a value the backend never defined. If your locale
    // JSON files (e.g. en.json) still have the key under
    // activity.status.under_review, rename it to activity.status.review too,
    // or this label will fall back to showing the raw key.
    { value: 'review', label: t('activity.status.review') },
    { value: 'complete', label: t('activity.status.complete') },
  ]

  const [activity, setActivity] = useState<Activity | null>(null)
  const [content, setContent] = useState<Record<string, unknown>>({})
  const [status, setStatus] = useState<ActivityStatus>('not_started')
  const [loading, setLoading] = useState(true)
  const [showAi, setShowAi] = useState(false)
  // Formal Strategic Objectives for this plan — used as KPI-editor link
  // targets (objectiveOptions below).
  const [formalObjectives, setFormalObjectives] = useState<StrategicObjective[]>([])

  // ── Delete ───────────────────────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // ── AI draft approval gate ────────────────────────────────────────────────
  // Accepting an AI draft only fills the editable fields — it does NOT save.
  // Autosave stays disabled until the user explicitly approves (or discards,
  // which restores whatever was in the fields immediately beforehand).
  const [pendingApproval, setPendingApproval] = useState(false)
  const [preDraftContent, setPreDraftContent] = useState<Record<string, unknown> | null>(null)
  const [approving, setApproving] = useState(false)
  // Bumped on every AI accept/discard so <ActivityEditor key={contentVersion}>
  // remounts instead of re-rendering in place. SwotEditor/KpiEditor/etc. only
  // read their `value` prop once on mount (they own their own field state
  // internally) — without a remount, a programmatic content swap like an AI
  // draft silently doesn't show up in the fields even though `content` state
  // (and therefore autosave) is genuinely updated. Remounting forces them to
  // re-initialise from the new value.
  const [contentVersion, setContentVersion] = useState(0)

  // Track whether the editor has been initialised (skip auto-save on first render)
  const initialised = useRef(false)
  const canEdit = can.editActivity

  // ── Data fetching ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!planId || !activityId) return
    activitiesApi.get(planId, activityId)
      .then((a) => {
        setActivity(a)
        setContent(a.content ?? {})
        setStatus(a.status)
        // Mark as initialised AFTER setting state so the first data load
        // doesn't trigger the auto-save (content hasn't "changed" yet).
        setTimeout(() => { initialised.current = true }, 50)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [activityId])

  // Formal Strategic Objectives for this plan.
  useEffect(() => {
    if (!planId) return
    pillarsApi.listObjectives(planId)
      .then(setFormalObjectives)
      .catch(() => setFormalObjectives([]))
  }, [planId])

  // The list of objectives KPIs on this plan can link to.
  const objectiveOptions: ObjectiveOption[] = useMemo(
    () => formalObjectives.map((o) => ({ id: o.id, label: o.title })),
    [formalObjectives],
  )

  // ── Auto-save ───────────────────────────────────────────────────────────────

  const doSave = useCallback(async (payload: { content: Record<string, unknown>; status: ActivityStatus }) => {
    if (!activityId || !activity || !initialised.current) return
    await activitiesApi.update(activityId, payload)
  }, [activityId, activity])

  const { saveState, saveNow, markDirty } = useAutoSave({
    data: { content, status },
    onSave: doSave,
    debounceMs: 1500,
    // pendingApproval blocks autosave entirely — an AI draft sitting in the
    // fields is a proposal, not a save, until the user hits Approve.
    disabled: !canEdit || !initialised.current || pendingApproval,
  })

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleContentChange = useCallback((c: Record<string, unknown>) => {
    setContent(c)
    markDirty()
  }, [markDirty])

  const handleStatusChange = useCallback((s: ActivityStatus) => {
    setStatus(s)
    markDirty()
  }, [markDirty])

  // Fills the editable fields with the AI draft — does NOT save. The user
  // reviews/edits, then explicitly Approves (or Discards) before anything
  // touches the database.
  const handleAiAccept = useCallback((draft: Record<string, unknown>) => {
    setPreDraftContent(content) // snapshot so Discard has something to restore
    setContent(draft)
    setContentVersion((v) => v + 1) // force the editor to remount and re-sync
    setPendingApproval(true)
    setShowAi(false)
  }, [content])

  // Persists the (possibly user-edited) draft content. Calls activitiesApi
  // directly rather than going through useAutoSave's saveNow(), since that
  // hook is intentionally `disabled` while pendingApproval is true — this is
  // the one deliberate, explicit write that's allowed to bypass that gate.
  const handleApproveDraft = useCallback(async () => {
    if (!activityId || !activity) return
    setApproving(true)
    try {
      await activitiesApi.update(activityId, { content, status })
      setPendingApproval(false)
      setPreDraftContent(null)
    } finally {
      setApproving(false)
    }
  }, [activityId, activity, content, status])

  const handleDiscardDraft = useCallback(() => {
    if (preDraftContent) {
      setContent(preDraftContent)
      setContentVersion((v) => v + 1)
    }
    setPendingApproval(false)
    setPreDraftContent(null)
  }, [preDraftContent])

  const handleDelete = useCallback(async () => {
    if (!activityId || !planId) return
    setDeleting(true)
    try {
      await activitiesApi.delete(activityId)
      // Same rule as the back button: return to the tab (and pillar) this
      // activity actually lives on rather than LocalPlanChapters' default.
      navigate(backDestination(planId, activity, formalObjectives))
    } catch {
      setDeleting(false)
    }
  }, [activityId, planId, navigate, activity, formalObjectives])

  // ── Cmd+S instant save ──────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!canEdit || !initialised.current) return
        if (pendingApproval) {
          handleApproveDraft()
        } else {
          saveNow()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [canEdit, saveNow, pendingApproval, handleApproveDraft])

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        <div className="h-5 bg-ink-100 rounded w-1/4 animate-pulse" />
        <div className="h-8 bg-ink-100 rounded w-2/3 animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          <div className="h-64 bg-ink-100 rounded-2xl animate-pulse" />
          <div className="h-64 bg-ink-100 rounded-2xl animate-pulse" />
        </div>
      </div>
    )
  }

  if (!activity) return null

  // Mirrors the backend's "exactly one of objective_id / category" invariant
  // — an objective-nested activity always has objective_id set and no
  // category; a standalone Advanced Research activity has category:
  // 'advanced_research' and no objective_id.
  const isObjectiveNested = !!activity.objective_id
  const isAdvancedResearch = activity.category === 'advanced_research'

  const overdue = activity.due_date && status !== 'complete'
    && new Date(activity.due_date) < new Date()

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Back — objective-nested activities live under the Strategic
          Pillars chapter (LocalPlanBoard) and Advanced Research activities
          under their own tab, so return there directly rather than
          dropping back to LocalPlanChapters' default 'focus' tab. */}
      <button
        onClick={() => navigate(backDestination(planId!, activity, formalObjectives))}
        className="flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-700 transition-colors"
      >
        <ArrowLeft className="size-4" /> {t('activityEditor.backToPlan')}
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            {isAdvancedResearch && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold text-accent bg-accent-50">
                {t('advancedResearch.badge', { defaultValue: 'Advanced Research' })}
              </span>
            )}
            {isAdvancedResearch && (
              <span className="text-xs text-ink-400 capitalize">
                {activity.type.replace(/_/g, ' ')}
              </span>
            )}
            {overdue && (
              <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
                <AlertTriangle className="size-3" /> {t('activityEditor.overdue')}
              </span>
            )}
          </div>
          <h1 className="font-display text-xl font-bold text-ink-900">{activity.title}</h1>
          <div className="flex items-center gap-4 text-xs text-ink-400">
            {activity.due_date && (
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" />
                {new Date(activity.due_date).toLocaleDateString(i18n.language, {
                  day: 'numeric', month: 'long', year: 'numeric',
                })}
              </span>
            )}
            {activity.assigned_to && activity.assigned_to.length > 0 && (
              <span className="flex items-center gap-1">
                <User className="size-3.5" />
                {t('activityEditor.assigned', { count: activity.assigned_to.length })}
              </span>
            )}
          </div>
        </div>

        {/* Right controls — status + save indicator + AI */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Auto-save indicator */}
          {canEdit && (
            <SaveIndicator state={saveState} onSaveNow={saveNow} />
          )}

          {/* Status dropdown */}
          {canEdit && (
            <div className="relative">
              <select
                value={status}
                onChange={(e) => handleStatusChange(e.target.value as ActivityStatus)}
                className={`appearance-none rounded-xl pl-3 pr-8 py-2 text-sm font-semibold cursor-pointer outline-none ${STATUS_COLORS[status]}`}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 pointer-events-none opacity-60" />
            </div>
          )}

          {/* AI toggle */}
          {can.runAI && isAdvancedResearch && (
            <button
              onClick={() => setShowAi((v) => !v)}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                showAi ? 'bg-accent text-white' : 'border border-ink-200 bg-white text-ink-600 hover:bg-ink-50'
              }`}
            >
              <LwaziFace size={16} state={showAi ? 'happy' : 'idle'} /> {t('activityEditor.aiDraft')}
            </button>
          )}

          {/* Delete */}
          {can.createPlan && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors"
              title={t('activityEditor.delete')}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Offline notice — only show when there are unsaved pending changes */}
      {!isOnline && saveState === 'pending' && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">
          <span className="size-2 rounded-full bg-amber-400 shrink-0 animate-pulse" />
          {t('activityEditor.offlineNotice')}
        </div>
      )}

      {/* AI panel */}
      {showAi && planId && isAdvancedResearch && (
        <AiDraftPanel
          planId={planId}
          // activity.type is `string` on the backend model (it's not a DB-level
          // enum) — but in practice it's always one of the fixed ActivityType
          // picker values from CreateActivityModal, which is what AiDraftPanel
          // expects. Assert that instead of widening AiDraftPanel's prop type.
          activityType={activity.type as ActivityType}
          onAccept={handleAiAccept}
          isOffline={!isOnline}
        />
      )}

      {/* AI draft pending approval — fields below are filled in and editable,
          but nothing is saved until Approve is clicked (or Discard reverts). */}
      {pendingApproval && isAdvancedResearch && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-accent/10 border border-accent/30 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-ink-700">
            <Sparkles className="size-4 text-accent shrink-0" />
            {t('activityEditor.aiPendingApproval', 'AI draft filled in below — review or edit, then approve to save.')}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDiscardDraft}
              disabled={approving}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-500 hover:bg-ink-100 transition-colors disabled:opacity-50"
            >
              <X className="size-4" /> {t('activityEditor.discardDraft', 'Discard')}
            </button>
            <button
              onClick={handleApproveDraft}
              disabled={approving}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-colors disabled:opacity-50"
            >
              <Check className="size-4" />
              {approving ? t('activityEditor.approving', 'Saving…') : t('activityEditor.approveDraft', 'Approve & Save')}
            </button>
          </div>
        </div>
      )}

      {/* Editor */}
      <div className="bg-white rounded-2xl border border-ink-100 p-6">
        {isObjectiveNested ? (
          <LocalActivityEditor
            activity={activity}
            canEdit={canEdit}
            onUpdated={(a) => { setActivity(a); setStatus(a.status) }}
          />
        ) : (
          <ActivityEditor
            // Forces SwotEditor/KpiEditor/RiskRegisterEditor/GenericEditor to
            // remount and re-read `content` as fresh initial state whenever
            // an AI draft is accepted or discarded — those components own
            // their field state internally and only read `value` on mount,
            // so without this key a programmatic content swap wouldn't show
            // up in the fields even though `content` (and the eventual save)
            // is genuinely updated.
            key={contentVersion}
            activity={{ ...activity, content }}
            onChange={handleContentChange}
            readOnly={!canEdit}
            objectives={objectiveOptions}
          />
        )}
      </div>

      {/* Delete confirm */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white rounded-2xl border border-ink-100 shadow-xl p-6 space-y-4">
            <div className="size-12 rounded-full bg-red-100 flex items-center justify-center">
              <Trash2 className="size-5 text-red-600" />
            </div>
            <div>
              <h3 className="font-display font-bold text-ink-900">{t('activityEditor.deleteConfirmTitle')}</h3>
              <p className="text-sm text-ink-500 mt-1">
                {t('activityEditor.deleteConfirmDesc', { title: activity.title })}
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 rounded-xl border border-ink-200 px-4 py-2.5 text-sm font-semibold text-ink-700 hover:bg-ink-50 transition-colors">{t('common.cancel')}</button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50">
                {deleting ? t('planDetail.deleting') : t('activityEditor.deleteConfirmButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}