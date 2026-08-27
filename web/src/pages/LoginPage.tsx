import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, ArrowRight, AlertCircle, BookOpen, LogOut } from 'lucide-react'
import { authApi } from '../api/endpoints'
import { useAuthStore } from '../store/auth'
import AuthBrandPanel from '../components/auth/AuthBrandPanel'
import AuthMobileHeader from '../components/auth/AuthMobileHeader'
import LanguageSwitcher from '../components/ui/LanguageSwitcher'

// Key set by api/client.ts's response interceptor right before it hard-
// redirects here on a failed silent refresh (expired session, idle
// timeout, revoked refresh token, ...). Read once below.
const SESSION_EXPIRED_KEY = 'stratplan_session_expired'

export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const setAuth = useAuthStore((s) => s.setAuth)
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Read-once, on mount: whether this landing on /login was because the
  // session timed out / was signed out from under the person, rather than
  // a deliberate visit (typing the URL, clicking "Sign in" after a normal
  // logout, etc.). Cleared immediately so it can never resurface on a
  // later, unrelated visit — e.g. hitting back/forward, or logging out
  // again normally in the same tab.
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null)
  useEffect(() => {
    const raw = sessionStorage.getItem(SESSION_EXPIRED_KEY)
    if (!raw) return
    sessionStorage.removeItem(SESSION_EXPIRED_KEY)
    // client.ts stores the literal string 'true' when the backend's
    // response didn't carry a usable message — fall back to a generic
    // explanation in that case rather than showing the sentinel value.
    setSessionExpiredMessage(
      raw === 'true' ? t('auth.sessionExpiredGeneric', 'You were signed out — please log in again.') : raw,
    )
  }, [t])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setLoading(true)
    setError('')
    try {
      let user
      if (import.meta.env.VITE_MOCK === 'true') {
        // ── Mock mode: never touch Axios / the proxy ─────────────────────
        const { mockAuth } = await import('../mocks/handlers')
        const tokens = await mockAuth.login(email, password)
        user = await mockAuth.me()
        const org = await mockAuth.org()
        setAuth(user, org, tokens.access_token, tokens.refresh_token)
      } else {
        // ── Real mode ─────────────────────────────────────────────────────
        const tokens = await authApi.login({ email, password })
        const apiClient = (await import('../api/client')).default
        const { data: fetchedUser } = await apiClient.get('/org/me', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
        user = fetchedUser
        // Platform-tier users (super_admin, platform_support) have no org_id —
        // /org correctly 403s for them, so only fetch it when there's an org to fetch.
        let org = null
        if (user.org_id) {
          const { data: orgData } = await apiClient.get('/org', {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          })
          org = orgData
        }
        setAuth(user, org, tokens.access_token, tokens.refresh_token)
      }
      const isPlatformTier = user.role === 'super_admin' || user.role === 'platform_support'
      const dest = isPlatformTier
        ? '/platform-admin'
        // advisor has no org yet right after login (advisorOrgStore was
        // cleared on the previous logout, if any — see tokenStore.clear()
        // in api/client.ts) — send it to pick one instead of /dashboard,
        // which would 403 on every org-scoped call until it does.
        : user.role === 'advisor'
        ? '/org-picker'
        : '/dashboard'
      navigate(from ?? dest, { replace: true })
    } catch {
      setError(t('auth.signInError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink-900 flex">
      <AuthBrandPanel />

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-ink-50">
        <div className="w-full max-w-sm">
          <AuthMobileHeader />

          {/* Docs link — always visible (mobile included), unlike the
              LanguageSwitcher row below which is desktop-only because its
              mobile equivalent already lives inside AuthMobileHeader. This
              is the only way a logged-out visitor can reach /docs at all —
              it's a public route but nothing links to it otherwise. */}
          <div className="flex items-center justify-between mb-4">
            <Link
              to="/docs"
              className="flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-700 transition-colors"
            >
              <BookOpen className="size-3.5" /> {t('auth.docsLink', 'Docs')}
            </Link>
            <div className="hidden lg:block">
              <LanguageSwitcher />
            </div>
          </div>

          {sessionExpiredMessage && (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 mb-6">
              <LogOut className="size-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">{sessionExpiredMessage}</p>
            </div>
          )}

          <div className="mb-8">
            <h2 className="font-display text-2xl font-bold text-ink-900">{t('auth.signIn')}</h2>
            <p className="text-ink-500 text-sm mt-1">{t('auth.signInSubtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-ink-700">
                {t('auth.email')}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-900 placeholder:text-ink-400 outline-none transition-all focus:ring-2 focus:ring-accent-400 focus:border-transparent"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-ink-700">
                  {t('auth.password')}
                </label>
                <Link to="/forgot-password" className="text-xs font-medium text-accent hover:text-accent-700 transition-colors">
                  {t('auth.forgotPassword', 'Forgot password?')}
                </Link>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 pr-11 text-sm text-ink-900 placeholder:text-ink-400 outline-none transition-all focus:ring-2 focus:ring-accent-400 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 transition-colors"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-accent-600 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
            >
              {loading ? (
                <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <>{t('auth.signInButton')} <ArrowRight className="size-4" /></>
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-ink-400">
            {t('auth.noAccount')}{' '}
            <span className="text-ink-600 font-medium">
              {t('auth.noAccountHelp')}
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}