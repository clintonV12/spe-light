import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, ArrowLeft, MailCheck } from 'lucide-react'
import { authApi } from '../api/endpoints'
import AuthBrandPanel from '../components/auth/AuthBrandPanel'
import AuthMobileHeader from '../components/auth/AuthMobileHeader'
import LanguageSwitcher from '../components/ui/LanguageSwitcher'

// Requests a password reset link for the given email. Always shows the same
// success state regardless of whether the email exists (REQ-F-007 — see
// authsvc.RequestPasswordReset's doc comment) so this page can't be used to
// enumerate registered accounts.
export default function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    try {
      await authApi.requestPasswordReset(email)
    } catch {
      // Intentionally swallowed — the backend always returns 200 here to
      // avoid confirming/denying whether the address is registered, so a
      // network-level failure is the only realistic error path and isn't
      // worth surfacing differently from success.
    } finally {
      setLoading(false)
      setSubmitted(true)
    }
  }

  return (
    <div className="min-h-screen bg-ink-900 flex">
      <AuthBrandPanel />

      <div className="flex-1 flex items-center justify-center p-6 bg-ink-50">
        <div className="w-full max-w-sm">
          <AuthMobileHeader />
          <div className="hidden lg:flex justify-end mb-4">
            <LanguageSwitcher />
          </div>

          {submitted ? (
            <div className="text-center space-y-5">
              <div className="size-14 rounded-full bg-p2-light flex items-center justify-center mx-auto">
                <MailCheck className="size-7 text-p2-dark" />
              </div>
              <div>
                <h2 className="font-display text-2xl font-bold text-ink-900">{t('forgotPassword.checkEmailTitle', 'Check your email')}</h2>
                <p className="text-ink-500 text-sm mt-1.5">
                  {t('forgotPassword.checkEmailDesc', "If an account exists for {{email}}, we've sent a link to reset your password.", { email })}
                </p>
              </div>
              <Link
                to="/login"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-accent-600 hover:shadow-md w-full"
              >
                {t('forgotPassword.backToSignIn', 'Back to sign in')}
              </Link>
            </div>
          ) : (
            <div>
              <div className="mb-8">
                <h2 className="font-display text-2xl font-bold text-ink-900">{t('forgotPassword.title', 'Forgot your password?')}</h2>
                <p className="text-ink-500 text-sm mt-1">
                  {t('forgotPassword.subtitle', "Enter the email on your account and we'll send you a link to reset it.")}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <div className="space-y-1.5">
                  <label htmlFor="email" className="block text-sm font-medium text-ink-700">
                    {t('auth.email', 'Email address')}
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('auth.emailPlaceholder', 'you@company.com')}
                    className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-900 placeholder:text-ink-400 outline-none transition-all focus:ring-2 focus:ring-accent-400 focus:border-transparent"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-accent-600 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                >
                  {loading ? (
                    <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <>{t('forgotPassword.sendLink', 'Send reset link')} <ArrowRight className="size-4" /></>
                  )}
                </button>
              </form>

              <Link to="/login" className="mt-8 flex items-center justify-center gap-1.5 text-sm text-ink-500 hover:text-ink-700 transition-colors">
                <ArrowLeft className="size-3.5" /> {t('forgotPassword.backToSignIn', 'Back to sign in')}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}