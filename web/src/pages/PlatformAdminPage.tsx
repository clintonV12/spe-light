import { useCallback, useEffect, useState } from 'react'
import {
  Building2, Plus, Mail, ShieldCheck, ShieldOff, CheckCircle2, XCircle,
  RefreshCw, Filter, ArrowDownUp, ChevronLeft, ChevronRight, Activity, X, Lock,
} from 'lucide-react'
import { adminApi } from '../api/endpoints'
import { useAuthStore } from '../store/auth'
import type { Organisation, AuditLog, AuditAction } from '../types'

type Tab = 'organisations' | 'audit'

// ─── Audit label/colour maps — mirrors AdminPage.tsx so the two audit views
// read consistently for anyone who uses both. ──────────────────────────────

const ACTION_LABEL: Record<AuditAction, string> = {
  'plan.created':            'Created plan',
  'plan.updated':            'Updated plan',
  'plan.archived':           'Archived plan',
  'plan.deleted':            'Deleted plan',
  'plan.duplicated':         'Duplicated plan',
  'activity.created':        'Created activity',
  'activity.updated':        'Updated activity',
  'activity.deleted':        'Deleted activity',
  'activity.status_changed': 'Changed activity status',
  'user.invited':            'Invited user',
  'user.role_changed':       'Changed role',
  'user.deactivated':        'Deactivated user',
  'user.reactivated':        'Reactivated user',
  'invitation.cancelled':    'Cancelled invitation',
  'invitation.resent':       'Resent invitation',
  'invitation.accepted':     'Accepted invitation',
  'report.generated':        'Generated report',
  'link.created':            'Created link',
  'link.deleted':            'Deleted link',
}

const ACTION_GROUPS = [
  { label: 'All actions', value: '' },
  { label: 'Plans',       value: 'plan' },
  { label: 'Activities',  value: 'activity' },
  { label: 'Users',       value: 'user' },
  { label: 'Invitations', value: 'invitation' },
  { label: 'Reports',     value: 'report' },
]

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function diffLabel(diff: AuditLog['diff']): string | null {
  const keys = Object.keys(diff ?? {})
  if (keys.length === 0) return null
  return keys.map((k) => {
    const { from, to } = diff[k]
    const fromStr = from === null || from === undefined ? 'none' : String(from)
    const toStr   = to   === null || to   === undefined ? 'none' : String(to)
    return `${k}: ${fromStr} → ${toStr}`
  }).join(' · ')
}

// ─── Create organisation modal ─────────────────────────────────────────────

function CreateOrgModal({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState('')
  const [locale, setLocale] = useState('en')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      await adminApi.createOrg({
        name: name.trim(),
        industry: industry.trim() || undefined,
        locale,
      })
      onCreated()
      onClose()
    } catch {
      setError('Could not create the organisation. Check the details and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-bold text-ink-900">New organisation</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-ink-700">Organisation name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Strategy Group"
              className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink-700">Industry</label>
              <input
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink-700">Locale</label>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-accent-400"
              >
                <option value="en">English</option>
                <option value="fr">Français</option>
                <option value="pt">Português</option>
              </select>
            </div>
          </div>

          <p className="text-xs text-ink-400">
            The org is created active with no members. Use "Invite org admin" to onboard the first admin, or add users manually once inside the org.
          </p>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-ink-600 hover:bg-ink-50 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
              Create organisation
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Invite org admin modal ─────────────────────────────────────────────────

function InviteOrgAdminModal({ onInvited, onClose }: { onInvited: () => void; onClose: () => void }) {
  const [orgName, setOrgName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orgName.trim() || !email.trim()) return
    setLoading(true)
    setError('')
    try {
      await adminApi.sendOrgInvitation({ email: email.trim(), org_name: orgName.trim() })
      onInvited()
      onClose()
    } catch {
      setError('Could not send the invitation. Check the email address and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-bold text-ink-900">Invite an org admin</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-ink-700">New organisation name</label>
            <input
              autoFocus
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Acme Strategy Group"
              className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-ink-700">Admin contact email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@acme.com"
              className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent"
            />
          </div>

          <p className="text-xs text-ink-400">
            This creates a pending organisation and emails a 7-day setup link. The org activates and this
            person becomes org admin once they accept.
          </p>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-ink-600 hover:bg-ink-50 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !orgName.trim() || !email.trim()}
              className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
              Send invite
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Audit log tab (cross-org) ──────────────────────────────────────────────

function AuditLogTab({ orgs }: { orgs: Organisation[] }) {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [actionFilter, setActionFilter] = useState('')
  const [orgFilter, setOrgFilter] = useState('')
  const limit = 10

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await adminApi.listAuditLog({
        action: actionFilter || undefined,
        org_id: orgFilter || undefined,
        limit,
        offset: page * limit,
      })
      setLogs(result.logs)
      setTotal(result.total)
    } catch { /* leave prior page visible */ } finally { setLoading(false) }
  }, [page, actionFilter, orgFilter])

  useEffect(() => { setPage(0) }, [actionFilter, orgFilter])
  useEffect(() => { load() }, [load])

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-ink-400 shrink-0" />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 outline-none focus:ring-2 focus:ring-accent-400"
          >
            {ACTION_GROUPS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <ArrowDownUp className="size-4 text-ink-400 shrink-0" />
          <select
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 outline-none focus:ring-2 focus:ring-accent-400"
          >
            <option value="">All organisations</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>

        <span className="text-xs text-ink-400 ml-auto">
          {total} event{total !== 1 ? 's' : ''}{(actionFilter || orgFilter) ? ' (filtered)' : ''}
        </span>
      </div>

      <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-ink-50">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse">
                <div className="size-8 rounded-full bg-ink-100 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 bg-ink-100 rounded w-1/3" />
                  <div className="h-3 bg-ink-100 rounded w-1/2" />
                </div>
                <div className="h-3 bg-ink-100 rounded w-16" />
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <Activity className="size-9 text-ink-200 mb-3" />
            <p className="text-sm font-semibold text-ink-500">No events found</p>
            <p className="text-xs text-ink-400 mt-1">Try adjusting your filters.</p>
          </div>
        ) : (
          <div className="divide-y divide-ink-50">
            {logs.map((log) => {
              const change = diffLabel(log.diff)
              const orgName = orgs.find((o) => o.id === log.org_id)?.name ?? 'Unknown org'
              return (
                <div key={log.id} className="flex items-start gap-4 px-5 py-4 hover:bg-ink-50/50 transition-colors">
                  <div className="size-8 rounded-full bg-accent-100 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-accent">
                      {(log.user_name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink-800">
                      <span className="font-semibold">{log.user_name}</span>{' '}
                      <span className="font-medium text-ink-700">{ACTION_LABEL[log.action] ?? log.action}</span>{' '}
                      <span className="inline-flex items-center gap-1 text-xs text-p3-dark bg-p3-light rounded-md px-1.5 py-0.5 align-middle">
                        <Building2 className="size-3" /> {orgName}
                      </span>
                    </p>
                    {change && <p className="text-xs text-ink-400 mt-0.5 font-mono truncate">{change}</p>}
                    <p className="text-xs text-ink-400 mt-0.5">{log.user_email}</p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-xs text-ink-400">{relativeTime(log.created_at)}</p>
                    <p className="text-[10px] text-ink-300 mt-0.5">
                      {new Date(log.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-ink-100 bg-ink-50/50">
            <p className="text-xs text-ink-400">
              Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-xs text-ink-500 tabular-nums">{page + 1} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="p-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PlatformAdminPage() {
  const currentUser = useAuthStore((s) => s.user)
  const isSuperAdmin = currentUser?.role === 'super_admin'
  const isPlatformTier = isSuperAdmin || currentUser?.role === 'platform_support'

  const [tab, setTab] = useState<Tab>('organisations')
  const [orgs, setOrgs] = useState<Organisation[]>([])
  const [loading, setLoading] = useState(true)
  const [activeOnly, setActiveOnly] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showCreateOrg, setShowCreateOrg] = useState(false)
  const [showInviteOrg, setShowInviteOrg] = useState(false)

  const loadOrgs = useCallback(async () => {
    try {
      const data = await adminApi.listOrgs({ active_only: activeOnly || undefined })
      setOrgs(data)
    } catch { /* keep prior list on transient failure */ } finally { setLoading(false) }
  }, [activeOnly])

  useEffect(() => { loadOrgs() }, [loadOrgs])

  const handleToggleActive = async (org: Organisation) => {
    setActionLoading(org.id)
    try { await adminApi.updateOrg(org.id, { is_active: !org.is_active }); await loadOrgs() }
    catch { } finally { setActionLoading(null) }
  }

  if (!isPlatformTier) {
    return (
      <div className="p-6 max-w-lg mx-auto text-center py-20">
        <Lock className="size-9 text-ink-200 mx-auto mb-3" />
        <h1 className="font-display text-lg font-bold text-ink-900">Platform console</h1>
        <p className="text-sm text-ink-500 mt-1">
          This area is restricted to platform-level administrators.
        </p>
      </div>
    )
  }

  const activeCount = orgs.filter((o) => o.is_active).length

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">Platform console</h1>
          <p className="text-ink-500 text-sm mt-0.5">
            {orgs.length} organisation{orgs.length !== 1 ? 's' : ''} · {activeCount} active
            {!isSuperAdmin && <span className="text-ink-400"> · read-only</span>}
          </p>
        </div>
        {isSuperAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowInviteOrg(true)}
              className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink-700 hover:bg-ink-50 transition-colors"
            >
              <Mail className="size-4" /> Invite org admin
            </button>
            <button
              onClick={() => setShowCreateOrg(true)}
              className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
            >
              <Plus className="size-4" /> New organisation
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-ink-100 rounded-xl p-1 w-fit">
        {([
          { id: 'organisations' as const, label: 'Organisations' },
          { id: 'audit' as const,         label: 'Audit log' },
        ]).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Organisations tab ── */}
      {tab === 'organisations' && (
        <div className="space-y-3">
          <div className="flex items-center justify-end">
            <label className="flex items-center gap-2 text-sm text-ink-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(e) => setActiveOnly(e.target.checked)}
                className="rounded border-ink-300 text-accent focus:ring-accent-400"
              />
              Active only
            </label>
          </div>

          <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
            {loading ? (
              <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-12 bg-ink-50 rounded-xl animate-pulse" />)}</div>
            ) : orgs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <Building2 className="size-9 text-ink-200 mb-3" />
                <p className="text-sm font-semibold text-ink-500">No organisations yet</p>
                {isSuperAdmin && <p className="text-xs text-ink-400 mt-1">Create one, or invite an org admin to set one up.</p>}
              </div>
            ) : (
              <table className="w-full">
                <thead className="border-b border-ink-100 bg-ink-50">
                  <tr>
                    {['Organisation', 'Industry', 'Locale', 'Status', 'Created', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-50">
                  {orgs.map((org) => (
                    <tr key={org.id} className={!org.is_active ? 'opacity-60' : ''}>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="size-8 rounded-lg bg-p3-light flex items-center justify-center shrink-0">
                            <Building2 className="size-4 text-p3-dark" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-ink-900">{org.name}</p>
                            <p className="text-xs text-ink-400">{org.slug}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5"><p className="text-sm text-ink-600">{org.industry || '—'}</p></td>
                      <td className="px-4 py-3.5"><p className="text-sm text-ink-600 uppercase">{org.locale}</p></td>
                      <td className="px-4 py-3.5">
                        <span className={`flex items-center gap-1.5 text-xs font-medium ${org.is_active ? 'text-p2-dark' : 'text-ink-400'}`}>
                          {org.is_active ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                          {org.is_active ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-xs text-ink-400">
                          {new Date(org.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {!isSuperAdmin ? null : actionLoading === org.id ? (
                          <RefreshCw className="size-4 text-ink-300 animate-spin inline-block" />
                        ) : (
                          <button
                            onClick={() => handleToggleActive(org)}
                            className={`flex items-center gap-1.5 text-xs font-semibold ml-auto ${
                              org.is_active ? 'text-red-500 hover:text-red-700' : 'text-p2-dark hover:text-p2'
                            }`}
                          >
                            {org.is_active ? <ShieldOff className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
                            {org.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Audit log tab ── */}
      {tab === 'audit' && <AuditLogTab orgs={orgs} />}

      {showCreateOrg && <CreateOrgModal onCreated={loadOrgs} onClose={() => setShowCreateOrg(false)} />}
      {showInviteOrg && <InviteOrgAdminModal onInvited={loadOrgs} onClose={() => setShowInviteOrg(false)} />}
    </div>
  )
}