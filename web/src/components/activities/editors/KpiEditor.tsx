import React from 'react'
import { Plus, Trash2 } from 'lucide-react'
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

export const KpiEditor: React.FC<KpiEditorProps> = ({ value, onChange, readOnly }) => {
  const addRow = () => {
    onChange([...value, { id: crypto.randomUUID(), name: '', unit: '', baseline: '', target: '', current: '' }])
  }

  const updateRow = (id: string, field: keyof KpiRow, val: string) => {
    onChange(value.map((r) => (r.id === id ? { ...r, [field]: val } : r)))
  }

  const removeRow = (id: string) => {
    onChange(value.filter((r) => r.id !== id))
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-ink-100">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-xs font-semibold text-ink-500 uppercase tracking-wide">
            <tr>
              {['KPI name', 'Unit', 'Baseline', 'Target', 'Current'].map((h) => (
                <th key={h} className="px-3 py-2 text-left">{h}</th>
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
          <Plus className="size-4" /> Add KPI
        </Button>
      )}
    </div>
  )
}

export default KpiEditor
