import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Table2, BarChart3, AlertTriangle } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Button } from '../../ui'

export interface KpiRow {
  id: string
  name: string
  unit: string
  baseline: string
  target: string
  current: string
  /**
   * Which Strategic Objective this KPI tracks progress toward. Set when the
   * plan has real, linkable objectives to pick from (objective_id references
   * a real entity — a formal StrategicObjective for local plans, or a
   * sibling 'strategic_objectives'-type activity's id for international
   * plans, see ActivityEditorPage's objectiveOptions).
   */
  objective_id?: string
  /**
   * Cached display label for the linked objective, so the row still shows
   * something meaningful even if the objectives list changes or fails to
   * load later. Also doubles as a free-text fallback field when no
   * objectives exist yet for the plan (objective_id stays unset in that case).
   */
  objective_label?: string
}

// A linkable Strategic Objective, sourced by the caller (ActivityEditorPage)
// from either the formal StrategicObjective model (local plans) or sibling
// 'strategic_objectives'-type activities (international plans).
export interface ObjectiveOption {
  id: string
  label: string
}

interface KpiEditorProps {
  value: KpiRow[]
  onChange: (rows: KpiRow[]) => void
  readOnly?: boolean
  /**
   * Available objectives this plan's KPIs can be linked to. Empty means no
   * objectives exist yet for this plan — the Objective column falls back to
   * a free-text note and a warning is shown, since a KPI with nothing to
   * track against isn't doing its job.
   */
  objectives?: ObjectiveOption[]
}

type ViewMode = 'table' | 'bar'

export const KpiEditor: React.FC<KpiEditorProps> = ({ value, onChange, readOnly, objectives = [] }) => {
  const { t } = useTranslation()
  const [view, setView] = useState<ViewMode>('table')

  const hasObjectives = objectives.length > 0
  const objectiveById = useMemo(() => new Map(objectives.map((o) => [o.id, o.label])), [objectives])

  // A row counts as "unlinked" if it has neither a formal objective_id nor
  // even a free-text objective_label — i.e. nothing at all connecting this
  // KPI to something it's meant to track.
  const unlinkedCount = useMemo(
    () => value.filter((r) => r.name.trim() && !r.objective_id && !r.objective_label?.trim()).length,
    [value],
  )

  const addRow = () => {
    // New rows default-link to the first available objective (rather than
    // starting blank) so a KPI isn't disconnected from any objective by
    // default — the user can still explicitly clear it via the "Not linked"
    // option if they really mean to.
    const defaultObjective = objectives[0]
    onChange([
      ...value,
      {
        id: crypto.randomUUID(),
        name: '', unit: '', baseline: '', target: '', current: '',
        objective_id: defaultObjective?.id,
        objective_label: defaultObjective?.label,
      },
    ])
  }

  const updateRow = (id: string, field: keyof KpiRow, val: string) => {
    onChange(value.map((r) => (r.id === id ? { ...r, [field]: val } : r)))
  }

  const updateRowObjective = (id: string, objectiveId: string) => {
    if (objectiveId === '') {
      // Explicit "Not linked" selection.
      onChange(value.map((r) => (r.id === id ? { ...r, objective_id: undefined, objective_label: undefined } : r)))
      return
    }
    const label = objectiveById.get(objectiveId)
    onChange(value.map((r) => (r.id === id ? { ...r, objective_id: objectiveId, objective_label: label } : r)))
  }

  const removeRow = (id: string) => {
    onChange(value.filter((r) => r.id !== id))
  }

  const seriesLabels = {
    Baseline: t('editors.kpi.seriesBaseline'),
    Target: t('editors.kpi.seriesTarget'),
    Current: t('editors.kpi.seriesCurrent'),
  }

  const chartData = useMemo(() => value
    .filter((r) => r.name.trim() !== '')
    .map((r) => ({
      name: r.name.length > 16 ? `${r.name.slice(0, 16)}…` : r.name,
      [seriesLabels.Baseline]: Number(r.baseline) || 0,
      [seriesLabels.Target]: Number(r.target) || 0,
      [seriesLabels.Current]: Number(r.current) || 0,
    })), [value, seriesLabels.Baseline, seriesLabels.Target, seriesLabels.Current])

  return (
    <div className="space-y-3">
      {!readOnly && unlinkedCount > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            {hasObjectives
              ? t('editors.kpi.unlinkedWarning', {
                  count: unlinkedCount,
                  defaultValue: `${unlinkedCount} KPI${unlinkedCount === 1 ? '' : 's'} not linked to a Strategic Objective. A KPI without an objective doesn't track anything's progress — link it, or note what it supports.`,
                })
              : t('editors.kpi.noObjectivesWarning', {
                  defaultValue: "This plan has no Strategic Objectives yet. KPIs are meant to track an objective's progress — add an objective first, or use the Objective field below as a temporary note.",
                })}
          </p>
        </div>
      )}

      <div className="flex items-center gap-1 rounded-lg border border-ink-200 bg-white p-1 w-fit">
        {(['table', 'bar'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setView(mode)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              view === mode ? 'bg-accent text-white' : 'text-ink-500 hover:bg-ink-50'
            }`}
          >
            {mode === 'table' ? <Table2 className="size-3.5" /> : <BarChart3 className="size-3.5" />}
            {mode === 'table' ? t('editorsCommon.table') : t('editorsCommon.bar')}
          </button>
        ))}
      </div>

      {view === 'table' ? (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-ink-100">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-xs font-semibold text-ink-500 uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left min-w-40">{t('editors.kpi.headers.objective', { defaultValue: 'Objective' })}</th>
                  {[t('editors.kpi.headers.name'), t('editors.kpi.headers.unit'), t('editors.kpi.headers.baseline'), t('editors.kpi.headers.target'), t('editors.kpi.headers.current')].map((h, i) => (
                    <th key={i} className="px-3 py-2 text-left">{h}</th>
                  ))}
                  {!readOnly && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {value.map((row) => {
                  const unlinked = row.name.trim() && !row.objective_id && !row.objective_label?.trim()
                  return (
                  <tr key={row.id}>
                    <td className={`px-2 py-1 ${unlinked ? 'bg-amber-50' : ''}`}>
                      {hasObjectives ? (
                        <select
                          className={`w-full bg-transparent px-1.5 py-1 text-xs outline-none rounded ${
                            unlinked ? 'text-amber-700 border border-amber-300' : 'text-ink-700 focus:bg-ink-50'
                          }`}
                          value={row.objective_id ?? ''}
                          onChange={(e) => updateRowObjective(row.id, e.target.value)}
                          disabled={readOnly}
                        >
                          <option value="">{t('editors.kpi.notLinked', { defaultValue: '— Not linked (not recommended) —' })}</option>
                          {objectives.map((o) => (
                            <option key={o.id} value={o.id}>{o.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className={`w-full bg-transparent px-1 py-1 text-xs outline-none rounded ${
                            unlinked ? 'text-amber-700 placeholder:text-amber-400' : 'text-ink-700 focus:bg-ink-50'
                          }`}
                          value={row.objective_label ?? ''}
                          onChange={(e) => updateRow(row.id, 'objective_label', e.target.value)}
                          readOnly={readOnly}
                          placeholder={t('editors.kpi.objectivePlaceholder', { defaultValue: 'What objective does this support?' })}
                        />
                      )}
                    </td>
                    {(['name', 'unit', 'baseline', 'target', 'current'] as (keyof KpiRow)[]).map((field) => (
                      <td key={field} className="px-2 py-1">
                        <input
                          className="w-full bg-transparent px-1 py-1 text-ink-800 outline-none focus:bg-ink-50 rounded"
                          value={row[field]}
                          onChange={(e) => updateRow(row.id, field, e.target.value)}
                          readOnly={readOnly}
                          placeholder="—"
                        />
                      </td>
                    ))}
                    {!readOnly && (
                      <td className="px-2 py-1">
                        <button onClick={() => removeRow(row.id)} className="text-ink-300 hover:text-red-500">
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!readOnly && (
            <Button variant="ghost" size="sm" onClick={addRow}>
              <Plus className="size-4" /> {t('editorsCommon.addKpi')}
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-ink-100 bg-white p-4">
          {chartData.length === 0 ? (
            <p className="py-16 text-center text-xs text-ink-300">{t('editorsCommon.addNamedKpiForChart')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey={seriesLabels.Baseline} fill="#94a3b8" radius={[4, 4, 0, 0]} />
                <Bar dataKey={seriesLabels.Current} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey={seriesLabels.Target} fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="mt-1 text-center text-[11px] text-ink-300">{t('editorsCommon.chartOnlyNotSaved')}</p>
        </div>
      )}
    </div>
  )
}

export default KpiEditor