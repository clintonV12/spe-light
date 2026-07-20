import React, { useMemo, useState } from 'react'
import { Plus, Trash2, Table2, BarChart3, Grid3x3 } from 'lucide-react'
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis,
} from 'recharts'
import { Button } from '../../ui'

export interface RiskRow {
  id: string
  risk: string
  likelihood: 1 | 2 | 3 | 4 | 5
  impact: 1 | 2 | 3 | 4 | 5
  score: number
  mitigation: string
  owner: string
}

function calcScore(l: number, i: number) { return l * i }

function scoreColor(score: number): string {
  if (score >= 15) return 'bg-red-100 text-red-700'
  if (score >= 8)  return 'bg-amber-100 text-amber-700'
  return 'bg-green-100 text-green-700'
}

function scoreHex(score: number): string {
  if (score >= 15) return '#ef4444'
  if (score >= 8)  return '#f59e0b'
  return '#22c55e'
}

interface RiskRegisterEditorProps {
  value: RiskRow[]
  onChange: (rows: RiskRow[]) => void
  readOnly?: boolean
}

type ViewMode = 'table' | 'bar' | 'matrix'

export const RiskRegisterEditor: React.FC<RiskRegisterEditorProps> = ({ value, onChange, readOnly }) => {
  const [view, setView] = useState<ViewMode>('table')

  const addRow = () => {
    const row: RiskRow = { id: crypto.randomUUID(), risk: '', likelihood: 1, impact: 1, score: 1, mitigation: '', owner: '' }
    onChange([...value, row])
  }

  const updateRow = (id: string, field: keyof RiskRow, val: string | number) => {
    onChange(value.map((r) => {
      if (r.id !== id) return r
      const updated = { ...r, [field]: val }
      updated.score = calcScore(updated.likelihood, updated.impact)
      return updated
    }))
  }

  const removeRow = (id: string) => onChange(value.filter((r) => r.id !== id))

  const namedRows = useMemo(() => value.filter((r) => r.risk.trim() !== ''), [value])

  const barData = useMemo(() => namedRows
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((r) => ({ name: r.risk.length > 18 ? `${r.risk.slice(0, 18)}…` : r.risk, score: r.score })),
  [namedRows])

  const matrixData = useMemo(() => namedRows.map((r) => ({
    likelihood: r.likelihood, impact: r.impact, score: r.score, name: r.risk,
  })), [namedRows])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 rounded-lg border border-ink-200 bg-white p-1 w-fit">
        {(['table', 'bar', 'matrix'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setView(mode)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              view === mode ? 'bg-accent text-white' : 'text-ink-500 hover:bg-ink-50'
            }`}
          >
            {mode === 'table' && <Table2 className="size-3.5" />}
            {mode === 'bar' && <BarChart3 className="size-3.5" />}
            {mode === 'matrix' && <Grid3x3 className="size-3.5" />}
            {mode === 'table' ? 'Table' : mode === 'bar' ? 'Bar' : 'Risk matrix'}
          </button>
        ))}
      </div>

      {view === 'table' && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-ink-100">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-xs font-semibold text-ink-500 uppercase tracking-wide">
                <tr>
                  {['Risk', 'Likelihood (1-5)', 'Impact (1-5)', 'Score', 'Mitigation', 'Owner'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left">{h}</th>
                  ))}
                  {!readOnly && <th />}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {value.map((row) => (
                  <tr key={row.id}>
                    <td className="px-2 py-1 min-w-48">
                      <input className="w-full bg-transparent px-1 py-1 outline-none focus:bg-ink-50 rounded text-ink-800" value={row.risk} onChange={(e) => updateRow(row.id, 'risk', e.target.value)} readOnly={readOnly} placeholder="Describe the risk" />
                    </td>
                    {(['likelihood', 'impact'] as const).map((field) => (
                      <td key={field} className="px-2 py-1">
                        <input type="number" min={1} max={5} className="w-16 bg-transparent px-1 py-1 outline-none focus:bg-ink-50 rounded text-ink-800 text-center" value={row[field]} onChange={(e) => updateRow(row.id, field, Number(e.target.value) as 1)} readOnly={readOnly} />
                      </td>
                    ))}
                    <td className="px-2 py-1">
                      <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold ${scoreColor(row.score)}`}>{row.score}</span>
                    </td>
                    <td className="px-2 py-1 min-w-40">
                      <input className="w-full bg-transparent px-1 py-1 outline-none focus:bg-ink-50 rounded text-ink-800" value={row.mitigation} onChange={(e) => updateRow(row.id, 'mitigation', e.target.value)} readOnly={readOnly} placeholder="Mitigation action" />
                    </td>
                    <td className="px-2 py-1">
                      <input className="w-full bg-transparent px-1 py-1 outline-none focus:bg-ink-50 rounded text-ink-800" value={row.owner} onChange={(e) => updateRow(row.id, 'owner', e.target.value)} readOnly={readOnly} placeholder="Owner" />
                    </td>
                    {!readOnly && (
                      <td className="px-2 py-1">
                        <button onClick={() => removeRow(row.id)} className="text-ink-300 hover:text-red-500"><Trash2 className="size-4" /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!readOnly && <Button variant="ghost" size="sm" onClick={addRow}><Plus className="size-4" /> Add risk</Button>}
        </div>
      )}

      {view === 'bar' && (
        <div className="rounded-xl border border-ink-100 bg-white p-4">
          {barData.length === 0 ? (
            <p className="py-16 text-center text-xs text-ink-300">Add a named risk to see the chart.</p>
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={barData} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" domain={[0, 25]} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                  {barData.map((d, i) => <Cell key={i} fill={scoreHex(d.score)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="mt-1 text-center text-[11px] text-ink-300">Chart view only — not saved with the activity.</p>
        </div>
      )}

      {view === 'matrix' && (
        <div className="rounded-xl border border-ink-100 bg-white p-4">
          {matrixData.length === 0 ? (
            <p className="py-16 text-center text-xs text-ink-300">Add a named risk to see the risk matrix.</p>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" dataKey="likelihood" name="Likelihood" domain={[0, 6]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11 }} label={{ value: 'Likelihood', position: 'insideBottom', offset: -5, fontSize: 11 }} />
                <YAxis type="number" dataKey="impact" name="Impact" domain={[0, 6]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11 }} label={{ value: 'Impact', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                <ZAxis type="number" dataKey="score" range={[80, 400]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  formatter={(val, name) => [val, name]}
                  labelFormatter={() => ''}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as { name: string; likelihood: number; impact: number; score: number }
                    return (
                      <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs shadow-md">
                        <p className="font-semibold text-ink-800">{d.name}</p>
                        <p className="text-ink-500">Likelihood {d.likelihood} · Impact {d.impact} · Score {d.score}</p>
                      </div>
                    )
                  }}
                />
                <Scatter data={matrixData}>
                  {matrixData.map((d, i) => <Cell key={i} fill={scoreHex(d.score)} fillOpacity={0.8} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}
          <p className="mt-1 text-center text-[11px] text-ink-300">Bubble size = score. Chart view only — not saved with the activity.</p>
        </div>
      )}
    </div>
  )
}

export default RiskRegisterEditor