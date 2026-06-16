import React from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  LayoutDashboard, FileText, BarChart2, FileOutput,
  Settings, ChevronLeft, ChevronRight, WifiOff, RefreshCw,
  Menu,
} from 'lucide-react'
import { useUIStore } from '../../store/ui'
import { useOfflineStore } from '../../store/offline'
import { useSyncEngine } from '../../hooks'
import ToastContainer from '../ui/ToastContainer'

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/plans',     icon: FileText,        label: 'Plans' },
  { to: '/progress',  icon: BarChart2,        label: 'Progress' },
  { to: '/reports',   icon: FileOutput,       label: 'Reports' },
  { to: '/admin',     icon: Settings,         label: 'Admin' },
]

export const AppShell: React.FC = () => {
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggle = useUIStore((s) => s.toggleSidebar)
  const isOnline = useOfflineStore((s) => s.isOnline)
  const pendingCount = useOfflineStore((s) => s.pendingCount)
  const isSyncing = useOfflineStore((s) => s.isSyncing)
  const { sync } = useSyncEngine()

  return (
    <div className="flex h-screen overflow-hidden bg-ink-50">
      {/* Sidebar */}
      <aside
        className={clsx(
          'flex flex-col bg-ink-900 text-white transition-all duration-200 shrink-0',
          collapsed ? 'w-16' : 'w-56',
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-ink-700">
          <div className="size-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
            <span className="font-display font-bold text-sm">SP</span>
          </div>
          {!collapsed && (
            <span className="font-display font-bold text-base tracking-tight">SPE-Lite</span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 space-y-1 px-2">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-white'
                    : 'text-ink-300 hover:bg-ink-800 hover:text-white',
                )
              }
            >
              <Icon className="size-5 shrink-0" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Collapse toggle */}
        <div className="p-2 border-t border-ink-700">
          <button
            onClick={toggle}
            className="w-full flex items-center justify-center p-2 rounded-lg text-ink-400 hover:text-white hover:bg-ink-800 transition-colors"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <ChevronRight className="size-4" />
            ) : (
              <>
                <ChevronLeft className="size-4 mr-2" />
                <span className="text-xs">Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Main */}
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
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <ToastContainer />
    </div>
  )
}

export default AppShell
