import { useState, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ZoomIn, ZoomOut, Maximize2, GitBranch, Sparkles,
  Clock, AlertTriangle, X, Loader2,
} from 'lucide-react'
import { aiApi, activitiesApi } from '../../api/endpoints'
import type { Activity, ActivityLink, ActivityStatus, AiLinkSuggestion, StrategicPillar, StrategicObjective } from '../../types'

// ─── Layout constants ─────────────────────────────────────────────────────

const COLUMN_WIDTH = 280
const COLUMN_GAP = 90
const NODE_WIDTH = 220
const NODE_HEIGHT = 64
const ROW_GAP = 28
const TOP_PADDING = 70
const SIDE_PADDING = 60

// Columns used to be a fixed P1/P2/P3 (Activity.phase). Since migration
// 014_collapse_plan_types removed phases, every activity now belongs either
// to a Strategic Objective (which belongs to exactly one Strategic Pillar)
// or, if it's a standalone Advanced Research activity, to none — so columns
// are built dynamically instead: one per pillar the plan actually has (in
// pillar display order), plus one more for Advanced Research if the plan
// has any. See buildColumns below.
const ADVANCED_RESEARCH_KEY = '__advanced_research__'
const UNCATEGORIZED_KEY = '__uncategorized__' // defensive fallback only — see buildColumns

interface ColumnMeta {
  key: string
  label: string
  sub: string
  accent: string
  bg: string
  border: string
  dot: string
}

// Cycled by column index rather than fixed per-pillar — a plan can have any
// number of pillars, unlike the old fixed 3-phase palette.
const PILLAR_PALETTE: { accent: string; bg: string; border: string }[] = [
  { accent: '#D97706', bg: '#FEF3C7', border: '#F59E0B' }, // amber
  { accent: '#059669', bg: '#D1FAE5', border: '#10B981' }, // emerald
  { accent: '#2563EB', bg: '#DBEAFE', border: '#3B82F6' }, // blue
  { accent: '#DB2777', bg: '#FCE7F3', border: '#EC4899' }, // pink
  { accent: '#7C3AED', bg: '#EDE9FE', border: '#8B5CF6' }, // violet
  { accent: '#CA8A04', bg: '#FEF9C3', border: '#EAB308' }, // yellow
]
const ADVANCED_RESEARCH_PALETTE = { accent: '#0D9488', bg: '#CCFBF1', border: '#14B8A6' } // teal — distinct from AI-suggestion purple
const UNCATEGORIZED_PALETTE = { accent: '#6B7280', bg: '#F3F4F6', border: '#9CA3AF' } // grey

const STATUS_META: Record<ActivityStatus, { label: string; color: string; fill: string }> = {
  not_started: { label: 'Not started',  color: '#94A3B8', fill: '#F1F5F9' },
  in_progress: { label: 'In progress',  color: '#2563EB', fill: '#DBEAFE' },
  review:      { label: 'Under review', color: '#D97706', fill: '#FEF3C7' },
  complete:    { label: 'Complete',     color: '#059669', fill: '#D1FAE5' },
}

// Keyed loosely by string rather than ActivityLink['link_type'] on purpose:
// that type dropped 'auto' when the rule-based auto-linker's candidates
// stopped being persisted as their own type, but rows created before that
// change may still carry link_type "auto" in the database. Falling back to
// DEFAULT_LINK_META for anything unrecognized (rather than typing this as
// an exact Record and letting an unknown key throw when indexed) means old
// data still renders instead of crashing the diagram.
const LINK_META: Record<string, { label: string; dash: string; color: string }> = {
  auto:         { label: 'Auto-linked (legacy)', dash: '0',   color: '#94A3B8' },
  manual:       { label: 'Manually drawn',       dash: '0',   color: '#4B6BFB' },
  ai_suggested: { label: 'AI suggested',         dash: '5,4', color: '#8B5CF6' },
}
const DEFAULT_LINK_META = { label: 'Linked', dash: '0', color: '#94A3B8' }
function linkMeta(type: string) {
  return LINK_META[type] ?? DEFAULT_LINK_META
}

// ─── Column construction ────────────────────────────────────────────────────

// Builds the ordered column list for a plan: one per pillar (in display
// order), then Advanced Research (only if the plan actually has any —
// unlike pillars, it's optional so an empty column would be noise), then
// Uncategorized (only if some activity's objective_id doesn't resolve to
// any pillar we know about — shouldn't happen in practice, but activities
// and pillars/objectives are fetched separately in ProgressPage.tsx, so a
// defensive fallback beats silently dropping a node from the diagram).
function buildColumns(
  pillars: StrategicPillar[],
  activities: Activity[],
  objectiveToPillar: Map<string, string>,
): ColumnMeta[] {
  const cols: ColumnMeta[] = pillars
    .slice()
    .sort((a, b) => a.user_order - b.user_order)
    .map((p, i) => {
      const palette = PILLAR_PALETTE[i % PILLAR_PALETTE.length]
      return { key: p.id, label: p.title, sub: 'Pillar', ...palette, dot: palette.border }
    })

  if (activities.some((a) => a.category === 'advanced_research')) {
    cols.push({
      key: ADVANCED_RESEARCH_KEY, label: 'Advanced Research', sub: 'Plan-level',
      ...ADVANCED_RESEARCH_PALETTE, dot: ADVANCED_RESEARCH_PALETTE.border,
    })
  }

  const knownKeys = new Set(cols.map((c) => c.key))
  const hasUncategorized = activities.some((a) => {
    const key = columnKeyFor(a, objectiveToPillar)
    return key === UNCATEGORIZED_KEY || !knownKeys.has(key)
  })
  if (hasUncategorized) {
    cols.push({
      key: UNCATEGORIZED_KEY, label: 'Uncategorized', sub: '',
      ...UNCATEGORIZED_PALETTE, dot: UNCATEGORIZED_PALETTE.border,
    })
  }

  return cols
}

function columnKeyFor(activity: Activity, objectiveToPillar: Map<string, string>): string {
  if (activity.category === 'advanced_research') return ADVANCED_RESEARCH_KEY
  if (activity.objective_id) {
    const pillarId = objectiveToPillar.get(activity.objective_id)
    if (pillarId) return pillarId
  }
  return UNCATEGORIZED_KEY
}

// ─── Layout computation ─────────────────────────────────────────────────────

interface LayoutNode {
  activity: Activity
  x: number
  y: number
  column: string // ColumnMeta.key
}

interface LayoutResult {
  nodes: LayoutNode[]
  width: number
  height: number
}

/**
 * Activities are grouped into one column per pillar (plus Advanced Research
 * / Uncategorized where applicable — see buildColumns). Within a column,
 * nodes are ordered to minimise edge crossings: nodes with more cross-column
 * out-degree float toward the top, via one pass of barycenter ordering based
 * on linked node positions.
 */
function computeLayout(
  activities: Activity[],
  links: ActivityLink[],
  columns: ColumnMeta[],
  objectiveToPillar: Map<string, string>,
): LayoutResult {
  const byColumn = new Map<string, Activity[]>(columns.map((c) => [c.key, []]))
  activities.forEach((a) => {
    const key = columnKeyFor(a, objectiveToPillar)
    byColumn.get(key)?.push(a)
  })

  // Initial order: by user_order (creation sequence) within each column
  columns.forEach((c) => byColumn.get(c.key)?.sort((a, b) => a.user_order - b.user_order))

  const positions = new Map<string, { x: number; y: number; column: string }>()

  columns.forEach((col, colIdx) => {
    const x = SIDE_PADDING + colIdx * (COLUMN_WIDTH + COLUMN_GAP)
    ;(byColumn.get(col.key) ?? []).forEach((act, rowIdx) => {
      const y = TOP_PADDING + rowIdx * (NODE_HEIGHT + ROW_GAP)
      positions.set(act.id, { x, y, column: col.key })
    })
  })

  // One barycenter pass: reorder each column by the average y of connected
  // nodes in adjacent columns, to reduce visual crossing of edges.
  const linksBySource = new Map<string, string[]>()
  const linksByTarget = new Map<string, string[]>()
  links.forEach((l) => {
    linksBySource.set(l.source_id, [...(linksBySource.get(l.source_id) ?? []), l.target_id])
    linksByTarget.set(l.target_id, [...(linksByTarget.get(l.target_id) ?? []), l.source_id])
  })

  columns.forEach((col, colIdx) => {
    const acts = byColumn.get(col.key) ?? []
    const scored = acts.map((act) => {
      const neighbours = [
        ...(linksBySource.get(act.id) ?? []),
        ...(linksByTarget.get(act.id) ?? []),
      ]
      const ys = neighbours
        .map((id) => positions.get(id)?.y)
        .filter((y): y is number => y !== undefined)
      const avgY = ys.length ? ys.reduce((s, y) => s + y, 0) / ys.length : Infinity
      return { act, avgY }
    })
    scored.sort((a, b) => a.avgY - b.avgY)
    const x = SIDE_PADDING + colIdx * (COLUMN_WIDTH + COLUMN_GAP)
    scored.forEach(({ act }, rowIdx) => {
      const y = TOP_PADDING + rowIdx * (NODE_HEIGHT + ROW_GAP)
      positions.set(act.id, { x, y, column: col.key })
    })
  })

  const nodes: LayoutNode[] = activities
    .map((activity) => {
      const pos = positions.get(activity.id)
      if (!pos) return null
      return { activity, x: pos.x, y: pos.y, column: pos.column }
    })
    .filter((n): n is LayoutNode => n !== null)

  const maxRows = Math.max(1, ...columns.map((c) => (byColumn.get(c.key) ?? []).length))
  const width = SIDE_PADDING * 2 + Math.max(1, columns.length) * COLUMN_WIDTH + Math.max(0, columns.length - 1) * COLUMN_GAP
  const height = TOP_PADDING + maxRows * (NODE_HEIGHT + ROW_GAP) + 40

  return { nodes, width, height }
}

function isOverdue(activity: Activity): boolean {
  if (!activity.due_date || activity.status === 'complete') return false
  return new Date(activity.due_date) < new Date()
}

function typeLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function initialFor(label: string): string {
  return label.trim().slice(0, 2).toUpperCase()
}

// ─── Edge path — smooth cubic bezier, curving toward the gap between columns ─

function edgePath(
  source: { x: number; y: number; column: string },
  target: { x: number; y: number; column: string },
): string {
  const sameColumn = source.column === target.column
  const sx = source.x + NODE_WIDTH
  const sy = source.y + NODE_HEIGHT / 2
  const tx = sameColumn ? target.x + NODE_WIDTH : target.x
  const ty = target.y + NODE_HEIGHT / 2

  if (sameColumn) {
    // Same-column link: loop out to the right and back
    const bulge = 36
    return `M ${sx} ${sy} C ${sx + bulge} ${sy}, ${sx + bulge} ${ty}, ${sx} ${ty}`
  }

  const dx = Math.max(60, (tx - sx) * 0.5)
  return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`
}

// ─── Component ────────────────────────────────────────────────────────────

interface ActivityDependencyNetworkProps {
  activities: Activity[]
  links: ActivityLink[]
  pillars: StrategicPillar[]
  objectives: StrategicObjective[]
  planId: string
  /**
   * Called after an AI-suggested link is accepted and successfully saved.
   * The component doesn't refetch its own activities/links — the parent
   * (ProgressPage.tsx) owns that data — so this is how a newly-accepted
   * link actually shows up in the diagram. Optional so this component still
   * works (suggestions just won't visually confirm) if a caller doesn't
   * wire it up.
   */
  onLinksChanged?: () => void
}

export default function ActivityDependencyNetwork({
  activities, links, pillars, objectives, planId, onLinksChanged,
}: ActivityDependencyNetworkProps) {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<'all' | string>('all')

  // ── AI link suggestions ──────────────────────────────────────────────────
  // `suggestions === null` means "panel not open / nothing requested yet";
  // an empty array is a real "asked, found nothing" result and still shows
  // the panel with that message rather than looking indistinguishable from
  // never having asked.
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState<AiLinkSuggestion[] | null>(null)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null)

  const suggestionKey = (s: AiLinkSuggestion) => `${s.source_id}-${s.target_id}`

  const handleSuggestLinks = useCallback(async () => {
    setSuggesting(true)
    setSuggestError(null)
    try {
      const res = await aiApi.suggestLinks({ plan_id: planId })
      setSuggestions(res.suggestions)
    } catch {
      setSuggestions([])
      setSuggestError('AI is unavailable right now — try again in a moment.')
    } finally {
      setSuggesting(false)
    }
  }, [planId])

  const handleDismissSuggestions = useCallback(() => {
    setSuggestions(null)
    setSuggestError(null)
  }, [])

  const handleRejectSuggestion = useCallback((s: AiLinkSuggestion) => {
    // Nothing was ever persisted for a suggestion, so "reject" is purely
    // local — just drop it from the review list.
    const key = suggestionKey(s)
    setSuggestions((cur) => cur?.filter((x) => suggestionKey(x) !== key) ?? null)
  }, [])

  const handleAcceptSuggestion = useCallback(async (s: AiLinkSuggestion) => {
    const key = suggestionKey(s)
    setAcceptingKey(key)
    setSuggestError(null)
    try {
      await activitiesApi.createLink(s.source_id, { target_id: s.target_id, link_type: 'ai_suggested' })
      setSuggestions((cur) => cur?.filter((x) => suggestionKey(x) !== key) ?? null)
      onLinksChanged?.()
    } catch {
      // Most likely cause is CreateActivityLink's cycle check rejecting it,
      // or the link already existing (e.g. added manually since the
      // suggestion was generated) — leave it in the list so the user can
      // see which one failed, rather than silently dropping it.
      setSuggestError(
        `Couldn't save the link between "${s.source_title}" and "${s.target_title}" — it may create a cycle, or already exist.`,
      )
    } finally {
      setAcceptingKey(null)
    }
  }, [onLinksChanged])

  const objectiveToPillar = useMemo(() => {
    const m = new Map<string, string>()
    objectives.forEach((o) => m.set(o.id, o.pillar_id))
    return m
  }, [objectives])

  const objectiveTitle = useMemo(() => {
    const m = new Map<string, string>()
    objectives.forEach((o) => m.set(o.id, o.title))
    return m
  }, [objectives])

  const columns = useMemo(
    () => buildColumns(pillars, activities, objectiveToPillar),
    [pillars, activities, objectiveToPillar],
  )
  const columnByKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns])

  const { nodes, width, height } = useMemo(
    () => computeLayout(activities, links, columns, objectiveToPillar),
    [activities, links, columns, objectiveToPillar],
  )

  const nodeById = useMemo(() => {
    const m = new Map<string, LayoutNode>()
    nodes.forEach((n) => m.set(n.activity.id, n))
    return m
  }, [nodes])

  const visibleLinks = useMemo(
    () => (filterType === 'all' ? links : links.filter((l) => l.link_type === filterType)),
    [links, filterType],
  )

  // Connected set for hover/select highlighting
  const connectedIds = useMemo(() => {
    const focusId = selectedId ?? hoveredId
    if (!focusId) return null
    const set = new Set<string>([focusId])
    visibleLinks.forEach((l) => {
      if (l.source_id === focusId) set.add(l.target_id)
      if (l.target_id === focusId) set.add(l.source_id)
    })
    return set
  }, [selectedId, hoveredId, visibleLinks])

  const connectedLinkIds = useMemo(() => {
    const focusId = selectedId ?? hoveredId
    if (!focusId) return null
    const set = new Set<string>()
    visibleLinks.forEach((l) => {
      if (l.source_id === focusId || l.target_id === focusId) {
        set.add(`${l.source_id}-${l.target_id}-${l.id}`)
      }
    })
    return set
  }, [selectedId, hoveredId, visibleLinks])

  // ── Pan & zoom handlers ──────────────────────────────────────────────────

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = -e.deltaY * 0.001
    setZoom((z) => Math.min(2, Math.max(0.4, z + delta)))
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as SVGElement).closest('[data-node]')) return
    setIsPanning(true)
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
    setSelectedId(null)
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return
    const dx = e.clientX - panStart.current.x
    const dy = e.clientY - panStart.current.y
    setPan({ x: panStart.current.panX + dx, y: panStart.current.panY + dy })
  }, [isPanning])

  const handleMouseUp = useCallback(() => setIsPanning(false), [])

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const zoomIn  = () => setZoom((z) => Math.min(2, z + 0.15))
  const zoomOut = () => setZoom((z) => Math.max(0.4, z - 0.15))

  const selectedNode = selectedId ? nodeById.get(selectedId) : null

  // Link-type counts for the legend/filter row. Keyed by plain string (not
  // ActivityLink['link_type']) since real data can still contain legacy
  // "auto" rows even though that's no longer a creatable type — see the
  // LINK_META comment above.
  const linkCounts = useMemo(() => {
    const c: Record<string, number> = {}
    links.forEach((l) => { c[l.link_type] = (c[l.link_type] ?? 0) + 1 })
    return c
  }, [links])

  // Filter pills: always offer 'manual' and 'ai_suggested' (the two types
  // that can actually be created going forward), plus 'auto' only if this
  // plan happens to still have legacy auto-linked rows — no point offering
  // a filter for a type that can never match anything.
  const filterTypes = useMemo(() => {
    const types = ['manual', 'ai_suggested']
    if (linkCounts.auto > 0) types.push('auto')
    return types
  }, [linkCounts])

  const crossColumnCount = useMemo(
    () => links.filter((l) => nodeById.get(l.source_id)?.column !== nodeById.get(l.target_id)?.column).length,
    [links, nodeById],
  )

  return (
    <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
      {/* Header / controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-ink-100">
        <div>
          <div className="flex items-center gap-2">
            <GitBranch className="size-4 text-accent" />
            <h2 className="font-display text-sm font-bold text-ink-800">Activity Dependency Network</h2>
          </div>
          <p className="text-xs text-ink-400 mt-0.5">
            {activities.length} activities · {links.length} links · {crossColumnCount} cross-pillar
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* AI link-suggestion trigger */}
          <button
            onClick={handleSuggestLinks}
            disabled={suggesting || activities.length < 2}
            className="flex items-center gap-1.5 rounded-lg bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-600 hover:bg-purple-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={activities.length < 2 ? 'Add at least two activities first' : undefined}
          >
            {suggesting
              ? <Loader2 className="size-3.5 animate-spin" />
              : <Sparkles className="size-3.5" />}
            {suggesting ? 'Thinking…' : 'Suggest AI links'}
          </button>

          {/* Link-type filter pills */}
          <div className="flex items-center gap-1 bg-ink-50 rounded-lg p-1">
            {(['all', ...filterTypes]).map((t) => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  filterType === t ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-400 hover:text-ink-600'
                }`}
              >
                {t === 'all' ? `All (${links.length})` : `${linkMeta(t).label} (${linkCounts[t] ?? 0})`}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 border-l border-ink-100 pl-2">
            <button onClick={zoomOut} className="p-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-50 transition-colors" aria-label="Zoom out">
              <ZoomOut className="size-4" />
            </button>
            <span className="text-xs text-ink-400 w-10 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={zoomIn} className="p-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-50 transition-colors" aria-label="Zoom in">
              <ZoomIn className="size-4" />
            </button>
            <button onClick={resetView} className="p-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-50 transition-colors" aria-label="Reset view">
              <Maximize2 className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative overflow-hidden bg-ink-50"
        style={{ height: 560, cursor: isPanning ? 'grabbing' : 'grab' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Column background bands — fixed, not part of the pan/zoom transform */}
        <div className="absolute top-0 left-0 right-0 h-full pointer-events-none z-0">
          <svg width="100%" height="100%" className="absolute inset-0">
            <g transform={`translate(${pan.x}, 0) scale(${zoom}, 1)`} style={{ transformOrigin: '0 0' }}>
              {columns.map((col, idx) => {
                const x = SIDE_PADDING + idx * (COLUMN_WIDTH + COLUMN_GAP)
                return (
                  <g key={col.key} transform={`translate(${x}, 0)`}>
                    <rect
                      x={-16} y={0} width={NODE_WIDTH + 32} height={2000}
                      fill={col.bg} opacity={0.35}
                    />
                  </g>
                )
              })}
            </g>
          </svg>
        </div>

        {/* Pannable / zoomable layer */}
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            transition: isPanning ? 'none' : 'transform 0.15s ease-out',
          }}
        >
          <svg width={width} height={height} className="block">
            {/* Column header labels inside SVG so they scroll with content vertically but stay at top */}
            {columns.map((col, idx) => {
              const x = SIDE_PADDING + idx * (COLUMN_WIDTH + COLUMN_GAP)
              const label = col.label.length > 22 ? col.label.slice(0, 20) + '…' : col.label
              return (
                <g key={`hdr-${col.key}`} transform={`translate(${x}, 16)`}>
                  <rect x={0} y={0} width={26} height={20} rx={6} fill={col.border} />
                  <text x={13} y={14} textAnchor="middle" fontSize={10} fontWeight={700} fill="white" fontFamily="Arial, sans-serif">
                    {initialFor(col.label)}
                  </text>
                  <text x={34} y={14} fontSize={12} fontWeight={600} fill={col.accent} fontFamily="Arial, sans-serif">
                    {label}
                  </text>
                </g>
              )
            })}

            {/* Edges */}
            <g>
              {visibleLinks.map((link) => {
                const source = nodeById.get(link.source_id)
                const target = nodeById.get(link.target_id)
                if (!source || !target) return null
                const linkKey = `${link.source_id}-${link.target_id}-${link.id}`
                const meta = linkMeta(link.link_type)
                const isHighlighted = connectedLinkIds?.has(linkKey)
                const isDimmed = connectedLinkIds !== null && !isHighlighted
                return (
                  <path
                    key={link.id}
                    d={edgePath(source, target)}
                    fill="none"
                    stroke={isHighlighted ? '#4B6BFB' : meta.color}
                    strokeWidth={isHighlighted ? 2.5 : 1.5}
                    strokeDasharray={meta.dash}
                    opacity={isDimmed ? 0.12 : isHighlighted ? 1 : 0.55}
                    markerEnd={isHighlighted ? 'url(#arrow-highlight)' : 'url(#arrow-default)'}
                    style={{ transition: 'opacity 0.15s, stroke 0.15s' }}
                  />
                )
              })}
            </g>

            {/* Arrow marker defs */}
            <defs>
              <marker id="arrow-default" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#94A3B8" opacity={0.7} />
              </marker>
              <marker id="arrow-highlight" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#4B6BFB" />
              </marker>
            </defs>

            {/* Nodes */}
            <g>
              {nodes.map((node) => {
                const { activity, x, y, column } = node
                const meta = columnByKey.get(column) ?? { border: UNCATEGORIZED_PALETTE.border } as ColumnMeta
                const statusMeta = STATUS_META[activity.status]
                const overdue = isOverdue(activity)
                const isFocused = connectedIds?.has(activity.id)
                const isDimmed = connectedIds !== null && !isFocused
                const isSelected = selectedId === activity.id

                return (
                  <g
                    key={activity.id}
                    data-node
                    transform={`translate(${x}, ${y})`}
                    style={{ cursor: 'pointer', opacity: isDimmed ? 0.25 : 1, transition: 'opacity 0.15s' }}
                    onMouseEnter={() => setHoveredId(activity.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedId((cur) => (cur === activity.id ? null : activity.id))
                    }}
                  >
                    <rect
                      width={NODE_WIDTH} height={NODE_HEIGHT} rx={12}
                      fill="white"
                      stroke={isSelected || isFocused ? meta.border : '#E5E7EB'}
                      strokeWidth={isSelected ? 2.5 : isFocused ? 2 : 1.5}
                      style={{ filter: isSelected ? 'drop-shadow(0 4px 10px rgba(0,0,0,0.12))' : 'drop-shadow(0 1px 2px rgba(0,0,0,0.04))' }}
                    />
                    {/* Column accent bar */}
                    <rect x={0} y={0} width={5} height={NODE_HEIGHT} rx={2.5} fill={meta.border} />

                    {/* Status dot */}
                    <circle cx={NODE_WIDTH - 16} cy={16} r={5} fill={statusMeta.color} />

                    {/* Overdue flag */}
                    {overdue && (
                      <g transform={`translate(${NODE_WIDTH - 34}, 9)`}>
                        <circle cx={7} cy={7} r={8} fill="#FEE2E2" />
                        <text x={7} y={11} textAnchor="middle" fontSize={10} fill="#DC2626" fontWeight={700} fontFamily="Arial">!</text>
                      </g>
                    )}

                    {/* Title */}
                    <text x={16} y={26} fontSize={12.5} fontWeight={600} fill="#0F1117" fontFamily="Arial, sans-serif">
                      {activity.title.length > 26 ? activity.title.slice(0, 24) + '…' : activity.title}
                    </text>
                    {/* Type */}
                    <text x={16} y={42} fontSize={10.5} fill="#6B758F" fontFamily="Arial, sans-serif">
                      {typeLabel(activity.type).length > 30 ? typeLabel(activity.type).slice(0, 28) + '…' : typeLabel(activity.type)}
                    </text>
                    {/* Status label */}
                    <text x={16} y={56} fontSize={9.5} fontWeight={600} fill={statusMeta.color} fontFamily="Arial, sans-serif">
                      {statusMeta.label}
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
        </div>

        {/* Empty state */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-ink-400">No activities yet — add activities under any objective, or to Advanced Research, to see the network.</p>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 px-5 py-3 border-t border-ink-100 bg-ink-50/50">
        <span className="text-xs font-semibold text-ink-500">Link type:</span>
        {filterTypes.map((t) => (
          <span key={t} className="flex items-center gap-1.5 text-xs text-ink-500">
            <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke={linkMeta(t).color} strokeWidth="2" strokeDasharray={linkMeta(t).dash} /></svg>
            {linkMeta(t).label}
          </span>
        ))}
        <span className="text-xs text-ink-300 ml-auto">Scroll to zoom · drag to pan · click a card for detail</span>
      </div>

      {/* AI link-suggestion review panel */}
      {suggestions !== null && (
        <div className="border-t border-ink-100 bg-purple-50/40 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-purple-500" />
              <h3 className="text-sm font-semibold text-ink-800">
                AI suggested links{suggestions.length > 0 && ` (${suggestions.length})`}
              </h3>
            </div>
            <button
              onClick={handleDismissSuggestions}
              className="text-ink-300 hover:text-ink-600 transition-colors"
              aria-label="Dismiss suggestions"
            >
              <X className="size-4" />
            </button>
          </div>

          {suggestError && (
            <p className="text-xs text-red-500 mb-3">{suggestError}</p>
          )}

          {suggestions.length === 0 ? (
            <p className="text-xs text-ink-400">
              No new links found — the existing links may already cover everything the model was confident about.
            </p>
          ) : (
            <div className="space-y-2">
              {suggestions.map((s) => {
                const key = suggestionKey(s)
                const isAccepting = acceptingKey === key
                return (
                  <div
                    key={key}
                    className="flex items-center gap-3 rounded-xl border border-purple-200 bg-white px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-ink-800 truncate">
                        {s.source_title} <span className="text-ink-300">→</span> {s.target_title}
                      </p>
                      <p className="text-[11px] text-ink-400 mt-0.5">{s.reason}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleAcceptSuggestion(s)}
                        disabled={isAccepting}
                        className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-accent-700 transition-colors disabled:opacity-50"
                      >
                        {isAccepting ? '…' : 'Accept'}
                      </button>
                      <button
                        onClick={() => handleRejectSuggestion(s)}
                        disabled={isAccepting}
                        className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-ink-400 hover:bg-ink-100 transition-colors disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Detail panel — slides in when a node is selected */}
      {selectedNode && (
        <div className="border-t border-ink-100 bg-white">
          <NodeDetailPanel
            node={selectedNode}
            allLinks={links}
            nodeById={nodeById}
            columnByKey={columnByKey}
            objectiveTitle={objectiveTitle}
            onClose={() => setSelectedId(null)}
            onOpen={() => navigate(`/plans/${planId}/activities/${selectedNode.activity.id}`)}
            onFocusNode={(id) => setSelectedId(id)}
          />
        </div>
      )}
    </div>
  )
}

// ─── Detail panel for selected node ────────────────────────────────────────

function NodeDetailPanel({
  node, allLinks, nodeById, columnByKey, objectiveTitle, onClose, onOpen, onFocusNode,
}: {
  node: LayoutNode
  allLinks: ActivityLink[]
  nodeById: Map<string, LayoutNode>
  columnByKey: Map<string, ColumnMeta>
  objectiveTitle: Map<string, string>
  onClose: () => void
  onOpen: () => void
  onFocusNode: (id: string) => void
}) {
  const { activity } = node
  const meta = columnByKey.get(node.column) ?? { label: 'Uncategorized', border: UNCATEGORIZED_PALETTE.border } as ColumnMeta
  const statusMeta = STATUS_META[activity.status]
  const overdue = isOverdue(activity)
  // For a pillar column, show "Pillar Title · Objective Title" if we can
  // resolve the objective; Advanced Research/Uncategorized have no
  // objective, so just the column label.
  const subtitle = activity.objective_id && objectiveTitle.has(activity.objective_id)
    ? `${meta.label} · ${objectiveTitle.get(activity.objective_id)}`
    : meta.label

  const upstream = allLinks.filter((l) => l.target_id === activity.id)
  const downstream = allLinks.filter((l) => l.source_id === activity.id)

  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center justify-center w-9 h-9 rounded-xl text-xs font-bold text-white shrink-0"
            style={{ backgroundColor: meta.border }}
          >
            {initialFor(meta.label)}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-ink-900">{activity.title}</h3>
            <p className="text-xs text-ink-400">{typeLabel(activity.type)} · {subtitle}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-ink-300 hover:text-ink-600 transition-colors">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex items-center gap-4 mb-5">
        <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: statusMeta.color }}>
          <span className="size-2 rounded-full" style={{ backgroundColor: statusMeta.color }} />
          {statusMeta.label}
        </span>
        {activity.due_date && (
          <span className={`flex items-center gap-1.5 text-xs ${overdue ? 'text-red-500 font-medium' : 'text-ink-400'}`}>
            {overdue ? <AlertTriangle className="size-3.5" /> : <Clock className="size-3.5" />}
            {overdue ? 'Overdue · ' : 'Due '}
            {new Date(activity.due_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        )}
        <button
          onClick={onOpen}
          className="ml-auto text-xs font-semibold text-accent hover:text-accent-700 transition-colors"
        >
          Open activity →
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Upstream */}
        <div>
          <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-2">
            Feeds into this ({upstream.length})
          </p>
          {upstream.length === 0 ? (
            <p className="text-xs text-ink-300 italic">No upstream dependencies — this is a root activity.</p>
          ) : (
            <div className="space-y-1.5">
              {upstream.map((l) => {
                const src = nodeById.get(l.source_id)
                if (!src) return null
                const srcMeta = columnByKey.get(src.column) ?? { border: UNCATEGORIZED_PALETTE.border } as ColumnMeta
                return (
                  <button
                    key={l.id}
                    onClick={() => onFocusNode(src.activity.id)}
                    className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg hover:bg-ink-50 transition-colors group"
                  >
                    <span className="size-5 rounded-md flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: srcMeta.border }}>
                      {initialFor(srcMeta.label ?? '?')}
                    </span>
                    <span className="text-xs text-ink-700 truncate group-hover:text-accent">{src.activity.title}</span>
                    {l.link_type === 'ai_suggested' && <Sparkles className="size-3 text-purple-400 shrink-0 ml-auto" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Downstream */}
        <div>
          <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-2">
            This feeds into ({downstream.length})
          </p>
          {downstream.length === 0 ? (
            <p className="text-xs text-ink-300 italic">No downstream dependents yet.</p>
          ) : (
            <div className="space-y-1.5">
              {downstream.map((l) => {
                const tgt = nodeById.get(l.target_id)
                if (!tgt) return null
                const tgtMeta = columnByKey.get(tgt.column) ?? { border: UNCATEGORIZED_PALETTE.border } as ColumnMeta
                return (
                  <button
                    key={l.id}
                    onClick={() => onFocusNode(tgt.activity.id)}
                    className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg hover:bg-ink-50 transition-colors group"
                  >
                    <span className="size-5 rounded-md flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: tgtMeta.border }}>
                      {initialFor(tgtMeta.label ?? '?')}
                    </span>
                    <span className="text-xs text-ink-700 truncate group-hover:text-accent">{tgt.activity.title}</span>
                    {l.link_type === 'ai_suggested' && <Sparkles className="size-3 text-purple-400 shrink-0 ml-auto" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}