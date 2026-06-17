import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Save, Sparkles, CheckCircle2, Clock,
  User, AlertTriangle, ChevronDown,
} from 'lucide-react'
import { activitiesApi } from '../api/endpoints'
import { useOfflineStore } from '../store/offline'
import { usePermission, useToast } from '../hooks'
import AiDraftPanel from '../components/ai/AiDraftPanel'
import LinkedActivitiesPanel from '../components/activities/LinkedActivitiesPanel'
import SwotEditor from '../components/activities/editors/SwotEditor'
import KpiEditor from '../components/activities/editors/KpiEditor'
import type { KpiRow } from '../components/activities/editors/KpiEditor'
import RiskRegisterEditor from '../components/activities/editors/RiskRegisterEditor'
import type { RiskRow } from '../components/activities/editors/RiskRegisterEditor'
import GenericEditor from '../components/activities/editors/GenericEditor'
import type { Activity, ActivityStatus, Phase, ActivityLink } from '../types'

const STATUS_OPTIONS: { value: ActivityStatus; label: string }[] = [
  { value: 'not_started',  label: 'Not started' },
  { value: 'in_progress',  label: 'In progress' },
  { value: 'under_review', label: 'Under review' },
  { value: 'complete',     label: 'Complete' },
]

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

// Generic sections per activity type
const GENERIC_SECTIONS: Record<string, { key: string; label: string; placeholder?: string }[]> = {
  vision_mission:       [{ key: 'vision', label: 'Vision' }, { key: 'mission', label: 'Mission' }, { key: 'values', label: 'Core values' }],
  strategic_objectives: [{ key: 'objectives', label: 'Strategic objectives' }, { key: 'rationale', label: 'Rationale' }],
  pestle:               [{ key: 'political', label: 'Political' }, { key: 'economic', label: 'Economic' }, { key: 'social', label: 'Social' }, { key: 'technological', label: 'Technological' }, { key: 'legal', label: 'Legal' }, { key: 'environmental', label: 'Environmental' }],
  stakeholder_map:      [{ key: 'internal', label: 'Internal stakeholders' }, { key: 'external', label: 'External stakeholders' }, { key: 'strategy', label: 'Engagement strategy' }],
  competitive_analysis: [{ key: 'competitors', label: 'Key competitors' }, { key: 'positioning', label: 'Market positioning' }, { key: 'differentiators', label: 'Our differentiators' }],
  value_proposition:    [{ key: 'customer', label: 'Target customer' }, { key: 'problem', label: 'Problem solved' }, { key: 'solution', label: 'Our solution' }, { key: 'differentiator', label: 'Why us' }],
  operational_roadmap:  [{ key: 'q1', label: 'Q1 milestones' }, { key: 'q2', label: 'Q2 milestones' }, { key: 'q3', label: 'Q3 milestones' }, { key: 'q4', label: 'Q4 milestones' }],
  action_items:         [{ key: 'actions', label: 'Action items' }, { key: 'owners', label: 'Owners' }, { key: 'blockers', label: 'Blockers' }],
}

function ActivityEditor({ activity, onChange, readOnly }: {
  activity: Activity
  onChange: (content: Record<string, unknown>) => void
  readOnly: boolean
}) {
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

  const sections = GENERIC_SECTIONS[type] ?? [
    { key: 'content', label: 'Content', placeholder: 'Enter content for this activity…' },
    { key: 'notes', label: 'Notes' },
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

export default function ActivityEditorPage() {
  const { planId, activityId } = useParams<{ planId: string; activityId: string }>()
  const navigate = useNavigate()
  const { can } = usePermission()
  const { success, error: toastError } = useToast()
  const isOnline = useOfflineStore((s) => s.isOnline)

  const [activity, setActivity] = useState<Activity | null>(null)
  const [content, setContent] = useState<Record<string, unknown>>({})
  const [status, setStatus] = useState<ActivityStatus>('not_started')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showAi, setShowAi] = useState(false)

  // Linked-activities panel state
  const [planActivities, setPlanActivities] = useState<Activity[]>([])
  const [planLinks, setPlanLinks] = useState<ActivityLink[]>([])
  const [linksLoading, setLinksLoading] = useState(true)

  const canEdit = can.editActivity

  useEffect(() => {
    if (!activityId) return
    activitiesApi.get(activityId)
      .then((a) => { setActivity(a); setContent(a.content ?? {}); setStatus(a.status) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [activityId])

  const loadLinks = useCallback(() => {
    if (!planId) return
    setLinksLoading(true)
    Promise.all([
      activitiesApi.list(planId),
      activitiesApi.listLinks(planId),
    ])
      .then(([acts, links]) => {
        setPlanActivities(acts)
        setPlanLinks(links)
      })
      .catch(() => {
        setPlanActivities([])
        setPlanLinks([])
      })
      .finally(() => setLinksLoading(false))
  }, [planId])

  useEffect(() => { loadLinks() }, [loadLinks])

  const handleContentChange = useCallback((c: Record<string, unknown>) => {
    setContent(c)
    setDirty(true)
  }, [])

  const handleStatusChange = (s: ActivityStatus) => {
    setStatus(s)
    setDirty(true)
  }

  const handleSave = async () => {
    if (!activityId || !activity) return
    setSaving(true)
    try {
      await activitiesApi.update(activityId, { content, status })
      setDirty(false)
      success('Changes saved')
    } catch {
      toastError('Failed to save. Changes will be queued if offline.')
    } finally {
      setSaving(false)
    }
  }

  const handleAiAccept = (draft: Record<string, unknown>) => {
    setContent(draft)
    setDirty(true)
    setShowAi(false)
    success('AI draft applied — review and save.')
  }

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
  const overdue = activity.due_date && status !== 'complete' && new Date(activity.due_date) < new Date()

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Back */}
      <button
        onClick={() => navigate(`/plans/${planId}`)}
        className="flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-700 transition-colors"
      >
        <ArrowLeft className="size-4" /> Back to plan
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-bold ${PHASE_COLOR[activity.phase]}`}>
              {activity.phase}
            </span>
            <span className="text-xs text-ink-400 capitalize">{activity.type.replace(/_/g, ' ')}</span>
            {overdue && (
              <span className="flex items-center gap-1 text-xs text-red-500 font-medium">
                <AlertTriangle className="size-3" /> Overdue
              </span>
            )}
          </div>
          <h1 className="font-display text-xl font-bold text-ink-900">{activity.title}</h1>
          <div className="flex items-center gap-4 text-xs text-ink-400">
            {activity.due_date && (
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" />
                Due {new Date(activity.due_date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
            )}
            {activity.assigned_to && activity.assigned_to.length > 0 && (
              <span className="flex items-center gap-1">
                <User className="size-3.5" />
                {activity.assigned_to.length} assigned
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
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

          {/* AI */}
          {can.runAI && (
            <button
              onClick={() => setShowAi((v) => !v)}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                showAi ? 'bg-accent text-white' : 'border border-ink-200 bg-white text-ink-600 hover:bg-ink-50'
              }`}
            >
              <Sparkles className="size-4" /> AI draft
            </button>
          )}

          {/* Save */}
          {canEdit && (
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : dirty ? (
                <Save className="size-4" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </button>
          )}
        </div>
      </div>

      {/* AI panel */}
      {showAi && planId && (
        <AiDraftPanel
          planId={planId}
          phase={activity.phase}
          activityType={activity.type}
          onAccept={handleAiAccept}
          isOffline={!isOnline}
        />
      )}

      {/* Unsaved indicator */}
      {dirty && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5">
          <div className="size-2 rounded-full bg-amber-400 animate-pulse" />
          <p className="text-sm text-amber-800">You have unsaved changes.</p>
          <button onClick={handleSave} disabled={saving} className="ml-auto text-xs font-semibold text-amber-700 hover:text-amber-900">
            Save now
          </button>
        </div>
      )}

      {/* Two-column layout: editor + linked activities */}
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
