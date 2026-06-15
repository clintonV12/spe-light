import { useEffect, useState, useRef } from 'react'
import { FileOutput, FileText, FileSpreadsheet, Clock, CheckCircle2, Loader, Plus, Download } from 'lucide-react'
import { plansApi, reportsApi } from '../api/endpoints'
import { useToast } from '../hooks'
import type { Plan, Report, ReportType, ReportFormat } from '../types'

const REPORT_TYPES: { value: ReportType; label: string; desc: string }[] = [
  { value: 'full_plan',        label: 'Full plan',         desc: 'All phases, all activities' },
  { value: 'executive_summary',label: 'Executive summary', desc: 'High-level narrative for leadership' },
  { value: 'per_phase',        label: 'Per-phase report',  desc: 'Detailed breakdown by P1/P2/P3' },
  { value: 'progress_status',  label: 'Progress status',   desc: 'KPIs, completion %, overdue items' },
  { value: 'activity_detail',  label: 'Activity detail',   desc: 'Every activity with full content' },
]

const FORMAT_META: Record<ReportFormat, { label: string; icon: React.ReactNode; ext: string }> = {
  pdf:  { label: 'PDF',   icon: <FileText className="size-4" />,        ext: '.pdf' },
  docx: { label: 'Word',  icon: <FileOutput className="size-4" />,      ext: '.docx' },
  xlsx: { label: 'Excel', icon: <FileSpreadsheet className="size-4" />, ext: '.xlsx' },
}

interface Job {
  jobId: string
  planTitle: string
  type: ReportType
  format: ReportFormat
  startedAt: string
  status: 'processing' | 'complete' | 'failed'
  fileUrl?: string
}

export default function ReportsPage() {
  const { success, error: toastError } = useToast()
  const [plans, setPlans] = useState<Plan[]>([])
  const [history, setHistory] = useState<Report[]>([])
  const [loadingPlans, setLoadingPlans] = useState(true)
  const [selectedPlan, setSelectedPlan] = useState('')
  const [selectedType, setSelectedType] = useState<ReportType>('executive_summary')
  const [selectedFormat, setSelectedFormat] = useState<ReportFormat>('pdf')
  const [generating, setGenerating] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    plansApi.list()
      .then((data) => {
        const active = data.filter((p) => p.status !== 'archived')
        setPlans(active)
        if (active.length > 0) {
          setSelectedPlan(active[0].id)
          return reportsApi.history(active[0].id)
        }
        return []
      })
      .then(setHistory)
      .catch(() => {})
      .finally(() => setLoadingPlans(false))
  }, [])

  // Poll active jobs
  useEffect(() => {
    const processingJobs = jobs.filter((j) => j.status === 'processing')
    if (processingJobs.length === 0) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    pollRef.current = setInterval(async () => {
      for (const job of processingJobs) {
        try {
          const result = await reportsApi.poll(job.jobId)
          if (result.status === 'complete') {
            setJobs((prev) => prev.map((j) =>
              j.jobId === job.jobId
                ? { ...j, status: 'complete', fileUrl: result.file_url }
                : j
            ))
            success(`Report ready — ${job.planTitle}`)
          }
        } catch { /* keep polling */ }
      }
    }, 1500)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [jobs])

  const handleGenerate = async () => {
    if (!selectedPlan) return
    setGenerating(true)
    const plan = plans.find((p) => p.id === selectedPlan)
    try {
      const { job_id } = await reportsApi.generate(selectedPlan, { type: selectedType, format: selectedFormat })
      setJobs((prev) => [{
        jobId: job_id,
        planTitle: plan?.title ?? selectedPlan,
        type: selectedType,
        format: selectedFormat,
        startedAt: new Date().toISOString(),
        status: 'processing',
      }, ...prev])
    } catch {
      toastError('Failed to start report generation.')
    } finally {
      setGenerating(false)
    }
  }

  const handlePlanChange = async (planId: string) => {
    setSelectedPlan(planId)
    try {
      const h = await reportsApi.history(planId)
      setHistory(h)
    } catch { setHistory([]) }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink-900">Reports</h1>
        <p className="text-ink-500 text-sm mt-0.5">Generate PDF, Word, or Excel reports from your plans.</p>
      </div>

      {/* Generator card */}
      <div className="bg-white rounded-2xl border border-ink-100 p-6 space-y-6">
        <h2 className="font-display text-base font-bold text-ink-800">Generate a new report</h2>

        {/* Plan selector */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-ink-700">Plan</label>
          {loadingPlans ? (
            <div className="h-10 bg-ink-50 rounded-xl animate-pulse" />
          ) : (
            <select
              value={selectedPlan}
              onChange={(e) => handlePlanChange(e.target.value)}
              className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          )}
        </div>

        {/* Report type */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-700">Report type</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {REPORT_TYPES.map((rt) => (
              <button
                key={rt.value}
                onClick={() => setSelectedType(rt.value)}
                className={`text-left rounded-xl border p-3 transition-colors ${
                  selectedType === rt.value
                    ? 'border-accent bg-accent-50'
                    : 'border-ink-100 hover:border-ink-200 hover:bg-ink-50'
                }`}
              >
                <p className={`text-sm font-semibold ${selectedType === rt.value ? 'text-accent' : 'text-ink-800'}`}>
                  {rt.label}
                </p>
                <p className="text-xs text-ink-400 mt-0.5">{rt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Format picker */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-700">Format</label>
          <div className="flex gap-2">
            {(Object.entries(FORMAT_META) as [ReportFormat, typeof FORMAT_META[ReportFormat]][]).map(([fmt, meta]) => (
              <button
                key={fmt}
                onClick={() => setSelectedFormat(fmt)}
                className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                  selectedFormat === fmt
                    ? 'border-accent bg-accent-50 text-accent'
                    : 'border-ink-200 text-ink-600 hover:bg-ink-50'
                }`}
              >
                {meta.icon} {meta.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating || !selectedPlan}
          className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating
            ? <><span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Queuing…</>
            : <><Plus className="size-4" /> Generate report</>}
        </button>
      </div>

      {/* Active jobs */}
      {jobs.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-display text-sm font-bold text-ink-800">In progress</h2>
          {jobs.map((job) => {
            const fmtMeta = FORMAT_META[job.format]
            const rtLabel = REPORT_TYPES.find((r) => r.value === job.type)?.label ?? job.type
            return (
              <div key={job.jobId} className={`flex items-center gap-4 bg-white rounded-2xl border p-4 ${
                job.status === 'complete' ? 'border-p2' : 'border-ink-100'
              }`}>
                <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${
                  job.status === 'complete' ? 'bg-p2-light' : 'bg-ink-50'
                }`}>
                  {job.status === 'processing'
                    ? <Loader className="size-5 text-ink-400 animate-spin" />
                    : <CheckCircle2 className="size-5 text-p2-dark" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink-900 truncate">{job.planTitle}</p>
                  <p className="text-xs text-ink-400">{rtLabel} · {fmtMeta.label}</p>
                </div>
                <div className="text-right shrink-0">
                  {job.status === 'processing' ? (
                    <p className="text-xs text-ink-400 flex items-center gap-1">
                      <Clock className="size-3.5" /> Generating…
                    </p>
                  ) : (
                    <a
                      href={job.fileUrl ?? '#'}
                      className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent-700"
                      onClick={(e) => { if (!job.fileUrl || job.fileUrl.startsWith('/mock')) { e.preventDefault(); success('(Mock) file download simulated') } }}
                    >
                      <Download className="size-3.5" /> Download{fmtMeta.ext}
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* History */}
      <div className="space-y-3">
        <h2 className="font-display text-sm font-bold text-ink-800">
          Previous reports {selectedPlan && plans.find((p) => p.id === selectedPlan)
            ? `— ${plans.find((p) => p.id === selectedPlan)?.title}`
            : ''}
        </h2>
        {history.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-2xl border border-ink-100">
            <FileOutput className="size-8 text-ink-200 mx-auto mb-2" />
            <p className="text-sm text-ink-500">No reports generated yet for this plan.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
            <table className="w-full">
              <thead className="border-b border-ink-100 bg-ink-50">
                <tr>
                  {['Type', 'Format', 'Generated', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {history.map((r) => {
                  const fmtMeta = FORMAT_META[r.format]
                  const rtLabel = REPORT_TYPES.find((rt) => rt.value === r.type)?.label ?? r.type
                  return (
                    <tr key={r.id} className="hover:bg-ink-50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-ink-800">{rtLabel}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 text-sm text-ink-600">
                          {fmtMeta.icon} {fmtMeta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-ink-400">
                          {new Date(r.generated_at).toLocaleDateString(undefined, {
                            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => success('(Mock) file download simulated')}
                          className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent-700 ml-auto"
                        >
                          <Download className="size-3.5" /> Download
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
