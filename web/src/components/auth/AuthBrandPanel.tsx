import { useTranslation } from 'react-i18next'
import LanguageSwitcher from '../ui/LanguageSwitcher'

/**
 * components/auth/AuthBrandPanel.tsx — the dark left-hand panel shared by
 * every full-screen auth flow (sign in, accept invite, and any future ones
 * — password reset, SSO landing, etc.). Pulled out of LoginPage so the
 * branding, phase explainer, and self-hosted note stay in exactly one place
 * instead of drifting apart across pages.
 */
export default function AuthBrandPanel() {
  const { t } = useTranslation()

  return (
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
  )
}