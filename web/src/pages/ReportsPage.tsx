import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FileOutput, FileText, FileSpreadsheet, Clock, CheckCircle2, Loader, Plus, Download,
  SlidersHorizontal, Sparkles, Layers, TrendingUp, ListChecks, Check, History as HistoryIcon,
} from 'lucide-react'
import { plansApi, reportsApi } from '../api/endpoints'
import { useToast } from '../hooks'
import type { Plan, Report, ReportType, ReportFormat, ReportSectionConfig } from '../types'

const DEFAULT_CUSTOM_SECTIONS: ReportSectionConfig = {
  executive_summary:     true,
  vision_mission:        true,
  situational_analysis:  true,
  objective_activities:  true,
  advanced_research:     true,
  scorecard:             true,
  org_structure:         true,
  progress_status:       true,
  monitoring_evaluation: true,
  milestones:            true,
  dependency_links:      false,
  ai_summary:            false,
}

// True if the config would actually produce a non-empty report. Mirrors
// SectionConfig.hasContent() in report_service.go exactly.
function hasSelectedContent(s: ReportSectionConfig): boolean {
  return (
    s.executive_summary ||
    s.vision_mission ||
    s.situational_analysis ||
    s.objective_activities ||
    s.advanced_research ||
    s.scorecard ||
    s.org_structure ||
    s.progress_status ||
    s.monitoring_evaluation ||
    s.milestones ||
    s.dependency_links ||
    s.ai_summary
  )
}

// Number of top-level sections selected, for the "N sections" badge.
function countSections(s: ReportSectionConfig): number {
  return [
    s.executive_summary,
    s.vision_mission,
    s.situational_analysis,
    s.objective_activities,
    s.advanced_research,
    s.scorecard,
    s.org_structure,
    s.progress_status,
    s.monitoring_evaluation,
    s.milestones,
    s.dependency_links,
    s.ai_summary,
  ].filter(Boolean).length
}

// File-format names (PDF/Word/Excel) are conventionally left untranslated —
// they're product/format names, not descriptive UI copy.
const FORMAT_META: Record<ReportFormat, { label: string; icon: React.ReactNode; ext: string }> = {
  pdf:  { label: 'PDF',   icon: <FileText className="size-4" />,        ext: '.pdf' },
  docx: { label: 'Word',  icon: <FileOutput className="size-4" />,      ext: '.docx' },
  xlsx: { label: 'Excel', icon: <FileSpreadsheet className="size-4" />, ext: '.xlsx' },
}

// Purely decorative — a small icon per report type so the picker reads at
// a glance instead of as a wall of text. Doesn't affect which types exist
// or what they're called; that list (REPORT_TYPES, below) is unchanged.
const REPORT_TYPE_ICON: Record<ReportType, React.ReactNode> = {
  full_plan:         <FileText className="size-4" />,
  executive_summary: <Sparkles className="size-4" />,
  per_phase:         <Layers className="size-4" />,
  progress_status:   <TrendingUp className="size-4" />,
  activity_detail:   <ListChecks className="size-4" />,
  custom:            <SlidersHorizontal className="size-4" />,
}

interface Job {
  jobId: string
  planTitle: string
  type: ReportType
  format: ReportFormat
  startedAt: string
  status: 'processing' | 'complete' | 'failed'
  fileUrl?: string
  sections?: ReportSectionConfig
}

export default function ReportsPage() {
  const { t, i18n } = useTranslation()
  const { success, error: toastError } = useToast()

  // Only these two are offered now — Full Report (everything) and Custom
  // (pick exactly what you want) between them cover every case the other
  // four previously-separate types (Executive Summary, Per-Phase, Progress
  // Status, Activity Detail) existed for: each of those was really just a
  // fixed subset of sections, which Custom can already produce directly.
  // Old reports generated under one of the retired types still show up
  // fine in history below — REPORT_TYPE_ICON/FORMAT_META still cover every
  // ReportType value, only this picker list shrank.
  const REPORT_TYPES: { value: ReportType; label: string; desc: string }[] = [
    { value: 'full_plan', label: t('reportsPage.types.fullPlan.label'), desc: t('reportsPage.types.fullPlan.desc') },
    { value: 'custom',    label: t('reportsPage.types.custom.label'),   desc: t('reportsPage.types.custom.desc') },
  ]

  const [plans, setPlans] = useState<Plan[]>([])
  const [history, setHistory] = useState<Report[]>([])
  const [loadingPlans, setLoadingPlans] = useState(true)
  const [selectedPlan, setSelectedPlan] = useState('')
  const [selectedType, setSelectedType] = useState<ReportType>('full_plan')
  const [selectedFormat, setSelectedFormat] = useState<ReportFormat>('pdf')
  const [customSections, setCustomSections] = useState<ReportSectionConfig>(DEFAULT_CUSTOM_SECTIONS)
  const [generating, setGenerating] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
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
            success(t('reportsPage.toastReportReady', { title: job.planTitle }))
          }
        } catch { /* keep polling */ }
      }
    }, 1500)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [jobs]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerate = async () => {
    if (!selectedPlan) return
    if (selectedType === 'custom' && !hasSelectedContent(customSections)) {
      toastError(t('reportsPage.toastNoSectionsSelected'))
      return
    }
    setGenerating(true)
    const plan = plans.find((p) => p.id === selectedPlan)
    try {
      const { job_id } = await reportsApi.generate(selectedPlan, {
        type: selectedType,
        format: selectedFormat,
        ...(selectedType === 'custom' ? { sections: customSections } : {}),
      })
      setJobs((prev) => [{
        jobId: job_id,
        planTitle: plan?.title ?? selectedPlan,
        type: selectedType,
        format: selectedFormat,
        startedAt: new Date().toISOString(),
        status: 'processing',
        ...(selectedType === 'custom' ? { sections: customSections } : {}),
      }, ...prev])
    } catch {
      toastError(t('reportsPage.toastGenerateFailed'))
    } finally {
      setGenerating(false)
    }
  }

  const toggleSection = <K extends keyof ReportSectionConfig>(key: K, value: ReportSectionConfig[K]) => {
    setCustomSections((prev) => ({ ...prev, [key]: value }))
  }

  // Downloads go through apiClient (as a blob) rather than a plain <a href>,
  // since the download route sits behind the same auth middleware as every
  // other API call and a bare anchor tag has no way to attach the Bearer
  // token — clicking one would just 401.
  const handleDownload = async (jobId: string, fileUrl: string | undefined, filename: string) => {
    if (!fileUrl || fileUrl.startsWith('/mock')) {
      success(t('reportsPage.toastMockDownload'))
      return
    }
    setDownloadingId(jobId)
    try {
      const blob = await reportsApi.download(jobId)
      const objectUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(objectUrl)
    } catch {
      toastError(t('reportsPage.toastDownloadFailed'))
    } finally {
      setDownloadingId(null)
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
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="size-11 rounded-2xl bg-gradient-to-br from-accent to-accent-600 flex items-center justify-center text-white shrink-0 shadow-sm shadow-accent/25">
          <FileOutput className="size-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">{t('reportsPage.title')}</h1>
          <p className="text-ink-500 text-sm mt-0.5">{t('reportsPage.subtitle')}</p>
        </div>
      </div>

      {/* Generator card */}
      <div className="relative overflow-hidden bg-white rounded-2xl border border-ink-100 p-6 space-y-6">
        <span className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-accent to-accent-600" />
        <h2 className="font-display text-base font-bold text-ink-800 flex items-center gap-2">
          <Plus className="size-4 text-accent" /> {t('reportsPage.generateNew')}
        </h2>

        {/* Plan selector */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-ink-700">{t('reportsPage.plan')}</label>
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
          <label className="text-sm font-medium text-ink-700">{t('reportsPage.reportType')}</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {REPORT_TYPES.map((rt) => {
              const selected = selectedType === rt.value
              return (
                <button
                  key={rt.value}
                  onClick={() => setSelectedType(rt.value)}
                  className={`relative text-left rounded-xl border p-4 transition-all duration-150 ${
                    selected
                      ? 'border-accent bg-accent-50 shadow-[0_4px_16px_rgba(75,107,251,0.12)]'
                      : 'border-ink-100 hover:border-ink-200 hover:bg-ink-50 hover:-translate-y-0.5'
                  }`}
                >
                  {selected && (
                    <span className="absolute top-3 right-3 size-4 rounded-full bg-accent flex items-center justify-center">
                      <Check className="size-2.5 text-white" strokeWidth={3} />
                    </span>
                  )}
                  <div className={`size-8 rounded-lg flex items-center justify-center mb-2.5 ${selected ? 'bg-accent text-white' : 'bg-ink-100 text-ink-500'}`}>
                    {REPORT_TYPE_ICON[rt.value]}
                  </div>
                  <p className={`text-sm font-semibold ${selected ? 'text-accent' : 'text-ink-800'}`}>
                    {rt.label}
                  </p>
                  <p className="text-xs text-ink-400 mt-0.5 leading-relaxed">{rt.desc}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Custom section picker — only shown when the custom report type is selected */}
        {selectedType === 'custom' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-sm font-medium text-ink-700">
                <SlidersHorizontal className="size-3.5" /> {t('reportsPage.customSections')}
              </label>
              <span className="text-xs font-medium text-ink-400">
                {t('reportsPage.sectionsCount', { count: countSections(customSections) })}
              </span>
            </div>
            <div className="rounded-xl border border-ink-200 divide-y divide-ink-50 overflow-hidden">
              <label className="flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-accent-50/50 transition-colors">
                <input
                  type="checkbox"
                  checked={customSections.executive_summary}
                  onChange={(e) => toggleSection('executive_summary', e.target.checked)}
                  className="size-4 rounded border-ink-300 text-accent focus:ring-accent-400"
                />
                <span className="text-sm text-ink-800">{t('reportsPage.sections.executiveSummary')}</span>
              </label>

              <label className="flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-accent-50/50 transition-colors">
                <input
                  type="checkbox"
                  checked={customSections.vision_mission}
                  onChange={(e) => toggleSection('vision_mission', e.target.checked)}
                  className="size-4 rounded border-ink-300 text-accent focus:ring-accent-400"
                />
                <span className="text-sm text-ink-800">
                  {t('reportsPage.sections.visionMission', { defaultValue: 'Vision, Mission & Core Values' })}
                </span>
              </label>

              <label className="flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-accent-50/50 transition-colors">
                <input
                  type="checkbox"
                  checked={customSections.situational_analysis}
                  onChange={(e) => toggleSection('situational_analysis', e.target.checked)}
                  className="size-4 rounded border-ink-300 text-accent focus:ring-accent-400"
                />
                <span className="text-sm text-ink-800">
                  {t('reportsPage.sections.situationalAnalysis', { defaultValue: 'Situational Analysis (SWOT, PESTEL, Stakeholders)' })}
                </span>
              </label>

              <label className="flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-accent-50/50 transition-colors">
                <input
                  type="checkbox"
                  checked={customSections.scorecard}
                  onChange={(e) => toggleSection('scorecard', e.target.checked)}
                  className="size-4 rounded border-ink-300 text-accent focus:ring-accent-400"
                />
                <span className="text-sm text-ink-800">
                  {t('reportsPage.sections.scorecard', { defaultValue: 'Strategic Scorecard (KPIs + achievement chart)' })}
                </span>
              </label>

              <label className="flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-accent-50/50 transition-colors">
                <input
                  type="checkbox"
                  checked={customSections.objective_activities}
                  onChange={(e) => toggleSection('objective_activities', e.target.checked)}
                  className="size-4 rounded border-ink-300 text-accent focus:ring-accent-400"
                />
                <span className="text-sm text-ink-800">
                  {t('reportsPage.sections.objectiveActivities', { defaultValue: 'Pillar & Objective Activities' })}
                </span>
              </label>

              <label className="flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-accent-50/50 transition-colors">
                <input
                  type="checkbox"
                  checked={customSections.advanced_research}
                  onChange={(e) => toggleSection('advanced_research', e.target.checked)}
                  className="size-4 rounded border-ink-300 text-accent focus:ring-accent-400"
                />
                <span className="text-sm text-ink-800">
                  {t('reportsPage.sections.advancedResearch', { defaultValue: 'Advanced Research' })}
                </span>
              </label>

              <label className="flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-accent-50/50 transition-colors">
                <input
                  type="checkbox"
                  checked={customSections.org_structure}
                  onChange={(e) => toggleSection('org_structure', e.target.checked)}
                  className="size-4 rounded border-ink-300 text-accent focus:ring-accent-400"
                />
                <span className="text-sm text-ink-800">
                  {t('reportsPage.sections.orgStructure', { defaultValue: 'Organisational Structure' })}
                </span>
              </label>

              <label className="flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-accent-50/50 transition-colors">
                <input
                  type="checkbox"
                  checked={customSections.progress_status}
                  onChange={(e) => toggleSection('progress_status', e.target.checked)}
                  className="size-4 rounded border-ink-300 text-accent focus:ring-accent-400"
                />
                <span className="text-sm text-ink-800">{t('reportsPage.sections.progressStatus')}</span>
              </label>

              <label className="flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-accent-50/50 transition-colors">
                <input
                  type="checkbox"
                  checked={customSections.monitoring_evaluation}
                  onChange={(e) => toggleSection('monitoring_evaluation', e.target.checked)}
                  className="size-4 rounded border-ink-300 text-accent focus:ring-accent-400"
                />
                <span className="text-sm text-ink-800">
                  {t('reportsPage.sections.monitoringEvaluation', { defaultValue: 'Monitoring & Evaluation' })}
                </span>
              </label>

              <label className="flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-accent-50/50 transition-colors">
                <input
                  type="checkbox"
                  checked={customSections.milestones}
                  onChange={(e) => toggleSection('milestones', e.target.checked)}
                  className="size-4 rounded border-ink-300 text-accent focus:ring-accent-400"
                />
                <span className="text-sm text-ink-800">{t('reportsPage.sections.milestones')}</span>
              </label>

              <label className="flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-accent-50/50 transition-colors">
                <input
                  type="checkbox"
                  checked={customSections.dependency_links}
                  onChange={(e) => toggleSection('dependency_links', e.target.checked)}
                  className="size-4 rounded border-ink-300 text-accent focus:ring-accent-400"
                />
                <span className="text-sm text-ink-800">{t('reportsPage.sections.dependencyLinks')}</span>
              </label>

              <label className="flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-accent-50/50 transition-colors">
                <input
                  type="checkbox"
                  checked={customSections.ai_summary}
                  onChange={(e) => toggleSection('ai_summary', e.target.checked)}
                  className="size-4 rounded border-ink-300 text-accent focus:ring-accent-400"
                />
                <span className="text-sm text-ink-800">{t('reportsPage.sections.aiSummary')}</span>
              </label>
            </div>
            {!hasSelectedContent(customSections) && (
              <p className="flex items-center gap-1.5 text-xs text-red-500 font-medium">
                <span className="size-1.5 rounded-full bg-red-500 shrink-0" />
                {t('reportsPage.toastNoSectionsSelected')}
              </p>
            )}
          </div>
        )}

        {/* Format picker */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-700">{t('reportsPage.format')}</label>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(FORMAT_META) as [ReportFormat, typeof FORMAT_META[ReportFormat]][]).map(([fmt, meta]) => (
              <button
                key={fmt}
                onClick={() => setSelectedFormat(fmt)}
                className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all duration-150 ${
                  selectedFormat === fmt
                    ? 'border-accent bg-accent-50 text-accent shadow-[0_2px_10px_rgba(75,107,251,0.12)]'
                    : 'border-ink-200 text-ink-600 hover:bg-ink-50 hover:-translate-y-0.5'
                }`}
              >
                {meta.icon} {meta.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating || !selectedPlan || (selectedType === 'custom' && !hasSelectedContent(customSections))}
          className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-accent/20 hover:bg-accent-600 hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {generating
            ? <><span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> {t('reportsPage.queuing')}</>
            : <><Plus className="size-4" /> {t('reportsPage.generateReport')}</>}
        </button>
      </div>

      {/* Active jobs */}
      {jobs.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-display text-sm font-bold text-ink-800 flex items-center gap-2">
            <Loader className="size-3.5 text-accent" /> {t('reportsPage.inProgress')}
          </h2>
          {jobs.map((job) => {
            const fmtMeta = FORMAT_META[job.format]
            const rtLabel = REPORT_TYPES.find((r) => r.value === job.type)?.label ?? job.type
            return (
              <div key={job.jobId} className={`relative overflow-hidden flex items-center gap-4 bg-white rounded-2xl border p-4 transition-colors ${
                job.status === 'complete' ? 'border-p2/40' : 'border-ink-100'
              }`}>
                <span className={`absolute left-0 top-0 bottom-0 w-1 ${job.status === 'complete' ? 'bg-p2' : 'bg-ink-200'}`} />
                <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${
                  job.status === 'complete' ? 'bg-p2-light' : 'bg-ink-50'
                }`}>
                  {job.status === 'processing'
                    ? <Loader className="size-5 text-ink-400 animate-spin" />
                    : <CheckCircle2 className="size-5 text-p2-dark" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink-900 truncate">{job.planTitle}</p>
                  <p className="text-xs text-ink-400 flex items-center gap-1.5 mt-0.5">
                    <span className="inline-flex items-center gap-1">{REPORT_TYPE_ICON[job.type]} {rtLabel}</span>
                    <span className="text-ink-200">·</span>
                    <span className="inline-flex items-center gap-1">{fmtMeta.icon} {fmtMeta.label}</span>
                    {job.sections && <><span className="text-ink-200">·</span> {t('reportsPage.sectionsCount', { count: countSections(job.sections) })}</>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  {job.status === 'processing' ? (
                    <p className="text-xs text-ink-400 flex items-center gap-1">
                      <Clock className="size-3.5" /> {t('reportsPage.generating')}
                    </p>
                  ) : (
                    <button
                      onClick={() => handleDownload(job.jobId, job.fileUrl, `${rtLabel.replace(/\s+/g, '-').toLowerCase()}${fmtMeta.ext}`)}
                      disabled={downloadingId === job.jobId}
                      className="flex items-center gap-1.5 rounded-lg bg-p2-light px-3 py-1.5 text-xs font-semibold text-p2-dark hover:bg-p2/20 transition-colors disabled:opacity-50 disabled:cursor-wait"
                    >
                      {downloadingId === job.jobId
                        ? <span className="size-3.5 animate-spin rounded-full border-2 border-p2-dark border-t-transparent" />
                        : <Download className="size-3.5" />}
                      {' '}{t('reportsPage.download')}{fmtMeta.ext}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* History */}
      <div className="space-y-3">
        <h2 className="font-display text-sm font-bold text-ink-800 flex items-center gap-2">
          <HistoryIcon className="size-3.5 text-ink-400" />
          {t('reportsPage.previousReports')} {selectedPlan && plans.find((p) => p.id === selectedPlan)
            ? `— ${plans.find((p) => p.id === selectedPlan)?.title}`
            : ''}
        </h2>
        {history.length === 0 ? (
          <div className="text-center py-14 bg-white rounded-2xl border border-ink-100 border-dashed">
            <div className="size-12 rounded-2xl bg-ink-50 flex items-center justify-center mx-auto mb-3">
              <FileOutput className="size-6 text-ink-300" />
            </div>
            <p className="text-sm text-ink-500">{t('reportsPage.noReports')}</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
            <table className="w-full">
              <thead className="border-b border-ink-100 bg-ink-50/70">
                <tr>
                  {[t('reportsPage.colType'), t('reportsPage.colFormat'), t('reportsPage.colGenerated'), ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {history.map((r) => {
                  const fmtMeta = FORMAT_META[r.format]
                  const rtLabel = REPORT_TYPES.find((rt) => rt.value === r.type)?.label ?? r.type
                  return (
                    <tr key={r.id} className="hover:bg-accent-50/40 transition-colors">
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2">
                          <span className="size-7 rounded-lg bg-ink-50 flex items-center justify-center text-ink-400 shrink-0">
                            {REPORT_TYPE_ICON[r.type as ReportType] ?? <FileOutput className="size-3.5" />}
                          </span>
                          <p className="text-sm font-medium text-ink-800">{rtLabel}</p>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 text-sm text-ink-600">
                          {fmtMeta.icon} {fmtMeta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs text-ink-400">
                          {new Date(r.generated_at).toLocaleDateString(i18n.language, {
                            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDownload(r.id, r.file_url, `${rtLabel.replace(/\s+/g, '-').toLowerCase()}${fmtMeta.ext}`)}
                          disabled={downloadingId === r.id}
                          className="flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent-700 ml-auto disabled:opacity-50 disabled:cursor-wait"
                        >
                          {downloadingId === r.id
                            ? <span className="size-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                            : <Download className="size-3.5" />}
                          {' '}{t('reportsPage.download')}
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