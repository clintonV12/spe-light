import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, Check, CheckCircle2, AlertCircle, ArrowRight, BookOpen } from 'lucide-react'
import { authApi } from '../api/endpoints'
import AuthBrandPanel from '../components/auth/AuthBrandPanel'
import AuthMobileHeader from '../components/auth/AuthMobileHeader'
import LanguageSwitcher from '../components/ui/LanguageSwitcher'

// Mirrors AcceptInvitePage's password-setting form/strength UX exactly —
// same fields, same validation shape — since this is functionally the same
// "set a new password" moment, just reached via a reset link instead of an
// invite link.
export default function ResetPasswordPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) navigate('/forgot-password', { replace: true })
  }, [token, navigate])

  const passwordsMatch = password.length > 0 && password === confirm
  const passwordValid = password.length >= 8

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passwordValid || !passwordsMatch) return
    setLoading(true)
    setError('')
    try {
      await authApi.confirmPasswordReset(token, password)
      setDone(true)
    } catch {
      // Covers both "token invalid/expired/already used" and any transport
      // failure — the backend doesn't distinguish these to the client, so
      // neither does this message (see REQ: expired/used tokens rejected).
      setError(t('resetPassword.invalidOrExpired', 'This reset link is invalid or has expired. Request a new one to continue.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink-900 flex">
      <AuthBrandPanel />

      <div className="flex-1 flex items-center justify-center p-6 bg-ink-50">
        <div className="w-full max-w-sm">
          <AuthMobileHeader />
          {/* Docs link — always visible (mobile included); see LoginPage.tsx
              for why this row isn't simply "hidden lg:flex" like the old
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

          {done ? (
            <div className="text-center space-y-5">
              <div className="size-14 rounded-full bg-p2-light flex items-center justify-center mx-auto">
                <CheckCircle2 className="size-7 text-p2-dark" />
              </div>
              <div>
                <h2 className="font-display text-2xl font-bold text-ink-900">{t('resetPassword.successTitle', 'Password updated')}</h2>
                <p className="text-ink-500 text-sm mt-1.5">{t('resetPassword.successDesc', 'You can now sign in with your new password.')}</p>
              </div>
              <button
                onClick={() => navigate('/login', { replace: true })}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-accent-600 hover:shadow-md"
              >
                {t('resetPassword.goToSignIn', 'Go to sign in')} <ArrowRight className="size-4" />
              </button>
            </div>
          ) : (
            <div>
              <div className="mb-8">
                <h2 className="font-display text-2xl font-bold text-ink-900">{t('resetPassword.title', 'Choose a new password')}</h2>
                <p className="text-ink-500 text-sm mt-1">{t('resetPassword.subtitle', 'This link is single-use and expires shortly, so finish here.')}</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <div className="space-y-1.5">
                  <label htmlFor="password" className="block text-sm font-medium text-ink-700">{t('resetPassword.newPassword', 'New password')}</label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPw ? 'text' : 'password'}
                      autoComplete="new-password"
                      autoFocus
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('acceptInvite.passwordHint', 'At least 8 characters')}
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

                <div className="space-y-1.5">
                  <label htmlFor="confirm" className="block text-sm font-medium text-ink-700">{t('acceptInvite.confirmPassword', 'Confirm password')}</label>
                  <div className="relative">
                    <input
                      id="confirm"
                      type={showPw ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className={`w-full rounded-xl border bg-white px-4 py-3 pr-11 text-sm text-ink-900 placeholder:text-ink-400 outline-none transition-all focus:ring-2 focus:ring-accent-400 focus:border-transparent ${
                        confirm.length > 0 && !passwordsMatch ? 'border-red-300' : 'border-ink-200'
                      }`}
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
                  disabled={loading || !passwordValid || !passwordsMatch}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-accent-600 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                >
                  {loading ? (
                    <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <>{t('resetPassword.updatePassword', 'Update password')} <ArrowRight className="size-4" /></>
                  )}
                </button>
              </form>

              {error && (
                <Link to="/forgot-password" className="mt-6 block text-center text-sm text-accent hover:text-accent-700 font-medium">
                  {t('resetPassword.requestNewLink', 'Request a new link')}
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}