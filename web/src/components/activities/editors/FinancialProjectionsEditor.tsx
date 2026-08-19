import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, Table2, BarChart3 } from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Button } from '../../ui'

// ── Financial Projections ───────────────────────────────────────────────────
//
// Previously this activity type had no dedicated editor and fell back to
// GenericEditor — a handful of plain textareas with no numbers, no
// computation, nothing that actually projected anything. That defeats the
// point of putting it in Advanced Research alongside things like the Risk
// Register and KPI tracker, which are genuinely structured tools.
//
// This is a real multi-period P&L: one row per period (year/quarter/etc.),
// four inputs (Revenue, COGS, OpEx, Other Income), with Gross Profit, Net
// Profit, and both margins computed live — plus plan-level summary metrics
// (total revenue, revenue CAGR, break-even period) and a chart view, the
// same table/chart split pattern RiskRegisterEditor and KpiEditor already
// use elsewhere in Advanced Research.

export interface FinancialPeriodRow {
  id: string
  /** Free text — "Year 1", "FY26", "Q3 2027", whatever cadence the plan uses. */
  label: string
  revenue: string
  cogs: string
  opex: string
  other_income: string
}

export interface FinancialProjectionsContent {
  periods: FinancialPeriodRow[]
  /** Growth drivers, pricing basis, cost assumptions — the "why" behind the numbers above. */
  assumptions: string
}

interface FinancialProjectionsEditorProps {
  value: Partial<FinancialProjectionsContent>
  onChange: (value: FinancialProjectionsContent) => void
  readOnly?: boolean
}

const EMPTY_CONTENT: FinancialProjectionsContent = { periods: [], assumptions: '' }

function emptyPeriod(label: string): FinancialPeriodRow {
  return { id: crypto.randomUUID(), label, revenue: '', cogs: '', opex: '', other_income: '' }
}

function num(v: string): number {
  return Number(v) || 0
}

interface Computed {
  revenue: number
  cogs: number
  grossProfit: number
  grossMargin: number | null
  opex: number
  otherIncome: number
  netProfit: number
  netMargin: number | null
}

// Standard P&L waterfall: Revenue − COGS = Gross Profit; Gross Profit − OpEx
// + Other Income = Net Profit. Margins are null (not 0) when revenue is 0 —
// "0% margin" and "no revenue to measure a margin against" are different
// things and shouldn't render the same.
function computeRow(r: FinancialPeriodRow): Computed {
  const revenue = num(r.revenue)
  const cogs = num(r.cogs)
  const opex = num(r.opex)
  const otherIncome = num(r.other_income)
  const grossProfit = revenue - cogs
  const netProfit = grossProfit - opex + otherIncome
  return {
    revenue, cogs, grossProfit,
    grossMargin: revenue !== 0 ? (grossProfit / revenue) * 100 : null,
    opex, otherIncome, netProfit,
    netMargin: revenue !== 0 ? (netProfit / revenue) * 100 : null,
  }
}

function formatCurrency(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function formatPct(n: number | null): string {
  return n === null ? '—' : `${n.toFixed(1)}%`
}

type ViewMode = 'table' | 'chart'

export const FinancialProjectionsEditor: React.FC<FinancialProjectionsEditorProps> = ({ value, onChange, readOnly }) => {
  const { t } = useTranslation()
  const [view, setView] = useState<ViewMode>('table')

  const content: FinancialProjectionsContent = { ...EMPTY_CONTENT, ...value, periods: value.periods ?? [] }
  const periods = content.periods

  const setPeriods = (rows: FinancialPeriodRow[]) => onChange({ ...content, periods: rows })
  const setAssumptions = (text: string) => onChange({ ...content, assumptions: text })

  const addPeriod = () => {
    const label = `${t('editors.financialProjections.yearPrefix', { defaultValue: 'Year' })} ${periods.length + 1}`
    setPeriods([...periods, emptyPeriod(label)])
  }

  const updatePeriod = (id: string, field: keyof FinancialPeriodRow, val: string) => {
    setPeriods(periods.map((r) => (r.id === id ? { ...r, [field]: val } : r)))
  }

  const removePeriod = (id: string) => setPeriods(periods.filter((r) => r.id !== id))

  const computedRows = useMemo(() => periods.map((row) => ({ row, c: computeRow(row) })), [periods])
  const namedRows = useMemo(() => computedRows.filter(({ row }) => row.label.trim() !== ''), [computedRows])

  // ── Summary metrics ───────────────────────────────────────────────────────

  const totalRevenue = namedRows.reduce((s, { c }) => s + c.revenue, 0)
  const totalNetProfit = namedRows.reduce((s, { c }) => s + c.netProfit, 0)
  const avgNetMargin = totalRevenue !== 0 ? (totalNetProfit / totalRevenue) * 100 : null

  // CAGR needs at least two named periods, taken in table order (first row =
  // earliest period), and both endpoints must be positive revenue — a CAGR
  // off a zero or negative base isn't meaningful.
  const cagr = useMemo(() => {
    if (namedRows.length < 2) return null
    const first = namedRows[0].c.revenue
    const last = namedRows[namedRows.length - 1].c.revenue
    if (first <= 0 || last <= 0) return null
    const n = namedRows.length - 1
    return (Math.pow(last / first, 1 / n) - 1) * 100
  }, [namedRows])

  // First period where *cumulative* net profit crosses zero — a simple,
  // table-order break-even signal. Not a discounted cash-flow model, just a
  // running total, which is the right level of sophistication for a plan's
  // Advanced Research tab rather than a full finance model.
  const breakEvenLabel = useMemo(() => {
    let cumulative = 0
    for (const { row, c } of namedRows) {
      cumulative += c.netProfit
      if (cumulative >= 0) return row.label
    }
    return null
  }, [namedRows])

  const revenueLabel = t('editors.financialProjections.seriesRevenue', { defaultValue: 'Revenue' })
  const netProfitLabel = t('editors.financialProjections.seriesNetProfit', { defaultValue: 'Net Profit' })
  const netMarginLabel = t('editors.financialProjections.seriesNetMargin', { defaultValue: 'Net Margin' })

  const chartData = useMemo(() => namedRows.map(({ row, c }) => ({
    name: row.label,
    [revenueLabel]: c.revenue,
    [netProfitLabel]: c.netProfit,
    margin: c.netMargin,
  })), [namedRows, revenueLabel, netProfitLabel])

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {namedRows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <SummaryCard
            label={t('editors.financialProjections.totalRevenue', { defaultValue: 'Total Revenue' })}
            value={formatCurrency(totalRevenue)}
          />
          <SummaryCard
            label={t('editors.financialProjections.totalNetProfit', { defaultValue: 'Total Net Profit' })}
            value={formatCurrency(totalNetProfit)}
            tone={totalNetProfit >= 0 ? 'positive' : 'negative'}
          />
          <SummaryCard
            label={t('editors.financialProjections.avgNetMargin', { defaultValue: 'Avg Net Margin' })}
            value={formatPct(avgNetMargin)}
            tone={avgNetMargin === null ? undefined : avgNetMargin >= 0 ? 'positive' : 'negative'}
          />
          <SummaryCard
            label={t('editors.financialProjections.revenueCagr', { defaultValue: 'Revenue CAGR' })}
            value={cagr === null ? '—' : formatPct(cagr)}
            tone={cagr === null ? undefined : cagr >= 0 ? 'positive' : 'negative'}
          />
          <SummaryCard
            label={t('editors.financialProjections.breakEven', { defaultValue: 'Break-even' })}
            value={breakEvenLabel ?? t('editors.financialProjections.notYet', { defaultValue: 'Not reached' })}
          />
        </div>
      )}

      <div className="flex items-center gap-1 rounded-lg border border-ink-200 bg-white p-1 w-fit">
        {(['table', 'chart'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setView(mode)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              view === mode ? 'bg-accent text-white' : 'text-ink-500 hover:bg-ink-50'
            }`}
          >
            {mode === 'table' ? <Table2 className="size-3.5" /> : <BarChart3 className="size-3.5" />}
            {mode === 'table' ? t('editorsCommon.table') : t('editorsCommon.chart', { defaultValue: 'Chart' })}
          </button>
        ))}
      </div>

      {view === 'table' ? (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-ink-100">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-xs font-semibold text-ink-500 uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left min-w-28">{t('editors.financialProjections.headers.period', { defaultValue: 'Period' })}</th>
                  <th className="px-3 py-2 text-left">{t('editors.financialProjections.headers.revenue', { defaultValue: 'Revenue' })}</th>
                  <th className="px-3 py-2 text-left">{t('editors.financialProjections.headers.cogs', { defaultValue: 'COGS' })}</th>
                  <th className="px-3 py-2 text-left">{t('editors.financialProjections.headers.grossProfit', { defaultValue: 'Gross Profit' })}</th>
                  <th className="px-3 py-2 text-left">{t('editors.financialProjections.headers.opex', { defaultValue: 'OpEx' })}</th>
                  <th className="px-3 py-2 text-left">{t('editors.financialProjections.headers.otherIncome', { defaultValue: 'Other Income' })}</th>
                  <th className="px-3 py-2 text-left">{t('editors.financialProjections.headers.netProfit', { defaultValue: 'Net Profit' })}</th>
                  <th className="px-3 py-2 text-left">{t('editors.financialProjections.headers.netMargin', { defaultValue: 'Net Margin' })}</th>
                  {!readOnly && <th />}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {computedRows.map(({ row, c }) => (
                  <tr key={row.id}>
                    <td className="px-2 py-1 min-w-28">
                      <input
                        className="w-full bg-transparent px-1 py-1 outline-none focus:bg-ink-50 rounded text-ink-800 font-medium"
                        value={row.label}
                        onChange={(e) => updatePeriod(row.id, 'label', e.target.value)}
                        readOnly={readOnly}
                        placeholder={t('editors.financialProjections.periodPlaceholder', { defaultValue: 'e.g. Year 1' })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" className="w-28 bg-transparent px-1 py-1 outline-none focus:bg-ink-50 rounded text-ink-800" value={row.revenue} onChange={(e) => updatePeriod(row.id, 'revenue', e.target.value)} readOnly={readOnly} placeholder="0" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" className="w-28 bg-transparent px-1 py-1 outline-none focus:bg-ink-50 rounded text-ink-800" value={row.cogs} onChange={(e) => updatePeriod(row.id, 'cogs', e.target.value)} readOnly={readOnly} placeholder="0" />
                    </td>
                    <td className="px-2 py-1 tabular-nums text-ink-500">
                      {formatCurrency(c.grossProfit)}
                      <span className="ml-1 text-[10px] text-ink-300">({formatPct(c.grossMargin)})</span>
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" className="w-28 bg-transparent px-1 py-1 outline-none focus:bg-ink-50 rounded text-ink-800" value={row.opex} onChange={(e) => updatePeriod(row.id, 'opex', e.target.value)} readOnly={readOnly} placeholder="0" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" className="w-28 bg-transparent px-1 py-1 outline-none focus:bg-ink-50 rounded text-ink-800" value={row.other_income} onChange={(e) => updatePeriod(row.id, 'other_income', e.target.value)} readOnly={readOnly} placeholder="0" />
                    </td>
                    <td className={`px-2 py-1 font-semibold tabular-nums ${c.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(c.netProfit)}
                    </td>
                    <td className="px-2 py-1 tabular-nums text-ink-500">
                      {formatPct(c.netMargin)}
                    </td>
                    {!readOnly && (
                      <td className="px-2 py-1">
                        <button onClick={() => removePeriod(row.id)} className="text-ink-300 hover:text-red-500">
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {periods.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-xs text-ink-300">
                      {t('editors.financialProjections.noPeriodsYet', { defaultValue: 'No periods yet — add a year or quarter to start projecting.' })}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {!readOnly && (
            <Button variant="ghost" size="sm" onClick={addPeriod}>
              <Plus className="size-4" /> {t('editors.financialProjections.addPeriod', { defaultValue: 'Add period' })}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-ink-100 bg-white p-4">
            {chartData.length === 0 ? (
              <p className="py-16 text-center text-xs text-ink-300">
                {t('editors.financialProjections.addPeriodsForChart', { defaultValue: 'Add named periods with revenue to see a chart.' })}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey={revenueLabel} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey={netProfitLabel} fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          {chartData.length > 0 && (
            <div className="rounded-xl border border-ink-100 bg-white p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                {t('editors.financialProjections.marginTrend', { defaultValue: 'Net Margin Trend' })}
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                  <Line type="monotone" dataKey="margin" name={netMarginLabel} stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="text-center text-[11px] text-ink-300">{t('editorsCommon.chartOnlyNotSaved')}</p>
        </div>
      )}

      {/* Assumptions */}
      <div className="rounded-xl border-2 border-ink-200 bg-ink-50 p-4">
        <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-500">
          {t('editors.financialProjections.assumptions', { defaultValue: 'Key Assumptions' })}
        </p>
        <textarea
          className="min-h-20 w-full resize-none bg-transparent text-sm text-ink-800 outline-none placeholder:text-ink-400"
          placeholder={t('editors.financialProjections.assumptionsPlaceholder', {
            defaultValue: 'Growth drivers, pricing assumptions, cost basis, market sizing — whatever underpins the numbers above.',
          })}
          value={content.assumptions}
          onChange={(e) => setAssumptions(e.target.value)}
          readOnly={readOnly}
        />
      </div>
    </div>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  const toneCls = tone === 'positive' ? 'text-green-600' : tone === 'negative' ? 'text-red-600' : 'text-ink-900'
  return (
    <div className="rounded-xl border border-ink-100 bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${toneCls}`}>{value}</p>
    </div>
  )
}

export default FinancialProjectionsEditor