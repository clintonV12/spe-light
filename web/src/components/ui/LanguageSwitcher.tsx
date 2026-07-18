import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Check, ChevronDown } from 'lucide-react'

// Language names are shown in their own language regardless of the active
// locale (standard convention — "Français" doesn't become "French" just
// because the UI is in English). Keep this list in sync with the resources
// registered in src/i18n/index.ts.
const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'pt', label: 'Português' },
] as const

const LOCALE_STORAGE_KEY = 'stratplan-locale' // must match src/i18n/index.ts

interface LanguageSwitcherProps {
  /** Use on dark backgrounds (login hero panel, dark sidebar). Default: light (white top bars). */
  dark?: boolean
  /** Icon-only trigger with no visible label — for tight spaces. */
  compact?: boolean
}

export default function LanguageSwitcher({ dark = false, compact = false }: LanguageSwitcherProps) {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Keep <html lang> in sync for accessibility/SEO, both on mount (in case
  // i18next already picked a persisted locale before this component ever
  // rendered) and on every subsequent change.
  useEffect(() => {
    document.documentElement.lang = i18n.language
    const handleChange = (lng: string) => { document.documentElement.lang = lng }
    i18n.on('languageChanged', handleChange)
    return () => { i18n.off('languageChanged', handleChange) }
  }, [i18n])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const current = LANGUAGES.find((l) => i18n.language?.startsWith(l.code)) ?? LANGUAGES[0]

  const handleSelect = (code: string) => {
    i18n.changeLanguage(code)
    localStorage.setItem(LOCALE_STORAGE_KEY, code)
    setOpen(false)
  }

  const triggerClasses = dark
    ? 'text-ink-300 hover:text-white hover:bg-white/10'
    : 'text-ink-500 hover:text-ink-800 hover:bg-ink-100'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Change language"
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${triggerClasses}`}
      >
        <Globe className="size-3.5 shrink-0" />
        {!compact && <span>{current.label}</span>}
        <ChevronDown className={`size-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-40 rounded-xl border border-ink-100 bg-white shadow-lg py-1 z-50">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => handleSelect(l.code)}
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-ink-700 hover:bg-ink-50 transition-colors"
            >
              {l.label}
              {l.code === current.code && <Check className="size-3.5 text-accent shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}