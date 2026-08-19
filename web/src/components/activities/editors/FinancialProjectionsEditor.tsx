import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X, Table2, BarChart3 } from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

// ── Financial Projections ───────────────────────────────────────────────────
//
// v1 of this editor still laid out periods as rows with a handful of flat
// columns (Period / Revenue / Costs / Profit) — the same shape a plain
// TableEditor config already gave you, just with a couple of extra derived
// columns. That's not what a financial projection actually looks like.
//
// Real P&L statements run line items DOWN the side and periods ACROSS the
// top: a Revenue section you can break into multiple streams, Cost of
// Sales and Operating Expenses as separate sections (not lumped into one
// "Costs" number), and computed subtotal rows — Gross Profit, Net Profit,
// margins, a running cash position — the same shape an investor deck or a
// finance team's spreadsheet uses. This rebuild is that shape.

export interface FPPeriod {
  id: string
  /** Free text — "Year 1", "FY26", "Q3 2027" — whatever cadence the plan uses. */
  label: string
}

export interface FPLineItem {
  id: string
  label: string
  /** periodId → raw numeric string. */
  values: Record<string, string>
}

export type FPSection = 'revenue' | 'cogs' | 'opex' | 'other_income'

export interface FinancialProjectionsContent {
  currency: string
  periods: FPPeriod[]
  lineItems: Record<FPSection, FPLineItem[]>
  /** Growth drivers, pricing basis, cost assumptions — the "why" behind the numbers above. */
  assumptions: string
}

interface FinancialProjectionsEditorProps {
  value: Partial<FinancialProjectionsContent>
  onChange: (value: FinancialProjectionsContent) => void
  readOnly?: boolean
}

const EMPTY_CONTENT: FinancialProjectionsContent = {
  currency: 'SZL',
  periods: [],
  lineItems: { revenue: [], cogs: [], opex: [], other_income: [] },
  assumptions: '',
}

const CURRENCIES: { code: string; symbol: string }[] = [
  { code: 'SZL', symbol: 'E' },
  { code: 'ZAR', symbol: 'R' },
  { code: 'USD', symbol: '$' },
  { code: 'EUR', symbol: '€' },
  { code: 'GBP', symbol: '£' },
  { code: 'KES', symbol: 'KSh' },
  { code: 'NGN', symbol: '₦' },
]

function symbolFor(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code
}

function num(v: string | undefined): number {
  return Number(v) || 0
}

// Accounting-style formatting: negatives in parentheses, not a leading
// minus — how every real financial statement shows a loss.
function fmtMoney(n: number, currency: string): string {
  const abs = Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
  return n < 0 ? `(${symbolFor(currency)}${abs})` : `${symbolFor(currency)}${abs}`
}

function fmtPct(n: number | null): string {
  if (n === null) return '—'
  const abs = Math.abs(n).toFixed(1)
  return n < 0 ? `(${abs}%)` : `${abs}%`
}

function sumSection(items: FPLineItem[], periodId: string): number {
  return items.reduce((s, item) => s + num(item.values[periodId]), 0)
}

interface PeriodStats {
  periodId: string
  revenue: number
  cogs: number
  grossProfit: number
  grossMargin: number | null
  opex: number
  otherIncome: number
  netProfit: number
  netMargin: number | null
  yoyGrowth: number | null
  cumulativeCash: number
}

type ViewMode = 'table' | 'chart'

export const FinancialProjectionsEditor: React.FC<FinancialProjectionsEditorProps> = ({ value, onChange, readOnly }) => {
  const { t } = useTranslation()
  const [view, setView] = useState<ViewMode>('table')

  const content: FinancialProjectionsContent = {
    ...EMPTY_CONTENT,
    ...value,
    periods: value.periods ?? [],
    lineItems: {
      revenue: value.lineItems?.revenue ?? [],
      cogs: value.lineItems?.cogs ?? [],
      opex: value.lineItems?.opex ?? [],
      other_income: value.lineItems?.other_income ?? [],
    },
  }
  const { periods, lineItems, currency } = content

  const setCurrency = (c: string) => onChange({ ...content, currency: c })
  const setAssumptions = (text: string) => onChange({ ...content, assumptions: text })

  const addPeriod = () => {
    const label = `${t('editors.financialProjections.yearPrefix', { defaultValue: 'Year' })} ${periods.length + 1}`
    onChange({ ...content, periods: [...periods, { id: crypto.randomUUID(), label }] })
  }
  const updatePeriodLabel = (id: string, label: string) => {
    onChange({ ...content, periods: periods.map((p) => (p.id === id ? { ...p, label } : p)) })
  }
  const removePeriod = (id: string) => {
    onChange({ ...content, periods: periods.filter((p) => p.id !== id) })
  }

  const addLineItem = (section: FPSection) => {
    const row: FPLineItem = { id: crypto.randomUUID(), label: '', values: {} }
    onChange({ ...content, lineItems: { ...lineItems, [section]: [...lineItems[section], row] } })
  }
  const updateLineItemLabel = (section: FPSection, id: string, label: string) => {
    onChange({
      ...content,
      lineItems: { ...lineItems, [section]: lineItems[section].map((r) => (r.id === id ? { ...r, label } : r)) },
    })
  }
  const updateCell = (section: FPSection, id: string, periodId: string, val: string) => {
    onChange({
      ...content,
      lineItems: {
        ...lineItems,
        [section]: lineItems[section].map((r) => (r.id === id ? { ...r, values: { ...r.values, [periodId]: val } } : r)),
      },
    })
  }
  const removeLineItem = (section: FPSection, id: string) => {
    onChange({ ...content, lineItems: { ...lineItems, [section]: lineItems[section].filter((r) => r.id !== id) } })
  }

  // ── Computed stats, one entry per period, in table order ──────────────────
  const periodStats: PeriodStats[] = useMemo(() => {
    let cumulativeCash = 0
    let prevRevenue: number | null = null
    return periods.map((p) => {
      const revenue = sumSection(lineItems.revenue, p.id)
      const cogs = sumSection(lineItems.cogs, p.id)
      const opex = sumSection(lineItems.opex, p.id)
      const otherIncome = sumSection(lineItems.other_income, p.id)
      const grossProfit = revenue - cogs
      const netProfit = grossProfit - opex + otherIncome
      cumulativeCash += netProfit
      const yoyGrowth = prevRevenue !== null && prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : null
      prevRevenue = revenue
      return {
        periodId: p.id, revenue, cogs, grossProfit,
        grossMargin: revenue !== 0 ? (grossProfit / revenue) * 100 : null,
        opex, otherIncome, netProfit,
        netMargin: revenue !== 0 ? (netProfit / revenue) * 100 : null,
        yoyGrowth, cumulativeCash,
      }
    })
  }, [periods, lineItems])

  const statsByPeriod = useMemo(() => new Map(periodStats.map((s) => [s.periodId, s])), [periodStats])

  // ── Summary metrics ───────────────────────────────────────────────────────
  const totalRevenue = periodStats.reduce((s, p) => s + p.revenue, 0)
  const totalNetProfit = periodStats.reduce((s, p) => s + p.netProfit, 0)
  const avgNetMargin = totalRevenue !== 0 ? (totalNetProfit / totalRevenue) * 100 : null

  const cagr = useMemo(() => {
    if (periodStats.length < 2) return null
    const first = periodStats[0].revenue
    const last = periodStats[periodStats.length - 1].revenue
    if (first <= 0 || last <= 0) return null
    return (Math.pow(last / first, 1 / (periodStats.length - 1)) - 1) * 100
  }, [periodStats])

  const breakEvenLabel = useMemo(() => {
    const hit = periodStats.find((s) => s.cumulativeCash >= 0)
    if (!hit) return null
    return periods.find((p) => p.id === hit.periodId)?.label ?? null
  }, [periodStats, periods])

  // ── Chart data ─────────────────────────────────────────────────────────────
  const revenueLabel = t('editors.financialProjections.seriesRevenue', { defaultValue: 'Revenue' })
  const netProfitLabel = t('editors.financialProjections.seriesNetProfit', { defaultValue: 'Net Profit' })
  const netMarginLabel = t('editors.financialProjections.seriesNetMargin', { defaultValue: 'Net Margin' })
  const cashLabel = t('editors.financialProjections.seriesCumulativeCash', { defaultValue: 'Cumulative Cash Position' })

  const chartData = useMemo(() => periods.map((p) => {
    const s = statsByPeriod.get(p.id)!
    return {
      name: p.label || t('editors.financialProjections.untitled', { defaultValue: 'Untitled' }),
      [revenueLabel]: s.revenue,
      [netProfitLabel]: s.netProfit,
      margin: s.netMargin,
      cash: s.cumulativeCash,
    }
  }), [periods, statsByPeriod, revenueLabel, netProfitLabel, t])

  const hasData = periods.length > 0

  // ── Row/section rendering helpers ───────────────────────────────────────────

  const colCount = periods.length + 2 // label col + trailing actions col

  const SectionTitle: React.FC<{ label: string; onAdd: () => void; addLabel: string }> = ({ label, onAdd, addLabel }) => (
    <tr className="bg-ink-50">
      <td className="sticky left-0 z-10 bg-ink-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-500">
        {label}
      </td>
      {periods.map((p) => <td key={p.id} />)}
      <td className="px-2 py-1.5">
        {!readOnly && (
          <button
            onClick={onAdd}
            className="flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-accent hover:text-accent-600"
          >
            <Plus className="size-3" /> {addLabel}
          </button>
        )}
      </td>
    </tr>
  )

  const LineItemRow: React.FC<{ section: FPSection; item: FPLineItem; placeholder: string }> = ({ section, item, placeholder }) => (
    <tr>
      <td className="sticky left-0 z-10 bg-white px-3 py-1 min-w-40">
        <input
          className="w-full bg-transparent px-1 py-1 text-sm text-ink-800 outline-none focus:bg-ink-50 rounded"
          value={item.label}
          onChange={(e) => updateLineItemLabel(section, item.id, e.target.value)}
          readOnly={readOnly}
          placeholder={placeholder}
        />
      </td>
      {periods.map((p) => (
        <td key={p.id} className="px-2 py-1">
          <input
            type="number"
            className="w-24 bg-transparent px-1 py-1 text-sm text-ink-800 outline-none focus:bg-ink-50 rounded"
            value={item.values[p.id] ?? ''}
            onChange={(e) => updateCell(section, item.id, p.id, e.target.value)}
            readOnly={readOnly}
            placeholder="0"
          />
        </td>
      ))}
      <td className="px-2 py-1">
        {!readOnly && (
          <button onClick={() => removeLineItem(section, item.id)} className="text-ink-300 hover:text-red-500">
            <X className="size-3.5" />
          </button>
        )}
      </td>
    </tr>
  )

  const ComputedRow: React.FC<{
    label: string
    getValue: (s: PeriodStats) => string
    tone?: 'default' | 'strong' | 'muted'
  }> = ({ label, getValue, tone = 'default' }) => {
    const rowCls = tone === 'strong' ? 'bg-accent-50 font-bold' : tone === 'muted' ? 'text-ink-400 text-xs' : 'font-semibold'
    return (
      <tr className={tone === 'strong' ? 'bg-accent-50' : undefined}>
        <td className={`sticky left-0 z-10 px-3 py-1.5 ${tone === 'strong' ? 'bg-accent-50' : 'bg-white'} ${rowCls}`}>
          {label}
        </td>
        {periods.map((p) => (
          <td key={p.id} className={`px-2 py-1.5 tabular-nums ${rowCls}`}>
            {getValue(statsByPeriod.get(p.id)!)}
          </td>
        ))}
        <td />
      </tr>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {hasData && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <SummaryCard label={t('editors.financialProjections.totalRevenue', { defaultValue: 'Total Revenue' })} value={fmtMoney(totalRevenue, currency)} />
          <SummaryCard label={t('editors.financialProjections.totalNetProfit', { defaultValue: 'Total Net Profit' })} value={fmtMoney(totalNetProfit, currency)} tone={totalNetProfit >= 0 ? 'positive' : 'negative'} />
          <SummaryCard label={t('editors.financialProjections.avgNetMargin', { defaultValue: 'Avg Net Margin' })} value={fmtPct(avgNetMargin)} tone={avgNetMargin === null ? undefined : avgNetMargin >= 0 ? 'positive' : 'negative'} />
          <SummaryCard label={t('editors.financialProjections.revenueCagr', { defaultValue: 'Revenue CAGR' })} value={cagr === null ? '—' : fmtPct(cagr)} tone={cagr === null ? undefined : cagr >= 0 ? 'positive' : 'negative'} />
          <SummaryCard label={t('editors.financialProjections.breakEven', { defaultValue: 'Break-even' })} value={breakEvenLabel ?? t('editors.financialProjections.notYet', { defaultValue: 'Not reached' })} />
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
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

        <label className="flex items-center gap-1.5 text-xs text-ink-500">
          {t('editors.financialProjections.currency', { defaultValue: 'Currency' })}
          <select
            className="rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs font-medium text-ink-700 outline-none"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            disabled={readOnly}
          >
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} ({c.symbol})</option>)}
          </select>
        </label>
      </div>

      {view === 'table' ? (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-ink-100">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-xs font-semibold text-ink-500 uppercase tracking-wide">
                <tr>
                  <th className="sticky left-0 z-20 bg-ink-50 px-3 py-2 text-left min-w-40">
                    {t('editors.financialProjections.headers.lineItem', { defaultValue: 'Line Item' })}
                  </th>
                  {periods.map((p) => (
                    <th key={p.id} className="px-2 py-2 text-left min-w-28">
                      <div className="flex items-center gap-1">
                        <input
                          className="w-full min-w-0 bg-transparent px-1 py-1 text-xs font-bold uppercase tracking-wide text-ink-700 outline-none focus:bg-white rounded"
                          value={p.label}
                          onChange={(e) => updatePeriodLabel(p.id, e.target.value)}
                          readOnly={readOnly}
                          placeholder={t('editors.financialProjections.periodPlaceholder', { defaultValue: 'e.g. Year 1' })}
                        />
                        {!readOnly && (
                          <button onClick={() => removePeriod(p.id)} className="shrink-0 text-ink-300 hover:text-red-500">
                            <X className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="px-2 py-2">
                    {!readOnly && (
                      <button
                        onClick={addPeriod}
                        className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-accent px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-600"
                      >
                        <Plus className="size-3" /> {t('editors.financialProjections.addPeriod', { defaultValue: 'Period' })}
                      </button>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {periods.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} className="px-3 py-8 text-center text-xs text-ink-300">
                      {t('editors.financialProjections.noPeriodsYet', { defaultValue: 'Add a period (year, quarter, etc.) to start building the model.' })}
                    </td>
                  </tr>
                ) : (
                  <>
                    {/* Revenue */}
                    <SectionTitle
                      label={t('editors.financialProjections.sections.revenue', { defaultValue: 'Revenue' })}
                      onAdd={() => addLineItem('revenue')}
                      addLabel={t('editors.financialProjections.addRevenueLine', { defaultValue: 'Add revenue stream' })}
                    />
                    {lineItems.revenue.map((item) => (
                      <LineItemRow key={item.id} section="revenue" item={item} placeholder={t('editors.financialProjections.revenuePlaceholder', { defaultValue: 'e.g. Product sales' })} />
                    ))}
                    <ComputedRow label={t('editors.financialProjections.totalRevenue', { defaultValue: 'Total Revenue' })} getValue={(s) => fmtMoney(s.revenue, currency)} tone="strong" />
                    <ComputedRow label={t('editors.financialProjections.yoyGrowth', { defaultValue: 'YoY Growth' })} getValue={(s) => fmtPct(s.yoyGrowth)} tone="muted" />

                    {/* Cost of sales */}
                    <SectionTitle
                      label={t('editors.financialProjections.sections.cogs', { defaultValue: 'Cost of Sales' })}
                      onAdd={() => addLineItem('cogs')}
                      addLabel={t('editors.financialProjections.addCogsLine', { defaultValue: 'Add cost line' })}
                    />
                    {lineItems.cogs.map((item) => (
                      <LineItemRow key={item.id} section="cogs" item={item} placeholder={t('editors.financialProjections.cogsPlaceholder', { defaultValue: 'e.g. Materials, direct labor' })} />
                    ))}
                    <ComputedRow label={t('editors.financialProjections.totalCogs', { defaultValue: 'Total Cost of Sales' })} getValue={(s) => fmtMoney(s.cogs, currency)} tone="strong" />

                    <ComputedRow label={t('editors.financialProjections.grossProfit', { defaultValue: 'Gross Profit' })} getValue={(s) => fmtMoney(s.grossProfit, currency)} tone="strong" />
                    <ComputedRow label={t('editors.financialProjections.grossMargin', { defaultValue: 'Gross Margin' })} getValue={(s) => fmtPct(s.grossMargin)} tone="muted" />

                    {/* Operating expenses */}
                    <SectionTitle
                      label={t('editors.financialProjections.sections.opex', { defaultValue: 'Operating Expenses' })}
                      onAdd={() => addLineItem('opex')}
                      addLabel={t('editors.financialProjections.addOpexLine', { defaultValue: 'Add expense line' })}
                    />
                    {lineItems.opex.map((item) => (
                      <LineItemRow key={item.id} section="opex" item={item} placeholder={t('editors.financialProjections.opexPlaceholder', { defaultValue: 'e.g. Salaries, marketing, rent' })} />
                    ))}
                    <ComputedRow label={t('editors.financialProjections.totalOpex', { defaultValue: 'Total Operating Expenses' })} getValue={(s) => fmtMoney(s.opex, currency)} tone="strong" />

                    {/* Other income */}
                    <SectionTitle
                      label={t('editors.financialProjections.sections.otherIncome', { defaultValue: 'Other Income' })}
                      onAdd={() => addLineItem('other_income')}
                      addLabel={t('editors.financialProjections.addOtherIncomeLine', { defaultValue: 'Add income line' })}
                    />
                    {lineItems.other_income.map((item) => (
                      <LineItemRow key={item.id} section="other_income" item={item} placeholder={t('editors.financialProjections.otherIncomePlaceholder', { defaultValue: 'e.g. Grants, interest income' })} />
                    ))}
                    <ComputedRow label={t('editors.financialProjections.totalOtherIncome', { defaultValue: 'Total Other Income' })} getValue={(s) => fmtMoney(s.otherIncome, currency)} tone="strong" />

                    {/* Bottom line */}
                    <ComputedRow label={t('editors.financialProjections.netProfit', { defaultValue: 'Net Profit' })} getValue={(s) => fmtMoney(s.netProfit, currency)} tone="strong" />
                    <ComputedRow label={t('editors.financialProjections.netMargin', { defaultValue: 'Net Margin' })} getValue={(s) => fmtPct(s.netMargin)} tone="muted" />
                    <ComputedRow label={t('editors.financialProjections.cumulativeCash', { defaultValue: 'Cumulative Cash Position' })} getValue={(s) => fmtMoney(s.cumulativeCash, currency)} />
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-ink-100 bg-white p-4">
            {chartData.length === 0 ? (
              <p className="py-16 text-center text-xs text-ink-300">
                {t('editors.financialProjections.addPeriodsForChart', { defaultValue: 'Add periods and revenue to see a chart.' })}
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
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
              <div className="rounded-xl border border-ink-100 bg-white p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  {t('editors.financialProjections.cashTrend', { defaultValue: 'Cumulative Cash Position' })}
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="cash" name={cashLabel} stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
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