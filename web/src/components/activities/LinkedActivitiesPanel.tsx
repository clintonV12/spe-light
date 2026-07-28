import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowDownToLine, ArrowUpFromLine, Plus, Sparkles, X, Search,
  Link2, Trash2, GitBranch,
} from 'lucide-react'
import { activitiesApi } from '../../api/endpoints'
import { useToast } from '../../hooks'
import type { Activity, ActivityLink, Phase } from '../../types'

const PHASE_DOT: Record<Phase, string> = {
  P1: 'bg-p1', P2: 'bg-p2', P3: 'bg-p3',
}
const PHASE_BADGE: Record<Phase, string> = {
  P1: 'bg-p1-light text-p1-dark', P2: 'bg-p2-light text-p2-dark', P3: 'bg-p3-light text-p3-dark',
}

const LINK_TYPE_META: Record<ActivityLink['link_type'], { labelKey: string; icon: React.ReactNode; color: string }> = {
  manual:       { labelKey: 'linkedActivities.linkType.manual',       icon: <Link2 className="size-3" />,    color: 'text-accent' },
  ai_suggested: { labelKey: 'linkedActivities.linkType.ai_suggested', icon: <Sparkles className="size-3" />, color: 'text-purple-500' },
}

// Falls back to a humanized version of the raw type id for any activity
// type not present in the activityTypes.* translation keys.
function humanizeType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

interface LinkedActivitiesPanelProps {
  activity: Activity
  allActivities: Activity[]
  links: ActivityLink[]
  onLinksChanged: () => void
  canEdit: boolean
}

export default function LinkedActivitiesPanel({
  activity, allActivities, links, onLinksChanged, canEdit,
}: LinkedActivitiesPanelProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { success, error: toastError } = useToast()
  const [showPicker, setShowPicker] = useState<'upstream' | 'downstream' | null>(null)
  const [search, setSearch] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)

  const typeLabel = (type: string) => t(`activityTypes.${type}`, humanizeType(type))

  const upstream = useMemo(
    () => links
      .filter((l) => l.target_id === activity.id)
      .map((l) => ({ link: l, act: allActivities.find((a) => a.id === l.source_id) }))
      .filter((x): x is { link: ActivityLink; act: Activity } => !!x.act),
    [links, activity.id, allActivities],
  )

  const downstream = useMemo(
    () => links
      .filter((l) => l.source_id === activity.id)
      .map((l) => ({ link: l, act: allActivities.find((a) => a.id === l.target_id) }))
      .filter((x): x is { link: ActivityLink; act: Activity } => !!x.act),
    [links, activity.id, allActivities],
  )

  const linkedIds = useMemo(
    () => new Set([...upstream.map((u) => u.act.id), ...downstream.map((d) => d.act.id), activity.id]),
    [upstream, downstream, activity.id],
  )

  const pickerCandidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allActivities
      .filter((a) => !linkedIds.has(a.id))
      .filter((a) => !q || a.title.toLowerCase().includes(q) || typeLabel(a.type).toLowerCase().includes(q))
      .sort((a, b) => (a.phase ?? '').localeCompare(b.phase ?? '') || a.user_order - b.user_order)
  }, [allActivities, linkedIds, search])

  const handleAddLink = async (otherId: string, direction: 'upstream' | 'downstream') => {
    setPendingId(otherId)
    try {
      if (direction === 'upstream') {
        // other -> this activity
        await activitiesApi.createLink(otherId, { target_id: activity.id, link_type: 'manual' })
      } else {
        // this activity -> other
        await activitiesApi.createLink(activity.id, { target_id: otherId, link_type: 'manual' })
      }
      success(t('linkedActivities.linkAdded'))
      onLinksChanged()
      setShowPicker(null)
      setSearch('')
    } catch {
      toastError(t('linkedActivities.linkAddFailed'))
    } finally {
      setPendingId(null)
    }
  }

  const handleRemoveLink = async (link: ActivityLink) => {
    setPendingId(link.id)
    try {
      await activitiesApi.deleteLink(link.source_id, link.id)
      success(t('linkedActivities.linkRemoved'))
      onLinksChanged()
    } catch {
      toastError(t('linkedActivities.linkRemoveFailed'))
    } finally {
      setPendingId(null)
    }
  }

  const LinkRow = ({ act, link }: { act: Activity; link: ActivityLink }) => {
    const meta = LINK_TYPE_META[link.link_type]
    return (
      <div className="group flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-lg hover:bg-ink-50 transition-colors">
        {act.phase && <span className={`size-1.5 rounded-full shrink-0 ${PHASE_DOT[act.phase]}`} />}
        <button
          onClick={() => navigate(`/plans/${act.plan_id}/activities/${act.id}`)}
          className="flex-1 min-w-0 text-left"
        >
          <p className="text-xs font-medium text-ink-700 truncate group-hover:text-accent transition-colors">
            {act.title}
          </p>
        </button>
        <span className={`flex items-center gap-0.5 text-[10px] shrink-0 ${meta.color}`} title={t(meta.labelKey)}>
          {meta.icon}
        </span>
        {canEdit && (
          <button
            onClick={() => handleRemoveLink(link)}
            disabled={pendingId === link.id}
            className="shrink-0 text-ink-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all"
            aria-label={t('linkedActivities.removeLink')}
          >
            {pendingId === link.id
              ? <span className="size-3 animate-spin rounded-full border-2 border-ink-300 border-t-transparent inline-block" />
              : <Trash2 className="size-3.5" />}
          </button>
        )}
      </div>
    )
  }

  const PickerDropdown = ({ direction }: { direction: 'upstream' | 'downstream' }) => (
    <div className="mt-2 rounded-xl border border-ink-200 bg-white shadow-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-100">
        <Search className="size-3.5 text-ink-300 shrink-0" />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('linkedActivities.searchPlaceholder')}
          className="flex-1 text-xs outline-none placeholder:text-ink-300"
        />
        <button onClick={() => { setShowPicker(null); setSearch('') }} className="text-ink-300 hover:text-ink-600">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="max-h-56 overflow-y-auto py-1">
        {pickerCandidates.length === 0 ? (
          <p className="px-3 py-3 text-xs text-ink-300 text-center">{t('linkedActivities.noMatching')}</p>
        ) : (
          pickerCandidates.map((a) => (
            <button
              key={a.id}
              onClick={() => handleAddLink(a.id, direction)}
              disabled={pendingId === a.id}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-ink-50 transition-colors disabled:opacity-50"
            >
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md text-[9px] font-bold shrink-0 ${a.phase ? PHASE_BADGE[a.phase] : 'bg-ink-100 text-ink-500'}`}>
                {a.phase ?? '—'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-ink-700 truncate">{a.title}</p>
                <p className="text-[10px] text-ink-400">{typeLabel(a.type)}</p>
              </div>
              {pendingId === a.id && (
                <span className="size-3 animate-spin rounded-full border-2 border-accent border-t-transparent shrink-0" />
              )}
            </button>
          ))
        )}
      </div>
    </div>
  )

  return (
    <div className="bg-white rounded-2xl border border-ink-100 p-5 space-y-6 sticky top-6">
      <div className="flex items-center gap-2">
        <GitBranch className="size-4 text-ink-400" />
        <h3 className="font-display text-sm font-bold text-ink-800">{t('linkedActivities.title')}</h3>
      </div>

      {/* Upstream */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-500 uppercase tracking-wide">
            <ArrowDownToLine className="size-3" /> {t('linkedActivities.fedByCount', { count: upstream.length })}
          </p>
          {canEdit && (
            <button
              onClick={() => { setShowPicker(showPicker === 'upstream' ? null : 'upstream'); setSearch('') }}
              className="text-ink-300 hover:text-accent transition-colors"
              aria-label={t('linkedActivities.addUpstreamLink')}
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
        {upstream.length === 0 ? (
          <p className="text-xs text-ink-300 italic">{t('linkedActivities.noUpstream')}</p>
        ) : (
          <div>
            {upstream.map(({ link, act }) => (
              <LinkRow key={link.id} act={act} link={link} />
            ))}
          </div>
        )}
        {showPicker === 'upstream' && <PickerDropdown direction="upstream" />}
      </div>

      <div className="border-t border-ink-100" />

      {/* Downstream */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-500 uppercase tracking-wide">
            <ArrowUpFromLine className="size-3" /> {t('linkedActivities.feedsIntoCount', { count: downstream.length })}
          </p>
          {canEdit && (
            <button
              onClick={() => { setShowPicker(showPicker === 'downstream' ? null : 'downstream'); setSearch('') }}
              className="text-ink-300 hover:text-accent transition-colors"
              aria-label={t('linkedActivities.addDownstreamLink')}
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
        {downstream.length === 0 ? (
          <p className="text-xs text-ink-300 italic">{t('linkedActivities.noDownstream')}</p>
        ) : (
          <div>
            {downstream.map(({ link, act }) => (
              <LinkRow key={link.id} act={act} link={link} />
            ))}
          </div>
        )}
        {showPicker === 'downstream' && <PickerDropdown direction="downstream" />}
      </div>

      {(upstream.length > 0 || downstream.length > 0) && (
        <p className="text-[11px] text-ink-300 pt-1 border-t border-ink-50">
          {t('linkedActivities.footNote')}
        </p>
      )}
    </div>
  )
}