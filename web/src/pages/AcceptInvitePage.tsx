import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, Check, CheckCircle2, AlertCircle, ArrowRight, BookOpen } from 'lucide-react'
import { invitationsApi } from '../api/endpoints'
import { useAuthStore } from '../store/auth'
import AuthBrandPanel from '../components/auth/AuthBrandPanel'
import AuthMobileHeader from '../components/auth/AuthMobileHeader'
import LanguageSwitcher from '../components/ui/LanguageSwitcher'

type Step = 'form' | 'success'
type Strength = 'weak' | 'fair' | 'strong'

// Simple, dependency-free heuristic — enough to nudge people toward a
// stronger password without pretending to be a real entropy estimator.
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

export default function AcceptInvitePage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const prefillEmail = params.get('email') ?? ''

  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)

  const [step, setStep] = useState<Step>('form')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isPlatformTier, setIsPlatformTier] = useState(false)

  // Small mount-in transition for the success state — kept subtle and
  // one-shot, not a repeating/ambient animation.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 20)
    return () => clearTimeout(id)
  }, [])

  useEffect(() => {
    if (!token) {
      navigate('/login', { replace: true })
    }
  }, [token, navigate])

  const passwordsMatch = password.length > 0 && password === confirm
  const passwordStrong = password.length >= 8
  const strength = passwordStrength(password)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !password || !passwordsMatch || !passwordStrong) return
    setLoading(true)
    setError('')
    try {
      const tokens = await invitationsApi.accept({ token, name, password })
      let user
      if (import.meta.env.VITE_MOCK === 'true') {
        const { mockAuth } = await import('../mocks/handlers')
        user = await mockAuth.me()
        const org  = await mockAuth.org()
        setAuth(user, org, tokens.access_token, tokens.refresh_token)
      } else {
        const apiClient = (await import('../api/client')).default
        const { data: fetchedUser } = await apiClient.get('/org/me', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
        user = fetchedUser
        // Platform-tier invitees (super_admin, platform_support) have no
        // org_id — /org correctly 403s for them, same as LoginPage's real-mode
        // branch, so only fetch it when there's actually an org to fetch.
        let org = null
        if (user.org_id) {
          const { data: orgData } = await apiClient.get('/org', {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          })
          org = orgData
        }
        setAuth(user, org, tokens.access_token, tokens.refresh_token)
      }
      setIsPlatformTier(user.role === 'super_admin' || user.role === 'platform_support')
      setStep('success')
    } catch {
      setError(t('acceptInvite.invalidLink'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink-900 flex">
      <AuthBrandPanel />

      {/* Right panel — form or success state */}
      <div className="flex-1 flex items-center justify-center p-6 bg-ink-50">
        <div className="w-full max-w-sm">
          <AuthMobileHeader />

          {/* Docs link — always visible (mobile included), on both the
              form and success steps; see LoginPage.tsx for why this row
              isn't simply "hidden lg:flex" like the old
              LanguageSwitcher-only version was. */}
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

          {step === 'success' ? (
            <div
              className={`text-center space-y-5 transition-all duration-500 ease-out ${
                mounted ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
              }`}
            >
              <div className="size-14 rounded-full bg-p2-light flex items-center justify-center mx-auto">
                <CheckCircle2 className="size-7 text-p2-dark" />
              </div>
              <div>
                <p className="text-xs font-semibold tracking-widest text-p2-dark uppercase mb-2">
                  {t('acceptInvite.successEyebrow', "Account created")}
                </p>
                <h2 className="font-display text-2xl font-bold text-ink-900">{t('acceptInvite.successTitle')}</h2>
                <p className="text-ink-500 text-sm mt-1.5">
                  {t('acceptInvite.successDesc')}
                </p>
              </div>
              <button
                onClick={() => navigate(isPlatformTier ? '/platform-admin' : '/dashboard')}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-accent-600 hover:shadow-md"
              >
                {t('acceptInvite.goToDashboard')} <ArrowRight className="size-4" />
              </button>
            </div>
          ) : (
            <div>
              <p className="text-xs font-semibold tracking-widest text-accent-600 uppercase mb-2">
                {t('acceptInvite.eyebrow', "You've been invited")}
              </p>
              <div className="mb-8">
                <h2 className="font-display text-2xl font-bold text-ink-900">{t('acceptInvite.title')}</h2>
                {prefillEmail && (
                  <p className="text-ink-500 text-sm mt-1.5">
                    {t('acceptInvite.creatingFor')} <span className="font-medium text-ink-700">{prefillEmail}</span>
                  </p>
                )}
              </div>

              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                {/* Name */}
                <div className="space-y-1.5">
                  <label htmlFor="name" className="block text-sm font-medium text-ink-700">
                    {t('acceptInvite.yourName')}
                  </label>
                  <input
                    id="name"
                    type="text"
                    autoComplete="name"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Dlamini"
                    className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-900 placeholder:text-ink-400 outline-none transition-all focus:ring-2 focus:ring-accent-400 focus:border-transparent"
                  />
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <label htmlFor="password" className="block text-sm font-medium text-ink-700">
                    {t('acceptInvite.choosePassword')}
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPw ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('acceptInvite.passwordHint')}
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
                  {/* Strength meter */}
                  {password.length > 0 && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 h-1 rounded-full bg-ink-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${STRENGTH_METER[strength].bar} ${STRENGTH_METER[strength].width}`}
                        />
                      </div>
                      <span className="text-xs text-ink-400 shrink-0 w-10 text-right">
                        {t(`acceptInvite.strength.${strength}`, STRENGTH_LABEL[strength])}
                      </span>
                    </div>
                  )}
                </div>

                {/* Confirm */}
                <div className="space-y-1.5">
                  <label htmlFor="confirm" className="block text-sm font-medium text-ink-700">
                    {t('acceptInvite.confirmPassword')}
                  </label>
                  <div className="relative">
                    <input
                      id="confirm"
                      type={showPw ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder={t('acceptInvite.confirmPasswordHint')}
                      className={`w-full rounded-xl border bg-white px-4 py-3 pr-11 text-sm text-ink-900 placeholder:text-ink-400 outline-none transition-all focus:ring-2 focus:ring-accent-400 focus:border-transparent ${
                        confirm.length > 0 && !passwordsMatch ? 'border-red-300' : 'border-ink-200'
                      }`}
                    />
                    {passwordsMatch && (
                      <Check className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-p2-dark" />
                    )}
                  </div>
                  {confirm.length > 0 && !passwordsMatch && (
                    <p className="text-xs text-red-500">{t('acceptInvite.passwordMismatch')}</p>
                  )}
                </div>

                {/* Error */}
                {error && (
                  <div role="alert" className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                    <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !name || !passwordStrong || !passwordsMatch}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-accent-600 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                >
                  {loading ? (
                    <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <>{t('acceptInvite.createAccount')} <ArrowRight className="size-4" /></>
                  )}
                </button>
              </form>

              <p className="mt-8 text-center text-xs text-ink-400">
                {t('acceptInvite.termsNotice', "By creating an account, you agree to your organisation's usage policies.")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}