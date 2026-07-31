import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, TrendingUp, TrendingDown } from 'lucide-react'
import { Button, Input } from '../ui'
import { trackingApi } from '../../api/endpoints'
import { useToast } from '../../hooks'
import type { Plan, KPIWithMeasurements, KPIDirection, KPIPeriod, KPIMeasurement } from '../../types'
import { KPI_PERIODS } from '../../types'
import { useAiDraft, AiAssistTrigger, AiAssistPanel } from './AiChapterAssist'

interface TrackingModuleProps {
  plan: Plan
  canEdit: boolean
}

const PERIOD_META: Record<KPIPeriod, { label: string; color: string }> = {
  monthly:   { label: 'Monthly',   color: 'border-p1 bg-p1-light' },
  quarterly: { label: 'Quarterly', color: 'border-p2 bg-p2-light' },
  annual:    { label: 'Annual',    color: 'border-p3 bg-p3-light' },
}

// ── Achievement math ─────────────────────────────────────────────────────
//
// Mirrors models.KPIMeasurement.Achievement in the backend exactly (see
// models_tracking.go) so the number shown here while typing — before the
// value is even saved — matches what the server will compute once it is.
//
//   increase: pct = actual / target * 100   (higher actual is better)
//   decrease: pct = target / actual * 100   (lower actual is better)
//
// Not capped at 100 — overachievement is meaningful — but progress bars
// clamp their *width* at 100% so a 150% KPI doesn't overflow its box.

function computeAchievement(direction: KPIDirection, target?: number, actual?: number): number | null {
  if (target === undefined || target === null || actual === undefined || actual === null) return null
  if (direction === 'decrease') {
    if (actual === 0) return null
    return (target / actual) * 100
  }
  if (target === 0) return null
  return (actual / target) * 100
}

function periodCompletion(kpis: KPIWithMeasurements[], period: KPIPeriod): number | null {
  const values = kpis
    .map((k) => computeAchievement(k.direction, k.measurements[period]?.target_value, k.measurements[period]?.actual_value))
    .filter((v): v is number => v !== null)
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function achievementColor(pct: number): string {
  if (pct >= 100) return 'text-green-600'
  if (pct >= 70) return 'text-p1-dark'
  return 'text-red-600'
}

function achievementBarColor(pct: number): string {
  if (pct >= 100) return 'bg-green-500'
  if (pct >= 70) return 'bg-p1'
  return 'bg-red-400'
}

/** Small horizontal achievement bar + percentage label, used inside each KPI/period cell. */
const AchievementBar: React.FC<{ pct: number | null }> = ({ pct }) => {
  if (pct === null) {
    return <p className="text-xs text-ink-300 mt-1.5">Enter target &amp; actual</p>
  }
  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between mb-0.5">
        <span className={`text-xs font-bold ${achievementColor(pct)}`}>{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-ink-100 overflow-hidden">
        <div className={`h-full rounded-full ${achievementBarColor(pct)}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
    </div>
  )
}

/** Radial gauge for the single headline "Overall Strategic Plan Completion" metric. */
const RadialGauge: React.FC<{ pct: number | null; label: string }> = ({ pct, label }) => {
  const r = 52
  const circumference = 2 * Math.PI * r
  const clamped = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  const offset = circumference * (1 - clamped / 100)
  return (
    <div className="flex flex-col items-center justify-center">
      <svg viewBox="0 0 120 120" className="size-32">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#f1f5f9" strokeWidth="12" />
        {pct !== null && (
          <circle
            cx="60" cy="60" r={r} fill="none"
            stroke={pct >= 100 ? '#22c55e' : pct >= 70 ? '#f59e0b' : '#ef4444'}
            strokeWidth="12" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={offset}
            transform="rotate(-90 60 60)"
          />
        )}
        <text x="60" y="66" textAnchor="middle" className="fill-ink-900 font-display font-bold" style={{ fontSize: 24 }}>
          {pct === null ? '—' : `${Math.round(pct)}%`}
        </text>
      </svg>
      <p className="text-xs font-bold uppercase tracking-wide text-ink-500 mt-1">{label}</p>
    </div>
  )
}

export const TrackingModule: React.FC<TrackingModuleProps> = ({ plan, canEdit }) => {
  const [kpis, setKpis] = useState<KPIWithMeasurements[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [direction, setDirection] = useState<KPIDirection>('increase')
  const [adding, setAdding] = useState(false)
  const { success, error } = useToast()
  const ai = useAiDraft(plan.id, 'local_kpis')

  useEffect(() => {
    trackingApi.list(plan.id)
      .then(setKpis)
      .catch(() => error('Failed to load KPIs'))
      .finally(() => setLoading(false))
  }, [plan.id])

  const addKPI = async () => {
    if (!name.trim()) return
    setAdding(true)
    try {
      const kpi = await trackingApi.create(plan.id, { name: name.trim(), direction })
      setKpis((prev) => [...prev, { ...kpi, measurements: {} }])
      setName('')
      setDirection('increase')
    } catch {
      error('Failed to add KPI')
    } finally {
      setAdding(false)
    }
  }

  const removeKPI = async (id: string) => {
    try {
      await trackingApi.delete(id)
      setKpis((prev) => prev.filter((k) => k.id !== id))
    } catch {
      error('Failed to remove KPI')
    }
  }

  const saveMeasurement = async (kpiId: string, period: KPIPeriod, targetValue: number | null, actualValue: number | null) => {
    try {
      const m = await trackingApi.upsertMeasurement(kpiId, period, { target_value: targetValue, actual_value: actualValue })
      setKpis((prev) => prev.map((k) => (
        k.id === kpiId ? { ...k, measurements: { ...k.measurements, [period]: m } } : k
      )))
    } catch {
      error('Failed to save measurement')
    }
  }

  const handleAiAcceptKpis = async (draft: Record<string, unknown>) => {
    const list = Array.isArray(draft.kpis) ? draft.kpis as unknown[] : []
    for (const raw of list) {
      if (typeof raw !== 'object' || raw === null) continue
      const row = raw as { name?: unknown; direction?: unknown }
      const rowName = typeof row.name === 'string' ? row.name.trim() : ''
      if (!rowName) continue
      const rowDirection: KPIDirection = row.direction === 'decrease' ? 'decrease' : 'increase'
      try {
        const kpi = await trackingApi.create(plan.id, { name: rowName, direction: rowDirection })
        setKpis((prev) => [...prev, { ...kpi, measurements: {} }])
      } catch {
        // best-effort — skip a KPI that fails to save rather than aborting the rest
      }
    }
  }

  const monthly = useMemo(() => periodCompletion(kpis, 'monthly'), [kpis])
  const quarterly = useMemo(() => periodCompletion(kpis, 'quarterly'), [kpis])
  const annual = useMemo(() => periodCompletion(kpis, 'annual'), [kpis])
  const overall = useMemo(() => {
    const parts = [monthly, quarterly, annual].filter((v): v is number => v !== null)
    if (parts.length === 0) return null
    return parts.reduce((a, b) => a + b, 0) / parts.length
  }, [monthly, quarterly, annual])

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-ink-100 rounded-2xl animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Aggregated completion summary */}
      <div className="rounded-2xl border border-ink-100 bg-white p-5">
        <h3 className="font-display text-base font-bold text-ink-900 mb-4">Strategic Plan Completion</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-center justify-items-center">
          <RadialGauge pct={monthly} label="Monthly" />
          <RadialGauge pct={quarterly} label="Quarterly" />
          <RadialGauge pct={annual} label="Annual" />
          <div className="rounded-2xl border-2 border-accent bg-accent-50 p-3 w-full flex justify-center">
            <RadialGauge pct={overall} label="Overall" />
          </div>
        </div>
        {kpis.length === 0 && (
          <p className="text-sm text-ink-400 text-center mt-3">Add KPIs below to start tracking progress.</p>
        )}
      </div>

      {/* KPI list */}
      <div className="rounded-2xl border border-ink-100 bg-white p-5">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h3 className="font-display text-base font-bold text-ink-900">Key Performance Indicators</h3>
          {canEdit && <AiAssistTrigger onClick={ai.start} label="Suggest KPIs" />}
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
            onRegenerate={ai.generate}
            onClose={ai.close}
            onAccept={() => ai.accept(handleAiAcceptKpis)}
          />
        )}

        {kpis.length === 0 && (
          <p className="text-sm text-ink-400 mb-4">No KPIs yet. Add one below, or use "Suggest KPIs" above.</p>
        )}

        <div className="space-y-4 mb-4">
          {kpis.map((kpi) => (
            <KPIRow key={kpi.id} kpi={kpi} canEdit={canEdit} onRemove={() => removeKPI(kpi.id)} onSaveMeasurement={saveMeasurement} />
          ))}
        </div>

        {canEdit && (
          <div className="flex flex-wrap gap-2 items-center pt-3 border-t border-ink-100">
            <Input placeholder="KPI name, e.g. Membership growth" value={name} onChange={(e) => setName(e.target.value)} />
            <select
              className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900"
              value={direction}
              onChange={(e) => setDirection(e.target.value as KPIDirection)}
            >
              <option value="increase">Higher is better</option>
              <option value="decrease">Lower is better</option>
            </select>
            <Button variant="secondary" loading={adding} onClick={addKPI}><Plus className="size-4" /></Button>
          </div>
        )}
      </div>
    </div>
  )
}

const KPIRow: React.FC<{
  kpi: KPIWithMeasurements
  canEdit: boolean
  onRemove: () => void
  onSaveMeasurement: (kpiId: string, period: KPIPeriod, targetValue: number | null, actualValue: number | null) => Promise<void>
}> = ({ kpi, canEdit, onRemove, onSaveMeasurement }) => {
  // Local, per-cell draft values so typing doesn't fire a save on every
  // keystroke — persisted onBlur instead. Seeded from whatever's already
  // saved for this KPI, and reseeded if the parent's data changes under us
  // (e.g. after an AI-suggested batch add).
  const [drafts, setDrafts] = useState<Record<KPIPeriod, { target: string; actual: string }>>(() =>
    Object.fromEntries(KPI_PERIODS.map((p) => [
      p, { target: kpi.measurements[p]?.target_value?.toString() ?? '', actual: kpi.measurements[p]?.actual_value?.toString() ?? '' },
    ])) as Record<KPIPeriod, { target: string; actual: string }>,
  )

  const setDraft = (period: KPIPeriod, field: 'target' | 'actual', value: string) => {
    setDrafts((prev) => ({ ...prev, [period]: { ...prev[period], [field]: value } }))
  }

  const blur = (period: KPIPeriod) => {
    const d = drafts[period]
    const target = d.target.trim() === '' ? null : Number(d.target)
    const actual = d.actual.trim() === '' ? null : Number(d.actual)
    if (Number.isNaN(target ?? 0) || Number.isNaN(actual ?? 0)) return
    const existing: KPIMeasurement | undefined = kpi.measurements[period]
    if ((existing?.target_value ?? null) === target && (existing?.actual_value ?? null) === actual) return
    void onSaveMeasurement(kpi.id, period, target, actual)
  }

  const DirectionIcon = kpi.direction === 'decrease' ? TrendingDown : TrendingUp

  return (
    <div className="rounded-2xl border border-ink-100 bg-ink-50/40 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <DirectionIcon className="size-4 text-ink-400 shrink-0" />
          <p className="text-sm font-semibold text-ink-900">{kpi.name}</p>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400 bg-white border border-ink-200 rounded-full px-2 py-0.5">
            {kpi.direction === 'decrease' ? 'Lower is better' : 'Higher is better'}
          </span>
        </div>
        {canEdit && (
          <button onClick={onRemove} className="text-ink-400 hover:text-red-600 transition-colors">
            <Trash2 className="size-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {KPI_PERIODS.map((period) => {
          const pct = computeAchievement(
            kpi.direction,
            drafts[period].target.trim() === '' ? undefined : Number(drafts[period].target),
            drafts[period].actual.trim() === '' ? undefined : Number(drafts[period].actual),
          )
          const { label, color } = PERIOD_META[period]
          return (
            <div key={period} className={`rounded-xl border-2 p-3 ${color}`}>
              <p className="text-[11px] font-bold uppercase tracking-wide text-ink-600 mb-1.5">{label}</p>
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="number"
                  disabled={!canEdit}
                  placeholder="Target"
                  value={drafts[period].target}
                  onChange={(e) => setDraft(period, 'target', e.target.value)}
                  onBlur={() => blur(period)}
                  className="w-full rounded-md border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-accent disabled:bg-ink-50"
                />
                <input
                  type="number"
                  disabled={!canEdit}
                  placeholder="Actual"
                  value={drafts[period].actual}
                  onChange={(e) => setDraft(period, 'actual', e.target.value)}
                  onBlur={() => blur(period)}
                  className="w-full rounded-md border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-accent disabled:bg-ink-50"
                />
              </div>
              <AchievementBar pct={pct} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default TrackingModule