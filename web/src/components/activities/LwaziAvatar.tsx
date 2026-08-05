import React, { useEffect, useRef, useState } from 'react'

// ── Lwazi's face ─────────────────────────────────────────────────────────
//
// Every "Ask Lwazi" touch-point (the inline trigger, the draft panel
// header, the generate button) used to just show a static Sparkles icon.
// That reads as "AI feature exists here" but not "there's a persona you're
// talking to" — which is the whole point of naming the assistant. This
// gives Lwazi a small, consistent face + body built entirely from the
// app's existing accent/ink tokens (no new colors), designed to feel like
// a little character perched next to the UI rather than a flat icon
// sitting inside a button.
//
// States, tied to what's actually happening rather than decorative motion:
//
//   idle      — gentle float + breathing, occasional soft blink, so it
//               reads as "present" not "static"
//   listening — a pulse ring while typing/about to generate
//   thinking  — eyes settle, mouth becomes three beat-synced dots, body
//               holds still while a request is in flight
//   happy     — wider eyes + raised mouth, and the whole character grows
//               well past the trigger's own box (transform-based, so it
//               overflows visually without ever resizing the button) —
//               used on hover/success so it's genuinely hard to miss
//
// Blink timing is randomized (2.6s–5s) on purpose — a fixed interval reads
// as a loading spinner, not a face. All motion (float, breathing, blink,
// grow, pulse ring) is skipped under prefers-reduced-motion, and the grown
// face is pointer-events-none so it never steals the click from whatever's
// underneath it.
//
// Note: because the grow overflows the trigger's box, the trigger's own
// container (and any ancestor) needs to NOT have `overflow: hidden` for
// the effect to actually be visible — clipping ancestors will cut it off.

export type LwaziState = 'idle' | 'listening' | 'thinking' | 'happy'

interface LwaziFaceProps {
  size?: number
  state?: LwaziState
  className?: string
  /** How large the face grows on 'happy', as a multiple of `size`. Default 2.6. */
  hoverScale?: number
}

// Keyframes are injected once, lazily, on first mount — avoids needing a
// global CSS file just for this component while still only touching the
// DOM once no matter how many avatars are on screen.
let stylesInjected = false
function ensureLwaziStyles() {
  if (stylesInjected || typeof document === 'undefined') return
  stylesInjected = true
  const style = document.createElement('style')
  style.setAttribute('data-lwazi-styles', 'true')
  style.textContent = `
    @keyframes lwazi-float {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-8%) rotate(-3deg); }
    }
    @keyframes lwazi-breathe {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.035); }
    }
    @keyframes lwazi-shadow-pulse {
      0%, 100% { transform: translateX(-50%) scaleX(1); opacity: 0.22; }
      50% { transform: translateX(-50%) scaleX(0.8); opacity: 0.14; }
    }
    @keyframes lwazi-wiggle {
      0%, 100% { rotate: 0deg; }
      50% { rotate: -4deg; }
    }
    .lwazi-float { animation: lwazi-float 3.2s ease-in-out infinite; }
    .lwazi-breathe { animation: lwazi-breathe 3.2s ease-in-out infinite; }
    .lwazi-shadow-pulse { animation: lwazi-shadow-pulse 3.2s ease-in-out infinite; }
    .lwazi-grow {
      transition: transform 360ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .lwazi-grow-active {
      animation: lwazi-wiggle 900ms ease-in-out infinite;
    }
    @media (prefers-reduced-motion: reduce) {
      .lwazi-float, .lwazi-breathe, .lwazi-shadow-pulse, .lwazi-grow-active { animation: none !important; }
      .lwazi-grow { transition: none !important; }
    }
  `
  document.head.appendChild(style)
}

export const LwaziFace: React.FC<LwaziFaceProps> = ({ size = 20, state = 'idle', className = '', hoverScale = 2.6 }) => {
  const [blinking, setBlinking] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const blinkEndRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    ensureLwaziStyles()
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduceMotion(mq.matches)
    const handleChange = (e: MediaQueryListEvent) => setReduceMotion(e.matches)
    mq.addEventListener?.('change', handleChange)
    return () => mq.removeEventListener?.('change', handleChange)
  }, [])

  useEffect(() => {
    if (reduceMotion || state === 'thinking') return

    const scheduleBlink = () => {
      const delay = 2600 + Math.random() * 2400
      timeoutRef.current = setTimeout(() => {
        setBlinking(true)
        blinkEndRef.current = setTimeout(() => setBlinking(false), 130)
        scheduleBlink()
      }, delay)
    }
    scheduleBlink()

    return () => {
      clearTimeout(timeoutRef.current)
      clearTimeout(blinkEndRef.current)
    }
  }, [state, reduceMotion])

  const eyeScaleY = blinking ? 0.12 : state === 'thinking' ? 0.55 : 1
  const eyeRadius = state === 'happy' ? 1.85 : 1.6
  const isHappy = state === 'happy'

  // Idle float holds still while thinking or happy (happy gets its own,
  // much bigger, transform below instead).
  const floatClass = !reduceMotion && state === 'idle' ? 'lwazi-float' : ''

  return (
    <span
      className={`relative inline-flex shrink-0 items-end justify-center ${className}`}
      style={{ width: size, height: size * 1.18, overflow: 'visible' }}
      aria-hidden="true"
    >
      {/* Grounding shadow — fades out while grown so focus stays on the
          face, reads as a character standing/floating next to the UI
          rather than an icon flattened inside it. */}
      <span
        className={`absolute rounded-full bg-ink opacity-20 ${!reduceMotion && state !== 'thinking' && !isHappy ? 'lwazi-shadow-pulse' : ''}`}
        style={{
          width: size * 0.62,
          height: size * 0.12,
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          opacity: isHappy ? 0 : undefined,
          transition: 'opacity 200ms ease-out',
        }}
      />

      {state === 'listening' && (
        <span
          className="motion-safe:animate-ping absolute rounded-full bg-accent-200 opacity-70"
          style={{ width: size, height: size, bottom: size * 0.18 }}
        />
      )}

      {/* Grow stage: scales the whole character up on 'happy' via
          transform only, so it visually overflows the trigger's box
          without ever changing its layout size. pointer-events-none so
          the enlarged face never intercepts clicks meant for the trigger
          underneath it. z-index lifts it above sibling content while grown. */}
      <div
        className={`relative pointer-events-none ${!reduceMotion ? 'lwazi-grow' : ''} ${!reduceMotion && isHappy ? 'lwazi-grow-active' : ''}`}
        style={{
          width: size,
          height: size,
          marginBottom: size * 0.14,
          transformOrigin: '50% 100%',
          transform: isHappy ? `scale(${hoverScale})` : 'scale(1)',
          zIndex: isHappy ? 50 : undefined,
        }}
      >
        <div className={`relative w-full h-full ${floatClass}`}>
          <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            className={`block ${!reduceMotion && state !== 'thinking' ? 'lwazi-breathe' : ''}`}
          >
            {/* Face */}
            <circle cx="12" cy="12" r="11" className="fill-accent" />

            {/* Glossy highlight — pure white at low opacity, no new tokens */}
            <ellipse cx="8.3" cy="6.8" rx="5.4" ry="3.2" className="fill-white" opacity="0.14" />

            {/* Cheeks — a touch of warmth using the existing accent-100 token */}
            <circle cx="6.1" cy="13.8" r="1.15" className="fill-accent-100" opacity="0.4" />
            <circle cx="17.9" cy="13.8" r="1.15" className="fill-accent-100" opacity="0.4" />

            <path
              d="M6 6.5C8 4 10 3 12 3s4 1 6 3.5"
              className="stroke-accent-100"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
              opacity="0.5"
            />

            {/* Eyes */}
            <g style={{ transformOrigin: '8.5px 11px', transform: `scaleY(${eyeScaleY})`, transition: 'transform 90ms ease-out' }}>
              <circle cx="8.5" cy="11" r={eyeRadius} className="fill-white" style={{ transition: 'r 150ms ease-out' }} />
            </g>
            <g style={{ transformOrigin: '15.5px 11px', transform: `scaleY(${eyeScaleY})`, transition: 'transform 90ms ease-out' }}>
              <circle cx="15.5" cy="11" r={eyeRadius} className="fill-white" style={{ transition: 'r 150ms ease-out' }} />
            </g>

            {/* Mouth */}
            {state === 'thinking' ? (
              <g className="fill-white">
                <circle cx="8.7" cy="16" r="1.05" className="motion-safe:animate-pulse" style={{ animationDelay: '0ms' }} />
                <circle cx="12" cy="16" r="1.05" className="motion-safe:animate-pulse" style={{ animationDelay: '150ms' }} />
                <circle cx="15.3" cy="16" r="1.05" className="motion-safe:animate-pulse" style={{ animationDelay: '300ms' }} />
              </g>
            ) : (
              <path
                d={state === 'happy' ? 'M8 15.3c1.2 1.4 2.8 2 4 2s2.8-.6 4-2' : 'M8.7 15.8c1 .7 2.1 1 3.3 1s2.3-.3 3.3-1'}
                className="stroke-white"
                strokeWidth="1.6"
                strokeLinecap="round"
                fill="none"
                style={{ transition: 'd 120ms ease-out' }}
              />
            )}
          </svg>
        </div>
      </div>
    </span>
  )
}

export default LwaziFace