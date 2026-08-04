import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  User as UserIcon, Phone, Globe2, Shield, Building2, Eye, EyeOff,
  Check, AlertCircle, CheckCircle2, Laptop2, LogOut,
} from 'lucide-react'
import { meApi } from '../api/endpoints'
import { useAuthStore } from '../store/auth'
import type { User, Session } from '../types'

// ── Shared bits ──────────────────────────────────────────────────────────────

type Strength = 'weak' | 'fair' | 'strong'

function passwordStrength(pw: string): Strength {
  if (pw.length >= 12 && /[0-9]/.test(pw) && /[a-zA-Z]/.test(pw)) return 'strong'
  if (pw.length >= 8) return 'fair'
  return 'weak'
}

const STRENGTH_METER: Record<Strength, { width: string; bar: string }> = {
  weak:   { width: 'w-1/3',  bar: 'bg-red-400' },
  fair:   { width: 'w-2/3',  bar: 'bg-p1' },
  strong: { width: 'w-full', bar: 'bg-p2' },
}
const STRENGTH_LABEL: Record<Strength, string> = { weak: 'Weak', fair: 'Good', strong: 'Strong' }

const ROLE_LABEL: Record<string, string> = {
  super_admin:      'Super admin',
  platform_support: 'Platform support',
  org_admin:        'Org admin',
  planner:          'Planner',
  contributor:      'Contributor',
  viewer:           'Viewer',
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || '?'
}

// Forced logout after a security-sensitive action (password change / revoke
// all sessions) revokes every refresh token server-side, including this
// session's — so the local tokens are now stale. Goes through the store's
// own clearAuth() (same call AppShell's logout button makes) rather than
// just tokenStore.clear(), because auth state — user/org/isAuthenticated —
// is separately persisted to localStorage by the `persist` middleware;
// clearing only the tokens would leave a stale, still-"authenticated"
// snapshot behind. clearAuth() also resets the offline queue and toasts,
// which matters here too — nothing queued under this identity should
// survive into whoever signs in next in this browser. The hard redirect
// (rather than client-side navigate) mirrors client.ts's own
// refresh-failure path and guarantees every bit of in-memory state is torn
// down, not just the store.
function forceLogout() {
  useAuthStore.getState().clearAuth()
  window.location.href = '/login'
}

const inputCls =
  'w-full rounded-xl border border-ink-200 bg-white px-4 py-3 pr-11 text-sm text-ink-900 ' +
  'placeholder:text-ink-400 outline-none transition-all focus:ring-2 focus:ring-accent-400 focus:border-transparent'
const labelCls = 'block text-sm font-medium text-ink-700'
const cardCls = 'rounded-2xl border border-ink-200 bg-white p-6'

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { t } = useTranslation()
  const storeUser = useAuthStore((s) => s.user)

  const [user, setUser] = useState<User | null>(storeUser ?? null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    meApi.getProfile()
      .then((u) => { if (!cancelled) setUser(u) })
      .catch(() => { if (!cancelled) setLoadError(t('profile.loadError', "Couldn't load your profile. Try refreshing the page.")) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [t])

  const isPlatformTier = user?.role === 'super_admin' || user?.role === 'platform_support'

  const handleProfileSaved = (updated: User) => {
    setUser(updated)
    // Keep the global store (sidebar name/avatar, etc.) in sync so the rest
    // of the app reflects the edit immediately. Deliberately a direct
    // setState patch rather than setAuth(): setAuth is built for
    // login/invite-accept transitions and, as a matter of correctness for
    // that use case, also wipes the offline mutation queue and any toasts
    // (see store/auth.ts) so a previous identity's state can't bleed into
    // a new one. A plain "I changed my phone number" edit isn't an
    // identity change and shouldn't have that side effect — it would
    // silently drop any of the user's own queued offline work.
    useAuthStore.setState({ user: updated })
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink-900">{t('profile.title', 'Your account')}</h1>
        <p className="text-ink-500 text-sm mt-1">
          {t('profile.subtitle', 'Manage your personal details, password, and active sessions.')}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="size-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : loadError || !user ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{loadError || t('profile.loadError', "Couldn't load your profile.")}</p>
        </div>
      ) : (
        <>
          <IdentityCard user={user} isPlatformTier={isPlatformTier} />
          <ProfileForm user={user} onSaved={handleProfileSaved} />
          <PasswordForm />
          <SessionsCard />
        </>
      )}
    </div>
  )
}

// ── Identity summary ─────────────────────────────────────────────────────────

function IdentityCard({ user, isPlatformTier }: { user: User; isPlatformTier: boolean }) {
  const { t } = useTranslation()
  return (
    <div className={`${cardCls} flex items-center gap-4`}>
      <div className="size-14 rounded-full bg-accent-100 text-accent-700 flex items-center justify-center font-display text-lg font-bold shrink-0 overflow-hidden">
        {user.avatar_url ? (
          <img src={user.avatar_url} alt="" className="size-full object-cover" />
        ) : (
          initials(user.name)
        )}
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-ink-900 truncate">{user.name}</p>
        <p className="text-sm text-ink-500 truncate">{user.email}</p>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-ink-500">
          <span className="inline-flex items-center gap-1">
            <Shield className="size-3.5" /> {ROLE_LABEL[user.role] ?? user.role}
          </span>
          <span className="inline-flex items-center gap-1">
            <Building2 className="size-3.5" />
            {isPlatformTier ? t('profile.platformTeam', 'Platform team') : t('profile.orgAccount', 'Organisation account')}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Edit profile ─────────────────────────────────────────────────────────────

function ProfileForm({ user, onSaved }: { user: User; onSaved: (u: User) => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(user.name)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [locale, setLocale] = useState(user.locale ?? 'en')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const dirty = name !== user.name || phone !== (user.phone ?? '') || locale !== (user.locale ?? 'en')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dirty || !name.trim()) return
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const updated = await meApi.updateProfile({
        name:   name !== user.name ? name : undefined,
        phone:  phone !== (user.phone ?? '') ? phone : undefined,
        locale: locale !== (user.locale ?? 'en') ? locale : undefined,
      })
      onSaved(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg || t('profile.saveError', "Couldn't save your changes. Try again."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`${cardCls} space-y-5`} noValidate>
      <h2 className="font-semibold text-ink-900">{t('profile.detailsTitle', 'Profile details')}</h2>

      <div className="space-y-1.5">
        <label htmlFor="name" className={labelCls}>{t('profile.name', 'Full name')}</label>
        <div className="relative">
          <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-ink-400" />
          <input
            id="name" type="text" value={name} onChange={(e) => setName(e.target.value)}
            className={`${inputCls} pl-10`}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="phone" className={labelCls}>{t('profile.phone', 'Phone number')}</label>
        <div className="relative">
          <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-ink-400" />
          <input
            id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder={t('profile.phonePlaceholder', 'Optional')}
            className={`${inputCls} pl-10`}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="locale" className={labelCls}>{t('profile.locale', 'Language')}</label>
        <div className="relative">
          <Globe2 className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-ink-400" />
          <select
            id="locale" value={locale} onChange={(e) => setLocale(e.target.value)}
            className={`${inputCls} pl-10 appearance-none`}
          >
            <option value="en">English</option>
            <option value="fr">Français</option>
            <option value="pt">Português</option>
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className={labelCls}>{t('profile.email', 'Email address')}</label>
        <input type="email" value={user.email} disabled className={`${inputCls} pl-4 bg-ink-50 text-ink-400 cursor-not-allowed`} />
        <p className="text-xs text-ink-400">{t('profile.emailLocked', "Email can't be changed here — contact your admin.")}</p>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!dirty || saving || !name.trim()}
          className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-accent-600 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {saving ? t('profile.saving', 'Saving…') : t('profile.saveChanges', 'Save changes')}
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-sm text-p2-dark">
            <Check className="size-4" /> {t('profile.saved', 'Saved')}
          </span>
        )}
      </div>
    </form>
  )
}

// ── Change password ──────────────────────────────────────────────────────────

function PasswordForm() {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const strength = passwordStrength(next)
  const passwordsMatch = next.length > 0 && next === confirm
  const passwordValid = next.length >= 8

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!current || !passwordValid || !passwordsMatch) return
    setSaving(true)
    setError('')
    try {
      await meApi.changePassword({ current_password: current, new_password: next, confirm_password: confirm })
      setDone(true)
      // Every session (including this one) was just revoked server-side.
      setTimeout(forceLogout, 1500)
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg || t('profile.passwordError', 'Current password is incorrect, or the new password is invalid.'))
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className={`${cardCls} flex items-start gap-3`}>
        <CheckCircle2 className="size-5 text-p2-dark shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-ink-900">{t('profile.passwordUpdated', 'Password updated')}</p>
          <p className="text-sm text-ink-500 mt-0.5">
            {t('profile.passwordUpdatedDesc', 'For your security, you have been signed out everywhere. Redirecting to sign in…')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className={`${cardCls} space-y-5`} noValidate>
      <div>
        <h2 className="font-semibold text-ink-900">{t('profile.passwordTitle', 'Change password')}</h2>
        <p className="text-sm text-ink-500 mt-0.5">
          {t('profile.passwordSubtitle', 'Changing your password signs you out of every device, including this one.')}
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="current" className={labelCls}>{t('profile.currentPassword', 'Current password')}</label>
        <input
          id="current" type="password" autoComplete="current-password"
          value={current} onChange={(e) => setCurrent(e.target.value)}
          className={inputCls}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="new" className={labelCls}>{t('profile.newPassword', 'New password')}</label>
        <div className="relative">
          <input
            id="new" type={showPw ? 'text' : 'password'} autoComplete="new-password"
            value={next} onChange={(e) => setNext(e.target.value)}
            placeholder={t('acceptInvite.passwordHint', 'At least 8 characters')}
            className={inputCls}
          />
          <button
            type="button" onClick={() => setShowPw((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 transition-colors"
            aria-label={showPw ? 'Hide password' : 'Show password'}
          >
            {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {next.length > 0 && (
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 h-1 rounded-full bg-ink-100 overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-300 ${STRENGTH_METER[strength].bar} ${STRENGTH_METER[strength].width}`} />
            </div>
            <span className="text-xs text-ink-400 shrink-0 w-10 text-right">
              {t(`acceptInvite.strength.${strength}`, STRENGTH_LABEL[strength])}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="confirm" className={labelCls}>{t('acceptInvite.confirmPassword', 'Confirm password')}</label>
        <div className="relative">
          <input
            id="confirm" type={showPw ? 'text' : 'password'} autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
            className={`${inputCls} ${confirm.length > 0 && !passwordsMatch ? 'border-red-300' : ''}`}
          />
          {passwordsMatch && <Check className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-p2-dark" />}
        </div>
        {confirm.length > 0 && !passwordsMatch && (
          <p className="text-xs text-red-500">{t('acceptInvite.passwordMismatch', 'Passwords do not match')}</p>
        )}
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={saving || !current || !passwordValid || !passwordsMatch}
        className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-accent-600 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
      >
        {saving ? t('profile.updating', 'Updating…') : t('profile.updatePassword', 'Update password')}
      </button>
    </form>
  )
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function SessionsCard() {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [error, setError] = useState('')
  const [revoking, setRevoking] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    meApi.listSessions()
      .then(setSessions)
      .catch(() => setError(t('profile.sessionsError', "Couldn't load your sessions.")))
  }, [t])

  const handleRevokeAll = async () => {
    setRevoking(true)
    try {
      await meApi.revokeAllSessions()
      forceLogout()
    } catch {
      setError(t('profile.revokeError', "Couldn't sign out of all sessions. Try again."))
      setRevoking(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className={`${cardCls} space-y-4`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-ink-900">{t('profile.sessionsTitle', 'Active sessions')}</h2>
          <p className="text-sm text-ink-500 mt-0.5">
            {t('profile.sessionsSubtitle', "Everywhere you're currently signed in.")}
          </p>
        </div>
        {!confirmOpen ? (
          <button
            type="button" onClick={() => setConfirmOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 text-red-600 px-3 py-2 text-sm font-medium hover:bg-red-50 transition-colors shrink-0"
          >
            <LogOut className="size-4" /> {t('profile.signOutEverywhere', 'Sign out everywhere')}
          </button>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-ink-500">{t('profile.confirmRevoke', 'Sign out of every session?')}</span>
            <button
              type="button" onClick={handleRevokeAll} disabled={revoking}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {revoking ? t('profile.signingOut', 'Signing out…') : t('profile.confirm', 'Confirm')}
            </button>
            <button
              type="button" onClick={() => setConfirmOpen(false)} disabled={revoking}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50"
            >
              {t('profile.cancel', 'Cancel')}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {sessions === null && !error ? (
        <div className="flex items-center justify-center py-6">
          <span className="size-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : sessions && sessions.length > 0 ? (
        <ul className="divide-y divide-ink-100">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <Laptop2 className="size-4 text-ink-400 shrink-0" />
              <div className="min-w-0 text-sm">
                <p className="text-ink-700">
                  {t('profile.signedInSince', 'Signed in {{date}}', { date: new Date(s.created_at).toLocaleString() })}
                </p>
                <p className="text-xs text-ink-400">
                  {t('profile.expires', 'Expires {{date}}', { date: new Date(s.expires_at).toLocaleString() })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : sessions ? (
        <p className="text-sm text-ink-400 py-2">{t('profile.noSessions', 'No other active sessions.')}</p>
      ) : null}
    </div>
  )
}