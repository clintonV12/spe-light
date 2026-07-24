import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Table2, BarChart3 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Button } from '../../ui'

export interface KpiRow {
  id: string
  name: string
  unit: string
  baseline: string
  target: string
  current: string
}

interface KpiEditorProps {
  value: KpiRow[]
  onChange: (rows: KpiRow[]) => void
  readOnly?: boolean
}

type ViewMode = 'table' | 'bar'

export const KpiEditor: React.FC<KpiEditorProps> = ({ value, onChange, readOnly }) => {
  const { t } = useTranslation()
  const [view, setView] = useState<ViewMode>('table')

  const addRow = () => {
    onChange([...value, { id: crypto.randomUUID(), name: '', unit: '', baseline: '', target: '', current: '' }])
  }

  const updateRow = (id: string, field: keyof KpiRow, val: string) => {
    onChange(value.map((r) => (r.id === id ? { ...r, [field]: val } : r)))
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
                  {[t('editors.kpi.headers.name'), t('editors.kpi.headers.unit'), t('editors.kpi.headers.baseline'), t('editors.kpi.headers.target'), t('editors.kpi.headers.current')].map((h, i) => (
                    <th key={i} className="px-3 py-2 text-left">{h}</th>
                  ))}
                  {!readOnly && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {value.map((row) => (
                  <tr key={row.id}>
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
                ))}
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