import React, { useEffect, useRef, useState } from 'react'

// ── Lwazi's face ─────────────────────────────────────────────────────────
//
// Every "Ask Lwazi" touch-point (the inline trigger, the draft panel
// header, the generate button) used to just show a static Sparkles icon.
// That reads as "AI feature exists here" but not "there's a persona you're
// talking to" — which is the whole point of naming the assistant. This
// gives Lwazi a tiny, consistent face built entirely from the app's
// existing accent/ink tokens (no new colors), with three honest states
// tied to what's actually happening rather than decorative animation:
//
//   idle      — occasional soft blink, so it reads as "present" not "static"
//   listening — a gentle pulse ring while typing/about to generate
//   thinking  — eyes settle, mouth becomes three beat-synced dots, while
//               a request is in flight
//   happy     — a slightly wider eye + raised mouth, used on hover so the
//               trigger feels like it's responding to you, not just sitting there
//
// Blink timing is randomized (2.6s–5s) on purpose — a fixed interval reads
// as a loading spinner, not a face. Respects prefers-reduced-motion by
// skipping the blink loop and pulse ring entirely.

export type LwaziState = 'idle' | 'listening' | 'thinking' | 'happy'

interface LwaziFaceProps {
  size?: number
  state?: LwaziState
  className?: string
}

export const LwaziFace: React.FC<LwaziFaceProps> = ({ size = 20, state = 'idle', className = '' }) => {
  const [blinking, setBlinking] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const blinkEndRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

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
  }, [state])

  const eyeScaleY = blinking ? 0.12 : state === 'thinking' ? 0.55 : 1

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {state === 'listening' && (
        <span className="motion-safe:animate-ping absolute inset-0 rounded-full bg-accent-200 opacity-70" />
      )}

      <svg viewBox="0 0 24 24" width={size} height={size} className="relative">
        {/* Face */}
        <circle cx="12" cy="12" r="11" className="fill-accent" />
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
          <circle cx="8.5" cy="11" r="1.6" className="fill-white" />
        </g>
        <g style={{ transformOrigin: '15.5px 11px', transform: `scaleY(${eyeScaleY})`, transition: 'transform 90ms ease-out' }}>
          <circle cx="15.5" cy="11" r="1.6" className="fill-white" />
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
    </span>
  )
}

export default LwaziFace