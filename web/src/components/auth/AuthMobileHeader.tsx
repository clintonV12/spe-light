import LanguageSwitcher from '../ui/LanguageSwitcher'

/**
 * components/auth/AuthMobileHeader.tsx — compact logo + language switcher
 * shown in place of AuthBrandPanel below the lg breakpoint. Kept in sync
 * with AuthBrandPanel's logo treatment so the brand mark never differs
 * between a desktop and mobile visit to the same auth page.
 */
export default function AuthMobileHeader() {
  return (
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
  )
}