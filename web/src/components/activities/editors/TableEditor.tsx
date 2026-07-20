import React, { useMemo, useState } from 'react'
import { Plus, Trash2, Table2, BarChart3, LineChart as LineChartIcon, PieChart as PieChartIcon } from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

export type ColumnType = 'text' | 'number' | 'date' | 'select'

export interface TableColumn {
  key: string
  label: string
  type: ColumnType
  options?: string[]     // required when type === 'select'
  placeholder?: string
  width?: string          // optional min-width tailwind class, e.g. 'min-w-40'
}

export interface ChartSeries {
  key: string             // must reference a numeric-type column
  label: string
  color: string
}

export interface ChartConfig {
  /** Column used as the category / x-axis label for every chart mode. */
  labelColumn: string
  /** One or more numeric columns to plot as bar/line series. */
  series?: ChartSeries[]
  /** Alternative to `series` — counts rows grouped by a select/text column
   *  (e.g. "how many action items are Open vs Done"). */
  groupByColumn?: string
  enableBar?: boolean
  enableLine?: boolean
  enablePie?: boolean
}

export type TableRow = { id: string } & Record<string, string>

interface TableEditorProps {
  columns: TableColumn[]
  value: TableRow[]
  onChange: (rows: TableRow[]) => void
  readOnly?: boolean
  chart?: ChartConfig
  addLabel?: string
  emptyRow?: Record<string, string>
}

const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16']

type ViewMode = 'table' | 'bar' | 'line' | 'pie'

export const TableEditor: React.FC<TableEditorProps> = ({
  columns, value, onChange, readOnly, chart, addLabel = 'Add row', emptyRow,
}) => {
  const chartModes: ViewMode[] = useMemo(() => {
    if (!chart) return []
    const modes: ViewMode[] = []
    if (chart.enableBar !== false) modes.push('bar')
    if (chart.enableLine && chart.series && chart.series.length > 0) modes.push('line')
    if (chart.enablePie !== false && (chart.groupByColumn || (chart.series && chart.series.length === 1))) modes.push('pie')
    return modes
  }, [chart])

  const [view, setView] = useState<ViewMode>('table')

  const addRow = () => {
    const row: TableRow = { id: crypto.randomUUID(), ...(emptyRow ?? Object.fromEntries(columns.map((c) => [c.key, '']))) }
    onChange([...value, row])
  }

  const updateRow = (id: string, key: string, val: string) => {
    onChange(value.map((r) => (r.id === id ? { ...r, [key]: val } : r)))
  }

  const removeRow = (id: string) => onChange(value.filter((r) => r.id !== id))

  // ── Chart data derivation (frontend-only; never written back to content) ──

  const seriesChartData = useMemo(() => {
    if (!chart?.series) return []
    return value
      .filter((r) => (r[chart.labelColumn] ?? '').trim() !== '')
      .map((r) => {
        const point: Record<string, string | number> = { label: r[chart.labelColumn] }
        chart.series!.forEach((s) => { point[s.key] = Number(r[s.key]) || 0 })
        return point
      })
  }, [value, chart])

  const groupByChartData = useMemo(() => {
    if (!chart?.groupByColumn) return []
    const counts = new Map<string, number>()
    value.forEach((r) => {
      const v = (r[chart.groupByColumn!] ?? '').trim() || 'Unspecified'
      counts.set(v, (counts.get(v) ?? 0) + 1)
    })
    return Array.from(counts.entries()).map(([name, count]) => ({ name, count }))
  }, [value, chart])

  const pieData = chart?.groupByColumn
    ? groupByChartData.map((d) => ({ name: d.name, value: d.count }))
    : chart?.series?.length === 1
      ? seriesChartData.map((d) => ({ name: String(d.label), value: Number(d[chart.series![0].key]) || 0 }))
      : []

  const hasChartableData = view === 'bar' || view === 'line'
    ? (chart?.groupByColumn ? groupByChartData.length > 0 : seriesChartData.length > 0)
    : pieData.length > 0

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {chartModes.length > 0 && (
        <div className="flex items-center gap-1 rounded-lg border border-ink-200 bg-white p-1 w-fit">
          {(['table', ...chartModes] as ViewMode[]).map((mode) => {
            const icon = {
              table: <Table2 className="size-3.5" />,
              bar: <BarChart3 className="size-3.5" />,
              line: <LineChartIcon className="size-3.5" />,
              pie: <PieChartIcon className="size-3.5" />,
            }[mode]
            const label = { table: 'Table', bar: 'Bar', line: 'Line', pie: 'Pie' }[mode]
            return (
              <button
                key={mode}
                onClick={() => setView(mode)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  view === mode ? 'bg-accent text-white' : 'text-ink-500 hover:bg-ink-50'
                }`}
              >
                {icon} {label}
              </button>
            )
          })}
        </div>
      )}

      {view === 'table' && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-ink-100">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-xs font-semibold text-ink-500 uppercase tracking-wide">
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className="px-3 py-2 text-left">{c.label}</th>
                  ))}
                  {!readOnly && <th />}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {value.map((row) => (
                  <tr key={row.id}>
                    {columns.map((c) => (
                      <td key={c.key} className={`px-2 py-1 ${c.width ?? 'min-w-32'}`}>
                        {c.type === 'select' ? (
                          <select
                            className="w-full bg-transparent px-1 py-1 outline-none focus:bg-ink-50 rounded text-ink-800"
                            value={row[c.key] ?? ''}
                            onChange={(e) => updateRow(row.id, c.key, e.target.value)}
                            disabled={readOnly}
                          >
                            <option value="">—</option>
                            {c.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input
                            type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                            className="w-full bg-transparent px-1 py-1 outline-none focus:bg-ink-50 rounded text-ink-800"
                            value={row[c.key] ?? ''}
                            onChange={(e) => updateRow(row.id, c.key, e.target.value)}
                            readOnly={readOnly}
                            placeholder={c.placeholder ?? '—'}
                          />
                        )}
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
                {value.length === 0 && (
                  <tr>
                    <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-xs text-ink-300">
                      No rows yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {!readOnly && (
            <button
              onClick={addRow}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent-50 transition-colors"
            >
              <Plus className="size-4" /> {addLabel}
            </button>
          )}
        </div>
      )}

      {view !== 'table' && (
        <div className="rounded-xl border border-ink-100 bg-white p-4">
          {!hasChartableData ? (
            <p className="py-16 text-center text-xs text-ink-300">Add some rows to see the chart.</p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              {view === 'bar' ? (
                <BarChart data={chart?.groupByColumn ? groupByChartData : seriesChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey={chart?.groupByColumn ? 'name' : 'label'} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  {chart?.series && chart.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
                  {chart?.groupByColumn
                    ? <Bar dataKey="count" fill={PALETTE[0]} radius={[4, 4, 0, 0]} />
                    : chart?.series?.map((s, i) => (
                      <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color || PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} />
                    ))}
                </BarChart>
              ) : view === 'line' ? (
                <LineChart data={seriesChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {chart?.series?.map((s, i) => (
                    <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color || PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 3 }} />
                  ))}
                </LineChart>
              ) : (
                <PieChart>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={110} label={{ fontSize: 11 }}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                </PieChart>
              )}
            </ResponsiveContainer>
          )}
          <p className="mt-1 text-center text-[11px] text-ink-300">Chart view only — not saved with the activity.</p>
        </div>
      )}
    </div>
  )
}

export default TableEditor