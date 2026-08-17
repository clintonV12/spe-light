import React, { useEffect, useState } from 'react'
import {
  Compass, Users, Layers, Network, Gauge, Plus, Trash2, Pencil, Check, X,
  Target, ShieldCheck, CalendarClock, FlagTriangleRight, FlaskConical,
} from 'lucide-react'
import { Button, Input } from '../ui'
import {
  strategicFocusApi, coreValuesApi, stakeholdersApi, swotApi, pestelApi,
  orgStructureApi, meItemsApi,
} from '../../api/endpoints'
import { useToast } from '../../hooks'
import type {
  Plan, Activity, CoreValue, Stakeholder, StakeholderLevel, SWOTItem, SWOTCategory, PESTELItem,
  PESTELFactor, OrgStructureRole, MEItem, MECategory,
} from '../../types'
import LocalPlanBoard from './LocalPlanBoard'
import TrackingModule from './TrackingModule'
import AdvancedResearchPanel from './AdvancedResearchPanel'
import { useAiDraft, AiAssistTrigger, AiAssistPanel } from './AiChapterAssist'

interface LocalPlanChaptersProps {
  plan: Plan
  activities: Activity[]
  canEdit: boolean
  canDelete: boolean
  onChanged: () => void
  onPlanUpdated: (plan: Plan) => void
  /**
   * Which chapter tab to open on first render (e.g. so navigating back from
   * an activity editor can land the person back on the tab they came from
   * instead of always resetting to 'focus'). Falls back to 'focus' if
   * omitted or not a recognized chapter key.
   */
  initialChapter?: ChapterKey
}

export type ChapterKey = 'focus' | 'analysis' | 'pillars' | 'org' | 'me' | 'tracking' | 'advanced'

const CHAPTERS: { key: ChapterKey; label: string; icon: React.ElementType }[] = [
  { key: 'focus',    label: 'Vision, Mission & Values', icon: Compass },
  { key: 'analysis', label: 'Situational Analysis',     icon: Users   },
  { key: 'pillars',  label: 'Strategic Pillars',        icon: Layers  },
  { key: 'org',      label: 'Organisational Structure', icon: Network },
  { key: 'me',       label: 'Monitoring & Evaluation',  icon: Gauge   },
  { key: 'tracking', label: 'Tracking',                 icon: Target  },
  // Optional — deliberately last, and visually set apart in the tab bar
  // below, so it doesn't read as a required step in the chapter sequence.
  { key: 'advanced', label: 'Advanced Research',         icon: FlaskConical },
]

export const LocalPlanChapters: React.FC<LocalPlanChaptersProps> = ({
  plan, activities, canEdit, canDelete, onChanged, onPlanUpdated, initialChapter,
}) => {
  const isValidChapter = (key: ChapterKey | undefined): key is ChapterKey =>
    !!key && CHAPTERS.some((c) => c.key === key)

  const [active, setActive] = useState<ChapterKey>(isValidChapter(initialChapter) ? initialChapter : 'focus')

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-ink-200 mb-6">
        {CHAPTERS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActive(key)}
            className={`flex items-center gap-2 whitespace-nowrap px-3 py-2 sm:px-4 sm:py-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors ${
              active === key
                ? 'border-accent text-accent'
                : key === 'advanced'
                  ? 'border-transparent text-ink-400 hover:text-ink-600'
                  : 'border-transparent text-ink-500 hover:text-ink-700'
            }`}
          >
            <Icon className="size-4" />
            {label}
            {key === 'advanced' && (
              <span className="text-[10px] font-normal uppercase tracking-wide text-ink-300">
                Optional
              </span>
            )}
          </button>
        ))}
      </div>

      {active === 'focus'    && <StrategicFocusSection plan={plan} onPlanUpdated={onPlanUpdated} canEdit={canEdit} />}
      {active === 'analysis' && <SituationalAnalysisSection plan={plan} canEdit={canEdit} />}
      {active === 'pillars'  && (
        <LocalPlanBoard
          plan={plan}
          activities={activities}
          canEdit={canEdit}
          canDelete={canDelete}
          onChanged={onChanged}
        />
      )}
      {active === 'org' && <OrgStructureSection plan={plan} canEdit={canEdit} />}
      {active === 'me'  && <MESection plan={plan} canEdit={canEdit} />}
      {active === 'tracking' && <TrackingModule plan={plan} canEdit={canEdit} />}
      {active === 'advanced' && (
        <AdvancedResearchPanel
          plan={plan}
          activities={activities}
          canEdit={canEdit}
          canDelete={canDelete}
          onChanged={onChanged}
        />
      )}
    </div>
  )
}

// ── Chapter 2: Vision, Mission & Core Values ────────────────────────────────

const CORE_VALUE_COLORS = [
  'border-accent-200 bg-accent-50 text-accent',
  'border-p1 bg-p1-light text-p1-dark',
  'border-p2 bg-p2-light text-p2-dark',
  'border-p3 bg-p3-light text-p3-dark',
]

const StrategicFocusSection: React.FC<{ plan: Plan; onPlanUpdated: (plan: Plan) => void; canEdit: boolean }> = ({ plan, onPlanUpdated, canEdit }) => {
  const [vision, setVision] = useState(plan.vision ?? '')
  const [mission, setMission] = useState(plan.mission ?? '')
  const [savingFocus, setSavingFocus] = useState(false)
  const [values, setValues] = useState<CoreValue[]>([])
  const [newValueName, setNewValueName] = useState('')
  const { success, error } = useToast()
  const ai = useAiDraft(plan.id, 'vision_mission')

  useEffect(() => {
    coreValuesApi.list(plan.id).then(setValues).catch(() => error('Failed to load core values'))
  }, [plan.id])

  const saveFocus = async (v = vision, m = mission) => {
    setSavingFocus(true)
    try {
      const updated = await strategicFocusApi.update(plan.id, { vision: v, mission: m })
      onPlanUpdated(updated)
      success('Strategic focus saved')
    } catch {
      error('Failed to save vision & mission')
    } finally {
      setSavingFocus(false)
    }
  }

  const addValue = async (name = newValueName) => {
    if (!name.trim()) return
    try {
      const cv = await coreValuesApi.create(plan.id, { name: name.trim() })
      setValues((prev) => [...prev, cv])
      if (name === newValueName) setNewValueName('')
      return cv
    } catch {
      error('Failed to add core value')
      return null
    }
  }

  const removeValue = async (id: string) => {
    try {
      await coreValuesApi.delete(id)
      setValues((prev) => prev.filter((v) => v.id !== id))
    } catch {
      error('Failed to remove core value')
    }
  }

  const handleAiAccept = async (draft: Record<string, unknown>) => {
    const d = draft as { vision?: unknown; mission?: unknown; values?: unknown }
    const newVision = typeof d.vision === 'string' && d.vision.trim() ? d.vision.trim() : vision
    const newMission = typeof d.mission === 'string' && d.mission.trim() ? d.mission.trim() : mission
    if (newVision !== vision || newMission !== mission) {
      setVision(newVision)
      setMission(newMission)
      await saveFocus(newVision, newMission)
    }

    const rawValues = d.values
    const names = Array.isArray(rawValues)
      ? rawValues.filter((v): v is string => typeof v === 'string')
      : typeof rawValues === 'string'
        ? rawValues.split(/[,\n]/).map((v) => v.replace(/^[-•\s]+/, '').trim()).filter(Boolean)
        : []
    const existing = new Set(values.map((v) => v.name.toLowerCase()))
    for (const name of names) {
      const trimmed = name.trim()
      if (!trimmed || existing.has(trimmed.toLowerCase())) continue
      existing.add(trimmed.toLowerCase())
      await addValue(trimmed)
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div className="rounded-2xl border border-ink-100 bg-white p-5">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-accent-50 flex items-center justify-center shrink-0">
              <Compass className="size-4 text-accent" />
            </div>
            <h3 className="font-display text-base font-bold text-ink-900">Vision & mission</h3>
          </div>
          {canEdit && <AiAssistTrigger onClick={ai.start} />}
        </div>

        {ai.open && (
          <AiAssistPanel
            keywords={ai.keywords}
            onKeywordsChange={ai.setKeywords}
            onGenerate={ai.generate}
            loading={ai.loading}
            applying={ai.applying}
            draft={ai.draft}
            model={ai.model}
            onRegenerate={ai.generate}
            onClose={ai.close}
            onAccept={() => ai.accept(handleAiAccept)}
          />
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1.5">Vision</label>
            <textarea
              disabled={!canEdit}
              className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent resize-none min-h-20 disabled:bg-ink-50 disabled:text-ink-500"
              placeholder="What future is this organisation working toward?"
              value={vision}
              onChange={(e) => setVision(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1.5">Mission</label>
            <textarea
              disabled={!canEdit}
              className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent resize-none min-h-20 disabled:bg-ink-50 disabled:text-ink-500"
              placeholder="How does the organisation get there?"
              value={mission}
              onChange={(e) => setMission(e.target.value)}
            />
          </div>
          {canEdit && <Button loading={savingFocus} onClick={() => saveFocus()}>Save vision & mission</Button>}
        </div>
      </div>

      <div className="rounded-2xl border border-ink-100 bg-white p-5">
        <h3 className="font-display text-base font-bold text-ink-900 mb-3">Core values</h3>
        <div className="flex flex-wrap gap-2 mb-4">
          {values.map((v, i) => (
            <span
              key={v.id}
              className={`group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${CORE_VALUE_COLORS[i % CORE_VALUE_COLORS.length]}`}
            >
              {v.name}
              {canEdit && (
                <button onClick={() => removeValue(v.id)} className="opacity-50 hover:opacity-100 transition-opacity">
                  <span className="sr-only">Remove</span>
                  ×
                </button>
              )}
            </span>
          ))}
          {values.length === 0 && <p className="text-sm text-ink-400">No core values added yet. Use "Draft with AI" above or add one below.</p>}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Input
              placeholder="e.g. Integrity"
              value={newValueName}
              onChange={(e) => setNewValueName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addValue()}
            />
            <Button variant="secondary" onClick={() => addValue()}><Plus className="size-4" /></Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Chapter 3: Situational Analysis (Stakeholders / SWOT / PESTEL) ─────────

const STAKEHOLDER_LEVELS: StakeholderLevel[] = ['high', 'low']

function stakeholderQuadrant(influence: StakeholderLevel, interest: StakeholderLevel) {
  if (influence === 'high' && interest === 'high') return 'manage_closely' as const
  if (influence === 'high' && interest === 'low') return 'keep_satisfied' as const
  if (influence === 'low' && interest === 'high') return 'keep_informed' as const
  return 'monitor' as const
}

const STAKEHOLDER_QUADRANTS = [
  { key: 'manage_closely', label: 'Manage closely', hint: 'High influence · High interest', color: 'border-red-300 bg-red-50' },
  { key: 'keep_satisfied', label: 'Keep satisfied',  hint: 'High influence · Low interest',  color: 'border-p3 bg-p3-light' },
  { key: 'keep_informed',  label: 'Keep informed',   hint: 'Low influence · High interest',  color: 'border-p1 bg-p1-light' },
  { key: 'monitor',        label: 'Monitor',         hint: 'Low influence · Low interest',   color: 'border-ink-200 bg-ink-50' },
] as const

const SituationalAnalysisSection: React.FC<{ plan: Plan; canEdit: boolean }> = ({ plan, canEdit }) => {
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([])
  const [swot, setSwot] = useState<SWOTItem[]>([])
  const [pestel, setPestel] = useState<PESTELItem[]>([])
  const { error } = useToast()

  useEffect(() => {
    stakeholdersApi.list(plan.id).then(setStakeholders).catch(() => error('Failed to load stakeholders'))
    swotApi.list(plan.id).then(setSwot).catch(() => error('Failed to load SWOT items'))
    pestelApi.list(plan.id).then(setPestel).catch(() => error('Failed to load PESTEL items'))
  }, [plan.id])

  return (
    <div className="space-y-6">
      <StakeholderTable plan={plan} stakeholders={stakeholders} setStakeholders={setStakeholders} canEdit={canEdit} />
      <SWOTGrid plan={plan} swot={swot} setSwot={setSwot} canEdit={canEdit} />
      <PESTELTable plan={plan} pestel={pestel} setPestel={setPestel} canEdit={canEdit} />
    </div>
  )
}

const StakeholderTable: React.FC<{
  plan: Plan
  stakeholders: Stakeholder[]
  setStakeholders: React.Dispatch<React.SetStateAction<Stakeholder[]>>
  canEdit: boolean
}> = ({ plan, stakeholders, setStakeholders, canEdit }) => {
  const [name, setName] = useState('')
  const [influence, setInfluence] = useState<StakeholderLevel>('high')
  const [interest, setInterest] = useState<StakeholderLevel>('high')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editInfluence, setEditInfluence] = useState<StakeholderLevel>('high')
  const [editInterest, setEditInterest] = useState<StakeholderLevel>('high')
  const { error } = useToast()
  const ai = useAiDraft(plan.id, 'local_stakeholders')

  const startEditing = (item: Stakeholder) => {
    setEditingId(item.id)
    setEditName(item.name ?? '')
    setEditInfluence(item.influence)
    setEditInterest(item.interest)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditName('')
    setEditInfluence('high')
    setEditInterest('high')
  }

  const update = async (id: string) => {
    const trimmed = editName.trim()
    if (!trimmed) return
    try {
      const updated = await stakeholdersApi.update(id, {
        name: trimmed,
        influence: editInfluence,
        interest: editInterest,
      })
      setStakeholders((prev) => prev.map((s) => (s.id === id ? updated : s)))
      cancelEditing()
    } catch {
      error('Failed to update stakeholder')
    }
  }

  const add = async () => {
    if (!name.trim()) return
    try {
      const st = await stakeholdersApi.create(plan.id, { name: name.trim(), influence, interest })
      setStakeholders((prev) => [...prev, st])
      setName('')
    } catch {
      error('Failed to add stakeholder')
    }
  }

  const remove = async (id: string) => {
    try {
      await stakeholdersApi.delete(id)
      setStakeholders((prev) => prev.filter((s) => s.id !== id))
    } catch {
      error('Failed to remove stakeholder')
    }
  }

  const handleAiAccept = async (draft: Record<string, unknown>) => {
    const list = Array.isArray(draft.stakeholders) ? draft.stakeholders as unknown[] : []
    for (const raw of list) {
      if (typeof raw !== 'object' || raw === null) continue
      const row = raw as { name?: unknown; influence?: unknown; interest?: unknown }
      const rowName = typeof row.name === 'string' ? row.name.trim() : ''
      if (!rowName) continue
      const rowInfluence: StakeholderLevel = row.influence === 'low' ? 'low' : 'high'
      const rowInterest: StakeholderLevel = row.interest === 'low' ? 'low' : 'high'
      try {
        const st = await stakeholdersApi.create(plan.id, { name: rowName, influence: rowInfluence, interest: rowInterest })
        setStakeholders((prev) => [...prev, st])
      } catch {
        // best-effort — skip a stakeholder that fails to save rather than aborting the rest
      }
    }
  }

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className="font-display text-base font-bold text-ink-900">Stakeholder analysis</h3>
        {canEdit && <AiAssistTrigger onClick={ai.start} label="Suggest stakeholders" />}
      </div>

      {ai.open && (
        <AiAssistPanel
          keywords={ai.keywords}
          onKeywordsChange={ai.setKeywords}
          onGenerate={ai.generate}
          loading={ai.loading}
          applying={ai.applying}
          draft={ai.draft}
          model={ai.model}
          onRegenerate={ai.generate}
          onClose={ai.close}
          onAccept={() => ai.accept(handleAiAccept)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        {STAKEHOLDER_QUADRANTS.map(({ key, label, hint, color }) => {
          const items = stakeholders.filter((s) => stakeholderQuadrant(s.influence, s.interest) === key)
          return (
            <div key={key} className={`rounded-2xl border-2 p-4 ${color}`}>
              <p className="text-xs font-bold uppercase tracking-wide text-ink-600">{label}</p>
              <p className="text-[11px] text-ink-400 mb-2">{hint}</p>
              <div className="flex flex-wrap gap-1.5 min-h-8">
                {items.map((s) => (
                  <span key={s.id} className="group inline-flex items-center gap-1 rounded-full bg-white border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-800">
                    {s.name}
                    {canEdit && (
                      <>
                        <button
                          onClick={() => startEditing(s)}
                          className="opacity-0 group-hover:opacity-100 text-ink-400 hover:text-accent transition-opacity"
                          title="Edit stakeholder"
                        >
                          <Pencil className="size-3" />
                        </button>
                        <button
                          onClick={() => remove(s.id)}
                          className="opacity-0 group-hover:opacity-100 text-ink-400 hover:text-red-600 transition-opacity"
                          title="Delete stakeholder"
                        >
                          ×
                        </button>
                      </>
                    )}
                  </span>
                ))}
                {items.length === 0 && <p className="text-xs text-ink-400">None mapped.</p>}
              </div>
            </div>
          )
        })}
      </div>

      {canEdit && editingId && (
        <div className="mb-3 rounded-xl border border-accent-200 bg-accent-50/40 p-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Input placeholder="Stakeholder name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            <select
              className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900"
              value={editInfluence}
              onChange={(e) => setEditInfluence(e.target.value as StakeholderLevel)}
            >
              {STAKEHOLDER_LEVELS.map((l) => <option key={l} value={l}>{l} influence</option>)}
            </select>
            <select
              className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900"
              value={editInterest}
              onChange={(e) => setEditInterest(e.target.value as StakeholderLevel)}
            >
              {STAKEHOLDER_LEVELS.map((l) => <option key={l} value={l}>{l} interest</option>)}
            </select>
            <Button variant="secondary" onClick={() => update(editingId)}><Check className="size-4" /></Button>
            <Button variant="secondary" onClick={cancelEditing}><X className="size-4" /></Button>
          </div>
        </div>
      )}

      {canEdit && (
        <div className="flex flex-wrap gap-2 items-center">
          <Input placeholder="Stakeholder name" value={name} onChange={(e) => setName(e.target.value)} />
          <select
            className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900"
            value={influence}
            onChange={(e) => setInfluence(e.target.value as StakeholderLevel)}
          >
            {STAKEHOLDER_LEVELS.map((l) => <option key={l} value={l}>{l} influence</option>)}
          </select>
          <select
            className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900"
            value={interest}
            onChange={(e) => setInterest(e.target.value as StakeholderLevel)}
          >
            {STAKEHOLDER_LEVELS.map((l) => <option key={l} value={l}>{l} interest</option>)}
          </select>
          <Button variant="secondary" onClick={add}><Plus className="size-4" /></Button>
        </div>
      )}
    </div>
  )
}

const SWOT_CATEGORIES: SWOTCategory[] = ['strength', 'weakness', 'opportunity', 'threat']

// Same palette as SwotEditor.tsx (used for international plans) so both
// plan types render SWOT with an identical visual language.
const SWOT_META: Record<SWOTCategory, { label: string; color: string; draftKey: 'strengths' | 'weaknesses' | 'opportunities' | 'threats' }> = {
  strength:     { label: 'Strengths',     color: 'border-p2 bg-p2-light',     draftKey: 'strengths' },
  weakness:     { label: 'Weaknesses',    color: 'border-red-300 bg-red-50',  draftKey: 'weaknesses' },
  opportunity:  { label: 'Opportunities', color: 'border-p1 bg-p1-light',     draftKey: 'opportunities' },
  threat:       { label: 'Threats',       color: 'border-p3 bg-p3-light',     draftKey: 'threats' },
}

const SWOTGrid: React.FC<{
  plan: Plan
  swot: SWOTItem[]
  setSwot: React.Dispatch<React.SetStateAction<SWOTItem[]>>
  canEdit: boolean
}> = ({ plan, swot, setSwot, canEdit }) => {
  const [drafts, setDrafts] = useState<Record<SWOTCategory, string>>({
    strength: '', weakness: '', opportunity: '', threat: '',
  })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const { error } = useToast()
  const ai = useAiDraft(plan.id, 'swot')

  const startEditing = (item: SWOTItem) => {
    setEditingId(item.id)
    setEditText(item.text)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditText('')
  }

  const update = async (id: string) => {
    const text = editText.trim()
    if (!text) return
    try {
      const updated = await swotApi.update(id, { text })
      setSwot((prev) => prev.map((item) => (item.id === id ? updated : item)))
      cancelEditing()
    } catch {
      error('Failed to update SWOT item')
    }
  }

  const add = async (cat: SWOTCategory) => {
    const text = drafts[cat].trim()
    if (!text) return
    try {
      const item = await swotApi.create(plan.id, { category: cat, text })
      setSwot((prev) => [...prev, item])
      setDrafts((prev) => ({ ...prev, [cat]: '' }))
    } catch {
      error('Failed to add SWOT item')
    }
  }

  const remove = async (id: string) => {
    try {
      await swotApi.delete(id)
      setSwot((prev) => prev.filter((s) => s.id !== id))
    } catch {
      error('Failed to remove SWOT item')
    }
  }

  const handleAiAccept = async (draft: Record<string, unknown>) => {
    for (const cat of SWOT_CATEGORIES) {
      const raw = draft[SWOT_META[cat].draftKey]
      if (typeof raw !== 'string') continue
      const bullets = raw.split('\n').map((l) => l.replace(/^[-•\s]+/, '').trim()).filter(Boolean)
      for (const text of bullets) {
        try {
          const item = await swotApi.create(plan.id, { category: cat, text })
          setSwot((prev) => [...prev, item])
        } catch {
          // best-effort — skip a bullet that fails to save rather than aborting the rest
        }
      }
    }
  }

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className="font-display text-base font-bold text-ink-900">SWOT analysis</h3>
        {canEdit && <AiAssistTrigger onClick={ai.start} />}
      </div>

      {ai.open && (
        <AiAssistPanel
          keywords={ai.keywords}
          onKeywordsChange={ai.setKeywords}
          onGenerate={ai.generate}
          loading={ai.loading}
          applying={ai.applying}
          draft={ai.draft}
          model={ai.model}
          onRegenerate={ai.generate}
          onClose={ai.close}
          onAccept={() => ai.accept(handleAiAccept)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {SWOT_CATEGORIES.map((cat) => {
          const { label, color } = SWOT_META[cat]
          return (
            <div key={cat} className={`rounded-2xl border-2 p-4 ${color}`}>
              <h4 className="text-xs font-bold uppercase tracking-wide text-ink-600 mb-2">{label}</h4>
              <ul className="space-y-1 mb-2">
                {swot.filter((s) => s.category === cat).map((item) => (
                  <li key={item.id} className="group flex items-start justify-between gap-2 text-sm text-ink-800 bg-white/70 rounded-md px-2 py-1.5">
                    {editingId === item.id ? (
                      <div className="flex flex-1 items-center gap-1.5">
                        <Input
                          autoFocus
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') update(item.id)
                            if (e.key === 'Escape') cancelEditing()
                          }}
                        />
                        <button onClick={() => update(item.id)} className="text-accent hover:text-accent-600 p-1" title="Save"><Check className="size-4" /></button>
                        <button onClick={cancelEditing} className="text-ink-400 hover:text-ink-600 p-1" title="Cancel"><X className="size-4" /></button>
                      </div>
                    ) : (
                      <>
                        <span className="flex-1">{item.text}</span>
                        {canEdit && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => startEditing(item)} className="text-ink-400 hover:text-accent transition-colors" title="Edit item"><Pencil className="size-3.5" /></button>
                            <button onClick={() => remove(item.id)} className="text-ink-400 hover:text-red-600 transition-colors" title="Delete item"><Trash2 className="size-3.5" /></button>
                          </div>
                        )}
                      </>
                    )}
                  </li>
                ))}
                {swot.filter((s) => s.category === cat).length === 0 && (
                  <li className="text-sm text-ink-400">None recorded.</li>
                )}
              </ul>
              {canEdit && (
                <div className="flex gap-2">
                  <Input
                    placeholder={`Add a ${cat}...`}
                    value={drafts[cat]}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [cat]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && add(cat)}
                  />
                  <Button variant="secondary" onClick={() => add(cat)}><Plus className="size-4" /></Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const PESTEL_FACTORS: PESTELFactor[] = [
  'political', 'economic', 'social', 'technological', 'environmental', 'legal',
]

const PESTEL_COLOR: Record<PESTELFactor, string> = {
  political:      'border-blue-200 bg-blue-50',
  economic:       'border-green-200 bg-green-50',
  social:         'border-purple-200 bg-purple-50',
  technological:  'border-indigo-200 bg-indigo-50',
  environmental:  'border-teal-200 bg-teal-50',
  legal:          'border-amber-200 bg-amber-50',
}

const PESTELTable: React.FC<{
  plan: Plan
  pestel: PESTELItem[]
  setPestel: React.Dispatch<React.SetStateAction<PESTELItem[]>>
  canEdit: boolean
}> = ({ plan, pestel, setPestel, canEdit }) => {
  const [drafts, setDrafts] = useState<Record<PESTELFactor, { implication: string; positive: string; negative: string }>>(
    Object.fromEntries(PESTEL_FACTORS.map((f) => [f, { implication: '', positive: '', negative: '' }])) as Record<
      PESTELFactor, { implication: string; positive: string; negative: string }
    >,
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ implication: '', positive: '', negative: '' })
  const { error } = useToast()
  const ai = useAiDraft(plan.id, 'local_pestel')

  const startEditing = (item: PESTELItem) => {
    setEditingId(item.id)
    setEditForm({
      implication: item.implication ?? '',
      positive: item.positive ?? '',
      negative: item.negative ?? '',
    })
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditForm({ implication: '', positive: '', negative: '' })
  }

  const update = async (id: string) => {
    const implication = editForm.implication.trim()
    const positive = editForm.positive.trim()
    const negative = editForm.negative.trim()
    if (!implication && !positive && !negative) return
    try {
      const updated = await pestelApi.update(id, {
        implication: implication || undefined,
        positive: positive || undefined,
        negative: negative || undefined,
      })
      setPestel((prev) => prev.map((item) => (item.id === id ? updated : item)))
      cancelEditing()
    } catch {
      error('Failed to update PESTEL item')
    }
  }

  const add = async (factor: PESTELFactor) => {
    const d = drafts[factor]
    if (!d.implication.trim() && !d.positive.trim() && !d.negative.trim()) return
    try {
      const item = await pestelApi.create(plan.id, {
        factor,
        implication: d.implication.trim() || undefined,
        positive: d.positive.trim() || undefined,
        negative: d.negative.trim() || undefined,
      })
      setPestel((prev) => [...prev, item])
      setDrafts((prev) => ({ ...prev, [factor]: { implication: '', positive: '', negative: '' } }))
    } catch {
      error('Failed to add PESTEL item')
    }
  }

  const remove = async (id: string) => {
    try {
      await pestelApi.delete(id)
      setPestel((prev) => prev.filter((p) => p.id !== id))
    } catch {
      error('Failed to remove PESTEL item')
    }
  }

  const handleAiAccept = async (draft: Record<string, unknown>) => {
    // 1. Extract the items array regardless of how the payload wraps it
    let items: Array<Record<string, unknown>> = []

    if (Array.isArray(draft)) {
      items = draft
    } else if (Array.isArray(draft.items)) {
      items = draft.items as Array<Record<string, unknown>>
    } else if (draft.draft && typeof draft.draft === 'object' && Array.isArray((draft.draft as Record<string, unknown>).items)) {
      items = (draft.draft as Record<string, unknown>).items as Array<Record<string, unknown>>
    } else {
      // Fallback: If it's a flat object like { political: {...}, economic: {...} }
      items = Object.entries(draft).map(([factor, data]) => ({
        factor,
        ...(typeof data === 'object' && data !== null ? data : { implication: String(data) }),
      }))
    }

    if (items.length === 0) {
      throw new Error('No items found in AI response')
    }

    let created = 0

    // 2. Iterate through the array of items directly
    for (const rawItem of items) {
      const rawFactor = String(rawItem.factor || '').toLowerCase().trim() as PESTELFactor
      
      // Ensure it matches one of our valid PESTEL factors
      if (!PESTEL_FACTORS.includes(rawFactor)) continue

      // Helper to grab string values from multiple possible key names
      const pick = (...keys: string[]) => {
        for (const key of keys) {
          const v = rawItem[key]
          if (typeof v === 'string' && v.trim()) return v.trim()
        }
        return ''
      }

      const implication = pick('implication', 'implications', 'implication_angle')
      const positive = pick('positive', 'positive_angle', 'positiveangle')
      const negative = pick('negative', 'negative_angle', 'negativeangle')

      if (!implication && !positive && !negative) continue

      try {
        const newItem = await pestelApi.create(plan.id, {
          factor: rawFactor,
          implication: implication || undefined,
          positive: positive || undefined,
          negative: negative || undefined,
        })
        setPestel((prev) => [...prev, newItem])
        created++
      } catch (err) {
        console.error(`Failed to create PESTEL item for factor ${rawFactor}:`, err)
      }
    }

    if (created === 0) {
      throw new Error('Failed to save any PESTEL items from AI draft')
    }
  }

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className="font-display text-base font-bold text-ink-900">PESTEL analysis</h3>
        {canEdit && <AiAssistTrigger onClick={ai.start} />}
      </div>

      {ai.open && (
        <AiAssistPanel
          keywords={ai.keywords}
          onKeywordsChange={ai.setKeywords}
          onGenerate={ai.generate}
          loading={ai.loading}
          applying={ai.applying}
          draft={ai.draft}
          model={ai.model}
          onRegenerate={ai.generate}
          onClose={ai.close}
          onAccept={() => ai.accept(handleAiAccept)}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {PESTEL_FACTORS.map((factor) => (
          <div key={factor} className={`rounded-2xl border-2 p-4 ${PESTEL_COLOR[factor]}`}>
            <h4 className="text-xs font-bold uppercase tracking-wide text-ink-600 mb-2">{factor}</h4>
            <div className="space-y-1 mb-2">
              {pestel.filter((p) => p.factor === factor).map((item) => (
                <div key={item.id} className="group flex items-start justify-between gap-2 text-sm text-ink-900 bg-white/70 rounded-md px-2 py-1.5">
                  {editingId === item.id ? (
                    <div className="flex-1 space-y-1.5">
                      <Input placeholder="Implication" value={editForm.implication} onChange={(e) => setEditForm((prev) => ({ ...prev, implication: e.target.value }))} />
                      <Input placeholder="Positive angle" value={editForm.positive} onChange={(e) => setEditForm((prev) => ({ ...prev, positive: e.target.value }))} />
                      <div className="flex gap-2">
                        <Input
                          autoFocus
                          placeholder="Negative angle"
                          value={editForm.negative}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, negative: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') update(item.id)
                            if (e.key === 'Escape') cancelEditing()
                          }}
                        />
                        <button onClick={() => update(item.id)} className="text-accent hover:text-accent-600 p-1" title="Save"><Check className="size-4" /></button>
                        <button onClick={cancelEditing} className="text-ink-400 hover:text-ink-600 p-1" title="Cancel"><X className="size-4" /></button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1">
                        {item.implication && <>Implication: {item.implication}. </>}
                        {item.positive && <>Positive: {item.positive}. </>}
                        {item.negative && <>Negative: {item.negative}.</>}
                      </span>
                      {canEdit && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => startEditing(item)} className="text-ink-400 hover:text-accent transition-colors" title="Edit item"><Pencil className="size-3.5" /></button>
                          <button onClick={() => remove(item.id)} className="text-ink-400 hover:text-red-600 transition-colors" title="Delete item"><Trash2 className="size-3.5" /></button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
              {pestel.filter((p) => p.factor === factor).length === 0 && (
                <p className="text-sm text-ink-400">None recorded.</p>
              )}
            </div>
            {canEdit && (
              <div className="space-y-1.5">
                <Input
                  placeholder="Implication"
                  value={drafts[factor].implication}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [factor]: { ...prev[factor], implication: e.target.value } }))}
                />
                <Input
                  placeholder="Positive angle"
                  value={drafts[factor].positive}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [factor]: { ...prev[factor], positive: e.target.value } }))}
                />
                <div className="flex gap-2">
                  <Input
                    placeholder="Negative angle"
                    value={drafts[factor].negative}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [factor]: { ...prev[factor], negative: e.target.value } }))}
                  />
                  <Button variant="secondary" onClick={() => add(factor)}><Plus className="size-4" /></Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Chapter 6: Organisational Structure ─────────────────────────────────────

const OrgStructureSection: React.FC<{ plan: Plan; canEdit: boolean }> = ({ plan, canEdit }) => {
  const [roles, setRoles] = useState<OrgStructureRole[]>([])
  const [title, setTitle] = useState('')
  const [reportsToId, setReportsToId] = useState<string>('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editReportsToId, setEditReportsToId] = useState<string>('')
  const { error } = useToast()
  const ai = useAiDraft(plan.id, 'local_org_structure')

  const startEditing = (role: OrgStructureRole) => {
    setEditingId(role.id)
    setEditTitle(role.title ?? '')
    setEditReportsToId(role.reports_to_id ?? '')
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditTitle('')
    setEditReportsToId('')
  }

  const update = async (id: string) => {
    const trimmed = editTitle.trim()
    if (!trimmed) return

    try {
      const updated = await orgStructureApi.update(id, {
        title: trimmed,
        reports_to_id: editReportsToId || undefined,
      })
      setRoles((prev) => prev.map((role) => (role.id === id ? updated : role)))
      cancelEditing()
    } catch {
      error('Failed to update role')
    }
  }

  useEffect(() => {
    orgStructureApi.list(plan.id).then(setRoles).catch(() => error('Failed to load org structure'))
  }, [plan.id])

  const add = async () => {
    if (!title.trim()) return
    try {
      const role = await orgStructureApi.create(plan.id, {
        title: title.trim(),
        reports_to_id: reportsToId || undefined,
      })
      setRoles((prev) => [...prev, role])
      setTitle('')
      setReportsToId('')
    } catch {
      error('Failed to add role')
    }
  }

  const remove = async (id: string) => {
    try {
      await orgStructureApi.delete(id)
      setRoles((prev) => prev.filter((r) => r.id !== id))
    } catch {
      error('Failed to remove role')
    }
  }

  const handleAiAccept = async (draft: Record<string, unknown>) => {
    const list = Array.isArray(draft.roles) ? draft.roles as unknown[] : []
    const idByTitle = new Map<string, string>()
    for (const raw of list) {
      if (typeof raw !== 'object' || raw === null) continue
      const row = raw as { title?: unknown; reports_to?: unknown }
      const rowTitle = typeof row.title === 'string' ? row.title.trim() : ''
      if (!rowTitle) continue
      const parentTitle = typeof row.reports_to === 'string' ? row.reports_to.trim() : ''
      const reportsToRoleId = parentTitle ? idByTitle.get(parentTitle) : undefined
      try {
        const role = await orgStructureApi.create(plan.id, { title: rowTitle, reports_to_id: reportsToRoleId })
        setRoles((prev) => [...prev, role])
        idByTitle.set(rowTitle, role.id)
      } catch {
        // best-effort — skip a role that fails to save rather than aborting the rest
      }
    }
  }

  // Build a simple parent → children tree so the chart reads top-down
  // instead of as a flat, unordered list.
  const byParent = new Map<string, OrgStructureRole[]>()
  for (const r of roles) {
    const key = r.reports_to_id ?? ''
    byParent.set(key, [...(byParent.get(key) ?? []), r])
  }

  const renderNode = (role: OrgStructureRole, depth: number): React.ReactNode => (
    <div key={role.id}>
      {editingId === role.id && canEdit ? (
        <div
          className="rounded-lg border border-accent-200 bg-accent-50/40 px-3 py-2 mb-1.5"
          style={{ marginLeft: depth * 24 }}
        >
          <div className="flex flex-wrap gap-2 items-center">
            {depth > 0 && <span className="text-ink-300 text-sm">└</span>}
            <Input
              autoFocus
              className="flex-1 min-w-[180px]"
              placeholder="Role title"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') update(role.id)
                if (e.key === 'Escape') cancelEditing()
              }}
            />
            <select
              className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900"
              value={editReportsToId}
              onChange={(e) => setEditReportsToId(e.target.value)}
            >
              <option value="">Top of chart (no manager)</option>
              {roles
                .filter((r) => r.id !== role.id)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    Reports to: {r.title}
                  </option>
                ))}
            </select>
            <button
              onClick={() => update(role.id)}
              className="text-accent hover:text-accent-600 p-1"
              title="Save"
            >
              <Check className="size-4" />
            </button>
            <button
              onClick={cancelEditing}
              className="text-ink-400 hover:text-ink-600 p-1"
              title="Cancel"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      ) : (
        <div
          className="group flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 mb-1.5"
          style={{ marginLeft: depth * 24 }}
        >
          <div className="flex items-center gap-2">
            {depth > 0 && <span className="text-ink-300 text-sm">└</span>}
            <span className="text-sm text-ink-900 font-medium">{role.title}</span>
          </div>
          {canEdit && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => startEditing(role)}
                className="text-ink-400 hover:text-accent transition-colors"
                title="Edit role"
              >
                <Pencil className="size-4" />
              </button>
              <button
                onClick={() => remove(role.id)}
                className="text-ink-400 hover:text-red-600"
                title="Delete role"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          )}
        </div>
      )}
      {(byParent.get(role.id) ?? []).map((child) => renderNode(child, depth + 1))}
    </div>
  )

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className="font-display text-base font-bold text-ink-900">Organisational structure</h3>
        {canEdit && <AiAssistTrigger onClick={ai.start} />}
      </div>

      {ai.open && (
        <AiAssistPanel
          keywords={ai.keywords}
          onKeywordsChange={ai.setKeywords}
          onGenerate={ai.generate}
          loading={ai.loading}
          applying={ai.applying}
          draft={ai.draft}
          model={ai.model}
          onRegenerate={ai.generate}
          onClose={ai.close}
          onAccept={() => ai.accept(handleAiAccept)}
        />
      )}

      <div className="mb-3">
        {(byParent.get('') ?? []).map((role) => renderNode(role, 0))}
        {roles.length === 0 && <p className="text-sm text-ink-400">No roles added yet.</p>}
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Role title, e.g. Executive Manager" value={title} onChange={(e) => setTitle(e.target.value)} />
          <select
            className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900"
            value={reportsToId}
            onChange={(e) => setReportsToId(e.target.value)}
          >
            <option value="">Top of chart (no manager)</option>
            {roles.map((r) => <option key={r.id} value={r.id}>Reports to: {r.title}</option>)}
          </select>
          <Button variant="secondary" onClick={add}><Plus className="size-4" /></Button>
        </div>
      )}
    </div>
  )
}

// ── Chapter 7: Monitoring & Evaluation ──────────────────────────────────────

const ME_CATEGORIES: { key: MECategory; label: string; icon: React.ElementType; color: string }[] = [
  { key: 'objective',               label: 'M&E objectives',                  icon: Target,            color: 'border-l-accent' },
  { key: 'critical_success_factor', label: 'Critical success factors',        icon: ShieldCheck,       color: 'border-l-p2' },
  { key: 'review_note',             label: 'Review cadence',                  icon: CalendarClock,     color: 'border-l-p1' },
  { key: 'conclusion_measure',      label: 'Conclusion / rollout measures',   icon: FlagTriangleRight, color: 'border-l-p3' },
]

const MESection: React.FC<{ plan: Plan; canEdit: boolean }> = ({ plan, canEdit }) => {
  const [items, setItems] = useState<MEItem[]>([])
  const [drafts, setDrafts] = useState<Record<MECategory, string>>({
    objective: '', critical_success_factor: '', review_note: '', conclusion_measure: '',
  })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const { error } = useToast()
  const ai = useAiDraft(plan.id, 'local_me')

  const startEditing = (item: MEItem) => {
    setEditingId(item.id)
    setEditText(item.text ?? '')
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditText('')
  }

  const update = async (id: string) => {
    const text = editText.trim()
    if (!text) return

    try {
      const updated = await meItemsApi.update(id, { text })
      setItems((prev) => prev.map((item) => (item.id === id ? updated : item)))
      cancelEditing()
    } catch {
      error('Failed to update M&E item')
    }
  }

  useEffect(() => {
    meItemsApi.list(plan.id).then(setItems).catch(() => error('Failed to load M&E items'))
  }, [plan.id])

  const add = async (cat: MECategory) => {
    const text = drafts[cat].trim()
    if (!text) return
    try {
      const item = await meItemsApi.create(plan.id, { category: cat, text })
      setItems((prev) => [...prev, item])
      setDrafts((prev) => ({ ...prev, [cat]: '' }))
    } catch {
      error('Failed to add M&E item')
    }
  }

  const remove = async (id: string) => {
    try {
      await meItemsApi.delete(id)
      setItems((prev) => prev.filter((i) => i.id !== id))
    } catch {
      error('Failed to remove M&E item')
    }
  }

  const handleAiAccept = async (draft: Record<string, unknown>) => {
    const list = Array.isArray(draft.items) ? draft.items as unknown[] : []
    const validCategories = ME_CATEGORIES.map((c) => c.key)
    for (const raw of list) {
      if (typeof raw !== 'object' || raw === null) continue
      const row = raw as { category?: unknown; text?: unknown }
      const category = validCategories.find((c) => c === row.category)
      const text = typeof row.text === 'string' ? row.text.trim() : ''
      if (!category || !text) continue
      try {
        const item = await meItemsApi.create(plan.id, { category, text })
        setItems((prev) => [...prev, item])
      } catch {
        // best-effort — skip an item that fails to save rather than aborting the rest
      }
    }
  }

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className="font-display text-base font-bold text-ink-900">Monitoring & evaluation</h3>
        {canEdit && <AiAssistTrigger onClick={ai.start} />}
      </div>

      {ai.open && (
        <AiAssistPanel
          keywords={ai.keywords}
          onKeywordsChange={ai.setKeywords}
          onGenerate={ai.generate}
          loading={ai.loading}
          applying={ai.applying}
          draft={ai.draft}
          model={ai.model}
          onRegenerate={ai.generate}
          onClose={ai.close}
          onAccept={() => ai.accept(handleAiAccept)}
        />
      )}

      <div className="space-y-3">
        {ME_CATEGORIES.map(({ key, label, icon: Icon, color }) => (
          <div key={key} className={`rounded-xl border border-ink-100 border-l-4 ${color} bg-ink-50/40 p-4`}>
            <h4 className="flex items-center gap-2 text-sm font-semibold text-ink-700 mb-2">
              <Icon className="size-4 text-ink-400" /> {label}
            </h4>
            <ul className="space-y-1 mb-2">
              {items.filter((i) => i.category === key).map((item) => (
                <li key={item.id} className="group flex items-center justify-between gap-2 text-sm text-ink-900 bg-white rounded-md px-2 py-1.5">
                  {editingId === item.id ? (
                    <div className="flex flex-1 items-center gap-1.5">
                      <Input
                        autoFocus
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') update(item.id)
                          if (e.key === 'Escape') cancelEditing()
                        }}
                      />
                      <button
                        onClick={() => update(item.id)}
                        className="text-accent hover:text-accent-600 p-1"
                        title="Save"
                      >
                        <Check className="size-4" />
                      </button>
                      <button
                        onClick={cancelEditing}
                        className="text-ink-400 hover:text-ink-600 p-1"
                        title="Cancel"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1">{item.text}</span>
                      {canEdit && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => startEditing(item)}
                            className="text-ink-400 hover:text-accent transition-colors"
                            title="Edit item"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            onClick={() => remove(item.id)}
                            className="text-ink-400 hover:text-red-600 transition-colors"
                            title="Delete item"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
              {items.filter((i) => i.category === key).length === 0 && (
                <li className="text-sm text-ink-400">None recorded.</li>
              )}
            </ul>
            {canEdit && (
              <div className="flex gap-2">
                <Input
                  placeholder={`Add a ${label.toLowerCase()} note...`}
                  value={drafts[key]}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && add(key)}
                />
                <Button variant="secondary" onClick={() => add(key)}><Plus className="size-4" /></Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default LocalPlanChapters