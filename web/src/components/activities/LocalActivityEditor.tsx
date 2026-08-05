import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, TrendingUp, TrendingDown, Lock, Layers } from 'lucide-react'
import { Input } from '../ui'
import { activitiesApi, pillarsApi } from '../../api/endpoints'
import { useToast } from '../../hooks'
import type { Activity, KPI, KPIPeriod, StrategicPillar, StrategicObjective } from '../../types'
import { KPI_PERIODS } from '../../types'

// ── Local-plan activity editor ──────────────────────────────────────────────
//
// International activities are edited via a per-type component
// (SwotEditor, VisionMissionEditor, GenericEditor, ...) that all share the
// same {value, onChange, readOnly} contract against Activity.content — that
// contract doesn't fit local-plan activities at all, since none of their
// real data lives in `content`. A local activity's editable fields —
// budget, responsibility, target_period, kpis — are top-level Activity
// columns (see 008_plan_types_and_local_hierarchy), set on creation in
// CreateActivityModal.tsx and then refined here over the activity's life.
// So rather than force-fitting a `content` shape, this takes the activity
// itself and PUTs partial updates directly via activitiesApi.update —
// same autosave-on-blur pattern the rest of the local-plan chapters use
// (see LocalPlanChapters.tsx), not a single big Save button.
//
// Target values entered here are the ones the Tracking Module then treats
// as locked (see TrackingModule.tsx's targetLocked) — this is the
// authoritative place to set a KPI's target; Tracking Module is where
// Actual gets filled in as progress comes in, though it's editable here
// too for convenience (e.g. correcting a typo without leaving this page).

interface LocalActivityEditorProps {
  activity: Activity
  canEdit: boolean
  onUpdated: (activity: Activity) => void
}

const PERIOD_META: Record<KPIPeriod, { label: string; color: string }> = {
  monthly:   { label: 'Monthly',   color: 'border-p1 bg-p1-light' },
  quarterly: { label: 'Quarterly', color: 'border-p2 bg-p2-light' },
  annual:    { label: 'Annual',    color: 'border-p3 bg-p3-light' },
}

function emptyKPI(): KPI {
  return { indicator: '', target: '', target_value: undefined }
}

export const LocalActivityEditor: React.FC<LocalActivityEditorProps> = ({ activity, canEdit, onUpdated }) => {
  const { error } = useToast()

  // ── Breadcrumb (Pillar › Objective) ───────────────────────────────────
  const [pillars, setPillars] = useState<StrategicPillar[]>([])
  const [objectives, setObjectives] = useState<StrategicObjective[]>([])
  useEffect(() => {
    pillarsApi.list(activity.plan_id).then(setPillars).catch(() => {})
    pillarsApi.listObjectives(activity.plan_id).then(setObjectives).catch(() => {})
  }, [activity.plan_id])
  const breadcrumb = useMemo(() => {
    const objective = objectives.find((o) => o.id === activity.objective_id)
    const pillar = objective ? pillars.find((p) => p.id === objective.pillar_id) : undefined
    if (pillar && objective) return `${pillar.title} › ${objective.title}`
    return objective?.title ?? ''
  }, [objectives, pillars, activity.objective_id])

  // ── Title / status ─────────────────────────────────────────────────────
  const [title, setTitle] = useState(activity.title)
  useEffect(() => setTitle(activity.title), [activity.id, activity.title])

  const patch = async (payload: Partial<Pick<Activity,
    'title' | 'budget' | 'responsibility' | 'target_period' | 'kpis'
  >>) => {
    try {
      const updated = await activitiesApi.update(activity.id, payload)
      onUpdated(updated)
    } catch {
      error('Failed to save changes')
    }
  }

  const saveTitle = () => {
    if (title.trim() && title.trim() !== activity.title) void patch({ title: title.trim() })
  }

  // ── Budget / Responsibility ────────────────────────────────────────────
  const [budget, setBudget] = useState(activity.budget?.toString() ?? '')
  const [responsibility, setResponsibility] = useState(activity.responsibility ?? '')
  useEffect(() => {
    setBudget(activity.budget?.toString() ?? '')
    setResponsibility(activity.responsibility ?? '')
  }, [activity.id, activity.budget, activity.responsibility])

  const saveBudget = () => {
    const num = budget.trim() === '' ? undefined : Number(budget)
    if (Number.isNaN(num ?? 0)) return
    if ((activity.budget ?? undefined) !== num) void patch({ budget: num })
  }
  const saveResponsibility = () => {
    const trimmed = responsibility.trim() || undefined
    if ((activity.responsibility ?? undefined) !== trimmed) void patch({ responsibility: trimmed })
  }

  // ── Measurement period ─────────────────────────────────────────────────
  const savePeriod = (period: KPIPeriod | '') => {
    void patch({ target_period: period || undefined })
  }

  // ── KPIs ────────────────────────────────────────────────────────────────
  const [kpis, setKpis] = useState<KPI[]>(activity.kpis ?? [])
  const [drafts, setDrafts] = useState<{ target: string; actual: string }[]>(() =>
    (activity.kpis ?? []).map((k) => ({ target: k.target_value?.toString() ?? '', actual: k.actual_value?.toString() ?? '' })),
  )
  useEffect(() => {
    setKpis(activity.kpis ?? [])
    setDrafts((activity.kpis ?? []).map((k) => ({ target: k.target_value?.toString() ?? '', actual: k.actual_value?.toString() ?? '' })))
  }, [activity.id, activity.kpis])

  const updateKpiText = (i: number, field: 'indicator' | 'target', value: string) => {
    setKpis((prev) => prev.map((k, idx) => (idx === i ? { ...k, [field]: value } : k)))
  }
  const commitKpiText = () => void patch({ kpis })

  const setDraft = (i: number, field: 'target' | 'actual', value: string) => {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)))
  }
  const blurKpiValue = (i: number) => {
    const d = drafts[i]
    const targetValue = d.target.trim() === '' ? undefined : Number(d.target)
    const actualValue = d.actual.trim() === '' ? undefined : Number(d.actual)
    if (Number.isNaN(targetValue ?? 0) || Number.isNaN(actualValue ?? 0)) return
    const current = kpis[i]
    if ((current.target_value ?? undefined) === targetValue && (current.actual_value ?? undefined) === actualValue) return
    const newKpis = kpis.map((k, idx) => (idx === i ? { ...k, target_value: targetValue, actual_value: actualValue } : k))
    setKpis(newKpis)
    void patch({ kpis: newKpis })
  }

  const addKpi = () => {
    const newKpis = [...kpis, emptyKPI()]
    setKpis(newKpis)
    setDrafts((prev) => [...prev, { target: '', actual: '' }])
    void patch({ kpis: newKpis })
  }
  const removeKpi = (i: number) => {
    const newKpis = kpis.filter((_, idx) => idx !== i)
    setKpis(newKpis)
    setDrafts((prev) => prev.filter((_, idx) => idx !== i))
    void patch({ kpis: newKpis })
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header: breadcrumb, title */}
      <div className="rounded-2xl border border-ink-100 bg-white p-5">
        {breadcrumb && (
          <p className="flex items-center gap-1.5 text-xs text-ink-400 mb-2">
            <Layers className="size-3.5" /> {breadcrumb}
          </p>
        )}
        <input
          disabled={!canEdit}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          className="w-full font-display text-lg font-bold text-ink-900 outline-none bg-transparent border-b-2 border-transparent focus:border-accent-200 disabled:text-ink-500"
        />
      </div>

      {/* KPIs */}
      <div className="rounded-2xl border border-ink-100 bg-white p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-sm font-bold text-ink-900">Key Performance Indicators</h3>
          {canEdit && (
            <button onClick={addKpi} className="flex items-center gap-1 text-xs text-accent hover:text-accent-600">
              <Plus className="size-3.5" /> Add
            </button>
          )}
        </div>

        {kpis.length === 0 && <p className="text-sm text-ink-400">No KPIs added yet.</p>}

        <div className="space-y-3">
          {kpis.map((kpi, i) => {
            const DirectionIcon = kpi.direction === 'decrease' ? TrendingDown : TrendingUp
            return (
              <div key={i} className="rounded-xl border border-ink-100 bg-ink-50/40 p-3">
                <div className="flex items-start gap-2 mb-2">
                  <DirectionIcon className="size-4 text-ink-400 shrink-0 mt-2" />
                  <div className="flex-1 space-y-1.5">
                    <input
                      disabled={!canEdit}
                      value={kpi.indicator}
                      onChange={(e) => updateKpiText(i, 'indicator', e.target.value)}
                      onBlur={commitKpiText}
                      placeholder="Indicator"
                      className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent disabled:bg-ink-50"
                    />
                    <input
                      disabled={!canEdit}
                      value={kpi.target}
                      onChange={(e) => updateKpiText(i, 'target', e.target.value)}
                      onBlur={commitKpiText}
                      placeholder="Target (description)"
                      className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent disabled:bg-ink-50"
                    />
                  </div>
                  {canEdit && (
                    <button onClick={() => removeKpi(i)} className="mt-2 text-ink-300 hover:text-red-500 transition-colors">
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 pl-6">
                  <div>
                    <label className="h-3.5 flex items-center gap-1 whitespace-nowrap text-[10px] uppercase tracking-wide text-ink-400">
                      Target value
                    </label>
                    <input
                      type="number"
                      disabled={!canEdit}
                      value={drafts[i]?.target ?? ''}
                      onChange={(e) => setDraft(i, 'target', e.target.value)}
                      onBlur={() => blurKpiValue(i)}
                      className="w-full rounded-md border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-accent disabled:bg-ink-50"
                    />
                  </div>
                  <div>
                    <label className="h-3.5 flex items-center gap-1 whitespace-nowrap text-[10px] uppercase tracking-wide text-ink-400">
                      Actual value <Lock className="size-2.5 shrink-0" />
                    </label>
                    <input
                      type="number"
                      disabled={!canEdit}
                      value={drafts[i]?.actual ?? ''}
                      onChange={(e) => setDraft(i, 'actual', e.target.value)}
                      onBlur={() => blurKpiValue(i)}
                      className="w-full rounded-md border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-accent disabled:bg-ink-50"
                      title="Normally updated from the Tracking Module as progress comes in — editable here too."
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Budget / Responsibility / Measurement period */}
      <div className="rounded-2xl border border-ink-100 bg-white p-5 space-y-4">
        <h3 className="font-display text-sm font-bold text-ink-900">Implementation details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Budget"
            type="number"
            placeholder="0.00"
            value={budget}
            disabled={!canEdit}
            onChange={(e) => setBudget(e.target.value)}
            onBlur={saveBudget}
          />
          <Input
            label="Responsibility"
            placeholder="e.g. Board / HR Committee"
            value={responsibility}
            disabled={!canEdit}
            onChange={(e) => setResponsibility(e.target.value)}
            onBlur={saveResponsibility}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-700 mb-1.5">Measurement Period</label>
          <select
            disabled={!canEdit}
            value={activity.target_period ?? ''}
            onChange={(e) => savePeriod(e.target.value as KPIPeriod | '')}
            className="w-full sm:w-64 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none focus:border-accent disabled:bg-ink-50"
          >
            <option value="">No measurement period</option>
            {KPI_PERIODS.map((p) => (
              <option key={p} value={p}>{PERIOD_META[p].label}</option>
            ))}
          </select>
          <p className="text-xs text-ink-400 mt-1">
            Which Tracking Module gauge this activity's KPIs count toward.
          </p>
        </div>
      </div>

    </div>
  )
}

export default LocalActivityEditor