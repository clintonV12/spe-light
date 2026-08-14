import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FlaskConical, Plus, Trash2, Clock } from 'lucide-react'
import { activitiesApi } from '../../api/endpoints'
import { useToast } from '../../hooks'
import { EmptyState } from '../ui'
import CreateActivityModal from './CreateActivityModal'
import type { Plan, Activity, ActivityStatus } from '../../types'

const STATUS_DOT: Record<ActivityStatus, string> = {
  not_started: 'bg-ink-300',
  in_progress: 'bg-p2',
  review:      'bg-p1',
  complete:    'bg-green-500',
}

interface AdvancedResearchPanelProps {
  plan: Plan
  /** Full activity list for the plan — filtered down to category === 'advanced_research' here. */
  activities: Activity[]
  canEdit: boolean
  canDelete: boolean
  onChanged: () => void
}

// ─── Chapter 8 (optional): Advanced Research ────────────────────────────────
//
// A flat list of standalone activities attached directly to the plan —
// never nested under a Strategic Pillar/Objective. This is where the
// deeper, more specialised research tools that don't have their own
// dedicated chapter live (Business Model Canvas, Competitive Analysis,
// Risk Register, OKR/Balanced Scorecard, Operational Roadmap, Resource
// Plan, Budget Allocation) — most plans will never need to touch this tab,
// so it stays clearly optional rather than looking like a required step.
export default function AdvancedResearchPanel({
  plan, activities, canEdit, canDelete, onChanged,
}: AdvancedResearchPanelProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { success, error: toastError } = useToast()

  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Activity | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const items = activities
    .filter((a) => a.category === 'advanced_research')
    .sort((a, b) => a.user_order - b.user_order)

  const handleDelete = async (activity: Activity) => {
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

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-bold text-ink-900 flex items-center gap-2">
            <FlaskConical className="size-4 text-accent" />
            {t('advancedResearch.title', { defaultValue: 'Advanced Research' })}
          </h2>
          <p className="text-sm text-ink-500 mt-0.5">
            {t('advancedResearch.subtitle', {
              defaultValue: 'Optional, deeper-dive tools — Business Model Canvas, Competitive Analysis, Risk Register, and more. Standalone, not tied to any Strategic Pillar.',
            })}
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-600 transition-colors shrink-0"
          >
            <Plus className="size-4" /> {t('advancedResearch.add', { defaultValue: 'Add research' })}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<FlaskConical className="size-8" />}
          title={t('advancedResearch.emptyTitle', { defaultValue: 'Nothing here yet' })}
          description={t('advancedResearch.emptyDesc', {
            defaultValue: 'Most plans never need this tab — use it only if you want a Business Model Canvas, Risk Register, or similar deep-dive alongside your plan.',
          })}
          action={canEdit ? (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
            >
              <Plus className="size-4" /> {t('advancedResearch.add', { defaultValue: 'Add research' })}
            </button>
          ) : undefined}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-ink-100 divide-y divide-ink-50">
          {items.map((a) => (
            <div
              key={a.id}
              className="group w-full flex items-center gap-3 px-4 py-3 hover:bg-ink-50 transition-colors"
            >
              <span className={`size-2 rounded-full shrink-0 ${STATUS_DOT[a.status]}`} />
              <button
                onClick={() => navigate(`/plans/${plan.id}/activities/${a.id}`)}
                className="flex-1 min-w-0 text-left"
              >
                <p className="text-sm font-medium text-ink-800 truncate group-hover:text-accent transition-colors">
                  {a.title}
                </p>
                <p className="text-xs text-ink-400 mt-0.5">{t(`activityTypes.${a.type}`)}</p>
              </button>
              {a.due_date && (
                <span className="flex items-center gap-1 text-xs text-ink-400 shrink-0">
                  <Clock className="size-3.5" />
                  {new Date(a.due_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </span>
              )}
              {canDelete && (
                <button
                  onClick={() => setDeleteTarget(a)}
                  className="shrink-0 p-1 rounded-lg text-ink-300 opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title={t('planDetail.deleteActivityConfirm', { defaultValue: 'Delete activity' })}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateActivityModal
          planId={plan.id}
          advanced
          onCreated={onChanged}
          onClose={() => setShowCreate(false)}
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
                onClick={() => handleDelete(deleteTarget)}
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