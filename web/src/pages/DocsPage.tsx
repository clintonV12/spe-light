import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import { Search, Hash, ExternalLink, Menu, X, FileText, ArrowRight, LayoutDashboard, Download } from 'lucide-react'
import { useAuthStore } from '../store/auth'

// ── In-app documentation ────────────────────────────────────────────────────
//
// Renders markdown docs (starting with the generated API reference) inside
// the app itself, so nobody has to go dig up a file on disk or a wiki page
// to answer "what does this endpoint actually do." Docs are checked in as
// plain .md files under src/docs/ and registered in DOC_REGISTRY below —
// adding a second doc (a user guide, an admin runbook, whatever comes next)
// is one new file + one new registry entry, nothing else changes here.
//
// Public route — mounted in App.tsx outside ProtectedRoute/AppShell
// entirely, deliberately, so someone evaluating the platform (or an admin
// troubleshooting a login problem) can read the docs without signing in
// first. That means this page gets none of AppShell's chrome for free —
// no sidebar, no top bar — so it renders its own minimal header below
// (DocsHeader) instead, with a "Back to dashboard" link if an authenticated
// session happens to still be active in this browser, or "Sign in" if not.
//
// Requires two new dependencies not otherwise used in this codebase:
//   npm install react-markdown remark-gfm
// remark-gfm specifically because the API reference leans hard on GFM
// tables (every endpoint's request/response shape is a table) — the base
// CommonMark react-markdown ships with doesn't parse those on its own.
//
// Heading anchors are generated with the same slug algorithm GitHub uses
// (lowercase, strip everything but [a-z0-9 -], turn spaces into hyphens,
// don't collapse runs) specifically so they match the hand-written anchor
// links already inside the docs' own "Table of Contents" sections — e.g.
// "### 4.3 SSO — SAML & OIDC" slugs to "43-sso--saml--oidc", which is
// exactly what those documents already link to. Getting this wrong wouldn't
// break rendering, just silently turn every internal TOC link into a dead
// anchor.

interface DocEntry {
  id: string
  title: string
  description: string
  content: string
}

interface Heading {
  level: number
  text: string
  slug: string
  /** Raw text from this heading to the next heading of level <= its own —
   *  used for search, not rendering. */
  body: string
}

// ── Registry ─────────────────────────────────────────────────────────────
//
// Vite's `?raw` import suffix pulls the file in as a plain string at build
// time (no markdown processing at import time — react-markdown does that at
// render time instead). Requires either a `*.md?raw` module declaration
// somewhere in the project's .d.ts files, or `vite-env.d.ts` already
// covering it — see the declaration this PR also adds at
// src/types/markdown.d.ts if one doesn't already exist.
import apiReferenceMd from '../docs/api-reference.md?raw'

const DOC_REGISTRY: DocEntry[] = [
  {
    id: 'api-reference',
    title: 'API Reference',
    description: 'Every endpoint, request/response shape, and role requirement.',
    content: apiReferenceMd,
  },
  // Add future docs here, e.g.:
  // { id: 'user-guide', title: 'User Guide', description: '...',
  //   content: userGuideMd },
]

// ── Downloadable resources ──────────────────────────────────────────────
//
// Separate from DOC_REGISTRY on purpose: these are files meant to be saved
// and read outside the app (offline, printed, shared with a Board), not
// markdown rendered in-page. Each entry's `href` is a static asset — drop
// the actual file in /public/guides/ (Vite serves anything under /public
// at the site root) and point href at that same path; no import needed
// since these never get parsed/rendered, just downloaded as-is.
interface DownloadEntry {
  id: string
  title: string
  description: string
  href: string
  /** Suggested filename for the browser's save dialog. */
  filename: string
}

const DOWNLOAD_REGISTRY: DownloadEntry[] = [
  {
    id: 'strategic-plan-guide',
    title: 'Strategic Planning Guide',
    description: 'Complete guide to developing and establishing a strategic plan (PDF).',
    href: '/guides/complete-guide-to-strategic-planning.pdf',
    filename: 'Complete Guide to Developing and Establishing a Strategic Plan.pdf',
  },
]

// ── Slug + heading extraction ───────────────────────────────────────────

function githubSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/ /g, '-')
}

// Strips the markdown syntax that can appear inside a heading line itself
// (inline code, bold, links) so both the sidebar label and the slug are
// computed from the same plain text a reader actually sees.
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim()
}

// Single pass over the raw markdown, in document order, producing every
// heading's slug up front. Both the sidebar (levels 2-3 only, to mirror the
// docs' own hand-written TOC granularity) and the render-time heading
// components (all levels, via the shared index counter below) read from
// this same list — computing slugs twice, once from raw text and once from
// rendered React children, risks the two drifting apart on some edge case
// neither pass handles identically. One source of truth avoids that.
function extractHeadings(markdown: string): Heading[] {
  const lines = markdown.split('\n')
  const seen = new Map<string, number>()
  const raw: { level: number; text: string; slug: string; lineIndex: number }[] = []

  lines.forEach((line, i) => {
    const m = /^(#{1,4})\s+(.*)$/.exec(line)
    if (!m) return
    const level = m[1].length
    const text = stripInlineMarkdown(m[2])
    let slug = githubSlug(text)
    const count = seen.get(slug) ?? 0
    seen.set(slug, count + 1)
    if (count > 0) slug = `${slug}-${count}`
    raw.push({ level, text, slug, lineIndex: i })
  })

  return raw.map((h, idx) => {
    // Body runs until the next heading of level <= this one — same
    // "section" semantics a reader would expect from a nested TOC.
    let endLine = lines.length
    for (let j = idx + 1; j < raw.length; j++) {
      if (raw[j].level <= h.level) { endLine = raw[j].lineIndex; break }
    }
    const body = lines.slice(h.lineIndex + 1, endLine).join('\n')
    return { level: h.level, text: h.text, slug: h.slug, body }
  })
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()

  const [activeDocId, setActiveDocId] = useState(DOC_REGISTRY[0].id)
  const [query, setQuery] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const activeDoc = useMemo(
    () => DOC_REGISTRY.find((d) => d.id === activeDocId) ?? DOC_REGISTRY[0],
    [activeDocId],
  )

  const allHeadings = useMemo(() => extractHeadings(activeDoc.content), [activeDoc])
  const sidebarHeadings = useMemo(
    () => allHeadings.filter((h) => h.level >= 2 && h.level <= 3),
    [allHeadings],
  )

  const filteredHeadings = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sidebarHeadings
    return sidebarHeadings.filter(
      (h) => h.text.toLowerCase().includes(q) || h.body.toLowerCase().includes(q),
    )
  }, [sidebarHeadings, query])

  // Render-time heading components pull sequential slugs from allHeadings —
  // reset per render so switching docs (or any re-render) starts the
  // counter over from the top, matching document order exactly.
  const headingIndexRef = useRef(0)
  headingIndexRef.current = 0

  const scrollToSlug = (slug: string, replaceHistory = false) => {
    const el = document.getElementById(slug)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const url = `${location.pathname}#${slug}`
    if (replaceHistory) navigate(url, { replace: true })
    else navigate(url, { replace: false })
  }

  // Deep-link support: /docs#43-sso--saml--oidc scrolls to that heading on
  // load, once the markdown has actually rendered (hence the rAF — the
  // element doesn't exist in the DOM until after the first paint).
  useEffect(() => {
    if (!location.hash) return
    const slug = location.hash.slice(1)
    const id = requestAnimationFrame(() => scrollToSlug(slug, true))
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocId])

  // Intercepts clicks on internal "#slug" links (both the doc's own
  // hand-written TOC and any cross-reference like "see §4.15") so they
  // smooth-scroll instead of a hard jump, and keeps the URL in sync so the
  // browser back button and page refresh both still land in the right spot.
  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest('a')
    if (!target) return
    const href = target.getAttribute('href')
    if (!href || !href.startsWith('#')) return
    e.preventDefault()
    scrollToSlug(href.slice(1))
  }

  const components: Components = {
    h1: ({ children }) => {
      const slug = allHeadings[headingIndexRef.current++]?.slug
      return (
        <h1 id={slug} className="font-display text-2xl sm:text-3xl font-bold text-ink-900 mb-2 scroll-mt-20">
          {children}
        </h1>
      )
    },
    h2: ({ children }) => {
      const slug = allHeadings[headingIndexRef.current++]?.slug
      return (
        <h2 id={slug} className="group font-display text-xl font-bold text-ink-900 mt-10 mb-3 pt-6 border-t border-ink-100 first:border-t-0 first:pt-0 first:mt-0 scroll-mt-20 flex items-center gap-2">
          {children}
          <HeadingAnchor slug={slug} />
        </h2>
      )
    },
    h3: ({ children }) => {
      const slug = allHeadings[headingIndexRef.current++]?.slug
      return (
        <h3 id={slug} className="group font-display text-base font-bold text-ink-900 mt-7 mb-2 scroll-mt-20 flex items-center gap-2">
          {children}
          <HeadingAnchor slug={slug} />
        </h3>
      )
    },
    h4: ({ children }) => {
      const slug = allHeadings[headingIndexRef.current++]?.slug
      return (
        <h4 id={slug} className="group font-semibold text-sm text-ink-800 mt-5 mb-1.5 scroll-mt-20 flex items-center gap-2">
          {children}
          <HeadingAnchor slug={slug} />
        </h4>
      )
    },
    p: ({ children }) => <p className="text-sm text-ink-700 leading-relaxed mb-3">{children}</p>,
    a: ({ href, children }) => {
      const isExternal = /^https?:\/\//.test(href ?? '')
      return (
        <a
          href={href}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
          className="text-accent hover:text-accent-700 underline decoration-accent-200 underline-offset-2 transition-colors"
        >
          {children}
          {isExternal && <ExternalLink className="inline size-3 ml-0.5 mb-0.5" />}
        </a>
      )
    },
    ul: ({ children }) => <ul className="list-disc list-outside pl-5 text-sm text-ink-700 space-y-1 mb-3">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal list-outside pl-5 text-sm text-ink-700 space-y-1 mb-3">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    strong: ({ children }) => <strong className="font-semibold text-ink-900">{children}</strong>,
    em: ({ children }) => <em className="italic text-ink-600">{children}</em>,
    hr: () => <hr className="my-8 border-ink-100" />,
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-accent-200 bg-accent-50 rounded-r-lg px-4 py-3 my-4 text-sm text-ink-700 [&>p]:mb-0">
        {children}
      </blockquote>
    ),
    code: ({ className, children }) => {
      // A fenced block (```...```) gets a language className from remark;
      // an inline `code span` doesn't — that's the one reliable signal to
      // tell them apart in react-markdown's flat code renderer.
      const isBlock = Boolean(className)
      if (!isBlock) {
        return <code className="rounded bg-ink-100 px-1.5 py-0.5 text-[13px] font-mono text-ink-800">{children}</code>
      }
      return <code className="block font-mono text-[13px] text-ink-100 whitespace-pre">{children}</code>
    },
    pre: ({ children }) => (
      <pre className="rounded-xl bg-ink-900 p-4 overflow-x-auto mb-4">{children}</pre>
    ),
    table: ({ children }) => (
      <div className="overflow-x-auto mb-4 rounded-lg border border-ink-100">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-ink-50">{children}</thead>,
    tbody: ({ children }) => <tbody className="divide-y divide-ink-100">{children}</tbody>,
    tr: ({ children }) => <tr>{children}</tr>,
    th: ({ children }) => (
      <th className="text-left font-semibold text-ink-700 px-3 py-2 whitespace-nowrap border-b border-ink-200">{children}</th>
    ),
    td: ({ children }) => <td className="px-3 py-2 text-ink-700 align-top">{children}</td>,
  }

  return (
    <div className="min-h-screen bg-ink-50 flex flex-col">
      <DocsHeader />
      <div className="flex flex-col lg:flex-row gap-6 max-w-7xl w-full mx-auto p-4 sm:p-6">
      {/* Mobile nav toggle */}
      <div className="lg:hidden flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-ink-900">{t('docs.title', 'Documentation')}</h1>
        <button
          onClick={() => setMobileNavOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-700"
        >
          {mobileNavOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          {t('docs.contents', 'Contents')}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`lg:w-72 shrink-0 ${mobileNavOpen ? 'block' : 'hidden'} lg:block`}>
        <div className="lg:sticky lg:top-6 space-y-4">
          {DOC_REGISTRY.length > 1 && (
            <div className="space-y-1">
              {DOC_REGISTRY.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => { setActiveDocId(doc.id); setQuery(''); setMobileNavOpen(false) }}
                  className={`w-full flex items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                    doc.id === activeDocId ? 'bg-accent-50 text-accent' : 'text-ink-600 hover:bg-ink-50'
                  }`}
                >
                  <FileText className="size-4 shrink-0 mt-0.5" />
                  <span>
                    <span className="block text-sm font-semibold">{doc.title}</span>
                    <span className="block text-xs text-ink-400">{doc.description}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-ink-300" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('docs.search', 'Search this doc…')}
              className="w-full rounded-lg border border-ink-200 bg-white pl-8 pr-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>

          {DOWNLOAD_REGISTRY.length > 0 && (
            <div className="space-y-1.5">
              <p className="px-1 text-[11px] font-semibold text-ink-300 uppercase tracking-wide">
                {t('docs.downloads', 'Downloads')}
              </p>
              {DOWNLOAD_REGISTRY.map((res) => (
                <a
                  key={res.id}
                  href={res.href}
                  download={res.filename}
                  className="flex items-start gap-2.5 rounded-lg border border-ink-100 bg-white px-3 py-2.5 text-left transition-colors hover:border-accent-300 hover:bg-accent-50/40 group"
                >
                  <Download className="size-4 shrink-0 mt-0.5 text-ink-400 group-hover:text-accent-600 transition-colors" />
                  <span>
                    <span className="block text-sm font-semibold text-ink-800 group-hover:text-accent-700 transition-colors">
                      {res.title}
                    </span>
                    <span className="block text-xs text-ink-400">{res.description}</span>
                  </span>
                </a>
              ))}
            </div>
          )}

          <nav className="max-h-[70vh] overflow-y-auto space-y-0.5 pr-1">
            {filteredHeadings.length === 0 && (
              <p className="text-xs text-ink-400 px-2 py-1">{t('docs.noMatches', 'No matching sections.')}</p>
            )}
            {filteredHeadings.map((h) => (
              <button
                key={h.slug}
                onClick={() => { scrollToSlug(h.slug); setMobileNavOpen(false) }}
                className={`w-full text-left rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-ink-50 hover:text-ink-900 ${
                  h.level === 2 ? 'font-semibold text-ink-700' : 'text-ink-500 pl-4'
                }`}
              >
                {h.text}
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0 rounded-2xl border border-ink-100 bg-white p-6 sm:p-8" onClick={handleContentClick}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {activeDoc.content}
        </ReactMarkdown>
      </main>
      </div>
    </div>
  )
}

// Standalone header for this page specifically — DocsPage is a public
// route mounted outside AppShell (see the page-top comment), so it has no
// sidebar/top bar to inherit and needs just enough of its own chrome to
// not feel like a bare, disconnected page: the brand mark (same /logo.jpg
// asset as AppShell and the auth screens) and one contextual action.
function DocsHeader() {
  const { t } = useTranslation()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const role = useAuthStore((s) => s.user?.role)
  const isPlatformTier = role === 'super_admin' || role === 'platform_support'

  return (
    <header className="h-16 shrink-0 bg-white border-b border-ink-100 flex items-center px-4 sm:px-6">
      <div className="max-w-7xl w-full mx-auto flex items-center justify-between">
        <Link to={isAuthenticated ? (isPlatformTier ? '/platform-admin' : '/dashboard') : '/login'} className="flex items-center gap-2.5">
          <img src="/logo.jpg" alt="SPE-Lite" className="size-8 rounded-lg object-contain shrink-0" />
          <span className="font-display font-bold text-base text-ink-900 tracking-tight hidden sm:inline">SPE-Lite</span>
        </Link>

        {isAuthenticated ? (
          <Link
            to={isPlatformTier ? '/platform-admin' : '/dashboard'}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-50 hover:text-ink-900 transition-colors"
          >
            <LayoutDashboard className="size-4" />
            {t('docs.backToDashboard', 'Back to dashboard')}
          </Link>
        ) : (
          <Link
            to="/login"
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
          >
            {t('docs.signIn', 'Sign in')} <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>
    </header>
  )
}

// Small "#" anchor that appears on hover next to a heading, for copying a
// direct link to that section — standard docs-site affordance.
function HeadingAnchor({ slug }: { slug?: string }) {
  if (!slug) return null
  return (
    <a
      href={`#${slug}`}
      className="opacity-0 group-hover:opacity-100 text-ink-300 hover:text-accent transition-opacity"
      aria-label="Link to this section"
      onClick={(e) => e.stopPropagation()}
    >
      <Hash className="size-3.5" />
    </a>
  )
}