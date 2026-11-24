'use client'

// GlassActionButton — a button for one async action, whose arrow is a separate glass droplet.
// Press it and the droplet melts into the body (the kit's one gooey effect) and stays merged
// while the action runs and after it succeeds:
//
//   idle      [ Deploy ]  ( → )      the arrow floats apart as a droplet
//   pending   [ Deploying     ◌ ]    merged; a spinner turns where the arrow was
//   success   [ Deployed      ✓ ]    still merged; a check draws itself in
//
//   <GlassActionButton
//     material="tinted"
//     className="bg-neutral-900 text-white"
//     pendingLabel="Deploying"
//     successLabel="Deployed"
//     onAction={deploy}            // return the promise: pending lasts until it settles
//   >
//     Deploy
//   </GlassActionButton>
//
// If the action throws, the droplet splits off again and `onActionError` is called.
// `resetAfter` (ms) splits it off again after a success; by default it stays merged.
// Change `resetKey` to split it off yourself ("Start over"): the button stays mounted, so
// the droplet springs out and the label morphs back instead of snapping.
// A label that is plain text changes letter by letter, each coming out of a blur and the dark;
// any other label rises in as one piece.
// Without WebGL2 it is a plain button with a divider. COPY VERBATIM. MIT.

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'

import { GlassLayer, type GlassMaterial } from './glass-layer'

export type GlassActionState = 'idle' | 'pending' | 'success'

export type GlassActionButtonProps = {
  /** The idle label; also the button's accessible name. */
  children: ReactNode
  /** Runs on press. Return a promise to stay pending until it settles. */
  onAction: () => unknown
  /** Called when `onAction` throws or rejects; the button returns to idle. */
  onActionError?: (error: unknown) => void
  /** Label while `onAction` runs. Default: the idle label. */
  pendingLabel?: ReactNode
  /** Label after `onAction` succeeds. Default: the idle label. */
  successLabel?: ReactNode
  /** Milliseconds after a success before the droplet splits off again. 0 (default) stays merged. */
  resetAfter?: number
  /** Change it to return to idle: the droplet splits off again, and a running action's result is dropped. */
  resetKey?: unknown
  /** The droplet's idle icon. Default: an arrow. */
  icon?: ReactNode
  material?: GlassMaterial
  size?: 'sm' | 'md' | 'lg'
  /** Clear glass: how much tint covers the backdrop (0–1). */
  tint?: number
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'onClick'>

// The droplet is as tall as the button. Apart, the body keeps 1.625 × that free at its end
// (droplet + gap); merged, just the droplet's slot. The difference is a spacer that springs
// closed (a child, so the glass re-reading the host's colours never cuts its transition).
const sizes = {
  sm: { host: 'h-8 pl-4 text-[13px]', drop: 'size-8 [&_svg]:size-3.5', apart: 52, merged: 38, cap: 32 },
  md: { host: 'h-10 pl-5 text-sm', drop: 'size-10 [&_svg]:size-4', apart: 65, merged: 46, cap: 40 },
  lg: { host: 'h-12 pl-6 text-[15px]', drop: 'size-12 [&_svg]:size-[18px]', apart: 78, merged: 55, cap: 48 },
}

const fallback: Record<GlassMaterial, string> = {
  // Text follows the glass's own tone once it draws, so it reads on any backdrop.
  clear:
    'border border-black/10 bg-white/60 text-neutral-900 shadow-sm backdrop-blur-md dark:border-white/15 dark:bg-white/10 dark:text-white data-[glass-tone=dark]:text-white data-[glass-tone=light]:text-neutral-900',
  tinted: '',
}

// Letter by letter: each letter takes 0.4s and starts 0.01s after the one before it.
const LETTERS_CSS = `
@keyframes glass-letter{from{opacity:0;filter:blur(10px) brightness(0)}}
[data-glass-letter]{animation:glass-letter .4s ease-out both;animation-delay:calc(var(--glass-c,0) * .01s)}
@media (prefers-reduced-motion:reduce){[data-glass-letter]{animation:none}}
`

const ease = 'duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none'

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
// Optically centred: the head carries the weight, so the arrow sits one unit left of the
// box centre and reads as centred in the droplet.
const Arrow = () => (
  <svg {...svg} strokeWidth="2">
    <path d="M4 12h14" />
    <path d="m11 5 7 7-7 7" />
  </svg>
)
const Spinner = () => (
  <svg {...svg} strokeWidth="2.5" data-glass-spin="">
    <path d="M21 12a9 9 0 1 1-6.22-8.56" />
  </svg>
)
const Check = () => (
  <svg {...svg} strokeWidth="2.5">
    <path data-glass-draw="" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
)

export function GlassActionButton({
  children,
  onAction,
  onActionError,
  pendingLabel,
  successLabel,
  resetAfter = 0,
  resetKey,
  icon,
  material = 'clear',
  size = 'md',
  tint,
  disabled = false,
  className = '',
  type = 'button',
  ...rest
}: GlassActionButtonProps) {
  const s = sizes[size]
  const [state, setState] = useState<GlassActionState>('idle')
  // Swaps animate only after the first press, never on page load.
  const [touched, setTouched] = useState(false)
  const [labelWidth, setLabelWidth] = useState<number>()
  const sizer = useRef<HTMLSpanElement>(null)
  const alive = useRef(true)

  const label = state === 'pending' ? (pendingLabel ?? children) : state === 'success' ? (successLabel ?? children) : children

  // The label's width springs to fit the new text (the sizer holds it, unclipped).
  useEffect(() => {
    const el = sizer.current
    if (!el) return
    const ro = new ResizeObserver(() => setLabelWidth(el.offsetWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (state !== 'success' || !resetAfter) return
    const id = setTimeout(() => setState('idle'), resetAfter)
    return () => clearTimeout(id)
  }, [state, resetAfter])

  // A new `resetKey` returns to idle from wherever the button is. The action that was
  // running is not cancelled, but its result no longer reaches the button.
  const runId = useRef(0)
  const lastKey = useRef(resetKey)
  useEffect(() => {
    if (Object.is(lastKey.current, resetKey)) return
    lastKey.current = resetKey
    runId.current++
    setState('idle')
  }, [resetKey])

  const run = async () => {
    if (state !== 'idle' || disabled) return
    const id = ++runId.current
    const current = () => alive.current && id === runId.current
    setTouched(true)
    setState('pending')
    try {
      await onAction()
      if (current()) setState('success')
    } catch (error) {
      if (current()) setState('idle')
      onActionError?.(error)
    }
  }

  const swap = touched ? { 'data-glass-in': '' } : {}
  // Plain text changes letter by letter: each letter is its own element, in a queue.
  const spelled = typeof label === 'string'
  return (
    <button
      type={type}
      data-glass-host=""
      data-state={state}
      aria-busy={state === 'pending'}
      aria-disabled={state !== 'idle' || undefined}
      disabled={disabled}
      onClick={run}
      style={{ paddingRight: s.merged }}
      className={`inline-flex shrink-0 cursor-pointer items-center rounded-full font-semibold whitespace-nowrap outline-none select-none focus-visible:ring-2 focus-visible:ring-[#3291FF] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-default ${s.host} ${fallback[material]} ${className}`}
      {...rest}
    >
      <GlassLayer material={material} tint={tint} droplet={state === 'idle' ? 'apart' : 'merged'} />
      <style href="liquid-glass-letters" precedence="default">
        {LETTERS_CSS}
      </style>
      <span aria-hidden className={`relative inline-flex overflow-hidden transition-[width] ${ease}`} style={{ width: labelWidth }}>
        <span ref={sizer} className="invisible absolute">
          {label}
        </span>
        {spelled ? (
          <span key={state}>
            {Array.from(label, (char, i) => (
              <span key={i} {...(touched ? { 'data-glass-letter': '' } : {})} style={{ '--glass-c': i } as CSSProperties}>
                {char}
              </span>
            ))}
          </span>
        ) : (
          <span key={state} {...swap}>
            {label}
          </span>
        )}
      </span>
      <span aria-hidden className={`shrink-0 transition-[width] ${ease}`} style={{ width: state === 'idle' ? s.apart - s.merged : 0 }} />
      {/* Divider for the plain CSS look; hidden once the glass draws the droplet itself. */}
      {state === 'idle' && (
        <span aria-hidden data-glass-fallback="" className="pointer-events-none absolute inset-y-2 w-px bg-current opacity-20" style={{ right: s.cap }} />
      )}
      <span aria-hidden data-glass-drop="" className={`pointer-events-none absolute top-0 right-0 flex items-center justify-center [&_svg]:shrink-0 ${s.drop}`}>
        <span key={state} className="flex" {...swap}>
          {state === 'pending' ? <Spinner /> : state === 'success' ? <Check /> : (icon ?? <Arrow />)}
        </span>
      </span>
      <span className="sr-only">{children}</span>
      <span role="status" className="sr-only">
        {state === 'pending' ? (pendingLabel ?? '') : state === 'success' ? (successLabel ?? '') : ''}
      </span>
    </button>
  )
}

export default GlassActionButton
