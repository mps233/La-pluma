'use client'

// The lightweight half of GlassPopup: the context and the anchor canvas. Keeping these
// separate lets GlassButtonGroup use the popup contract without importing the engine,
// shader, and menu/select surface machinery.

import { createContext, useEffect, useRef } from 'react'

import type { GlassPopup } from './glass-popup'
import { GlassStyles } from './glass-layer'

/** Each letter of it: how long it takes (seconds), how long after the one before it starts, how soft it starts (CSS px). */
const LETTER = { duration: 0.4, gap: 0.01, blur: 10 }

const CSS = `
[data-glass-popup]{isolation:isolate;overflow:visible!important;background:transparent}
[data-glass-popup][data-glass-off]{background:rgb(255 255 255 / .86);border:1px solid rgb(0 0 0 / .1);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px)}
:is(.dark,[data-theme=dark]) [data-glass-popup][data-glass-off]{background:rgb(23 23 23 / .86);border-color:rgb(255 255 255 / .14)}
[data-glass-popup] :is([role=option],[role=menuitem],[data-glass-item]){transition:background-color .12s ease}
[data-glass-popup]:not([data-glass-off]) :is([role=listbox],[role=menu],[data-glass-list]){opacity:var(--glass-out,0)}
[data-glass-popup]:not([data-glass-off]) :is([role=option],[role=menuitem],[data-glass-item]){--glass-in:clamp(0,calc((var(--glass-items,0) - var(--glass-i,0) * var(--glass-gap)) / var(--glass-fade)),1);opacity:calc(var(--glass-base,1) * var(--glass-in));translate:0 calc((1 - var(--glass-in)) * 6px)}
[data-glass-popup] :is([role=option],[role=menuitem],[data-glass-item])[data-disabled]{--glass-base:.4}
[data-glass-popup][data-glass-arriving] :is([role=listbox],[role=menu],[data-glass-list]){overflow:hidden}
[data-glass-popup][data-glass-off] :is([role=listbox],[role=menu],[data-glass-list]){transition:opacity .16s ease}
[data-glass-popup][data-glass-off]:is([data-starting-style],[data-ending-style]) :is([role=listbox],[role=menu],[data-glass-list]){opacity:0}
[data-glass-anchor]>:not(canvas){translate:0 var(--glass-sway-y,0px);scale:var(--glass-sway-sx,1) var(--glass-sway-sy,1);filter:var(--glass-lit,none)}
[data-glass-popup]:not([data-glass-off]) :is([role=listbox],[role=menu],[data-glass-list]){translate:var(--glass-ride-x,0px) var(--glass-ride-y,0px);scale:var(--glass-zoom,1);clip-path:var(--glass-clip,none);filter:var(--glass-lit,) var(--glass-soft,)}
[data-glass-anchor][data-glass-morphing]>:not(canvas){filter:var(--glass-lit,) blur(var(--glass-label-blur,0px)) opacity(var(--glass-label,1))}
[data-glass-hold]{position:absolute;width:0;height:0;opacity:1;pointer-events:none}
[data-glass-card-shadow]{position:absolute;inset:0;z-index:-2;border-radius:inherit;pointer-events:none;opacity:0;box-shadow:0 20px 48px oklch(0 0 0 / .105),0 3px 10px oklch(0 0 0 / .045)}
[data-glass-popup][data-glass-tone=dark]>[data-glass-card-shadow]{box-shadow:0 22px 55px oklch(0 0 0 / .34)}
[data-glass-popup][data-glass-off]>[data-glass-card-shadow]{opacity:1!important}
[data-glass-anchor][data-glass-label=in] :is([data-glass-char],svg){animation:glass-char ${LETTER.duration}s ease-out both;animation-delay:calc(var(--glass-at,0s) + var(--glass-c,0) * ${LETTER.gap}s)}
[data-glass-anchor][data-glass-morphing] :is([data-glass-char],svg){opacity:0}
@keyframes glass-char{from{opacity:0;filter:blur(${LETTER.blur}px) brightness(0)}to{opacity:1;filter:blur(0) brightness(1)}}
@keyframes glass-hold{to{opacity:0}}
[data-glass-popup]:not([data-glass-off])[data-ending-style]>[data-glass-hold]{animation:glass-hold 60s linear forwards}
@media (prefers-reduced-motion:reduce){
[data-glass-char],[data-glass-anchor] svg{opacity:1!important;animation:none!important}
[data-glass-popup]:not([data-glass-off])[data-ending-style]>[data-glass-hold]{animation:none}
}
`

const canvasStyle = { position: 'absolute', zIndex: -1, maxWidth: 'none', pointerEvents: 'none', width: 0, height: 0 } as const

export const GlassPopupContext = createContext<GlassPopup | null>(null)

/** The anchor's share of the glass: the first child of the control that opens the popup. */
export function GlassPopupAnchor({ popup }: { popup: GlassPopup }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => popup.setTrigger(canvasRef.current), [popup])
  return (
    <>
      <GlassStyles />
      <style href="liquid-glass-popup" precedence="default">
        {CSS}
      </style>
      <canvas ref={canvasRef} aria-hidden style={canvasStyle} />
    </>
  )
}
