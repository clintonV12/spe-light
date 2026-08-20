import { useCallback, useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import {
  Building2, Plus, Mail, ShieldCheck, ShieldOff, CheckCircle2, XCircle,
  RefreshCw, Filter, ArrowDownUp, ChevronLeft, ChevronRight, Activity, X, Lock,
  Users, Send, Clock3, Trash2, UserCog, FileText, ListChecks, FileOutput, TrendingUp,
  Eye, AlertTriangle, LayoutDashboard,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { adminApi } from '../api/endpoints'
import type { PlatformStats, OrgDetail } from '../api/endpoints'
import { useAuthStore } from '../store/auth'
import type { Organisation, AuditLog, AuditAction, User, Invitation, UserRole } from '../types'

type Tab = 'dashboard' | 'organisations' | 'team' | 'invitations' | 'audit'

// ─── Shared display maps ───────────────────────────────────────────────────
// Action labels come from t(`auditActions.${action}`) — the AuditAction
// strings (e.g. 'plan.created') map directly onto the nested auditActions.*
// keys in the locale files via i18next's default dot key-separator.

function getActionGroups(t: (key: string) => string) {
  return [
    { label: t('auditLog.filterAllActions'), value: '' },
    { label: t('auditLog.filterPlans'),       value: 'plan' },
    { label: t('auditLog.filterActivities'),  value: 'activity' },
    { label: t('auditLog.filterUsers'),       value: 'user' },
    { label: t('auditLog.filterInvitations'), value: 'invitation' },
    { label: t('auditLog.filterReports'),     value: 'report' },
  ]
}

function getPlatformRoleMeta(t: (key: string) => string): Record<'super_admin' | 'platform_support' | 'advisor', { label: string; className: string }> {
  return {
    super_admin:      { label: t('roles.super_admin'),      className: 'bg-accent-100 text-accent-700' },
    platform_support: { label: t('roles.platform_support'), className: 'bg-p3-light text-p3-dark' },
    advisor:          { label: t('roles.advisor'),          className: 'bg-p1-light text-p1-dark' },
  }
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

function diffLabel(diff: AuditLog['diff'], t: (key: string) => string): string | null {
  const keys = Object.keys(diff ?? {})
  if (keys.length === 0) return null
  return keys.map((k) => {
    const { from, to } = diff[k]
    const fromStr = from === null || from === undefined ? t('common.none') : String(from)
    const toStr   = to   === null || to   === undefined ? t('common.none') : String(to)
    return `${k}: ${fromStr} → ${toStr}`
  }).join(' · ')
}

// ─── Platform overview stats ────────────────────────────────────────────────
//
// Cross-organisation counts (GET /api/v1/admin/stats — see adminsvc.GetStats)
// shown above the tabs regardless of which tab is active, since this is the
// "how is the platform doing" snapshot a super_admin/platform_support user
// wants immediately on landing here, not buried behind a click.

const STAT_ACCENTS = {
  ink:    'bg-ink-100 text-ink-500',
  accent: 'bg-accent-50 text-accent-700',
  p1:     'bg-p1-light text-p1-dark',
  p2:     'bg-p2-light text-p2-dark',
  p3:     'bg-p3-light text-p3-dark',
} as const

function StatCard({ icon: Icon, label, value, sub, accent = 'ink' }: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: number | string
  sub?: string
  accent?: keyof typeof STAT_ACCENTS
}) {
  return (
    <div className="bg-white rounded-2xl border border-ink-100 p-4 hover:border-ink-200 transition-colors">
      <div className={`inline-flex items-center justify-center size-8 rounded-xl mb-3 ${STAT_ACCENTS[accent]}`}>
        <Icon className="size-4" />
      </div>
      <p className="font-display text-2xl font-bold text-ink-900 tabular-nums leading-none">{value}</p>
      <p className="text-xs font-medium text-ink-500 mt-1.5">{label}</p>
      {sub && <p className="text-[11px] text-ink-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function StatsOverview() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminApi.getStats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="h-[86px] bg-white rounded-2xl border border-ink-100 animate-pulse" />
        ))}
      </div>
    )
  }
  if (!stats) return null

  const pendingInvitesTotal = stats.pending_org_invitations + stats.pending_platform_invitations

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        icon={Building2}
        accent="p3"
        label={t('platformAdmin.stats.organisations', 'Organisations')}
        value={stats.orgs_total}
        sub={t('platformAdmin.stats.organisationsSub', '{{active}} active', { active: stats.orgs_active }) as string}
      />
      <StatCard
        icon={Users}
        accent="accent"
        label={t('platformAdmin.stats.users', 'Users')}
        value={stats.org_users_total + stats.platform_team_total}
        sub={t('platformAdmin.stats.usersSub', '{{team}} platform team', { team: stats.platform_team_total }) as string}
      />
      <StatCard
        icon={FileText}
        accent="p2"
        label={t('platformAdmin.stats.plans', 'Plans')}
        value={stats.plans_total}
        sub={t('platformAdmin.stats.plansSub', '{{active}} active', { active: stats.plans_active }) as string}
      />
      <StatCard
        icon={ListChecks}
        accent="p1"
        label={t('platformAdmin.stats.activities', 'Activities')}
        value={stats.activities_total}
      />
      <StatCard
        icon={FileOutput}
        accent="ink"
        label={t('platformAdmin.stats.reports', 'Reports Generated')}
        value={stats.reports_generated_total}
      />
      <StatCard
        icon={TrendingUp}
        accent="p2"
        label={t('platformAdmin.stats.newOrgs', 'New Orgs (30d)')}
        value={stats.orgs_new_last_30_days}
      />
      <StatCard
        icon={Clock3}
        accent="p1"
        label={t('platformAdmin.stats.pendingInvites', 'Pending Invites')}
        value={pendingInvitesTotal}
        sub={t('platformAdmin.stats.pendingInvitesSub', '{{org}} org · {{platform}} platform', {
          org: stats.pending_org_invitations, platform: stats.pending_platform_invitations,
        }) as string}
      />
    </div>
  )
}

// ─── Quick-action shortcut card (Dashboard tab) ────────────────────────────

function ShortcutCard({ icon: Icon, title, description, onClick, accent = 'ink' }: {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  onClick: () => void
  accent?: keyof typeof STAT_ACCENTS
}) {
  const { t } = useTranslation()
  return (
    <button
      onClick={onClick}
      className="group flex flex-col gap-3 rounded-2xl border border-ink-100 bg-white p-5 text-left hover:border-accent-200 hover:shadow-sm transition-all"
    >
      <div className={`inline-flex items-center justify-center size-10 rounded-xl ${STAT_ACCENTS[accent]}`}>
        <Icon className="size-5" />
      </div>
      <div>
        <p className="text-sm font-semibold text-ink-900">{title}</p>
        <p className="text-xs text-ink-400 mt-0.5">{description}</p>
      </div>
      <span className="flex items-center gap-1 text-xs font-medium text-accent opacity-0 group-hover:opacity-100 transition-opacity">
        {t('common.view', 'View')} <ChevronRight className="size-3.5" />
      </span>
    </button>
  )
}

// ─── Organisation detail modal ─────────────────────────────────────────────
//
// The platform admin's drill-into-one-org view: full profile (including the
// self-service fields an org_admin fills in via PATCH /api/v1/org — address,
// contacts, industry, structure, member count) plus summary counts, with
// activate/deactivate and delete available right from here too.

function OrgDetailField({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-ink-50 last:border-0">
      <span className="text-xs font-medium text-ink-400 shrink-0">{label}</span>
      <span className="text-sm text-ink-800 text-right">{value}</span>
    </div>
  )
}

function OrgDetailModal({ orgId, onClose, onChanged }: {
  orgId: string
  onClose: () => void
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const currentUser = useAuthStore((s) => s.user)
  const isSuperAdmin = currentUser?.role === 'super_admin'

  const [detail, setDetail] = useState<OrgDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminApi.getOrgDetail(orgId)
      setDetail(data)
    } catch {
      setError(t('platformAdmin.detail.loadError'))
    } finally {
      setLoading(false)
    }
  }, [orgId, t])

  useEffect(() => { load() }, [load])

  const handleToggleActive = async () => {
    if (!detail) return
    setActionLoading(true)
    try {
      const updated = await adminApi.updateOrg(detail.id, { is_active: !detail.is_active })
      setDetail({ ...detail, ...updated })
      onChanged()
    } catch { } finally { setActionLoading(false) }
  }

  const handleDelete = async () => {
    if (!detail) return
    setActionLoading(true)
    setError(null)
    try {
      await adminApi.deleteOrg(detail.id)
      onChanged()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('platformAdmin.detail.deleteError'))
      setConfirmDelete(false)
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-ink-100 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6">
          <h2 className="font-display text-lg font-bold text-ink-900">{t('platformAdmin.detail.title')}</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700">
            <X className="size-5" />
          </button>
        </div>

        <div className="px-6 pb-6">
          {loading ? (
            <div className="space-y-2 pt-4">
              {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-8 bg-ink-50 rounded-lg animate-pulse" />)}
            </div>
          ) : !detail ? (
            <p className="text-sm text-red-600 pt-4">{error ?? t('platformAdmin.detail.loadError')}</p>
          ) : (
            <>
              <div className="flex items-center gap-3 pt-4 pb-2">
                <div className="size-10 rounded-lg bg-p3-light flex items-center justify-center shrink-0">
                  <Building2 className="size-5 text-p3-dark" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-ink-900 truncate">{detail.name}</p>
                  <p className="text-xs text-ink-400">{detail.slug}</p>
                </div>
                <span className={`ml-auto shrink-0 flex items-center gap-1.5 text-xs font-medium ${detail.is_active ? 'text-p2-dark' : 'text-ink-400'}`}>
                  {detail.is_active ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                  {detail.is_active ? t('platformAdmin.status.active') : t('platformAdmin.status.deactivated')}
                </span>
              </div>

              {/* Summary counts */}
              <div className="grid grid-cols-3 gap-2 py-3">
                <div className="rounded-xl bg-ink-50 px-3 py-2 text-center">
                  <p className="font-display text-lg font-bold text-ink-900 tabular-nums">{detail.user_count}</p>
                  <p className="text-[11px] text-ink-400">{t('platformAdmin.detail.users')}</p>
                </div>
                <div className="rounded-xl bg-ink-50 px-3 py-2 text-center">
                  <p className="font-display text-lg font-bold text-ink-900 tabular-nums">{detail.plan_count}</p>
                  <p className="text-[11px] text-ink-400">{t('platformAdmin.detail.plans')}</p>
                </div>
                <div className="rounded-xl bg-ink-50 px-3 py-2 text-center">
                  <p className="font-display text-lg font-bold text-ink-900 tabular-nums">{detail.active_plan_count}</p>
                  <p className="text-[11px] text-ink-400">{t('platformAdmin.detail.activePlans')}</p>
                </div>
              </div>

              {/* Profile fields */}
              <div className="pt-1">
                <OrgDetailField label={t('platformAdmin.detail.industry')} value={detail.industry} />
                <OrgDetailField label={t('platformAdmin.detail.locale')} value={detail.locale?.toUpperCase()} />
                <OrgDetailField label={t('platformAdmin.detail.totalMembers')} value={detail.total_members} />
                <OrgDetailField label={t('platformAdmin.detail.address')} value={detail.address} />
                <OrgDetailField label={t('platformAdmin.detail.country')} value={detail.country} />
                <OrgDetailField label={t('platformAdmin.detail.contactEmail')} value={detail.contact_email} />
                <OrgDetailField label={t('platformAdmin.detail.contactPhone')} value={detail.contact_phone} />
                <OrgDetailField label={t('platformAdmin.detail.orgStructure')} value={detail.org_structure} />
                <OrgDetailField
                  label={t('platformAdmin.detail.created')}
                  value={new Date(detail.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                />
              </div>

              {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

              {isSuperAdmin && (
                <div className="flex flex-col gap-2 pt-5 mt-2 border-t border-ink-100">
                  {!confirmDelete ? (
                    <>
                      <button
                        onClick={handleToggleActive}
                        disabled={actionLoading}
                        className={`flex items-center justify-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
                          detail.is_active
                            ? 'border-red-200 text-red-600 hover:bg-red-50'
                            : 'border-p2-light text-p2-dark hover:bg-p2-light'
                        }`}
                      >
                        {detail.is_active ? <ShieldOff className="size-4" /> : <ShieldCheck className="size-4" />}
                        {detail.is_active ? t('platformAdmin.deactivate') : t('platformAdmin.activate')}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(true)}
                        disabled={detail.is_active || actionLoading}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-ink-200 px-4 py-2.5 text-sm font-semibold text-ink-400 enabled:hover:text-red-600 enabled:hover:border-red-200 enabled:hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="size-4" /> {t('platformAdmin.detail.deleteOrg')}
                      </button>
                      {detail.is_active && (
                        <p className="text-xs text-ink-400 text-center">{t('platformAdmin.detail.deactivateFirst')}</p>
                      )}
                    </>
                  ) : (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
                      <div className="flex items-start gap-2.5 text-sm text-red-800">
                        <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                        <span>{t('platformAdmin.detail.deleteConfirmDesc', { name: detail.name })}</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConfirmDelete(false)}
                          className="flex-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50"
                        >
                          {t('common.cancel')}
                        </button>
                        <button
                          onClick={handleDelete}
                          disabled={actionLoading}
                          className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {actionLoading ? t('platformAdmin.detail.deleting') : t('platformAdmin.detail.deleteConfirm')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Delete organisation confirm modal (row-level quick action) ───────────

function DeleteOrgConfirmModal({ org, onClose, onDeleted }: {
  org: Organisation
  onClose: () => void
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    setLoading(true)
    setError(null)
    try {
      await adminApi.deleteOrg(org.id)
      onDeleted()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('platformAdmin.detail.deleteError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-ink-100 shadow-xl p-6 space-y-4">
        <div className="size-12 rounded-full bg-red-100 flex items-center justify-center">
          <Trash2 className="size-5 text-red-600" />
        </div>
        <div>
          <h3 className="font-display font-bold text-ink-900">{t('platformAdmin.detail.deleteConfirmTitle')}</h3>
          <p className="text-sm text-ink-500 mt-1">{t('platformAdmin.detail.deleteConfirmDesc', { name: org.name })}</p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 rounded-xl border border-ink-200 px-4 py-2.5 text-sm font-semibold text-ink-700 hover:bg-ink-50 transition-colors">{t('common.cancel')}</button>
          <button onClick={handleDelete} disabled={loading} className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50">
            {loading ? t('platformAdmin.detail.deleting') : t('platformAdmin.detail.deleteConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Create organisation modal ─────────────────────────────────────────────

function CreateOrgModal({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState('')
  const [locale, setLocale] = useState('en')
  const [adminEmail, setAdminEmail] = useState('')
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
        admin_email: adminEmail.trim() || undefined,
      })
      onCreated()
      onClose()
    } catch {
      setError(
        adminEmail.trim()
          ? t('platformAdmin.createOrgModal.errorWithEmail')
          : t('platformAdmin.createOrgModal.errorWithoutEmail'),
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-bold text-ink-900">{t('platformAdmin.createOrgModal.title')}</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 transition-colors"><X className="size-4" /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-ink-700">{t('platformAdmin.createOrgModal.name')}</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('platformAdmin.createOrgModal.namePlaceholder')}
              className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink-700">{t('platformAdmin.createOrgModal.industry')}</label>
              <input
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder={t('platformAdmin.createOrgModal.industryPlaceholder')}
                className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink-700">{t('platformAdmin.createOrgModal.locale')}</label>
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

          <div className="space-y-1.5 pt-1 border-t border-ink-100">
            <label className="block text-sm font-medium text-ink-700 pt-3">{t('platformAdmin.createOrgModal.inviteAdminLabel')}</label>
            <input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder={t('platformAdmin.createOrgModal.adminEmailPlaceholder')}
              className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent"
            />
          </div>

          <p className="text-xs text-ink-400">
            {adminEmail.trim()
              ? t('platformAdmin.createOrgModal.noteWithEmail')
              : t('platformAdmin.createOrgModal.noteWithoutEmail')}
          </p>

          {error && <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-ink-600 hover:bg-ink-50 transition-colors">{t('common.cancel')}</button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
              {t('platformAdmin.createOrgModal.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Invite org admin modal ─────────────────────────────────────────────────
//
// Targets an existing organisation — orgs must be created first (via
// CreateOrgModal) so this can never fabricate a new org from typed text.

function InviteOrgAdminModal({ orgs, onInvited, onClose }: { orgs: Organisation[]; onInvited: () => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? '')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orgId || !email.trim()) return
    setLoading(true)
    setError('')
    try {
      await adminApi.sendOrgInvitation({ email: email.trim(), org_id: orgId })
      onInvited()
      onClose()
    } catch {
      setError(t('platformAdmin.inviteOrgAdminModal.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-bold text-ink-900">{t('platformAdmin.inviteOrgAdminModal.title')}</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 transition-colors"><X className="size-4" /></button>
        </div>

        {orgs.length === 0 ? (
          <p className="text-sm text-ink-500">
            {t('platformAdmin.inviteOrgAdminModal.noOrgs')}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink-700">{t('platformAdmin.inviteOrgAdminModal.organisation')}</label>
              <select
                autoFocus
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-accent-400"
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}{!o.is_active ? t('platformAdmin.inviteOrgAdminModal.inactiveSuffix') : ''}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink-700">{t('platformAdmin.inviteOrgAdminModal.adminEmail')}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('platformAdmin.inviteOrgAdminModal.emailPlaceholder')}
                className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent"
              />
            </div>

            <p className="text-xs text-ink-400">
              {t('platformAdmin.inviteOrgAdminModal.note')}
            </p>

            {error && <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700">{error}</div>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-ink-600 hover:bg-ink-50 transition-colors">{t('common.cancel')}</button>
              <button
                type="submit"
                disabled={loading || !orgId || !email.trim()}
                className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                {t('platformAdmin.inviteOrgAdminModal.submit')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ─── Invite platform teammate modal ─────────────────────────────────────────

function InviteTeamModal({ onInvited, onClose }: { onInvited: () => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'platform_support' | 'super_admin' | 'advisor'>('platform_support')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')
    try {
      await adminApi.invitePlatformUser({ email: email.trim(), role: role as UserRole })
      onInvited()
      onClose()
    } catch {
      setError(t('platformAdmin.inviteTeamModal.error'))
    } finally {
      setLoading(false)
    }
  }

  const platformRoleMeta = getPlatformRoleMeta(t)

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-bold text-ink-900">{t('platformAdmin.inviteTeamModal.title')}</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 transition-colors"><X className="size-4" /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-ink-700">{t('platformAdmin.inviteTeamModal.email')}</label>
            <input
              autoFocus
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('platformAdmin.inviteTeamModal.emailPlaceholder')}
              className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 outline-none focus:ring-2 focus:ring-accent-400 focus:border-transparent"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-ink-700">{t('platformAdmin.inviteTeamModal.platformRole')}</label>
            <div className="grid grid-cols-3 gap-2">
              {(['platform_support', 'super_admin', 'advisor'] as const).map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => setRole(r)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    role === r ? 'border-accent bg-accent-50' : 'border-ink-100 hover:border-ink-200 hover:bg-ink-50'
                  }`}
                >
                  <p className={`text-sm font-semibold ${role === r ? 'text-accent' : 'text-ink-800'}`}>
                    {platformRoleMeta[r].label}
                  </p>
                  <p className="text-xs text-ink-400 mt-0.5">
                    {r === 'platform_support'
                      ? t('platformAdmin.inviteTeamModal.platformSupportDesc')
                      : r === 'super_admin'
                      ? t('platformAdmin.inviteTeamModal.superAdminDesc')
                      : t('platformAdmin.inviteTeamModal.advisorDesc', 'Acts as org_admin inside any organisation it selects — no platform console access.')}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-ink-400">
            {t('platformAdmin.inviteTeamModal.note')}
          </p>

          {error && <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-ink-600 hover:bg-ink-50 transition-colors">{t('common.cancel')}</button>
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
              {t('platformAdmin.inviteTeamModal.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Platform team tab ───────────────────────────────────────────────────────

function TeamTab() {
  const { t } = useTranslation()
  const platformRoleMeta = getPlatformRoleMeta(t)
  const currentUser = useAuthStore((s) => s.user)
  const isSuperAdmin = currentUser?.role === 'super_admin'

  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const u = await adminApi.listPlatformUsers()
      setUsers(u)
    } catch { /* keep prior state */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleToggleActive = async (u: User) => {
    setActionLoading(u.id)
    try { await adminApi.updatePlatformUser(u.id, { is_active: !u.is_active }); await load() }
    catch { } finally { setActionLoading(null) }
  }

  const handleRoleChange = async (u: User, role: UserRole) => {
    setActionLoading(u.id)
    try { await adminApi.updatePlatformUser(u.id, { role }); await load() }
    catch { } finally { setActionLoading(null) }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-ink-800 mb-3">{t('platformAdmin.team.membersHeading')}</h3>
      <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">{[1, 2].map((i) => <div key={i} className="h-12 bg-ink-50 rounded-xl animate-pulse" />)}</div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="size-8 text-ink-200 mb-2" />
            <p className="text-sm font-semibold text-ink-500">{t('platformAdmin.team.noMembers')}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b border-ink-100 bg-ink-50">
              <tr>
                {[t('platformAdmin.table.name'), t('platformAdmin.table.role'), t('platformAdmin.table.status'), t('platformAdmin.table.lastLogin'), ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-50">
              {users.map((u) => {
                const meta = platformRoleMeta[u.role as 'super_admin' | 'platform_support' | 'advisor']
                const isSelf = u.id === currentUser?.id
                return (
                  <tr key={u.id} className={!u.is_active ? 'opacity-60' : ''}>
                    <td className="px-4 py-3.5">
                      <p className="text-sm font-medium text-ink-900">{u.name} {isSelf && <span className="text-ink-400 font-normal">{t('admin.you')}</span>}</p>
                      <p className="text-xs text-ink-400">{u.email}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      {isSuperAdmin && !isSelf ? (
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u, e.target.value as UserRole)}
                          className={`text-xs font-semibold rounded-lg px-2 py-1 outline-none cursor-pointer ${meta?.className ?? 'bg-ink-100 text-ink-600'}`}
                        >
                          <option value="platform_support">{t('roles.platform_support')}</option>
                          <option value="super_admin">{t('roles.super_admin')}</option>
                          <option value="advisor">{t('roles.advisor')}</option>
                        </select>
                      ) : (
                        <span className={`text-xs font-semibold rounded-lg px-2 py-1 ${meta?.className ?? 'bg-ink-100 text-ink-600'}`}>
                          {meta?.label ?? u.role}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`flex items-center gap-1.5 text-xs font-medium ${u.is_active ? 'text-p2-dark' : 'text-ink-400'}`}>
                        {u.is_active ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                        {u.is_active ? t('platformAdmin.status.active') : t('platformAdmin.status.deactivated')}
                      </span>
                    </td>
                    <td className="px-4 py-3.5"><p className="text-xs text-ink-400">{u.last_login_at ? relativeTime(u.last_login_at, t) : t('platformAdmin.team.never')}</p></td>
                    <td className="px-4 py-3.5 text-right">
                      {!isSuperAdmin || isSelf ? null : actionLoading === u.id ? (
                        <RefreshCw className="size-4 text-ink-300 animate-spin inline-block" />
                      ) : (
                        <button
                          onClick={() => handleToggleActive(u)}
                          className={`flex items-center gap-1.5 text-xs font-semibold ml-auto ${
                            u.is_active ? 'text-red-500 hover:text-red-700' : 'text-p2-dark hover:text-p2'
                          }`}
                        >
                          {u.is_active ? <ShieldOff className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
                          {u.is_active ? t('platformAdmin.deactivate') : t('platformAdmin.activate')}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── Invitations tab ─────────────────────────────────────────────────────────
//
// Pending platform-team invitations, split out from TeamTab into its own
// destination — the roster tab manages people who've already joined, this
// one is purely about outstanding invites (send/resend/cancel).

function InvitationsTab() {
  const { t } = useTranslation()
  const platformRoleMeta = getPlatformRoleMeta(t)
  const currentUser = useAuthStore((s) => s.user)
  const isSuperAdmin = currentUser?.role === 'super_admin'

  const [invites, setInvites] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)

  const load = useCallback(async () => {
    try {
      const i = await adminApi.listPlatformInvitations()
      setInvites(i)
    } catch { /* keep prior state */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCancelInvite = async (id: string) => {
    setActionLoading(id)
    try { await adminApi.cancelPlatformInvitation(id); await load() }
    catch { } finally { setActionLoading(null) }
  }

  const handleResendInvite = async (id: string) => {
    setActionLoading(id)
    try { await adminApi.resendPlatformInvitation(id); await load() }
    catch { } finally { setActionLoading(null) }
  }

  const pendingInvites = invites.filter((i) => i.status === 'pending')

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-2xl border border-ink-100">
        <Lock className="size-8 text-ink-200 mb-2" />
        <p className="text-sm text-ink-500">{t('platformAdmin.restricted')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
        >
          <Send className="size-4" /> {t('platformAdmin.team.inviteTeammate')}
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">{[1, 2].map((i) => <div key={i} className="h-12 bg-ink-50 rounded-xl animate-pulse" />)}</div>
        ) : pendingInvites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <Clock3 className="size-9 text-ink-200 mb-3" />
            <p className="text-sm font-semibold text-ink-500">{t('platformAdmin.team.noPending')}</p>
          </div>
        ) : (
          <div className="divide-y divide-ink-50">
            {pendingInvites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-4 px-4 py-3.5">
                <UserCog className="size-4 text-ink-300 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-800">{inv.email}</p>
                  <p className="text-xs text-ink-400">
                    {platformRoleMeta[inv.role as 'super_admin' | 'platform_support' | 'advisor']?.label ?? inv.role} · {t('platformAdmin.team.expires', { date: new Date(inv.expires_at).toLocaleDateString() })}
                  </p>
                </div>
                {actionLoading === inv.id ? (
                  <RefreshCw className="size-4 text-ink-300 animate-spin" />
                ) : (
                  <div className="flex items-center gap-3 shrink-0">
                    <button onClick={() => handleResendInvite(inv.id)} className="flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-700">
                      <Send className="size-3.5" /> {t('common.resend')}
                    </button>
                    <button onClick={() => handleCancelInvite(inv.id)} className="flex items-center gap-1 text-xs font-semibold text-red-500 hover:text-red-700">
                      <Trash2 className="size-3.5" /> {t('common.cancel')}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showInvite && <InviteTeamModal onInvited={load} onClose={() => setShowInvite(false)} />}
    </div>
  )
}

// ─── Audit log tab (cross-org) ──────────────────────────────────────────────

function AuditLogTab({ orgs }: { orgs: Organisation[] }) {
  const { t } = useTranslation()
  const ACTION_GROUPS = getActionGroups(t)
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
            {ACTION_GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <ArrowDownUp className="size-4 text-ink-400 shrink-0" />
          <select
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-700 outline-none focus:ring-2 focus:ring-accent-400"
          >
            <option value="">{t('auditLog.allOrganisations')}</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>

        <span className="text-xs text-ink-400 ml-auto">
          {t('auditLog.eventsCount', { count: total })}{(actionFilter || orgFilter) ? t('auditLog.filtered') : ''}
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
            <p className="text-sm font-semibold text-ink-500">{t('auditLog.noEventsFound')}</p>
            <p className="text-xs text-ink-400 mt-1">{t('auditLog.adjustFilters')}</p>
          </div>
        ) : (
          <div className="divide-y divide-ink-50">
            {logs.map((log) => {
              const change = diffLabel(log.diff, t)
              const orgName = orgs.find((o) => o.id === log.org_id)?.name ?? t('auditLog.unknownOrg')
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
                      <span className="font-medium text-ink-700">{t(`auditActions.${log.action}`, log.action)}</span>{' '}
                      <span className="inline-flex items-center gap-1 text-xs text-p3-dark bg-p3-light rounded-md px-1.5 py-0.5 align-middle">
                        <Building2 className="size-3" /> {orgName}
                      </span>
                    </p>
                    {change && <p className="text-xs text-ink-400 mt-0.5 font-mono truncate">{change}</p>}
                    <p className="text-xs text-ink-400 mt-0.5">{log.user_email}</p>
                  </div>

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

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-ink-100 bg-ink-50/50">
            <p className="text-xs text-ink-400">{t('auditLog.showing', { from: page * limit + 1, to: Math.min((page + 1) * limit, total), total })}</p>
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
  const { t } = useTranslation()
  const currentUser = useAuthStore((s) => s.user)
  const isSuperAdmin = currentUser?.role === 'super_admin'
  const isPlatformTier = isSuperAdmin || currentUser?.role === 'platform_support'

  const [tab, setTab] = useState<Tab>('dashboard')
  const [orgs, setOrgs] = useState<Organisation[]>([])
  const [loading, setLoading] = useState(true)
  const [activeOnly, setActiveOnly] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showCreateOrg, setShowCreateOrg] = useState(false)
  const [showInviteOrg, setShowInviteOrg] = useState(false)
  const [viewOrgId, setViewOrgId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Organisation | null>(null)

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
        <h1 className="font-display text-lg font-bold text-ink-900">{t('platformAdmin.title')}</h1>
        <p className="text-sm text-ink-500 mt-1">{t('platformAdmin.restricted')}</p>
      </div>
    )
  }

  const activeCount = orgs.filter((o) => o.is_active).length

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-11 rounded-2xl bg-ink-900 text-white shrink-0">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-ink-900">{t('platformAdmin.title')}</h1>
            <p className="text-ink-500 text-sm mt-0.5">
              {t('platformAdmin.orgsCount', { count: orgs.length })} · {t('platformAdmin.activeCount', { count: activeCount })}
              {!isSuperAdmin && <span className="text-ink-400"> · {t('platformAdmin.readOnly')}</span>}
            </p>
          </div>
        </div>
        {isSuperAdmin && tab === 'organisations' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowInviteOrg(true)}
              className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink-700 hover:bg-ink-50 transition-colors"
            >
              <Mail className="size-4" /> {t('platformAdmin.inviteOrgAdmin')}
            </button>
            <button
              onClick={() => setShowCreateOrg(true)}
              className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
            >
              <Plus className="size-4" /> {t('platformAdmin.newOrganisation')}
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-ink-100 rounded-xl p-1 w-fit overflow-x-auto">
        {([
          { id: 'dashboard' as const,     label: t('platformAdmin.tabs.dashboard', 'Dashboard'),       icon: LayoutDashboard },
          { id: 'organisations' as const, label: t('platformAdmin.tabs.organisations'),                icon: Building2 },
          { id: 'team' as const,          label: t('platformAdmin.tabs.team'),                         icon: UserCog },
          { id: 'invitations' as const,   label: t('platformAdmin.tabs.invitations', 'Invitations'),   icon: Mail },
          { id: 'audit' as const,         label: t('platformAdmin.tabs.auditLog'),                     icon: Activity },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              tab === id ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
            }`}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Dashboard tab — stats + shortcuts ── */}
      {tab === 'dashboard' && (
        <div className="space-y-8">
          <StatsOverview />
          <div>
            <h2 className="text-sm font-semibold text-ink-800 mb-3">{t('platformAdmin.dashboard.quickActions', 'Quick actions')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <ShortcutCard
                icon={Building2}
                accent="p3"
                title={t('platformAdmin.tabs.organisations')}
                description={t('platformAdmin.dashboard.organisationsDesc', 'Create, view, and manage organisations')}
                onClick={() => setTab('organisations')}
              />
              <ShortcutCard
                icon={UserCog}
                accent="accent"
                title={t('platformAdmin.tabs.team')}
                description={t('platformAdmin.dashboard.teamDesc', 'Manage platform team roles and access')}
                onClick={() => setTab('team')}
              />
              <ShortcutCard
                icon={Mail}
                accent="p1"
                title={t('platformAdmin.tabs.invitations', 'Invitations')}
                description={t('platformAdmin.dashboard.invitationsDesc', 'Send and track pending team invites')}
                onClick={() => setTab('invitations')}
              />
              <ShortcutCard
                icon={Activity}
                accent="p2"
                title={t('platformAdmin.tabs.auditLog')}
                description={t('platformAdmin.dashboard.auditDesc', 'Review activity across every organisation')}
                onClick={() => setTab('audit')}
              />
            </div>
          </div>
        </div>
      )}

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
              {t('platformAdmin.activeOnly')}
            </label>
          </div>

          <div className="bg-white rounded-2xl border border-ink-100 overflow-hidden">
            {loading ? (
              <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-12 bg-ink-50 rounded-xl animate-pulse" />)}</div>
            ) : orgs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <Building2 className="size-9 text-ink-200 mb-3" />
                <p className="text-sm font-semibold text-ink-500">{t('platformAdmin.noOrganisations')}</p>
                {isSuperAdmin && <p className="text-xs text-ink-400 mt-1">{t('platformAdmin.noOrganisationsHelp')}</p>}
              </div>
            ) : (
              <table className="w-full">
                <thead className="border-b border-ink-100 bg-ink-50">
                  <tr>
                    {[t('platformAdmin.table.organisation'), t('platformAdmin.table.industry'), t('platformAdmin.table.locale'), t('platformAdmin.table.status'), t('platformAdmin.table.created'), ''].map((h, i) => (
                      <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-50">
                  {orgs.map((org) => (
                    <tr key={org.id} className={!org.is_active ? 'opacity-60' : ''}>
                      <td className="px-4 py-3.5">
                        <button
                          onClick={() => setViewOrgId(org.id)}
                          className="flex items-center gap-3 text-left hover:opacity-80 transition-opacity"
                        >
                          <div className="size-8 rounded-lg bg-p3-light flex items-center justify-center shrink-0">
                            <Building2 className="size-4 text-p3-dark" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-ink-900">{org.name}</p>
                            <p className="text-xs text-ink-400">{org.slug}</p>
                          </div>
                        </button>
                      </td>
                      <td className="px-4 py-3.5"><p className="text-sm text-ink-600">{org.industry || '—'}</p></td>
                      <td className="px-4 py-3.5"><p className="text-sm text-ink-600 uppercase">{org.locale}</p></td>
                      <td className="px-4 py-3.5">
                        <span className={`flex items-center gap-1.5 text-xs font-medium ${org.is_active ? 'text-p2-dark' : 'text-ink-400'}`}>
                          {org.is_active ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                          {org.is_active ? t('platformAdmin.status.active') : t('platformAdmin.status.deactivated')}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-xs text-ink-400">
                          {new Date(org.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => setViewOrgId(org.id)}
                            title={t('platformAdmin.detail.view')}
                            className="text-ink-400 hover:text-accent transition-colors"
                          >
                            <Eye className="size-4" />
                          </button>
                          {isSuperAdmin && (
                            actionLoading === org.id ? (
                              <RefreshCw className="size-4 text-ink-300 animate-spin" />
                            ) : (
                              <>
                                <button
                                  onClick={() => handleToggleActive(org)}
                                  className={`flex items-center gap-1.5 text-xs font-semibold ${
                                    org.is_active ? 'text-red-500 hover:text-red-700' : 'text-p2-dark hover:text-p2'
                                  }`}
                                >
                                  {org.is_active ? <ShieldOff className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
                                  {org.is_active ? t('platformAdmin.deactivate') : t('platformAdmin.activate')}
                                </button>
                                <button
                                  onClick={() => setDeleteTarget(org)}
                                  disabled={org.is_active}
                                  title={org.is_active ? t('platformAdmin.detail.deactivateFirst') : t('platformAdmin.detail.deleteOrg')}
                                  className="text-ink-300 enabled:hover:text-red-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Platform team tab ── */}
      {tab === 'team' && <TeamTab />}

      {/* ── Invitations tab ── */}
      {tab === 'invitations' && <InvitationsTab />}

      {/* ── Audit log tab ── */}
      {tab === 'audit' && <AuditLogTab orgs={orgs} />}

      {showCreateOrg && <CreateOrgModal onCreated={loadOrgs} onClose={() => setShowCreateOrg(false)} />}
      {showInviteOrg && <InviteOrgAdminModal orgs={orgs} onInvited={loadOrgs} onClose={() => setShowInviteOrg(false)} />}
      {viewOrgId && (
        <OrgDetailModal orgId={viewOrgId} onClose={() => setViewOrgId(null)} onChanged={loadOrgs} />
      )}
      {deleteTarget && (
        <DeleteOrgConfirmModal
          org={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={loadOrgs}
        />
      )}
    </div>
  )
}