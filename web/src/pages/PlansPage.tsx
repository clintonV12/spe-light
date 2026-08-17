import { useEffect, useState, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Plus, Search, SlidersHorizontal, ChevronUp, ChevronDown,
  MoreHorizontal, Archive, Copy, Trash2, AlertTriangle, CheckSquare,
  Square, X, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { plansApi } from '../api/endpoints'
import { usePermission } from '../hooks'
import { Badge, ProgressBar, EmptyState } from '../components/ui'
import CreatePlanModal from '../components/plans/CreatePlanModal'
import { SHORTCUT_CREATE_EVENT } from '../components/layout/AppShell'
import { fetchPlanKpiAchievement } from '../components/activities/TrackingModule'
import type { Plan, PlanStatus } from '../types'

const STATUS_VARIANT: Record<PlanStatus, 'neutral' | 'p1' | 'p2' | 'p3' | 'success'> = {
  draft:     'neutral',
  active:    'p2',
  review:    'p1',
  completed: 'success',
  archived:  'neutral',
}

type SortKey = 'title' | 'status' | 'progress' | 'updated_at'
type SortDir = 'asc' | 'desc'

// Client-side pagination: `filtered` is already the full sorted/searched
// result set (the list endpoint has no server-side paging), so we just
// slice it for display. 10 keeps each page a comfortable table height —
// pagination controls only render at all once there's more than one page.
const PAGE_SIZE = 10

function PlanRowMenu({ onArchive, onDuplicate, onDelete }: {
  onArchive: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const MENU_WIDTH = 176 // w-44

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      // Position below the button, right-aligned to it — same visual spot
      // the old `absolute right-0` version aimed for, just computed in
      // viewport coordinates so a portal can render it outside the table.
      setCoords({
        top: rect.bottom + 4,
        left: Math.max(8, rect.right - MENU_WIDTH),
      })
    }
    setOpen((v) => !v)
  }

  // The table wrapper's overflow-hidden (needed for its rounded corners)
  // clips any absolutely-positioned dropdown that tries to render past its
  // edge — that's what caused the menu to expand then immediately get cut
  // off. Rendering through a portal into document.body with `fixed`
  // coordinates sidesteps that clipping entirely. Close on scroll/resize so
  // a stale, no-longer-aligned menu can't linger.
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={toggle}
        className="p-1.5 rounded-lg text-ink-300 hover:text-ink-700 hover:bg-ink-50 transition-colors"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && coords && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 w-44 rounded-xl border border-ink-100 bg-white shadow-lg py-1"
            style={{ top: coords.top, left: coords.left }}
          >
            <button onClick={(e) => { e.stopPropagation(); onDuplicate(); setOpen(false) }} className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
              <Copy className="size-4 text-ink-400" /> {t('plansPage.duplicate')}
            </button>
            <button onClick={(e) => { e.stopPropagation(); onArchive(); setOpen(false) }} className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
              <Archive className="size-4 text-ink-400" /> {t('plansPage.archive')}
            </button>
            <div className="my-1 border-t border-ink-100" />
            <button onClick={(e) => { e.stopPropagation(); onDelete(); setOpen(false) }} className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50">
              <Trash2 className="size-4" /> {t('common.delete')}
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

// ─── Bulk action bar ──────────────────────────────────────────────────────────
function BulkActionBar({
  count, onArchive, onDelete, onClear, loading,
}: {
  count: number
  onArchive: () => void
  onDelete: () => void
  onClear: () => void
  loading: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-accent-50 border border-accent-200 rounded-xl">
      <span className="text-sm font-semibold text-accent">
        {t('plansPage.selectedCount', { count })}
      </span>
      <div className="flex items-center gap-2 ml-2">
        <button
          onClick={onArchive}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-ink-200 bg-white text-sm text-ink-700 hover:bg-ink-50 transition-colors disabled:opacity-50"
        >
          <Archive className="size-3.5" /> {t('plansPage.archiveAll')}
        </button>
        <button
          onClick={onDelete}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-white text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
        >
          <Trash2 className="size-3.5" /> {t('plansPage.deleteAll')}
        </button>
      </div>
      {loading && <span className="size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />}
      <button onClick={onClear} className="ml-auto text-ink-400 hover:text-ink-700 transition-colors">
        <X className="size-4" />
      </button>
    </div>
  )
}

export default function PlansPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { can } = usePermission()

  const STATUS_OPTIONS: { value: PlanStatus | 'all'; label: string }[] = [
    { value: 'all',       label: t('plansPage.statusAll') },
    { value: 'draft',     label: t('plan.status.draft') },
    { value: 'active',    label: t('plan.status.active') },
    { value: 'review',    label: t('plan.status.review') },
    { value: 'completed', label: t('plan.status.completed') },
    { value: 'archived',  label: t('plan.status.archived') },
  ]

  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<PlanStatus | 'all'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('updated_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [deleteTarget, setDeleteTarget] = useState<Plan | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // ── Bulk selection ──────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)

  const load = async () => {
    try {
      const data = await plansApi.list()
      // GET /api/v1/plans never returns `progress` — it's explicitly not a
      // backend field on Plan (see the type's own doc comment); it only
      // comes back from GET /plans/{id}/progress. Without this extra
      // fetch-and-merge step, the progress column/sort and every card's
      // overall % always read as zero, even though ProgressPage.tsx (which
      // does fetch it per plan) shows the real numbers for the same plans.
      // kpi_achievement is fetched the same way, from each plan's
      // activities — see fetchPlanKpiAchievement.
      const withProgress = await Promise.all(
        data.map(async (p) => {
          const [progress, kpi_achievement] = await Promise.all([
            plansApi.progress(p.id).catch(() => undefined),
            fetchPlanKpiAchievement(p.id),
          ])
          return progress ? { ...p, progress, kpi_achievement } : { ...p, kpi_achievement }
        })
      )
      setPlans(withProgress)
    } catch {
      // leave plans empty
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // 'c' keyboard shortcut opens the create plan modal
  useEffect(() => {
    const handler = () => setShowCreate(true)
    window.addEventListener(SHORTCUT_CREATE_EVENT, handler)
    return () => window.removeEventListener(SHORTCUT_CREATE_EVENT, handler)
  }, [])


  const filtered = useMemo(() => {
    let result = plans
    if (statusFilter !== 'all') result = result.filter((p) => p.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((p) => p.title.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q))
    }
    return [...result].sort((a, b) => {
      let av: string | number = ''
      let bv: string | number = ''
      if (sortKey === 'title')      { av = a.title; bv = b.title }
      if (sortKey === 'status')     { av = a.status; bv = b.status }
      if (sortKey === 'updated_at') { av = a.updated_at; bv = b.updated_at }
      if (sortKey === 'progress')   { av = a.kpi_achievement ?? a.progress?.overall.percent_complete ?? 0; bv = b.kpi_achievement ?? b.progress?.overall.percent_complete ?? 0 }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [plans, search, statusFilter, sortKey, sortDir])

  // ── Pagination ───────────────────────────────────────────────────────────
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  // Whenever the search/filter/sort inputs change, `filtered` is a new result
  // set — jump back to page 1 rather than possibly landing on a now-empty
  // page (e.g. you were on page 3 and a new filter only matches 1 page).
  useEffect(() => {
    setPage(1)
  }, [search, statusFilter, sortKey, sortDir])

  // Separately, clamp if the *current* filtered set shrinks below the page
  // we're on — e.g. deleting the last plan on the last page, or a plan
  // reload dropping the count — without resetting all the way to page 1
  // and losing the user's place for a one-row change.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  )

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id))
  const someSelected = selected.size > 0

  const toggleAll = () => {
    if (allFilteredSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((p) => p.id)))
    }
  }

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ChevronUp className="size-3.5 text-ink-300" />
    return sortDir === 'asc'
      ? <ChevronUp className="size-3.5 text-accent" />
      : <ChevronDown className="size-3.5 text-accent" />
  }

  // ── Single-row actions ──────────────────────────────────────────────────────
  const handleArchive = async (plan: Plan) => {
    setActionLoading(plan.id)
    try { await plansApi.update(plan.id, { status: 'archived' }); await load() }
    catch { } finally { setActionLoading(null) }
  }

  const handleDuplicate = async (plan: Plan) => {
    setActionLoading(plan.id)
    try { await plansApi.duplicate(plan.id); await load() }
    catch { } finally { setActionLoading(null) }
  }

  const handleDelete = async (plan: Plan) => {
    setActionLoading(plan.id)
    try { await plansApi.delete(plan.id); await load() }
    catch { } finally { setActionLoading(null); setDeleteTarget(null) }
  }

  // ── Bulk actions ────────────────────────────────────────────────────────────
  const handleBulkArchive = async () => {
    setBulkLoading(true)
    try {
      await Promise.all([...selected].map((id) => plansApi.update(id, { status: 'archived' })))
      setSelected(new Set())
      await load()
    } catch { } finally { setBulkLoading(false) }
  }

  const handleBulkDelete = async () => {
    setBulkLoading(true)
    try {
      await Promise.all([...selected].map((id) => plansApi.delete(id)))
      setSelected(new Set())
      setBulkDeleteConfirm(false)
      await load()
    } catch { } finally { setBulkLoading(false) }
  }

  const thClass = 'px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wide'

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">{t('plansPage.title')}</h1>
          <p className="text-ink-500 text-sm mt-0.5">{t('plansPage.countSub', { count: plans.length })}</p>
        </div>
        {can.createPlan && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
          >
            <Plus className="size-4" /> {t('plansPage.newPlan')}
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <BulkActionBar
          count={selected.size}
          loading={bulkLoading}
          onArchive={handleBulkArchive}
          onDelete={() => setBulkDeleteConfirm(true)}
          onClear={() => setSelected(new Set())}
        />
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-400" />
          <input
            type="text" placeholder={t('plansPage.searchPlaceholder')} value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-ink-200 bg-white pl-9 pr-4 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-ink-400 shrink-0" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as PlanStatus | 'all')}
            className="rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-700 outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent"
          >
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3,4].map((i) => <div key={i} className="h-16 bg-white rounded-xl border border-ink-100 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={search || statusFilter !== 'all' ? t('plansPage.emptyFilteredTitle') : t('plansPage.emptyTitle')}
          description={search || statusFilter !== 'all' ? t('plansPage.emptyFilteredDesc') : t('plansPage.emptyDesc')}
          action={!search && !statusFilter && can.createPlan ? (
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors">
              <Plus className="size-4" /> {t('plansPage.newPlan')}
            </button>
          ) : undefined}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-ink-100 bg-ink-50">
              <tr>
                {/* Select-all checkbox */}
                <th className="px-4 py-3 w-10">
                  <button onClick={toggleAll} className="text-ink-400 hover:text-accent transition-colors">
                    {allFilteredSelected
                      ? <CheckSquare className="size-4 text-accent" />
                      : someSelected
                        ? <CheckSquare className="size-4 text-accent/50" />
                        : <Square className="size-4" />}
                  </button>
                </th>
                {[
                  { k: 'title' as SortKey,      label: t('plansPage.colPlan') },
                  { k: 'status' as SortKey,     label: t('plansPage.colStatus') },
                  { k: 'progress' as SortKey,   label: t('plansPage.colProgress') },
                  { k: 'updated_at' as SortKey, label: t('plansPage.colLastUpdated') },
                ].map(({ k, label }) => (
                  <th key={k} className={`${thClass} cursor-pointer hover:text-ink-800`} onClick={() => toggleSort(k)}>
                    <span className="flex items-center gap-1">{label} <SortIcon k={k} /></span>
                  </th>
                ))}
                <th className={thClass} />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-50">
              {paginated.map((plan) => {
                const statusLabel = t(`plan.status.${plan.status}`)
                const statusVariant = STATUS_VARIANT[plan.status]
                // KPI achievement is what "progress" means now — falls
                // back to activity-status percent_complete for a plan with
                // no KPIs scored yet (see Plan.kpi_achievement in types).
                const overallPct = plan.kpi_achievement ?? plan.progress?.overall.percent_complete ?? 0
                const overdue = plan.progress?.overall.overdue ?? 0
                const isSelected = selected.has(plan.id)

                return (
                  <tr
                    key={plan.id}
                    onClick={() => navigate(`/plans/${plan.id}`)}
                    className={`cursor-pointer transition-colors group ${isSelected ? 'bg-accent-50 hover:bg-accent-50' : 'hover:bg-ink-50'}`}
                  >
                    {/* Checkbox */}
                    <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleOne(plan.id)}
                        className="text-ink-300 hover:text-accent transition-colors"
                      >
                        {isSelected
                          ? <CheckSquare className="size-4 text-accent" />
                          : <Square className="size-4" />}
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <p className={`font-medium text-sm transition-colors ${isSelected ? 'text-accent' : 'text-ink-900 group-hover:text-accent'}`}>{plan.title}</p>
                      {plan.description && <p className="text-xs text-ink-400 mt-0.5 line-clamp-1">{plan.description}</p>}
                      {overdue > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs text-red-500 mt-1">
                          <AlertTriangle className="size-3" /> {t('plansPage.overdueCount', { count: overdue })}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <Badge variant={statusVariant}>{statusLabel}</Badge>
                    </td>
                    <td className="px-4 py-4 w-52">
                      <ProgressBar value={overallPct} className="w-full" />
                      <p className="text-xs text-ink-400 mt-0.5">{Math.round(overallPct)}%</p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-xs text-ink-500">
                        {new Date(plan.updated_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </td>
                    <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                      {actionLoading === plan.id
                        ? <span className="size-4 animate-spin rounded-full border-2 border-ink-300 border-t-transparent inline-block" />
                        : <PlanRowMenu
                            onArchive={() => handleArchive(plan)}
                            onDuplicate={() => handleDuplicate(plan)}
                            onDelete={() => setDeleteTarget(plan)}
                          />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination — only shown once results actually span more than one page */}
      {!loading && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-ink-400">
            {t('plansPage.showing', {
              from: (page - 1) * PAGE_SIZE + 1,
              to: Math.min(page * PAGE_SIZE, filtered.length),
              total: filtered.length,
            })}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-500 hover:bg-ink-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <ChevronLeft className="size-3.5" /> {t('plansPage.prev')}
            </button>
            <span className="px-2 text-xs text-ink-500 tabular-nums">
              {t('plansPage.pageOf', { page, total: totalPages })}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-500 hover:bg-ink-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              {t('plansPage.next')} <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Single-delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white rounded-2xl border border-ink-100 shadow-xl p-6 space-y-4">
            <div className="size-12 rounded-full bg-red-100 flex items-center justify-center">
              <Trash2 className="size-5 text-red-600" />
            </div>
            <div>
              <h3 className="font-display font-bold text-ink-900">{t('plansPage.deletePlanTitle')}</h3>
              <p className="text-sm text-ink-500 mt-1">
                {t('plansPage.deletePlanDesc', { title: deleteTarget.title })}
              </p>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-xl border border-ink-200 px-4 py-2.5 text-sm font-semibold text-ink-700 hover:bg-ink-50 transition-colors">{t('common.cancel')}</button>
              <button onClick={() => handleDelete(deleteTarget)} className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors">{t('plansPage.deletePlanConfirm')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete confirm */}
      {bulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-white rounded-2xl border border-ink-100 shadow-xl p-6 space-y-4">
            <div className="size-12 rounded-full bg-red-100 flex items-center justify-center">
              <Trash2 className="size-5 text-red-600" />
            </div>
            <div>
              <h3 className="font-display font-bold text-ink-900">{t('plansPage.deleteBulkTitle', { count: selected.size })}</h3>
              <p className="text-sm text-ink-500 mt-1">{t('plansPage.deleteBulkDesc')}</p>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setBulkDeleteConfirm(false)} className="flex-1 rounded-xl border border-ink-200 px-4 py-2.5 text-sm font-semibold text-ink-700 hover:bg-ink-50 transition-colors">{t('common.cancel')}</button>
              <button onClick={handleBulkDelete} disabled={bulkLoading} className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50">
                {bulkLoading ? t('plansPage.deleting') : t('plansPage.deleteBulkConfirm', { count: selected.size })}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && <CreatePlanModal onCreated={load} onClose={() => setShowCreate(false)} />}
    </div>
  )
}