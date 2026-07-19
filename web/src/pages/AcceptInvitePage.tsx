import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, CheckCircle, AlertCircle, ArrowRight } from 'lucide-react'
import { invitationsApi } from '../api/endpoints'
import { useAuthStore } from '../store/auth'
import LanguageSwitcher from '../components/ui/LanguageSwitcher'

type Step = 'form' | 'success'

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

  useEffect(() => {
    if (!token) {
      navigate('/login', { replace: true })
    }
  }, [token, navigate])

  const passwordsMatch = password === confirm
  const passwordStrong = password.length >= 8

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !password || !passwordsMatch || !passwordStrong) return
    setLoading(true)
    setError('')
    try {
      const tokens = await invitationsApi.accept({ token, name, password })
      if (import.meta.env.VITE_MOCK === 'true') {
        const { mockAuth } = await import('../mocks/handlers')
        const user = await mockAuth.me()
        const org  = await mockAuth.org()
        setAuth(user, org, tokens.access_token, tokens.refresh_token)
      } else {
        const apiClient = (await import('../api/client')).default
        const { data: user } = await apiClient.get('/org/me', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
        const { data: org } = await apiClient.get('/org', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
        setAuth(user, org, tokens.access_token, tokens.refresh_token)
      }
      setStep('success')
    } catch {
      setError(t('acceptInvite.invalidLink'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo + language */}
        <div className="flex items-center justify-between gap-2.5 mb-10">
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-xl bg-ink-900 flex items-center justify-center">
              <span className="font-display font-bold text-white text-sm">SP</span>
            </div>
            <span className="font-display font-bold text-ink-900 text-lg tracking-tight">StratPlan</span>
          </div>
          <LanguageSwitcher compact />
        </div>

        {step === 'success' ? (
          <div className="bg-white rounded-2xl border border-ink-100 shadow-sm p-8 text-center space-y-4">
            <div className="size-14 rounded-full bg-p2-light flex items-center justify-center mx-auto">
              <CheckCircle className="size-7 text-p2-dark" />
            </div>
            <div>
              <h2 className="font-display text-xl font-bold text-ink-900">{t('acceptInvite.successTitle')}</h2>
              <p className="text-ink-500 text-sm mt-1">
                {t('acceptInvite.successDesc')}
              </p>
            </div>
            <button
              onClick={() => navigate('/dashboard')}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
            >
              {t('acceptInvite.goToDashboard')} <ArrowRight className="size-4" />
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-ink-100 shadow-sm p-8">
            <div className="mb-7">
              <h2 className="font-display text-2xl font-bold text-ink-900">{t('acceptInvite.title')}</h2>
              {prefillEmail && (
                <p className="text-ink-500 text-sm mt-1.5">
                  {t('acceptInvite.creatingFor')} <span className="font-medium text-ink-700">{prefillEmail}</span>
                </p>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
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
                  >
                    {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {/* Strength bar */}
                {password.length > 0 && (
                  <div className="flex gap-1 mt-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          password.length >= i * 2
                            ? password.length >= 8 ? 'bg-p2' : 'bg-p1'
                            : 'bg-ink-100'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Confirm */}
              <div className="space-y-1.5">
                <label htmlFor="confirm" className="block text-sm font-medium text-ink-700">
                  {t('acceptInvite.confirmPassword')}
                </label>
                <input
                  id="confirm"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={t('acceptInvite.confirmPasswordHint')}
                  className={`w-full rounded-xl border bg-white px-4 py-3 text-sm text-ink-900 placeholder:text-ink-400 outline-none transition-all focus:ring-2 focus:ring-accent-400 focus:border-transparent ${
                    confirm.length > 0 && !passwordsMatch ? 'border-red-300' : 'border-ink-200'
                  }`}
                />
                {confirm.length > 0 && !passwordsMatch && (
                  <p className="text-xs text-red-500">{t('acceptInvite.passwordMismatch')}</p>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                  <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !name || !passwordStrong || !passwordsMatch}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <>{t('acceptInvite.createAccount')} <ArrowRight className="size-4" /></>
                )}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}