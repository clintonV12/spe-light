import {
  useCallback, useEffect, useRef, useState
} from 'react'
import {
  UserPlus, RefreshCw, MoreHorizontal, ShieldCheck, Shield, Eye,
  Users, Mail, Activity, ChevronLeft, ChevronRight, Filter,
  ArrowDownUp, Building2, Save,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { orgApi, auditApi } from '../api/endpoints'
import { useAuthStore } from '../store/auth'
import { Badge } from '../components/ui'
import InviteUserModal from '../components/admin/InviteUserModal'
import type { User, Invitation, UserRole, AuditLog, AuditAction, Organisation, OrgProfileUpdate } from '../types'

type Tab = 'users' | 'invitations' | 'audit' | 'organisation'

type RoleMeta = { label: string; icon: React.ReactNode; variant: 'neutral' | 'p1' | 'p2' | 'p3' | 'success' }

// Built from t() rather than a module-level constant so labels react to
// language changes; icon/variant stay static, only the label is translated.
function getRoleMeta(t: (key: string) => string): Record<UserRole, RoleMeta> {
  return {
    super_admin:      { label: t('roles.super_admin'),      icon: <ShieldCheck className="size-3.5" />, variant: 'p3' },
    platform_support: { label: t('roles.platform_support'), icon: <Shield className="size-3.5" />,      variant: 'p1' },
    org_admin:        { label: t('roles.org_admin'),        icon: <ShieldCheck className="size-3.5" />, variant: 'p2' },
    planner:          { label: t('roles.planner'),          icon: <Shield className="size-3.5" />,      variant: 'success' },
    contributor:      { label: t('roles.contributor'),      icon: <Users className="size-3.5" />,       variant: 'neutral' },
    viewer:           { label: t('roles.viewer'),            icon: <Eye className="size-3.5" />,        variant: 'neutral' },
  }
}

// ─── Audit helpers ────────────────────────────────────────────────────────────
// Action labels come from t(`auditActions.${action}`) — the AuditAction
// strings (e.g. 'plan.created') map directly onto the nested auditActions.*
// keys in the locale files via i18next's default dot key-separator.

const ACTION_COLOR: Partial<Record<AuditAction, string>> = {
  'plan.deleted':        'text-red-600',
  'activity.deleted':    'text-red-600',
  'user.deactivated':    'text-red-600',
  'plan.created':        'text-p2-dark',
  'activity.created':    'text-p2-dark',
  'plan.archived':       'text-ink-400',
  'activity.status_changed': 'text-accent',
  'user.role_changed':   'text-p3-dark',
  'report.generated':    'text-p1-dark',
}

function getActionGroups(t: (key: string) => string) {
  return [
    { label: t('auditLog.filterAllActions'), value: '' },
    { label: t('auditLog.filterPlans'), value: 'plan' },
    { label: t('auditLog.filterActivities'), value: 'activity' },
    { label: t('auditLog.filterUsers'), value: 'user' },
    { label: t('auditLog.filterInvitations'), value: 'invitation' },
    { label: t('auditLog.filterReports'), value: 'report' },
  ]
}

function diffLabel(diff: AuditLog['diff'], t: (key: string) => string): string | null {
  const keys = Object.keys(diff ?? {})
  if (keys.length === 0) return null
  return keys.map((k) => {
    const { from, to } = diff![k]
    const fromStr = from === null ? t('common.none') : String(from)
    const toStr   = to   === null ? t('common.none') : String(to)
    return `${k}: ${fromStr} → ${toStr}`
  }).join(' · ')
}

function relativeTime(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return t('auditLog.justNow')
  const m = Math.floor(s / 60)
  if (m < 60) return t('auditLog.minutesAgo', { count: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('auditLog.hoursAgo', { count: h })
  const d = Math.floor(h / 24)
  if (d < 7) return t('auditLog.daysAgo', { count: d })
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── User row menu ────────────────────────────────────────────────────────────

function UserRowMenu({ user, currentUserId, onToggleActive, onChangeRole }: {
  user: User; currentUserId: string
  onToggleActive: () => void; onChangeRole: (r: UserRole) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (user.id === currentUserId) return null
  const roles: UserRole[] = ['planner', 'contributor', 'viewer', 'org_admin']
  const roleMeta = getRoleMeta(t)
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="p-1.5 rounded-lg text-ink-300 hover:text-ink-700 hover:bg-ink-50 transition-colors">
        <MoreHorizontal className="size-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-ink-100 bg-white shadow-lg py-1">
            <p className="px-3 py-1.5 text-xs font-semibold text-ink-400 uppercase tracking-wide">{t('admin.changeRole')}</p>
            {roles.map((r) => (
              <button key={r} onClick={() => { onChangeRole(r); setOpen(false) }}
                className={`flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors ${user.role === r ? 'text-accent bg-accent-50' : 'text-ink-700 hover:bg-ink-50'}`}
              >
                {roleMeta[r].icon} {roleMeta[r].label}
              </button>
            ))}
            <div className="my-1 border-t border-ink-100" />
            <button onClick={() => { onToggleActive(); setOpen(false) }}
              className={`flex items-center gap-2 w-full px-3 py-2 text-sm ${user.is_active ? 'text-red-600 hover:bg-red-50' : 'text-p2-dark hover:bg-p2-light'}`}
            >
              {user.is_active ? t('admin.deactivateUser') : t('admin.reactivateUser')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Audit log tab ────────────────────────────────────────────────────────────

function AuditLogTab({ users }: { users: User[] }) {
  const { t } = useTranslation()
  const ACTION_GROUPS = getActionGroups(t)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [actionFilter, setActionFilter] = useState('')
  const [userFilter, setUserFilter] = useState('')
  const limit = 10

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await auditApi.list({
        action: actionFilter || undefined,
        user_id: userFilter || undefined,
        limit,
        offset: page * limit,
      })
      setLogs(result.logs)
      setTotal(result.total)
    } catch { } finally { setLoading(false) }
  }, [page, actionFilter, userFilter])

  useEffect(() => { setPage(0) }, [actionFilter, userFilter])
  useEffect(() => { load() }, [load])

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-4">
      {/* Filters row */}
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
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 outline-none focus:ring-2 focus:ring-accent-400"
          >
            <option value="">{t('auditLog.allMembers')}</option>
            {users.filter((u) => u.is_active).map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>

        <span className="text-xs text-ink-400 ml-auto">
          {t('auditLog.eventsCount', { count: total })}
          {(actionFilter || userFilter) ? t('auditLog.filtered') : ''}
        </span>
      </div>

      {/* Log entries */}
      <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-ink-50">
            {[1,2,3,4,5].map((i) => (
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
            <p className="text-sm font-semibold text-ink-500">{t('auditLog.noEventsFound')}</p>
            <p className="text-xs text-ink-400 mt-1">{t('auditLog.adjustFilters')}</p>
          </div>
        ) : (
          <div className="divide-y divide-ink-50">
            {logs.map((log) => {
              const actionColor = ACTION_COLOR[log.action] ?? 'text-ink-700'
              const change = diffLabel(log.diff, t)
              // Some audit actions (e.g. invitation.accepted) aren't
              // guaranteed to have a denormalised user_name/record_label
              // from the backend yet — fall back rather than crash.
              const userName    = log.user_name || t('auditLog.unknownUser')
              const recordLabel = log.record_label || '—'
              return (
                <div key={log.id} className="flex items-start gap-4 px-5 py-4 hover:bg-ink-50/50 transition-colors">
                  {/* Avatar */}
                  <div className="size-8 rounded-full bg-accent-100 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-accent">
                      {userName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Action line */}
                    <p className="text-sm text-ink-800">
                      <span className="font-semibold">{userName}</span>
                      {' '}
                      <span className={`font-medium ${actionColor}`}>
                        {t(`auditActions.${log.action}`, log.action)}
                      </span>
                      {' '}
                      <span className="text-ink-500 italic truncate">"{recordLabel}"</span>
                    </p>

                    {/* Diff / change detail */}
                    {change && (
                      <p className="text-xs text-ink-400 mt-0.5 font-mono truncate">{change}</p>
                    )}

                    {/* Email */}
                    <p className="text-xs text-ink-400 mt-0.5">{log.user_email}</p>
                  </div>

                  {/* Timestamp */}
                  <div className="text-right shrink-0">
                    <p className="text-xs text-ink-400">{relativeTime(log.created_at, t)}</p>
                    <p className="text-[10px] text-ink-300 mt-0.5">
                      {new Date(log.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-ink-100 bg-ink-50/50">
            <p className="text-xs text-ink-400">
              {t('auditLog.showing', { from: page * limit + 1, to: Math.min((page + 1) * limit, total), total })}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-xs text-ink-500 tabular-nums">{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-1.5 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Organisation profile tab ─────────────────────────────────────────────────
//
// Lets an org_admin fill in descriptive info about their own organisation —
// address, country, contact info, industry, org structure, and total
// member count. This isn't just a display profile: the backend folds it
// into every AI draft/summary/suggest-links prompt (see aisvc's use of
// orgsvc-backed context) so AI output is grounded in what the organisation
// actually is, instead of just the plan text. Fields are entirely optional;
// leaving them blank just means the AI prompts carry less context, nothing
// breaks.

type OrgProfileForm = {
  industry:       string
  address:        string
  country:        string
  contact_email:  string
  contact_phone:  string
  org_structure:  string
  total_members:  string
}

const emptyOrgForm: OrgProfileForm = {
  industry: '', address: '', country: '', contact_email: '',
  contact_phone: '', org_structure: '', total_members: '',
}

function orgToForm(org: Organisation): OrgProfileForm {
  return {
    industry:      org.industry ?? '',
    address:       org.address ?? '',
    country:       org.country ?? '',
    contact_email: org.contact_email ?? '',
    contact_phone: org.contact_phone ?? '',
    org_structure: org.org_structure ?? '',
    total_members: org.total_members !== undefined ? String(org.total_members) : '',
  }
}

function OrganisationTab() {
  const { t } = useTranslation()
  const [org, setOrg] = useState<Organisation | null>(null)
  const [form, setForm] = useState<OrgProfileForm>(emptyOrgForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await orgApi.getOrg()
      setOrg(data)
      setForm(orgToForm(data))
    } catch {
      setError(t('admin.organisation.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  const handleChange = (field: keyof OrgProfileForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false)
    setForm((f) => ({ ...f, [field]: e.target.value }))
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload: OrgProfileUpdate = {
        industry:      form.industry || undefined,
        address:       form.address || undefined,
        country:       form.country || undefined,
        contact_email: form.contact_email || undefined,
        contact_phone: form.contact_phone || undefined,
        org_structure: form.org_structure || undefined,
        total_members: form.total_members ? Number(form.total_members) : undefined,
      }
      const updated = await orgApi.updateOrg(payload)
      setOrg(updated)
      setForm(orgToForm(updated))
      setSaved(true)
    } catch {
      setError(t('admin.organisation.saveError'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-ink-100 p-6 space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-ink-50 rounded-xl animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-ink-100 p-6 max-w-2xl">
      <div className="flex items-center gap-2 mb-1">
        <Building2 className="size-5 text-ink-400" />
        <h2 className="font-display text-lg font-bold text-ink-900">{org?.name ?? t('admin.organisation.title')}</h2>
      </div>
      <p className="text-ink-500 text-sm mb-6">{t('admin.organisation.description')}</p>

      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('admin.organisation.industry')}>
            <input value={form.industry} onChange={handleChange('industry')}
              className="w-full rounded-xl border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-200" />
          </Field>
          <Field label={t('admin.organisation.totalMembers')}>
            <input type="number" min={0} value={form.total_members} onChange={handleChange('total_members')}
              className="w-full rounded-xl border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-200" />
          </Field>
        </div>

        <Field label={t('admin.organisation.address')}>
          <input value={form.address} onChange={handleChange('address')}
            className="w-full rounded-xl border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-200" />
        </Field>

        <Field label={t('admin.organisation.country')}>
          <input value={form.country} onChange={handleChange('country')}
            className="w-full rounded-xl border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-200" />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t('admin.organisation.contactEmail')}>
            <input type="email" value={form.contact_email} onChange={handleChange('contact_email')}
              className="w-full rounded-xl border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-200" />
          </Field>
          <Field label={t('admin.organisation.contactPhone')}>
            <input type="tel" value={form.contact_phone} onChange={handleChange('contact_phone')}
              className="w-full rounded-xl border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-200" />
          </Field>
        </div>

        <Field label={t('admin.organisation.orgStructure')} hint={t('admin.organisation.orgStructureHint')}>
          <textarea rows={3} value={form.org_structure} onChange={handleChange('org_structure')}
            className="w-full rounded-xl border border-ink-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-200" />
        </Field>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors disabled:opacity-60">
            <Save className="size-4" /> {saving ? t('common.saving') : t('common.save')}
          </button>
          {saved && !saving && <span className="text-sm text-p2-dark">{t('admin.organisation.saved')}</span>}
        </div>
      </form>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink-400 mt-1">{hint}</span>}
    </label>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { t } = useTranslation()
  const roleMeta = getRoleMeta(t)
  const currentUser = useAuthStore((s) => s.user)
  const [searchParams, setSearchParams] = useSearchParams()
  const paramTab = searchParams.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(paramTab ?? 'users')

  // Sync tab state when URL param changes (e.g. navigating from dashboard feed)
  const prevParam = useRef(paramTab)
  useEffect(() => {
    if (paramTab && paramTab !== prevParam.current) {
      setTab(paramTab)
      prevParam.current = paramTab
    }
  }, [paramTab])
  const [users, setUsers] = useState<User[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const loadUsers = async () => {
    try {
      const [u, inv] = await Promise.all([orgApi.listUsers(), orgApi.listInvitations()])
      setUsers(u); setInvitations(inv)
    } catch { } finally { setLoading(false) }
  }

  useEffect(() => { loadUsers() }, [])

  const handleToggleActive = async (user: User) => {
    setActionLoading(user.id)
    try { await orgApi.updateUser(user.id, { is_active: !user.is_active }); await loadUsers() }
    catch { } finally { setActionLoading(null) }
  }

  const handleChangeRole = async (user: User, role: UserRole) => {
    setActionLoading(user.id)
    try { await orgApi.updateUser(user.id, { role }); await loadUsers() }
    catch { } finally { setActionLoading(null) }
  }

  const handleCancelInvite = async (inv: Invitation) => {
    setActionLoading(inv.id)
    try { await orgApi.cancelInvitation(inv.id); await loadUsers() }
    catch { } finally { setActionLoading(null) }
  }

  const handleResendInvite = async (inv: Invitation) => {
    setActionLoading(inv.id)
    try { await orgApi.resendInvitation(inv.id); await loadUsers() }
    catch { } finally { setActionLoading(null) }
  }

  const pendingInvitations = invitations.filter((i) => i.status === 'pending')

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'users',        label: t('admin.tabs.members'),      count: users.length },
    { id: 'invitations',  label: t('admin.tabs.invitations'),  count: pendingInvitations.length },
    { id: 'audit',        label: t('admin.tabs.auditLog') },
    { id: 'organisation', label: t('admin.tabs.organisation') },
  ]

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink-900">{t('admin.title')}</h1>
          <p className="text-ink-500 text-sm mt-0.5">
            {t('admin.membersCount', { count: users.length })} · {t('admin.pendingInvitesCount', { count: pendingInvitations.length })}
          </p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
        >
          <UserPlus className="size-4" /> {t('admin.inviteMember')}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-ink-100 rounded-xl p-1 w-fit">
        {TABS.map(({ id, label, count }) => (
          <button
            key={id}
            onClick={() => {
              setTab(id)
              setSearchParams(id !== 'users' ? { tab: id } : {})
            }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
            }`}
          >
            {label}
            {count !== undefined && count > 0 && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                tab === id ? 'bg-accent-100 text-accent' : 'bg-ink-200 text-ink-500'
              }`}>{count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Users tab ── */}
      {tab === 'users' && (
        <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">{[1,2,3].map((i) => <div key={i} className="h-12 bg-ink-50 rounded-xl animate-pulse" />)}</div>
          ) : (
            <table className="w-full">
              <thead className="border-b border-ink-100 bg-ink-50">
                <tr>
                  {[t('admin.table.member'), t('admin.table.role'), t('admin.table.status'), ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {users.map((user) => {
                  const userRoleMeta = roleMeta[user.role]
                  const isSelf = user.id === currentUser?.id
                  return (
                    <tr key={user.id} className={!user.is_active ? 'opacity-50' : ''}>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="size-8 rounded-full bg-accent-100 flex items-center justify-center shrink-0">
                            <span className="text-xs font-bold text-accent">
                              {user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-ink-900">
                              {user.name} {isSelf && <span className="text-ink-400 font-normal">{t('admin.you')}</span>}
                            </p>
                            <p className="text-xs text-ink-400">{user.email}</p>
                            {user.plan_ids && user.plan_ids.length > 0 && (
                              <p className="text-[10px] text-p3-dark mt-0.5">
                                {t('admin.scopedToPlans', { count: user.plan_ids.length })}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge variant={userRoleMeta.variant}>
                          <span className="flex items-center gap-1">{userRoleMeta.icon} {userRoleMeta.label}</span>
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`text-xs font-medium ${user.is_active ? 'text-p2-dark' : 'text-ink-400'}`}>
                          {user.is_active ? t('admin.status.active') : t('admin.status.deactivated')}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {actionLoading === user.id
                          ? <RefreshCw className="size-4 text-ink-300 animate-spin inline-block" />
                          : <UserRowMenu user={user} currentUserId={currentUser?.id ?? ''} onToggleActive={() => handleToggleActive(user)} onChangeRole={(r) => handleChangeRole(user, r)} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Invitations tab ── */}
      {tab === 'invitations' && (
        <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">{[1,2].map((i) => <div key={i} className="h-12 bg-ink-50 rounded-xl animate-pulse" />)}</div>
          ) : invitations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <Mail className="size-9 text-ink-200 mb-3" />
              <p className="text-sm font-semibold text-ink-500">{t('admin.noInvitations')}</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="border-b border-ink-100 bg-ink-50">
                <tr>
                  {[t('admin.table.email'), t('admin.table.role'), t('admin.table.status'), t('admin.table.expires'), ''].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {invitations.map((inv) => {
                  const invRoleMeta = roleMeta[inv.role]
                  const isPending = inv.status === 'pending'
                  const expired = new Date(inv.expires_at) < new Date()
                  return (
                    <tr key={inv.id} className={!isPending ? 'opacity-60' : ''}>
                      <td className="px-4 py-3.5"><p className="text-sm text-ink-800">{inv.email}</p></td>
                      <td className="px-4 py-3.5"><Badge variant={invRoleMeta.variant}>{invRoleMeta.label}</Badge></td>
                      <td className="px-4 py-3.5">
                        <span className={`text-xs font-medium capitalize ${
                          inv.status === 'accepted' ? 'text-p2-dark'
                          : inv.status === 'pending' && !expired ? 'text-p1-dark'
                          : 'text-ink-400'
                        }`}>{expired && isPending ? t('admin.status.expired') : t(`admin.status.${inv.status}`, inv.status)}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-xs text-ink-400">{new Date(inv.expires_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</p>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {actionLoading === inv.id
                          ? <RefreshCw className="size-4 text-ink-300 animate-spin inline-block" />
                          : isPending ? (
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => handleResendInvite(inv)} className="text-xs text-accent hover:text-accent-700 font-medium">{t('common.resend')}</button>
                              <button onClick={() => handleCancelInvite(inv)} className="text-xs text-red-500 hover:text-red-700 font-medium">{t('common.cancel')}</button>
                            </div>
                          ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Audit log tab ── */}
      {tab === 'audit' && <AuditLogTab users={users} />}

      {/* ── Organisation profile tab ── */}
      {tab === 'organisation' && <OrganisationTab />}

      {showInvite && <InviteUserModal onInvited={loadUsers} onClose={() => setShowInvite(false)} />}
    </div>
  )
}