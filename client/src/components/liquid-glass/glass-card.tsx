'use client'

// GlassCard — a card made of liquid glass. Your content sits on it; its face frosts and
// tints whatever lies behind the card, so the text stays readable, and its rim pulls it
// towards the centre.
//
//   <GlassCard className="w-64 p-5">…</GlassCard>                              // frosted glass
//   <GlassCard live className="size-44 p-4">…</GlassCard>                      // something moves behind it
//   <GlassCard blur={0} tint={0.3} className="w-64 p-5">…</GlassCard>          // clearer glass
//   <GlassCard material="tinted" className="bg-sky-500 p-5 text-white">…</GlassCard>
//
// The glass takes the card's corners (rounded-[28px] unless you bring a `rounded-*` class)
// and stays still under the pointer: a card holds content, it is not a button. Size and
// padding are yours, with classes. COPY VERBATIM. MIT — https://github.com/bilalgursen/liquid-glass

import { useMemo, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'

import { GlassLayer, type GlassMaterial, type GlassOptics } from './glass-layer'

export type GlassCardProps = {
  children?: ReactNode
  /** Glass look. Default `clear`: frosts and bends what is behind. `tinted` takes the card's own background colour. */
  material?: GlassMaterial
  /** Clear glass: how much tint covers the backdrop (0–1, default 0.7): white on a light page, black on a dark one. */
  tint?: number
  /** Clear glass: how much the backdrop is frosted, in px like CSS `blur()` (default 5). `0` shows it sharp. */
  blur?: number
  /** Repaint the backdrop every frame, for content that moves behind the card. It then draws while on screen. */
  live?: boolean
  /** Fine-tuning of the glass: tint colour, a rim line, frost mix, bend, light and shadow. Merged over the card's own. */
  optics?: GlassOptics
  className?: string
} & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>

// The card's own glass: the rim pulls the backdrop towards the centre by 6.5% of the viewport,
// fading as (1 − d / (1.35 × half))^9.75; then a 5 px frost over the bent picture, a 70% tint and
// a 1.3 px white line at 60% (25% on dark glass). No colour split, no light. The drop shadow is CSS
// (SHADOW, below), two soft layers under the card, so it reads the same at every card size.
const CARD_OPTICS: GlassOptics = {
  bendMode: 'radial',
  borderColor: '#ffffff',
  borderAlpha: 0.6,
  borderWidth: 1.3,
  frostMix: 1,
  frostEdge: 1,
  saturation: 1,
  refraction: 1,
  bendDepth: 1.35,
  bendCurve: 9.75,
  dispersion: 0,
  magnify: 0,
  light: 0,
  cursorLight: false,
  shadow: 0,
}
const SHADOW = '0 16.5px 36px rgba(0, 0, 0, 0.08), 0 26.4px 55.9px rgba(0, 0, 0, 0.08)'
const TINT = 0.7
const DARK_BORDER_ALPHA = 0.25
const BLUR = 5

// The look before the glass draws (first paint, and the permanent look without WebGL2):
// the same tint and frost in CSS, through --glass-card-tint and --glass-card-blur.
const fallback: Record<GlassMaterial, string> = {
  // Text follows the glass's own tone once it draws, so it reads on any backdrop.
  clear:
    'border border-white/60 bg-white/(--glass-card-tint) text-neutral-900 backdrop-blur-(--glass-card-blur) dark:border-white/25 dark:bg-black/(--glass-card-tint) dark:text-white data-[glass-tone=dark]:text-white data-[glass-tone=light]:text-neutral-900',
  tinted: '',
}

export function GlassCard({ children, material = 'clear', tint = TINT, blur = BLUR, live = false, optics, className = '', style, ...rest }: GlassCardProps) {
  // Rounded unless you bring your own corners: any `rounded-*` class replaces the default
  // (the stylesheet's order, not the class order, would otherwise decide which one wins).
  const corners = /(^|\s)!?rounded-/.test(className) ? '' : 'rounded-[28px]'
  const look = {
    '--glass-card-tint': `${Math.min(1, Math.max(0, tint)) * 100}%`,
    '--glass-card-blur': `${Math.max(0, blur)}px`,
  } as CSSProperties
  // Yours over the card's own; on dark glass the rim line takes its dark opacity.
  const glass = useMemo<GlassOptics>(
    () => ({ ...CARD_OPTICS, ...optics, dark: { borderAlpha: optics?.borderAlpha ?? DARK_BORDER_ALPHA, ...optics?.dark } }),
    [optics],
  )
  return (
    <div data-glass-host="" className={`${corners} ${fallback[material]} ${className}`} style={{ ...look, ...style }} {...rest}>
      {/* The glass layer must be the host's first child. */}
      <GlassLayer material={material} tint={tint} blur={blur} live={live} swell={false} optics={glass} />
      {/* The drop shadow, under the glass: an outer box-shadow never paints inside its own box. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ zIndex: -2, boxShadow: SHADOW }} />
      {children}
    </div>
  )
}

export default GlassCard
