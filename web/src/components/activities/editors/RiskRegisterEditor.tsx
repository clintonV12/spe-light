import React from 'react'
import { Plus, Trash2 } from 'lucide-react'
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

interface RiskRegisterEditorProps {
  value: RiskRow[]
  onChange: (rows: RiskRow[]) => void
  readOnly?: boolean
}

export const RiskRegisterEditor: React.FC<RiskRegisterEditorProps> = ({ value, onChange, readOnly }) => {
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

  return (
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
  )
}

export default RiskRegisterEditor
