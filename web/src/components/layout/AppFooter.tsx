/**
 * AppFooter — same ink-scale family as the AppShell sidebar, one step
 * lighter (ink-800 vs. the sidebar's ink-900) so it reads as its own
 * surface rather than a repeat of the sidebar panel. A 2px accent-
 * coloured top edge is the footer's one signature touch, tying back to
 * the same accent used for active nav state and primary buttons.
 *
 * Three-column dark footer:
 *   Left   — SPE-Lite brand mark + short description, German Cooperation credit
 *   Centre — Quick Links
 *   Right  — Contacts (phone, website, address)
 *
 * Both logo slots use /logo.jpg — the same asset as the sidebar and login
 * screen (see AppShell.tsx / AuthBrandPanel.tsx). There's only one real
 * brand asset available; rather than fall back to placeholder boxes for the
 * programme credit, it reuses the same mark at a smaller, muted treatment
 * so the two slots read as "platform" vs. "programme" rather than as a
 * mistake. Swap the second `<img>`'s src for a dedicated German
 * Cooperation / Deutsche Zusammenarbeit mark if one becomes available.
 */

import { Phone, Globe, MapPin, ArrowUpRight } from 'lucide-react'

// ─── Data ─────────────────────────────────────────────────────────────────────

const QUICK_LINKS = [
  { label: 'Coop Criteria',       href: '#' },
  { label: 'Coop Meet',           href: '#' },
  { label: 'Coop Digi Gap',       href: '#' },
  { label: 'Coop Sustainability', href: '#' },
  { label: 'SPE',                 href: '#' },
]

const CONTACTS = [
  {
    id: 'phone',
    icon: Phone,
    label: 'Phone',
    content: '+268 7854 2660',
    href: 'tel:+26878542660',
  },
  {
    id: 'website',
    icon: Globe,
    label: 'Website',
    content: 'www.dgrv.coop',
    href: 'https://www.dgrv.coop',
  },
  {
    id: 'address',
    icon: MapPin,
    label: 'Address',
    content: 'Lot 265 of Farm 2, Mbabane – Eswatini, known as Raiffeisen House',
    href: undefined,
  },
]

// ─── Component ─────────────────────────────────────────────────────────────────

export default function AppFooter() {
  return (
    <footer className="mt-auto bg-ink-800 border-t-2 border-accent">
      <div className="max-w-7xl mx-auto px-6 md:px-8 py-12 md:py-14">

        {/* ── Three-column grid ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-8">

          {/* ── Col 1: Brand ──────────────────────────────────────────────── */}
          <div className="md:col-span-5 flex flex-col gap-6">
            <div className="flex items-center gap-3">
              <img
                src="/logo.jpg"
                alt="SPE-Lite"
                className="size-11 rounded-xl object-contain shrink-0 ring-1 ring-white/10"
              />
              <div>
                <p className="font-display font-bold text-white text-base tracking-tight">SPE-Lite</p>
                <p className="text-white/40 text-xs">Strategic Planning &amp; Execution Platform</p>
              </div>
            </div>

            <p className="text-white/50 text-sm leading-relaxed max-w-sm">
              Built and maintained by DGRV Eswatini, delivered as part of the German
              Cooperation&rsquo;s regional cooperative development programme.
            </p>

            <div className="flex items-center gap-3 pt-4 border-t border-ink-700">
              <img
                src="/logo.jpg"
                alt="German Cooperation — Deutsche Zusammenarbeit"
                className="size-9 rounded-lg object-contain shrink-0 ring-1 ring-white/10 opacity-80"
              />
              <p className="text-white/40 text-xs leading-snug">
                German Cooperation<br />Deutsche Zusammenarbeit
              </p>
            </div>
          </div>

          {/* ── Col 2: Quick Links ────────────────────────────────────────── */}
          <div className="md:col-span-3">
            <h3 className="text-white font-semibold text-sm tracking-wide uppercase mb-5">Quick Links</h3>
            <ul className="space-y-3">
              {QUICK_LINKS.map(({ label, href }) => (
                <li key={label}>
                  <a
                    href={href}
                    className="group inline-flex items-center gap-1 text-white/55 text-sm hover:text-white transition-colors"
                  >
                    {label}
                    <ArrowUpRight className="size-3 opacity-0 -translate-y-0.5 group-hover:opacity-60 group-hover:translate-y-0 transition-all" />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Col 3: Contacts ───────────────────────────────────────────── */}
          <div className="md:col-span-4">
            <h3 className="text-white font-semibold text-sm tracking-wide uppercase mb-5">Contact</h3>
            <div className="space-y-4">
              {CONTACTS.map(({ id, icon: Icon, label, content, href }) => (
                <div key={id} className="flex items-start gap-3">
                  <div className="shrink-0 size-9 rounded-lg bg-ink-700 border border-ink-600 flex items-center justify-center">
                    <Icon className="size-4 text-white/60" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white/40 text-[11px] uppercase tracking-wide mb-0.5">{label}</p>
                    {href ? (
                      <a
                        href={href}
                        target={href.startsWith('http') ? '_blank' : undefined}
                        rel="noopener noreferrer"
                        className="text-white/70 text-sm hover:text-white transition-colors break-words"
                      >
                        {content}
                      </a>
                    ) : (
                      <p className="text-white/70 text-sm leading-snug">{content}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* ── Bottom bar ─────────────────────────────────────────────────────── */}
        <div className="mt-12 pt-6 border-t border-ink-700 flex flex-wrap items-center justify-between gap-3">
          <p className="text-white/35 text-xs">
            © {new Date().getFullYear()} DGRV Eswatini · SPE-Lite. All rights reserved.
          </p>
          <div className="flex items-center gap-5">
            {[
              { label: 'Privacy policy', href: '/privacy' },
              { label: 'Terms of use',   href: '/terms'   },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                className="text-xs text-white/35 hover:text-white/70 transition-colors"
              >
                {label}
              </a>
            ))}
          </div>
        </div>

      </div>
    </footer>
  )
}