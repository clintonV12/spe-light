import React, { useState, useEffect, useCallback } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  LayoutDashboard, FileText, BarChart2, FileOutput,
  Settings, ChevronLeft, ChevronRight, WifiOff, RefreshCw,
  Menu, Search, Keyboard, ShieldCheck,
} from 'lucide-react'
import { useUIStore } from '../../store/ui'
import { useOfflineStore } from '../../store/offline'
import { useAuthStore } from '../../store/auth'
import { useSyncEngine } from '../../hooks'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import ToastContainer from '../ui/ToastContainer'
import CommandPalette from './CommandPalette'
import ShortcutsModal from './ShortcutsModal'
import AppFooter from './AppFooter'
import { ROLE_HIERARCHY } from './ProtectedRoute'

// Custom event dispatched by AppShell when the user presses 'c'.
// Pages listen for this and open their own create modal.
export const SHORTCUT_CREATE_EVENT = 'stratplan:shortcut:create'

export const AppShell: React.FC = () => {
  const collapsed    = useUIStore((s) => s.sidebarCollapsed)
  const toggle       = useUIStore((s) => s.toggleSidebar)
  const isOnline     = useOfflineStore((s) => s.isOnline)
  const pendingCount = useOfflineStore((s) => s.pendingCount)
  const isSyncing    = useOfflineStore((s) => s.isSyncing)
  const { sync }     = useSyncEngine()

  const role = useAuthStore((s) => s.user?.role)

  const [searchOpen,    setSearchOpen]    = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const closeSearch    = useCallback(() => setSearchOpen(false),    [])
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), [])

  // ── Global search shortcut: / and Cmd+K ────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isEditing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(
        (e.target as HTMLElement)?.tagName,
      )
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen((v) => !v)
        return
      }
      if (e.key === '/' && !isEditing) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ── Navigation + action shortcuts ──────────────────────────────────────────
  useKeyboardShortcuts({
    onOpenSearch:  () => setSearchOpen(true),
    onOpenCreate:  () => window.dispatchEvent(new CustomEvent(SHORTCUT_CREATE_EVENT)),
    onOpenHelp:    () => setShortcutsOpen((v) => !v),
  })

  // ── Role-based navigation ────────────────────────────────────────────────
  // Platform-tier users (super_admin, platform_support) have no org and no
  // access to Plans/Progress/Reports/org-Admin per the SRS permission
  // matrix — they get a single link to their own console instead.
  const isPlatformTier = role === 'super_admin' || role === 'platform_support'

  const orgNavItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/plans',     icon: FileText,        label: 'Plans'     },
    { to: '/progress',  icon: BarChart2,        label: 'Progress'  },
    { to: '/reports',   icon: FileOutput,       label: 'Reports'   },
    ...(role && ROLE_HIERARCHY[role] >= ROLE_HIERARCHY.org_admin
      ? [{ to: '/admin', icon: Settings, label: 'Admin' }]
      : []),
  ]
  const platformNavItems = [
    { to: '/platform-admin', icon: ShieldCheck, label: 'Platform console' },
  ]
  const navItems = isPlatformTier ? platformNavItems : orgNavItems

  return (
    <div className="flex h-screen overflow-hidden bg-ink-50">

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <aside className={clsx(
        'flex flex-col bg-ink-900 text-white transition-all duration-200 shrink-0',
        collapsed ? 'w-16' : 'w-56',
      )}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-ink-700">
          <img
            src="/logo.jpg"
            alt="StratPlan"
            className="size-8 rounded-lg shrink-0 object-contain"
          />

          {!collapsed && (
            <span className="font-display font-bold text-base tracking-tight">
              StratPlan
            </span>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-4 space-y-1 px-2">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-accent text-white'
                  : 'text-ink-300 hover:bg-ink-800 hover:text-white',
              )}
            >
              <Icon className="size-5 shrink-0" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Shortcuts hint */}
        {!collapsed && (
          <div className="px-3 pb-2">
            <button
              onClick={() => setShortcutsOpen(true)}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-ink-500 hover:text-ink-300 hover:bg-ink-800 transition-colors"
            >
              <Keyboard className="size-3.5" />
              <span>Keyboard shortcuts</span>
              <kbd className="ml-auto text-[10px] font-mono bg-ink-800 border border-ink-700 rounded px-1">?</kbd>
            </button>
          </div>
        )}

        {/* Collapse toggle */}
        <div className="p-2 border-t border-ink-700">
          <button
            onClick={toggle}
            className="w-full flex items-center justify-center p-2 rounded-lg text-ink-400 hover:text-white hover:bg-ink-800 transition-colors"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed
              ? <ChevronRight className="size-4" />
              : <><ChevronLeft className="size-4 mr-2" /><span className="text-xs">Collapse</span></>
            }
          </button>
        </div>
      </aside>

      {/* ── Main column ────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* Offline banner */}
        {!isOnline && (
          <div className="flex items-center gap-2 bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
            <WifiOff className="size-4 shrink-0" />
            <span className="flex-1">
              You're offline. Changes are saved locally and will sync when you reconnect.
            </span>
            {pendingCount > 0 && (
              <span className="font-medium">{pendingCount} pending</span>
            )}
          </div>
        )}

        {/* Top bar */}
        <header className="h-14 bg-white border-b border-ink-100 flex items-center gap-4 px-4 shrink-0">
          <button
            onClick={toggle}
            className="lg:hidden p-1.5 rounded-lg text-ink-400 hover:text-ink-700"
          >
            <Menu className="size-5" />
          </button>

          {/* Search trigger */}
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-ink-200 bg-ink-50 text-ink-400 hover:bg-ink-100 hover:text-ink-600 transition-colors w-full max-w-xs"
          >
            <Search className="size-3.5 shrink-0" />
            <span className="text-xs flex-1 text-left">Search…</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] font-mono text-ink-400 bg-white border border-ink-200 rounded px-1.5 py-0.5">
              ⌘K
            </kbd>
          </button>

          <div className="flex-1" />

          {/* Sync indicator */}
          {isOnline && pendingCount > 0 && (
            <button
              onClick={sync}
              disabled={isSyncing}
              className="flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-800"
            >
              <RefreshCw className={clsx('size-3.5', isSyncing && 'animate-spin')} />
              {isSyncing ? 'Syncing…' : `${pendingCount} to sync`}
            </button>
          )}

          {/* Shortcuts hint button in top bar */}
          <button
            onClick={() => setShortcutsOpen(true)}
            className="hidden md:flex items-center gap-1.5 text-xs text-ink-400 hover:text-ink-600 transition-colors"
            title="Keyboard shortcuts (?)"
          >
            <Keyboard className="size-3.5" />
          </button>
        </header>

        {/* Page content + footer */}
        <main className="flex-1 overflow-y-auto flex flex-col">
          <div className="flex-1">
            <Outlet />
          </div>
          <AppFooter />
        </main>
      </div>

      {/* ── Overlays ───────────────────────────────────────────────────────── */}
      <ToastContainer />
      <CommandPalette   open={searchOpen}    onClose={closeSearch}    />
      <ShortcutsModal   open={shortcutsOpen} onClose={closeShortcuts} />
    </div>
  )
}

export default AppShell