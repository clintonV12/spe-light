import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, FileText, LayoutDashboard, FileOutput, Settings,
  CornerDownLeft, ArrowUp, ArrowDown, X, BookOpen,
} from 'lucide-react'
import { useGlobalSearch } from '../../hooks/useGlobalSearch'
import type { SearchResult } from '../../hooks/useGlobalSearch'
import { useAuthStore } from '../../store/auth'
import { advisorApi } from '../../api/endpoints'
import { ROLE_HIERARCHY, PLATFORM_ROLES } from './ProtectedRoute'

const PHASE_DOT: Record<'P1' | 'P2' | 'P3', string> = {
  P1: 'bg-p1', P2: 'bg-p2', P3: 'bg-p3',
}

const PAGE_ICON: Record<string, React.ReactNode> = {
  '/dashboard': <LayoutDashboard className="size-4" />,
  '/plans':     <FileText className="size-4" />,
  '/reports':   <FileOutput className="size-4" />,
  '/admin':     <Settings className="size-4" />,
  // Icon mapping only — /docs itself isn't in useGlobalSearch's static page
  // list yet (that hook wasn't available when this was wired up). Add
  // { path: '/docs', title: 'Docs', ... } to whatever builds that list and
  // it'll pick up this icon automatically; until then this entry is inert.
  '/docs':      <BookOpen className="size-4" />,
}

// The authoritative set of pages that actually exist (mirrors App.tsx's
// route tree). useGlobalSearch builds its own static "page" list
// independently (that hook wasn't available when this was last touched),
// so if it still lists a page that's since been removed — like the old
// standalone Progress page — filtering results against this set here
// catches it without needing to touch that hook too. '/platform-admin'
// and '/profile' are deliberately not page-search results anywhere in the
// app (no nav entry links to them via search), so they're left out; add
// them here if that ever changes.
const KNOWN_PAGES = new Set(['/dashboard', '/plans', '/reports', '/admin', '/docs'])

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-ink-100 text-ink-500',
  active: 'bg-p2-light text-p2-dark',
  review: 'bg-p1-light text-p1-dark',
  completed: 'bg-green-100 text-green-700',
  archived: 'bg-ink-100 text-ink-400',
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const { buildIndex, search, isIndexing } = useGlobalSearch()
  const [query, setQuery] = useState('')
  const [rawResults, setRawResults] = useState<SearchResult[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const role = useAuthStore((s) => s.user?.role)

  // Same access rules ProtectedRoute enforces server-route-side, applied
  // here so the palette never offers a destination it's about to bounce
  // the user away from. A platform-tier user (super_admin,
  // platform_support) or an advisor that hasn't picked an org yet has no
  // org context at all — every org-scoped page 403s for them — so those
  // pages are filtered out of results entirely rather than shown and then
  // redirected away from after the fact.
  const isPlatformTier = role ? PLATFORM_ROLES.includes(role) : false
  const isOrglessAdvisor = role === 'advisor' && !advisorApi.currentOrgId()
  const canSeeOrgPages = !isPlatformTier && !isOrglessAdvisor
  const canSeeAdminPage = canSeeOrgPages && !!role && ROLE_HIERARCHY[role] >= ROLE_HIERARCHY.org_admin

  const results = useMemo(() => {
    return rawResults.filter((r) => {
      if (r.kind !== 'page') return true // plan/activity results are already org-scoped by the index itself
      if (!KNOWN_PAGES.has(r.path)) return false // stale entries (e.g. the removed Progress page)
      if (r.path === '/admin') return canSeeAdminPage
      if (r.path === '/docs') return true
      // /dashboard, /plans, /reports — org-tier only
      return canSeeOrgPages
    })
  }, [rawResults, canSeeOrgPages, canSeeAdminPage])

  // Build the index once when the palette first opens
  useEffect(() => {
    if (open) buildIndex()
  }, [open, buildIndex])

  // Re-run search whenever query or open state changes
  useEffect(() => {
    if (!open) return
    setRawResults(search(query))
    setActiveIndex(0)
  }, [open, query, search])

  // Focus input on open, reset query on close
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10)
    } else {
      setQuery('')
    }
  }, [open])

  const handleSelect = useCallback((result: SearchResult) => {
    navigate(result.path)
    onClose()
  }, [navigate, onClose])

  // Keyboard navigation within the palette
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[activeIndex]) handleSelect(results[activeIndex])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-ink-100 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-ink-100">
          <Search className="size-4 text-ink-300 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search plans, activities, pages…"
            className="flex-1 text-sm outline-none placeholder:text-ink-300"
          />
          {isIndexing && (
            <span className="size-3.5 animate-spin rounded-full border-2 border-ink-200 border-t-accent shrink-0" />
          )}
          <button onClick={onClose} className="shrink-0 text-ink-300 hover:text-ink-600 transition-colors">
            <X className="size-4" />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-96 overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-ink-400">No results for "{query}"</p>
            </div>
          ) : (
            <>
              {!query.trim() && (
                <p className="px-4 pb-1.5 text-[11px] font-semibold text-ink-300 uppercase tracking-wide">
                  Quick navigate
                </p>
              )}
              {results.map((result, idx) => {
                const isActive = idx === activeIndex
                return (
                  <button
                    key={`${result.kind}-${result.id}`}
                    data-idx={idx}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => handleSelect(result)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      isActive ? 'bg-accent-50' : 'hover:bg-ink-50'
                    }`}
                  >
                    {/* Icon by kind */}
                    <span className={`flex items-center justify-center size-8 rounded-lg shrink-0 ${
                      isActive ? 'bg-accent text-white' : 'bg-ink-100 text-ink-400'
                    }`}>
                      {result.kind === 'page' ? (
                        PAGE_ICON[result.path] ?? <FileText className="size-4" />
                      ) : result.kind === 'plan' ? (
                        <FileText className="size-4" />
                      ) : (
                        <span className={`size-2.5 rounded-full ${result.phase ? PHASE_DOT[result.phase] : 'bg-ink-300'}`} />
                      )}
                    </span>

                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${isActive ? 'text-accent-900' : 'text-ink-800'}`}>
                        {result.title}
                      </p>
                      <p className="text-xs text-ink-400 truncate">{result.subtitle}</p>
                    </div>

                    {result.badge && (
                      <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_BADGE[result.badge] ?? 'bg-ink-100 text-ink-500'}`}>
                        {result.badge}
                      </span>
                    )}

                    {isActive && (
                      <CornerDownLeft className="size-3.5 text-accent shrink-0" />
                    )}
                  </button>
                )
              })}
            </>
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-ink-100 bg-ink-50/50">
          <span className="flex items-center gap-1 text-[11px] text-ink-400">
            <ArrowUp className="size-3" /><ArrowDown className="size-3" /> Navigate
          </span>
          <span className="flex items-center gap-1 text-[11px] text-ink-400">
            <CornerDownLeft className="size-3" /> Select
          </span>
          <span className="flex items-center gap-1 text-[11px] text-ink-400 ml-auto">
            <kbd className="px-1.5 py-0.5 rounded bg-white border border-ink-200 font-mono text-[10px]">Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  )
}