import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, ArrowRight, AlertCircle } from 'lucide-react'
import { authApi } from '../api/endpoints'
import { useAuthStore } from '../store/auth'
import LanguageSwitcher from '../components/ui/LanguageSwitcher'

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
      navigate(from ?? (isPlatformTier ? '/platform-admin' : '/dashboard'), { replace: true })
    } catch {
      setError(t('auth.signInError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink-900 flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex flex-col justify-between w-[480px] shrink-0 bg-ink-900 border-r border-ink-700 p-12">
        {/* Logo + language */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/logo.jpg"
              alt="SPE-Lite"
              className="size-9 rounded-xl shrink-0 object-contain"
            />
            <span className="font-display font-bold text-white text-lg tracking-tight">SPE-Lite</span>
          </div>
          <LanguageSwitcher dark compact />
        </div>

        {/* Headline */}
        <div className="space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-semibold tracking-widest text-accent-400 uppercase">
              {t('auth.tagline')}
            </p>
            <h1 className="font-display text-4xl font-bold text-white leading-[1.15]">
              {t('auth.headline1')}<br />{t('auth.headline2')}<br />{t('auth.headline3')}
            </h1>
            <p className="text-ink-400 text-base leading-relaxed max-w-xs">
              {t('auth.heroDescription')}
            </p>
          </div>

          {/* Phase pills */}
          <div className="flex flex-col gap-3">
            {[
              { phase: 'P1', label: t('auth.phaseAnalysis'),   desc: t('auth.phaseAnalysisDesc'),   color: 'bg-p1-light text-p1-dark' },
              { phase: 'P2', label: t('auth.phaseStrategy'),   desc: t('auth.phaseStrategyDesc'),   color: 'bg-p2-light text-p2-dark' },
              { phase: 'P3', label: t('auth.phaseOperations'), desc: t('auth.phaseOperationsDesc'), color: 'bg-p3-light text-p3-dark' },
            ].map(({ phase, label, desc, color }) => (
              <div key={phase} className="flex items-center gap-3">
                <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold shrink-0 ${color}`}>
                  {phase}
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{label}</p>
                  <p className="text-xs text-ink-400">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-ink-600">
          {t('auth.selfHosted')}
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-ink-50">
        <div className="w-full max-w-sm">
          {/* Mobile logo + language */}
          <div className="flex items-center justify-between gap-2 mb-10 lg:hidden">
            <div className="flex items-center gap-2">
              <img
                src="/logo.jpg"
                alt="SPE-Lite"
                className="size-8 rounded-lg shrink-0 object-contain"
              />
              <span className="font-display font-bold text-ink-900 text-base">SPE-Lite</span>
            </div>
            <LanguageSwitcher compact />
          </div>

          {/* Desktop language switcher (mobile one lives in the row above) */}
          <div className="hidden lg:flex justify-end mb-4">
            <LanguageSwitcher />
          </div>

          <div className="mb-8">
            <h2 className="font-display text-2xl font-bold text-ink-900">{t('auth.signIn')}</h2>
            <p className="text-ink-500 text-sm mt-1">{t('auth.signInSubtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
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
              <label htmlFor="password" className="block text-sm font-medium text-ink-700">
                {t('auth.password')}
              </label>
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
              <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed"
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