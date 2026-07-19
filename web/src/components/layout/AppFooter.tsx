/**
 * AppFooter — DGRV360COOP style
 *
 * Three-column dark navy footer matching the DGRV360COOP brand:
 *   Left   — DGRV logo + German Cooperation logo
 *   Centre — Quick Links
 *   Right  — Contacts (phone, website, address)
 *
 * HOW TO SWAP IN REAL LOGO IMAGES
 * ────────────────────────────────
 * 1. Drop your PNG/SVG files into  src/assets/logos/
 * 2. Replace the <LogoPlaceholder> components below with:
 *      <img src={dgrvLogoSrc}          alt="DGRV" className="h-12 w-auto" />
 *      <img src={germanCoopLogoSrc}    alt="German Cooperation" className="h-12 w-auto" />
 * 3. Import the images at the top:
 *      import dgrvLogoSrc       from '../../assets/logos/dgrv.png'
 *      import germanCoopLogoSrc from '../../assets/logos/german-cooperation.png'
 */

import { Phone, Globe, MapPin } from 'lucide-react'

// ─── Logo placeholders ────────────────────────────────────────────────────────
// These render as labelled outlines so the layout looks correct before real
// image files are available. Delete each one once you add the real <img>.

function LogoPlaceholder({ label, width = 140, height = 48 }: { label: string; width?: number; height?: number }) {
  return (
    <div
      aria-label={label}
      title={label}
      style={{ width, height }}
      className="rounded border border-white/10 flex items-center justify-center"
    >
      <span className="text-[10px] text-white/30 font-medium text-center px-2 leading-tight">{label}</span>
    </div>
  )
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const QUICK_LINKS = [
  { label: 'Coop Criteria',    href: '#' },
  { label: 'Coop Meet',        href: '#' },
  { label: 'Coop Digi Gap',    href: '#' },
  { label: 'Coop Sustainability', href: '#' },
  { label: 'SPE',              href: '#' },
]

const CONTACTS = [
  {
    id: 'phone',
    icon: Phone,
    label: 'Phone',
    content: '+ 268 7854 2660',
    href: 'tel:+26878542660',
  },
  {
    id: 'website',
    icon: Globe,
    label: 'Mainsite',
    content: 'www.dgrv.coop / eswatini@dgrv.coop',
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
    <footer style={{ backgroundColor: '#1e2d3d' }} className="mt-auto">
      <div className="max-w-7xl mx-auto px-8 py-12">

        {/* ── Three-column grid ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-6">

          {/* ── Col 1: Logos ──────────────────────────────────────────────── */}
          <div className="flex flex-col gap-8">
            {/*
              DGRV logo
              Replace the <LogoPlaceholder> below with:
                <img src={dgrvLogoSrc} alt="DGRV — German Cooperative and Raiffeisen Confederation" className="h-14 w-auto" />
            */}
            <div>
              <LogoPlaceholder label="DGRV logo" width={160} height={52} />
              <p className="text-white/40 text-xs mt-2 leading-snug">
                German Cooperative and<br />Raiffeisen Confederation
              </p>
            </div>

            {/*
              German Cooperation / Deutsche Zusammenarbeit logo
              Replace with:
                <img src={germanCoopLogoSrc} alt="German Cooperation — Deutsche Zusammenarbeit" className="h-14 w-auto" />
            */}
            <LogoPlaceholder label="German Cooperation logo" width={160} height={52} />
          </div>

          {/* ── Col 2: Quick Links ────────────────────────────────────────── */}
          <div>
            <h3 className="text-white font-semibold text-base mb-5 tracking-wide">Quick Links</h3>
            <ul className="space-y-3">
              {QUICK_LINKS.map(({ label, href }) => (
                <li key={label}>
                  <a
                    href={href}
                    className="text-white/60 text-sm hover:text-white transition-colors duration-150 underline underline-offset-2 decoration-white/20 hover:decoration-white/60"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Col 3: Contacts ───────────────────────────────────────────── */}
          <div>
            <h3 className="text-white font-semibold text-base mb-5 tracking-wide">Contacts</h3>
            <div className="space-y-5">
              {CONTACTS.map(({ id, icon: Icon, label, content, href }) => (
                <div key={id} className="flex items-start gap-4">
                  {/* Circle icon */}
                  <div
                    className="shrink-0 size-10 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
                  >
                    <Icon className="size-4 text-white/60" />
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium mb-0.5">{label}</p>
                    {href ? (
                      <a
                        href={href}
                        target={href.startsWith('http') ? '_blank' : undefined}
                        rel="noopener noreferrer"
                        className="text-white/60 text-xs leading-relaxed hover:text-white transition-colors"
                      >
                        {content}
                      </a>
                    ) : (
                      <p className="text-white/60 text-xs leading-relaxed">{content}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* ── Bottom divider + copyright ─────────────────────────────────────── */}
        <div
          className="mt-10 pt-6 flex flex-wrap items-center justify-between gap-3"
          style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
        >
          <p className="text-white/30 text-xs">
            © {new Date().getFullYear()} DGRV360COOP · SPE-Lite. All rights reserved.
          </p>
          <div className="flex items-center gap-5">
            {[
              { label: 'Privacy policy', href: '/privacy'   },
              { label: 'Terms of use',   href: '/terms'     },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                className="text-xs text-white/30 hover:text-white/60 transition-colors"
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