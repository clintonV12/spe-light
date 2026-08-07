import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, TrendingUp, TrendingDown, Lock, Layers } from 'lucide-react'
import { activitiesApi, pillarsApi } from '../../api/endpoints'
import { useToast } from '../../hooks'
import type { Activity, KPI, KPIPeriod, StrategicPillar, StrategicObjective } from '../../types'
import { KPI_PERIODS } from '../../types'
import { useAiDraft, AiAssistTrigger, AiAssistPanel, parseKpiDraft } from './AiChapterAssist'

// ── Local-plan activity editor ──────────────────────────────────────────────
//
// International activities are edited via a per-type component
// (SwotEditor, VisionMissionEditor, GenericEditor, ...) that all share the
// same {value, onChange, readOnly} contract against Activity.content — that
// contract doesn't fit local-plan activities at all, since none of their
// real data lives in `content`. A local activity's editable fields — title
// and kpis — are top-level Activity columns (see
// 008_plan_types_and_local_hierarchy), set on creation in
// CreateActivityModal.tsx and then refined here over the activity's life.
// So rather than force-fitting a `content` shape, this takes the activity
// itself and PUTs partial updates directly via activitiesApi.update —
// same autosave-on-blur pattern the rest of the local-plan chapters use
// (see LocalPlanChapters.tsx), not a single big Save button.
//
// Budget/Responsibility/Measurement Period used to be one set of values for
// the whole activity ("Implementation details", below the KPI list). As of
// migration 013 they live on each KPI instead — the ESWAMCU table answers
// those per-indicator (two KPIs on the same activity can have different
// owners, costs, and reporting cadences), so each KPI card below now carries
// its own Budget/Responsibility/Measurement Period inputs rather than one
// shared panel underneath the list.
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

// Per-KPI free-typed field drafts — target/actual/budget are numeric and
// only committed onBlur (so typing doesn't fire a save on every keystroke);
// responsibility is text, same onBlur pattern for consistency.
// indicator/target(description)/target_period commit differently (see
// commitKpiText / changeKpiPeriod below) so they don't need a draft slot.
interface KpiDraft {
  target: string
  actual: string
  budget: string
  responsibility: string
}

function draftFor(k: KPI): KpiDraft {
  return {
    target: k.target_value?.toString() ?? '',
    actual: k.actual_value?.toString() ?? '',
    budget: k.budget?.toString() ?? '',
    responsibility: k.responsibility ?? '',
  }
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

  const patch = async (payload: Partial<Pick<Activity, 'title' | 'kpis'>>) => {
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

  // ── KPIs ────────────────────────────────────────────────────────────────
  const [kpis, setKpis] = useState<KPI[]>(activity.kpis ?? [])
  const [drafts, setDrafts] = useState<KpiDraft[]>(() => (activity.kpis ?? []).map(draftFor))
  useEffect(() => {
    setKpis(activity.kpis ?? [])
    setDrafts((activity.kpis ?? []).map(draftFor))
  }, [activity.id, activity.kpis])

  const updateKpiText = (i: number, field: 'indicator' | 'target', value: string) => {
    setKpis((prev) => prev.map((k, idx) => (idx === i ? { ...k, [field]: value } : k)))
  }
  const commitKpiText = () => void patch({ kpis })

  const setDraft = (i: number, field: keyof KpiDraft, value: string) => {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)))
  }

  // Commits Target value / Actual value from their drafts.
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

  // Commits this KPI's Budget from its draft.
  const blurKpiBudget = (i: number) => {
    const num = drafts[i].budget.trim() === '' ? undefined : Number(drafts[i].budget)
    if (Number.isNaN(num ?? 0)) return
    if ((kpis[i].budget ?? undefined) === num) return
    const newKpis = kpis.map((k, idx) => (idx === i ? { ...k, budget: num } : k))
    setKpis(newKpis)
    void patch({ kpis: newKpis })
  }

  // Commits this KPI's Responsibility from its draft.
  const blurKpiResponsibility = (i: number) => {
    const trimmed = drafts[i].responsibility.trim() || undefined
    if ((kpis[i].responsibility ?? undefined) === trimmed) return
    const newKpis = kpis.map((k, idx) => (idx === i ? { ...k, responsibility: trimmed } : k))
    setKpis(newKpis)
    void patch({ kpis: newKpis })
  }

  // Measurement Period is a <select>, committed immediately on change
  // (same as the old activity-level selector) rather than on blur.
  const changeKpiPeriod = (i: number, period: KPIPeriod | '') => {
    const newKpis = kpis.map((k, idx) => (idx === i ? { ...k, target_period: period || undefined } : k))
    setKpis(newKpis)
    void patch({ kpis: newKpis })
  }

  const addKpi = () => {
    const newKpis = [...kpis, emptyKPI()]
    setKpis(newKpis)
    setDrafts((prev) => [...prev, draftFor(emptyKPI())])
    void patch({ kpis: newKpis })
  }
  const removeKpi = (i: number) => {
    const newKpis = kpis.filter((_, idx) => idx !== i)
    setKpis(newKpis)
    setDrafts((prev) => prev.filter((_, idx) => idx !== i))
    void patch({ kpis: newKpis })
  }

  // ── AI-suggested KPIs ───────────────────────────────────────────────────
  //
  // Grounded in this activity specifically (activity.id passed through so
  // the backend prompt has the activity's own title/objective to work
  // from, not just the plan) rather than the plan-wide chapter drafts.
  const ai = useAiDraft(activity.plan_id, 'local_activity_kpis', activity.id)
  const acceptAiKpis = async (draft: Record<string, unknown>) => {
    // Throws if the draft didn't contain any usable KPIs — let that
    // propagate to useAiDraft.accept()'s catch so the person sees an error
    // instead of a false "applied" toast with nothing actually saved.
    const suggested = parseKpiDraft(draft)
    // Drop any still-empty rows already sitting in the list so accepting
    // suggestions doesn't leave blank KPI cards behind them.
    const existing = kpis.filter((k) => k.indicator.trim() || k.target.trim())
    const newKpis = [...existing, ...suggested]
    setKpis(newKpis)
    setDrafts(newKpis.map(draftFor))
    await patch({ kpis: newKpis })
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

      {/* KPIs — each carries its own Implementation details (Budget /
          Responsibility / Measurement Period) rather than one shared panel
          for the whole activity, since two KPIs here can have different
          owners, costs, and reporting cadences. */}
      <div className="rounded-2xl border border-ink-100 bg-white p-5">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="font-display text-sm font-bold text-ink-900">Key Performance Indicators</h3>
          {canEdit && (
            <div className="flex items-center gap-2 shrink-0">
              <AiAssistTrigger onClick={ai.start} label="Suggest KPIs" />
              <button onClick={addKpi} className="flex items-center gap-1 text-xs text-accent hover:text-accent-600">
                <Plus className="size-3.5" /> Add
              </button>
            </div>
          )}
        </div>

        {canEdit && ai.open && (
          <AiAssistPanel
            keywords={ai.keywords}
            onKeywordsChange={ai.setKeywords}
            onGenerate={ai.generate}
            loading={ai.loading}
            applying={ai.applying}
            draft={ai.draft}
            model={ai.model}
            onRegenerate={ai.generate}
            onClose={ai.close}
            onAccept={() => ai.accept(acceptAiKpis)}
          />
        )}

        {kpis.length === 0 && <p className="text-sm text-ink-400">No KPIs added yet.</p>}

        <div className="space-y-3">
          {kpis.map((kpi, i) => {
            const DirectionIcon = kpi.direction === 'decrease' ? TrendingDown : TrendingUp
            const periodMeta = kpi.target_period ? PERIOD_META[kpi.target_period] : null
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

                {/* Implementation details — Budget / Responsibility / Measurement
                    Period for this specific KPI (moved off the activity in
                    migration 013). */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pl-6 mt-2.5 pt-2.5 border-t border-ink-100">
                  <div>
                    <label className="h-3.5 flex items-center gap-1 whitespace-nowrap text-[10px] uppercase tracking-wide text-ink-400">
                      Budget
                    </label>
                    <input
                      type="number"
                      placeholder="0.00"
                      disabled={!canEdit}
                      value={drafts[i]?.budget ?? ''}
                      onChange={(e) => setDraft(i, 'budget', e.target.value)}
                      onBlur={() => blurKpiBudget(i)}
                      className="w-full rounded-md border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-accent disabled:bg-ink-50"
                    />
                  </div>
                  <div>
                    <label className="h-3.5 flex items-center gap-1 whitespace-nowrap text-[10px] uppercase tracking-wide text-ink-400">
                      Responsibility
                    </label>
                    <input
                      placeholder="e.g. Board / HR Committee"
                      disabled={!canEdit}
                      value={drafts[i]?.responsibility ?? ''}
                      onChange={(e) => setDraft(i, 'responsibility', e.target.value)}
                      onBlur={() => blurKpiResponsibility(i)}
                      className="w-full rounded-md border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-accent disabled:bg-ink-50"
                    />
                  </div>
                  <div>
                    <label className="h-3.5 flex items-center gap-1 whitespace-nowrap text-[10px] uppercase tracking-wide text-ink-400">
                      Measurement period
                    </label>
                    <select
                      disabled={!canEdit}
                      value={kpi.target_period ?? ''}
                      onChange={(e) => changeKpiPeriod(i, e.target.value as KPIPeriod | '')}
                      className="w-full rounded-md border border-ink-200 bg-white px-2 py-1.5 text-sm text-ink-900 outline-none focus:border-accent disabled:bg-ink-50"
                    >
                      <option value="">No period</option>
                      {KPI_PERIODS.map((p) => (
                        <option key={p} value={p}>{PERIOD_META[p].label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {periodMeta && (
                  <div className="pl-6 mt-1.5">
                    <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-1 border-2 ${periodMeta.color}`}>
                      {periodMeta.label} · which Tracking Module gauge this KPI counts toward
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default LocalActivityEditor