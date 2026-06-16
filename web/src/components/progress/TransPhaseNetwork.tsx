import { useState, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ZoomIn, ZoomOut, Maximize2, GitBranch, Sparkles,
  Clock, AlertTriangle, X,
} from 'lucide-react'
import type { Activity, ActivityLink, Phase, ActivityStatus } from '../../types'

// ─── Layout constants ─────────────────────────────────────────────────────

const COLUMN_WIDTH = 280
const COLUMN_GAP = 90
const NODE_WIDTH = 220
const NODE_HEIGHT = 64
const ROW_GAP = 28
const TOP_PADDING = 70
const SIDE_PADDING = 60

const PHASES: Phase[] = ['P1', 'P2', 'P3']

const PHASE_META: Record<Phase, { label: string; sub: string; accent: string; bg: string; border: string; dot: string }> = {
  P1: { label: 'P1', sub: 'Analysis',   accent: '#D97706', bg: '#FEF3C7', border: '#F59E0B', dot: '#F59E0B' },
  P2: { label: 'P2', sub: 'Strategy',   accent: '#059669', bg: '#D1FAE5', border: '#10B981', dot: '#10B981' },
  P3: { label: 'P3', sub: 'Operations', accent: '#7C3AED', bg: '#EDE9FE', border: '#8B5CF6', dot: '#8B5CF6' },
}

const STATUS_META: Record<ActivityStatus, { label: string; color: string; fill: string }> = {
  not_started:  { label: 'Not started',  color: '#94A3B8', fill: '#F1F5F9' },
  in_progress:  { label: 'In progress',  color: '#2563EB', fill: '#DBEAFE' },
  under_review: { label: 'Under review', color: '#D97706', fill: '#FEF3C7' },
  complete:     { label: 'Complete',     color: '#059669', fill: '#D1FAE5' },
}

const LINK_META: Record<ActivityLink['link_type'], { label: string; dash: string; color: string }> = {
  auto:         { label: 'Auto-linked',    dash: '0',   color: '#94A3B8' },
  manual:       { label: 'Manually drawn', dash: '0',   color: '#4B6BFB' },
  ai_suggested: { label: 'AI suggested',   dash: '5,4', color: '#8B5CF6' },
}

// ─── Layout computation ─────────────────────────────────────────────────────

interface LayoutNode {
  activity: Activity
  x: number
  y: number
  column: Phase
}

interface LayoutResult {
  nodes: LayoutNode[]
  width: number
  height: number
}

/**
 * Activities are grouped into one of three columns by phase (a label only —
 * NOT a pipeline stage). Within a column, nodes are ordered to minimise edge
 * crossings: nodes with more cross-phase out-degree float toward the top,
 * and we do one pass of barycenter ordering based on linked node positions.
 */
function computeLayout(activities: Activity[], links: ActivityLink[]): LayoutResult {
  const byPhase: Record<Phase, Activity[]> = { P1: [], P2: [], P3: [] }
  activities.forEach((a) => byPhase[a.phase]?.push(a))

  // Initial order: by user_order (creation sequence) within each column
  PHASES.forEach((p) => byPhase[p].sort((a, b) => a.user_order - b.user_order))

  const positions = new Map<string, { x: number; y: number; column: Phase }>()

  PHASES.forEach((phase, colIdx) => {
    const x = SIDE_PADDING + colIdx * (COLUMN_WIDTH + COLUMN_GAP)
    byPhase[phase].forEach((act, rowIdx) => {
      const y = TOP_PADDING + rowIdx * (NODE_HEIGHT + ROW_GAP)
      positions.set(act.id, { x, y, column: phase })
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

  PHASES.forEach((phase, colIdx) => {
    const acts = byPhase[phase]
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
      positions.set(act.id, { x, y, column: phase })
    })
  })

  const nodes: LayoutNode[] = activities
    .map((activity) => {
      const pos = positions.get(activity.id)
      if (!pos) return null
      return { activity, x: pos.x, y: pos.y, column: pos.column }
    })
    .filter((n): n is LayoutNode => n !== null)

  const maxRows = Math.max(1, ...PHASES.map((p) => byPhase[p].length))
  const width = SIDE_PADDING * 2 + PHASES.length * COLUMN_WIDTH + (PHASES.length - 1) * COLUMN_GAP
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

// ─── Edge path — smooth cubic bezier, curving toward the gap between columns ─

function edgePath(
  source: { x: number; y: number; column: Phase },
  target: { x: number; y: number; column: Phase },
): string {
  const sameColumn = source.column === target.column
  const sx = source.x + (sameColumn ? NODE_WIDTH : NODE_WIDTH)
  const sy = source.y + NODE_HEIGHT / 2
  const tx = sameColumn ? target.x + NODE_WIDTH : target.x
  const ty = target.y + NODE_HEIGHT / 2

  if (sameColumn) {
    // Same-phase link: loop out to the right and back
    const bulge = 36
    return `M ${sx} ${sy} C ${sx + bulge} ${sy}, ${sx + bulge} ${ty}, ${sx} ${ty}`
  }

  const dx = Math.max(60, (tx - sx) * 0.5)
  return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`
}

// ─── Component ────────────────────────────────────────────────────────────

interface TransPhaseNetworkProps {
  activities: Activity[]
  links: ActivityLink[]
  planId: string
}

export default function TransPhaseNetwork({ activities, links, planId }: TransPhaseNetworkProps) {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<'all' | ActivityLink['link_type']>('all')

  const { nodes, width, height } = useMemo(
    () => computeLayout(activities, links),
    [activities, links],
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

  // Link-type counts for the legend/filter row
  const linkCounts = useMemo(() => {
    const c: Record<ActivityLink['link_type'], number> = { auto: 0, manual: 0, ai_suggested: 0 }
    links.forEach((l) => { c[l.link_type] += 1 })
    return c
  }, [links])

  const crossPhaseCount = useMemo(
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
            <h2 className="font-display text-sm font-bold text-ink-800">Trans-Phase Network</h2>
          </div>
          <p className="text-xs text-ink-400 mt-0.5">
            {activities.length} activities · {links.length} links · {crossPhaseCount} cross-phase
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Link-type filter pills */}
          <div className="flex items-center gap-1 bg-ink-50 rounded-lg p-1">
            {(['all', 'manual', 'auto', 'ai_suggested'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  filterType === t ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-400 hover:text-ink-600'
                }`}
              >
                {t === 'all' ? `All (${links.length})` : `${LINK_META[t].label} (${linkCounts[t]})`}
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
        {/* Phase column headers — fixed, not part of the pan/zoom transform */}
        <div className="absolute top-0 left-0 right-0 h-full pointer-events-none z-0">
          <svg width="100%" height="100%" className="absolute inset-0">
            <g transform={`translate(${pan.x}, 0) scale(${zoom}, 1)`} style={{ transformOrigin: '0 0' }}>
              {PHASES.map((phase, idx) => {
                const x = SIDE_PADDING + idx * (COLUMN_WIDTH + COLUMN_GAP)
                const meta = PHASE_META[phase]
                return (
                  <g key={phase} transform={`translate(${x}, 0)`}>
                    <rect
                      x={-16} y={0} width={NODE_WIDTH + 32} height={2000}
                      fill={meta.bg} opacity={0.35}
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
            {PHASES.map((phase, idx) => {
              const x = SIDE_PADDING + idx * (COLUMN_WIDTH + COLUMN_GAP)
              const meta = PHASE_META[phase]
              return (
                <g key={`hdr-${phase}`} transform={`translate(${x}, 16)`}>
                  <rect x={0} y={0} width={36} height={20} rx={6} fill={meta.border} />
                  <text x={18} y={14} textAnchor="middle" fontSize={11} fontWeight={700} fill="white" fontFamily="Arial, sans-serif">
                    {meta.label}
                  </text>
                  <text x={44} y={14} fontSize={12} fontWeight={600} fill={meta.accent} fontFamily="Arial, sans-serif">
                    {meta.sub}
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
                const meta = LINK_META[link.link_type]
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
                const { activity, x, y } = node
                const meta = PHASE_META[activity.phase]
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
                    {/* Phase accent bar */}
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
            <p className="text-sm text-ink-400">No activities yet — add activities to any phase to see the network.</p>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 px-5 py-3 border-t border-ink-100 bg-ink-50/50">
        <span className="text-xs font-semibold text-ink-500">Link type:</span>
        {(['manual', 'auto', 'ai_suggested'] as const).map((t) => (
          <span key={t} className="flex items-center gap-1.5 text-xs text-ink-500">
            <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke={LINK_META[t].color} strokeWidth="2" strokeDasharray={LINK_META[t].dash} /></svg>
            {LINK_META[t].label}
          </span>
        ))}
        <span className="text-xs text-ink-300 ml-auto">Scroll to zoom · drag to pan · click a card for detail</span>
      </div>

      {/* Detail panel — slides in when a node is selected */}
      {selectedNode && (
        <div className="border-t border-ink-100 bg-white">
          <NodeDetailPanel
            node={selectedNode}
            allLinks={links}
            nodeById={nodeById}
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
  node, allLinks, nodeById, onClose, onOpen, onFocusNode,
}: {
  node: LayoutNode
  allLinks: ActivityLink[]
  nodeById: Map<string, LayoutNode>
  onClose: () => void
  onOpen: () => void
  onFocusNode: (id: string) => void
}) {
  const { activity } = node
  const meta = PHASE_META[activity.phase]
  const statusMeta = STATUS_META[activity.status]
  const overdue = isOverdue(activity)

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
            {activity.phase}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-ink-900">{activity.title}</h3>
            <p className="text-xs text-ink-400">{typeLabel(activity.type)} · {meta.sub}</p>
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
                const srcMeta = PHASE_META[src.activity.phase]
                return (
                  <button
                    key={l.id}
                    onClick={() => onFocusNode(src.activity.id)}
                    className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg hover:bg-ink-50 transition-colors group"
                  >
                    <span className="size-5 rounded-md flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: srcMeta.border }}>
                      {src.activity.phase}
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
                const tgtMeta = PHASE_META[tgt.activity.phase]
                return (
                  <button
                    key={l.id}
                    onClick={() => onFocusNode(tgt.activity.id)}
                    className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg hover:bg-ink-50 transition-colors group"
                  >
                    <span className="size-5 rounded-md flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: tgtMeta.border }}>
                      {tgt.activity.phase}
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
