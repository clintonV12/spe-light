import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft, Sparkles, Clock, User, AlertTriangle, ChevronDown,
} from 'lucide-react'
import { activitiesApi } from '../api/endpoints'
import { useOfflineStore } from '../store/offline'
import { usePermission } from '../hooks'
import { useAutoSave } from '../hooks/useAutoSave'
import SaveIndicator from '../components/ui/SaveIndicator'
import AiDraftPanel from '../components/ai/AiDraftPanel'
import LinkedActivitiesPanel from '../components/activities/LinkedActivitiesPanel'
import SwotEditor from '../components/activities/editors/SwotEditor'
import KpiEditor from '../components/activities/editors/KpiEditor'
import type { KpiRow } from '../components/activities/editors/KpiEditor'
import RiskRegisterEditor from '../components/activities/editors/RiskRegisterEditor'
import type { RiskRow } from '../components/activities/editors/RiskRegisterEditor'
import GenericEditor from '../components/activities/editors/GenericEditor'
import type { Activity, ActivityStatus, ActivityType, Phase, ActivityLink } from '../types'

const STATUS_COLORS: Record<ActivityStatus, string> = {
  not_started:  'bg-ink-100 text-ink-600',
  in_progress:  'bg-p2-light text-p2-dark',
  under_review: 'bg-p1-light text-p1-dark',
  complete:     'bg-green-100 text-green-700',
}

const PHASE_COLOR: Record<Phase, string> = {
  P1: 'text-p1-dark bg-p1-light',
  P2: 'text-p2-dark bg-p2-light',
  P3: 'text-p3-dark bg-p3-light',
}

// ─── Type-routed editor ───────────────────────────────────────────────────────

function ActivityEditor({ activity, onChange, readOnly }: {
  activity: Activity
  onChange: (content: Record<string, unknown>) => void
  readOnly: boolean
}) {
  const { t } = useTranslation()
  const content = activity.content ?? {}
  const type = activity.type

  // Built inside the component (not module scope) so labels re-translate
  // whenever the active language changes.
  const genericSections: Record<string, { key: string; label: string; placeholder?: string }[]> = {
    vision_mission: [
      { key: 'vision', label: t('activityEditor.sections.vision') },
      { key: 'mission', label: t('activityEditor.sections.mission') },
      { key: 'values', label: t('activityEditor.sections.coreValues') },
    ],
    strategic_objectives: [
      { key: 'objectives', label: t('activityEditor.sections.strategicObjectives') },
      { key: 'rationale', label: t('activityEditor.sections.rationale') },
    ],
    pestle: [
      { key: 'political', label: t('activityEditor.sections.political') },
      { key: 'economic', label: t('activityEditor.sections.economic') },
      { key: 'social', label: t('activityEditor.sections.social') },
      { key: 'technological', label: t('activityEditor.sections.technological') },
      { key: 'legal', label: t('activityEditor.sections.legal') },
      { key: 'environmental', label: t('activityEditor.sections.environmental') },
    ],
    stakeholder_map: [
      { key: 'internal', label: t('activityEditor.sections.internalStakeholders') },
      { key: 'external', label: t('activityEditor.sections.externalStakeholders') },
      { key: 'strategy', label: t('activityEditor.sections.engagementStrategy') },
    ],
    competitive_analysis: [
      { key: 'competitors', label: t('activityEditor.sections.keyCompetitors') },
      { key: 'positioning', label: t('activityEditor.sections.marketPositioning') },
      { key: 'differentiators', label: t('activityEditor.sections.ourDifferentiators') },
    ],
    value_proposition: [
      { key: 'customer', label: t('activityEditor.sections.targetCustomer') },
      { key: 'problem', label: t('activityEditor.sections.problemSolved') },
      { key: 'solution', label: t('activityEditor.sections.ourSolution') },
      { key: 'differentiator', label: t('activityEditor.sections.whyUs') },
    ],
    operational_roadmap: [
      { key: 'q1', label: t('activityEditor.sections.q1Milestones') },
      { key: 'q2', label: t('activityEditor.sections.q2Milestones') },
      { key: 'q3', label: t('activityEditor.sections.q3Milestones') },
      { key: 'q4', label: t('activityEditor.sections.q4Milestones') },
    ],
    action_items: [
      { key: 'actions', label: t('activityEditor.sections.actionItems') },
      { key: 'owners', label: t('activityEditor.sections.owners') },
      { key: 'blockers', label: t('activityEditor.sections.blockers') },
    ],
  }

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

  const sections = genericSections[type] ?? [
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ActivityEditorPage() {
  const { t, i18n } = useTranslation()
  const { planId, activityId } = useParams<{ planId: string; activityId: string }>()
  const navigate = useNavigate()
  const { can } = usePermission()
  const isOnline = useOfflineStore((s) => s.isOnline)

  const STATUS_OPTIONS: { value: ActivityStatus; label: string }[] = [
    { value: 'not_started',  label: t('activity.status.not_started') },
    { value: 'in_progress',  label: t('activity.status.in_progress') },
    { value: 'under_review', label: t('activity.status.under_review') },
    { value: 'complete',     label: t('activity.status.complete') },
  ]

  const [activity, setActivity] = useState<Activity | null>(null)
  const [content, setContent] = useState<Record<string, unknown>>({})
  const [status, setStatus] = useState<ActivityStatus>('not_started')
  const [loading, setLoading] = useState(true)
  const [showAi, setShowAi] = useState(false)
  const [planActivities, setPlanActivities] = useState<Activity[]>([])
  const [planLinks, setPlanLinks] = useState<ActivityLink[]>([])
  const [linksLoading, setLinksLoading] = useState(true)

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

  const loadLinks = useCallback(() => {
    if (!planId) return
    setLinksLoading(true)
    Promise.all([activitiesApi.list(planId), activitiesApi.listLinks(planId)])
      .then(([acts, links]) => { setPlanActivities(acts); setPlanLinks(links) })
      .catch(() => { setPlanActivities([]); setPlanLinks([]) })
      .finally(() => setLinksLoading(false))
  }, [planId])

  useEffect(() => { loadLinks() }, [loadLinks])

  // ── Auto-save ───────────────────────────────────────────────────────────────

  const doSave = useCallback(async (payload: { content: Record<string, unknown>; status: ActivityStatus }) => {
    if (!activityId || !activity || !initialised.current) return
    await activitiesApi.update(activityId, payload)
  }, [activityId, activity])

  const { saveState, saveNow, markDirty } = useAutoSave({
    data: { content, status },
    onSave: doSave,
    debounceMs: 1500,
    disabled: !canEdit || !initialised.current,
  })

  // ── Cmd+S instant save ──────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (canEdit && initialised.current) saveNow()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [canEdit, saveNow])

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleContentChange = useCallback((c: Record<string, unknown>) => {
    setContent(c)
    markDirty()
  }, [markDirty])

  const handleStatusChange = useCallback((s: ActivityStatus) => {
    setStatus(s)
    markDirty()
  }, [markDirty])

  const handleAiAccept = (draft: Record<string, unknown>) => {
    setContent(draft)
    markDirty()
    setShowAi(false)
  }

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

  const overdue = activity.due_date && status !== 'complete'
    && new Date(activity.due_date) < new Date()

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Back */}
      <button
        onClick={() => navigate(`/plans/${planId}`)}
        className="flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-700 transition-colors"
      >
        <ArrowLeft className="size-4" /> {t('activityEditor.backToPlan')}
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold ${PHASE_COLOR[activity.phase]}`}>
              {activity.phase}
            </span>
            <span className="text-xs text-ink-400 capitalize">
              {activity.type.replace(/_/g, ' ')}
            </span>
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
          {can.runAI && (
            <button
              onClick={() => setShowAi((v) => !v)}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                showAi ? 'bg-accent text-white' : 'border border-ink-200 bg-white text-ink-600 hover:bg-ink-50'
              }`}
            >
              <Sparkles className="size-4" /> {t('activityEditor.aiDraft')}
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
      {showAi && planId && (
        <AiDraftPanel
          planId={planId}
          phase={activity.phase}
          // activity.type is `string` on the backend model (it's not a DB-level
          // enum) — but in practice it's always one of the fixed ActivityType
          // picker values from CreateActivityModal, which is what AiDraftPanel
          // expects. Assert that instead of widening AiDraftPanel's prop type.
          activityType={activity.type as ActivityType}
          onAccept={handleAiAccept}
          isOffline={!isOnline}
        />
      )}

      {/* Two-column: editor + linked activities */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
        <div className="bg-white rounded-2xl border border-ink-100 p-6">
          <ActivityEditor
            activity={{ ...activity, content }}
            onChange={handleContentChange}
            readOnly={!canEdit}
          />
        </div>

        {linksLoading ? (
          <div className="h-72 bg-ink-100 rounded-2xl animate-pulse" />
        ) : (
          <LinkedActivitiesPanel
            activity={activity}
            allActivities={planActivities}
            links={planLinks}
            onLinksChanged={loadLinks}
            canEdit={canEdit}
          />
        )}
      </div>
    </div>
  )
}