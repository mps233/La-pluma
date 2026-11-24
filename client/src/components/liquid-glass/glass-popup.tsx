'use client'

// GlassPopup — the gooey popup, as a building block. A surface (a select's list, a menu, a
// popover) and the control that opens it are one body of liquid glass: the surface swells out of
// the whole anchor, a neck gathers between them, thins and snaps, both halves take the jolt, and
// the options come in one after another. Closing is the same motion played backwards.
//
//   const popup = useGlassPopup()
//   <button data-glass-host className="rounded-full …">     // the anchor: any positioned control
//     <GlassPopupAnchor popup={popup} />                     //   first child
//     Open
//   </button>
//   <Content data-glass-popup data-glass-skip className="rounded-3xl …">   // the popup's content
//     <GlassPopupSurface popup={popup} />                                   //   first child
//     <div role="menu">
//       <div role="menuitem" style={{ '--glass-i': 0 }}>…</div>          // --glass-i: its place in the queue
//     </div>
//   </Content>
//
// Contract (what UI SDK's popups do; any headless library that does the same works): the content
// carries `data-open` while open and `data-ending-style` while it closes, and stays mounted
// until every animation inside it has finished. An empty element (`data-glass-hold`) runs a
// long transition while closing and is finished the moment the glass is back inside the anchor:
// the WebGL exit decides when the popup leaves. Items are `role="option"`, `role="menuitem"` or
// `data-glass-item`, inside `role="listbox"`, `role="menu"` or `data-glass-list`. A press on one
// lights the surface where it lands; `data-glass-pick` gives that light to any other control inside.
// One shape, two canvases: the part inside the anchor's box is drawn beneath its label, the rest
// in the popup's layer (the top layer included). Both draw the same field, so the seam cannot show.
// `useGlassPopup({ opening: 'morph' })` is the other way out: the control itself becomes the
// surface. The same two glasses as above (Button's on the control, Card's on the surface) and
// the same light, with the surface coming out over the control: it grows from the control's box
// to its own (round all the way, a little past it, then settled), the control's label softens
// and goes, its glass gives way to the card and the list comes into focus inside. The surface
// lies over the control then: give the content `sideOffset={-<the control's height>}`. One
// canvas, the surface's, draws both glasses while it is out. It closes by a calmer motion of its
// own: the content goes first, the surface slides back into the control and slows as it lands.
// A label that comes back letter by letter: the label of a morphing control goes in
// <GlassPopupText> (GlassPopover and GlassDropdownMenu do it for their own triggers). The moment
// its surface is back in, as the control swells to take it, the label returns letter by letter,
// out of a blur and the dark.
// Without WebGL2 the surface is a plain frosted panel and the anchor keeps its CSS look.
// COPY VERBATIM. MIT — https://github.com/bilalgursen/liquid-glass

import { Children, createContext, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'

import { drawAround, drawDom } from './dom-snapshot'
import { GLOW, GLOW_SMALL, GOOEY, MORPH, MORPH_GLOW, MORPH_GLOW_SMALL, SPRINGS, clamp, getGlassEngine, lerp, rgbCss, smooth, stepSpring, surfaceColorOf, type GlassEngine, type GlassLens, type GlassView, type Rgb, type Spring } from './engine'
import { GlassStyles } from './glass-layer'

const DESIGN_HEIGHT = 120
/** The control is GlassButton's glass: its tint, no frost, its light and shadow. */
const TINT = 0.6
/** The surface is GlassCard's glass from the moment it leaves the control: frosted, with its tighter bend. */
const CARD = { tint: 0.7, blur: 5, bendCurve: 9.75, bendDepth: 1.35 }
/** Under a control painted in its own colour, the surface's tint covers this much. */
const FILLED = 0.92
/** The surface has no light of its own: this thin white line draws its edge, a soft CSS shadow lifts it. */
const LINE = { alpha: 0.6, darkAlpha: 0.25, width: 1.3 }
/** Room around the trigger's own canvas, and around the popup's. */
const TRIGGER_PAD = 16
const PAD = 28
const PAD_BOTTOM = 56
const TUNE = GOOEY
const ITEMS = ':is([role=option],[role=menuitem],[data-glass-item])'
/** What lights the surface where it is pressed: the items, and anything marked `data-glass-pick` (a popover's Close). */
const PICKS = ':is([role=option],[role=menuitem],[data-glass-item],[data-glass-pick])'
const LIST = ':is([role=listbox],[role=menu],[data-glass-list])'
/** What a morphing surface writes on its content for the list: where it is, how large, its cut and its focus. */
const RIDE = ['--glass-ride-x', '--glass-ride-y', '--glass-zoom', '--glass-clip', '--glass-soft']
/** The bridge forms fast; once the thread has broken, what is left of the tension lets go at once. */
const ATTACH = { omega: 28, zeta: 1 }
const LET_GO = { omega: 16, zeta: 1 }
/** How far through the opening the near edge has crossed the gap, and the list shows. */
const NEAR_EDGE = 0.3
/** Closed, the control answers the pointer as GlassButton does (GlassLayer's own values). */
const PRESS_SCALE = 1.08
const HOVER_SCALE = 1.04
const HOVER_GROW = 0.08
const MAX_GROW_PX = 6
/** Once the popup is back inside it, the control swells as if hovered for this long (seconds), then lets go. */
const SETTLE = 0.16
/** A morphing control lights up as it takes its surface back: this much of a press, at its middle. */
const SETTLE_GLOW = 0.7
/** What a morphing popup's light does to the content on it: how much it brightens it (× the light there), and the soft white bloom it leaves around it (px, alpha). */
const CONTENT_GLOW = { lift: 0.55, bloom: 7, alpha: 0.65 }
/** Each letter of it: how long it takes (seconds), how long after the one before it starts, how soft it starts (CSS px). */
const LETTER = { duration: 0.4, gap: 0.01, blur: 10 }
/** A morphing surface's content follows each side of the glass, at most this much (×) off its even size: past it, text would look stretched. */
const MAX_STRETCH = 1.06

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
[data-glass-anchor][data-glass-label=in] [data-glass-char]{animation:glass-char ${LETTER.duration}s ease-out both;animation-delay:calc(var(--glass-at,0s) + var(--glass-c,0) * ${LETTER.gap}s)}
[data-glass-anchor][data-glass-morphing] [data-glass-char]{opacity:0}
@keyframes glass-char{from{opacity:0;filter:blur(${LETTER.blur}px) brightness(0)}to{opacity:1;filter:blur(0) brightness(1)}}
@keyframes glass-hold{to{opacity:0}}
[data-glass-popup]:not([data-glass-off])[data-ending-style]>[data-glass-hold]{animation:glass-hold 60s linear forwards}
@media (prefers-reduced-motion:reduce){
[data-glass-char]{opacity:1!important;animation:none!important}
[data-glass-popup]:not([data-glass-off])[data-ending-style]>[data-glass-hold]{animation:none}
}
`

type Box = { L: number; T: number; W: number; H: number }
type Page = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null; key: string; at: number; stale: boolean; fill: string }

const newPage = (): Page => ({ canvas: document.createElement('canvas'), ctx: null, key: '', at: 0, stale: true, fill: '' })

/** The shared physics and shape of one popup: the anchor's canvas and the surface's both draw it. */
function createMorph(matchWidth: boolean, morphs: boolean, from: GlassPopupFrom) {
  /** Which way a morphing surface comes into place: 1 from above (the control is thrown down), -1 from below. */
  const way = from === 'bottom' ? -1 : 1
  let engine: GlassEngine | null = null
  let host: HTMLElement | null = null
  let content: HTMLElement | null = null
  let holdEl: HTMLElement | null = null
  let triggerView: GlassView | null = null
  let panelView: GlassView | null = null

  const open: Spring = { x: 0, v: 0 }
  const bridge: Spring = { x: 0, v: 0 }
  const recoil: Spring = { x: 0, v: 0 }
  // `opening: 'morph'`: the control becomes the surface. `open` is the side that grows the most,
  // `cross` the other one, and `calm` what follows without a bounce (corners, frost, focus).
  const cross: Spring = { x: 0, v: 0 }
  const calm: Spring = { x: 0, v: 0 }
  /** Seconds since a morphing control was pressed open: its surface comes out after the throw. */
  let waited = 0
  /** The surface's way into place: it comes down from above on a soft spring of its own (0 = still up, 1 = in place). */
  const drop: Spring = { x: 0, v: 0 }
  /** And seconds since it was asked to close: it may stay out a moment first. */
  let lingered = 0
  // The control's own swell under the pointer, while the popup is shut.
  const swPress: Spring = { x: 0, v: 0 }
  const swX: Spring = { x: 0, v: 0 }
  const swY: Spring = { x: 0, v: 0 }
  const swScale: Spring = { x: 1, v: 0 }
  // The light a press lets in: how bright, how far it has spread, where it landed (from the
  // control's centre, px) and how long it still holds.
  const glow: Spring = { x: 0, v: 0 }
  const glowSpread: Spring = { x: 0, v: 0 }
  const glowAt = { x: 0, y: 0 }
  let glowHold = 0
  /** This light opens the surface: it grows with it. */
  let glowWide = false
  /** This light is a choice in the list: it stays around the choice and leaves with the surface. */
  let glowList = false
  /** A morphing control's label, once its surface is back in: '' as it is, 'in' coming back letter by letter. */
  let label: '' | 'in' = ''
  const setLabel = (next: typeof label) => {
    if (label === next) return
    label = next
    if (!host) return
    if (next) host.dataset.glassLabel = next
    else delete host.dataset.glassLabel
  }
  /** How small the control is, 0–1 (as the bridge reads it): which set of light values it takes. */
  let glowSmall = 0
  const smallness = (width: number, height: number) => 1 - smooth(2, 2.4, width / Math.max(height, 1))
  /** The light's values for this control: the wide set, the small set on a small one, a blend in between. A morphing control has its own pair. */
  const glowTune = (): typeof GLOW => {
    const wideSet = morphs ? MORPH_GLOW : GLOW
    const smallSet = morphs ? MORPH_GLOW_SMALL : GLOW_SMALL
    if (glowSmall <= 0) return wideSet
    if (glowSmall >= 1) return smallSet
    const mixed = { ...wideSet }
    for (const key of Object.keys(mixed) as (keyof typeof GLOW)[]) mixed[key] = lerp(wideSet[key], smallSet[key], glowSmall)
    return mixed
  }
  /** How many presses' worth of light is asked for: each adds to what is still lit (a choice in the list adds GLOW.select of one). */
  let glowLevel = 0
  let hovered = false
  let pressed = false
  /** The swell that greets the popup's return: seconds of it left, and whether the popup was shut a frame ago. */
  let settle = 0
  let wasShut = true
  let moving = false
  let joined = false
  let wasJoined = false
  let pushed = false
  let snapped = false
  /** The opening as it played, frame by frame; and where a rewind of it has got to (seconds, or null). */
  let rec: { t: number; open: number; bridge: number; rc: number; reveal: number; snapped: boolean; cross: number; calm: number; drop: number }[] = []
  let recT = 0
  let rewind: number | null = null
  let panelDrawn = false
  let ready = false
  let dir = 1
  let surface: Rgb = [1, 1, 1]
  let tint: Rgb = [1, 1, 1]
  /** How much of the tint covers the control: Button's, or all of it on a control painted in its own colour. */
  let cover = TINT
  /** And how much covers the surface: the card's, or nearly all of it under a painted control, so the list keeps its colour. */
  let cardCover = CARD.tint
  let panelRadius = 24

  const isOpen = () => !!content && content.hasAttribute('data-open') && !content.hasAttribute('data-ending-style')
  // The closing popup leaves the moment the glass is back inside the trigger.
  const release = () => holdEl?.getAnimations().forEach((a) => a.finish())
  // The list comes in once the panel is open, one option after another (`reveal` = seconds since
  // the first one started); closing fades them out together.
  let reveal = 0
  let out = 0
  let lastPlace = -1
  let placed = -1
  const stepItems = (goal: number, dt: number, still: boolean, fixed?: number) => {
    if (!content) return false
    if (morphs) {
      // The whole list is there from the start, inside the growing glass: it fades up as it comes into focus, not in a queue.
      const follows = still ? goal : smooth(0, Math.max(MORPH.contentFade, 0.01), clamp(calm.x))
      // (A soft close lets the content go ahead of the glass, in MORPH.closeFade seconds.)
      out = !still && !goal && MORPH.closeSoft > 0.5 ? Math.min(follows, Math.max(0, out - dt / Math.max(MORPH.closeFade, 0.01))) : follows
      reveal = out > 0 ? 99 : 0
    } else if (fixed !== undefined) {
      // Rewinding: the list is wherever it was at that moment of the opening.
      reveal = fixed
      out = 1
    } else if (still) {
      reveal = goal ? 99 : 0
      out = goal
    } else if (goal) {
      out = 1
      if (open.x > TUNE.itemsAt) reveal = Math.min(reveal + dt, 99)
    } else {
      out = Math.max(0, out - dt / 0.12)
      if (!out) reveal = 0
    }
    // Written only when a value changes: each write restyles the whole list.
    const st = content.style
    const put = (name: string, value: string) => {
      if (st.getPropertyValue(name) !== value) st.setProperty(name, value)
    }
    const items = content.querySelectorAll<HTMLElement>(ITEMS)
    const count = items.length
    // The last place in the queue (--glass-i), read once per opening: past it the list is all
    // in, and the value stops changing. Every change of it restyles the whole list.
    if (reveal === 0) lastPlace = -1
    else if (lastPlace < 0 || count !== placed) {
      lastPlace = 0
      placed = count
      for (const el of items) lastPlace = Math.max(lastPlace, parseFloat(el.style.getPropertyValue('--glass-i') || getComputedStyle(el).getPropertyValue('--glass-i')) || 0)
    }
    const fade = Math.max(TUNE.itemsFade, 0.01)
    put('--glass-items', (lastPlace < 0 ? reveal : Math.min(reveal, Math.max(lastPlace, count) * TUNE.itemsGap + fade)).toFixed(3))
    put('--glass-out', out.toFixed(3))
    put('--glass-gap', String(TUNE.itemsGap))
    put('--glass-fade', String(fade))
    const arriving = !morphs && (!!goal || fixed !== undefined) && reveal < count * TUNE.itemsGap + TUNE.itemsFade
    // Options rise into place: until they have, their offset must not count as scrollable overflow.
    if (arriving !== 'glassArriving' in content.dataset) {
      if (arriving) content.dataset.glassArriving = ''
      else delete content.dataset.glassArriving
    }
    return morphs ? false : goal ? arriving : out > 0
  }
  // A style is written only when it changes: a write between two measurements makes the
  // browser lay the page out again, on every frame of an opening.
  const written = new WeakMap<HTMLElement, Record<string, string>>()
  const write = (el: HTMLElement, name: string, value: string) => {
    let last = written.get(el)
    if (!last) written.set(el, (last = {}))
    if (last[name] === value) return
    last[name] = value
    el.style.setProperty(name, value)
  }
  let listEl: HTMLElement | null = null
  const listOf = () => (listEl?.isConnected && content?.contains(listEl) ? listEl : (listEl = content?.querySelector<HTMLElement>(LIST) ?? null))
  const panelRect = () => {
    const c = content?.getBoundingClientRect()
    return c && c.width > 2 && c.height > 2 ? c : null
  }
  /**
   * The reaction: a morphing surface has just gone back in, and its way in carries the control on.
   * The same throw as the opening's, the other way: along the surface's return, or up from the middle.
   */
  let rebounding = false
  const rebound = () => {
    // (A soft close ends quietly: the control is not thrown.)
    if (!morphs || !host || MORPH.closeSoft > 0.5) return
    const c = panelRect()
    const a = host.getBoundingClientRect()
    const from = c ? c.top + c.height / 2 - (a.top + a.height / 2) : 0
    recoil.x = 0
    recoil.v = ((from < -4 ? 1 : -1) * MORPH.kick * MORPH.closeKick) / Math.max(MORPH.weight, 0.1)
    rebounding = recoil.v !== 0
  }
  const dirty = () => {
    if (triggerView) triggerView.dirty = true
    if (panelView) panelView.dirty = true
    engine?.wake()
  }

  /**
   * Light at this point (viewport px), or at the control's centre. `gain` dims it; a point in the
   * list is not held to the control's box, and its light stays around it. `wide`: the press that
   * opens the surface, whose light grows with the surface until it covers it. Any other press on
   * the control (the one that closes the surface) lights the control alone.
   */
  const light = (x?: number, y?: number, gain = 1, inList = false, wide = !inList && !isOpen()) => {
    if (!host) return
    const r = host.getBoundingClientRect()
    // A light that is still bright keeps spreading from where it is: only a fresh one starts small.
    if (glow.x < 0.08) glowSpread.x = glowSpread.v = 0
    // A press on the control stays in its box; a choice in the list lands where it is.
    const reach = inList ? Infinity : 0.5
    glowAt.x = x === undefined ? 0 : clamp(x - (r.left + r.width / 2), -r.width * reach, r.width * reach)
    glowAt.y = y === undefined ? 0 : clamp(y - (r.top + r.height / 2), -r.height * reach, r.height * reach)
    glowSmall = smallness(host.offsetWidth, host.offsetHeight)
    const tune = glowTune()
    glowLevel = Math.min(Math.max(glow.x, 0) + gain * (inList ? tune.select : 1), tune.stack)
    glowWide = wide
    glowList = inList
    glowHold = tune.hold
  }
  const stepGlow = (dt: number) => {
    // The light that opens the surface is a flash: it lets go once the surface is part of the
    // way out, however long the press is held, and fades faster than a press on its own.
    const opening = glowWide && isOpen()
    const tune = glowTune()
    const on = opening ? open.x < tune.coverUntil : pressed || glowHold > 0
    glowHold = Math.max(0, glowHold - dt)
    const a = stepSpring(glow, on ? glowLevel : 0, { omega: on ? tune.riseSpeed : opening ? tune.coverFadeSpeed : tune.fadeSpeed, zeta: 1 }, dt)
    const b = stepSpring(glowSpread, on || glow.x > 0.004 ? 1 : 0, { omega: tune.spreadSpeed, zeta: 1 }, dt)
    // A press held still changes nothing: the loop rests until the hold runs out or the press ends.
    return glowHold > 0 || a || (b && glow.x > 0.004)
  }

  const maxScale = () => 1 + (2 * MAX_GROW_PX) / Math.max(host?.offsetWidth ?? 1, 1)
  /** Hover swells the control and press grows it, as GlassLayer does; an open popup holds it still. */
  const stepSwell = (dt: number, still: boolean) => {
    if (!host) return false
    const shut = !isOpen() && open.x < 0.004
    if (still) {
      swPress.x = swX.x = swY.x = swPress.v = swX.v = swY.v = swScale.v = 0
      swScale.x = 1
      glow.x = glow.v = glowSpread.x = glowSpread.v = glowHold = 0
      host.style.scale = ''
      settle = 0
      wasShut = shut
      setLabel('')
      return false
    }
    // The popup has just gone back in: the control takes it like a hover, and lets go again.
    if (shut && !wasShut) {
      settle = SETTLE
      // A morphing control lights up with that swell. A press still lit is topped up, never added to.
      // (Not after a soft close, which ends without a light.)
      if (morphs && MORPH.closeSoft <= 0.5 && glow.x < SETTLE_GLOW) light(undefined, undefined, SETTLE_GLOW - Math.max(glow.x, 0), false, false)
      // A label that comes back letter by letter (GlassPopupText) does so with that swell, at once.
      if (morphs) setLabel('in')
    }
    if (!shut) setLabel('')
    wasShut = shut
    const greeting = settle > 0
    settle = Math.max(0, settle - dt)
    const hov = (hovered || greeting) && shut ? 1 : 0
    const down = pressed && shut
    const target = down ? Math.min(PRESS_SCALE, maxScale()) : hov ? Math.min(HOVER_SCALE, maxScale()) : 1
    const a = stepSpring(swPress, down ? 1 : 0, SPRINGS.press, dt)
    const b = stepSpring(swX, hov, SPRINGS.hoverX, dt)
    const c = stepSpring(swY, hov, SPRINGS.hoverY, dt)
    const d = stepSpring(swScale, target, SPRINGS.press, dt)
    host.style.scale = swScale.x === 1 ? '' : swScale.x.toFixed(4)
    const e = stepGlow(dt)
    return a || b || c || d || e || greeting
  }

  /** The surface's glass, whichever way it comes out: Card's frost and bend, and the thin white line at its edge. */
  const surfaceGlass = () => ({ frost: cardCover, blur: CARD.blur, bendCurve: CARD.bendCurve, bendDepth: CARD.bendDepth, borderAlpha: tint[0] > 0.5 ? LINE.alpha : LINE.darkAlpha, borderWidth: LINE.width })

  /** Everything both canvases need, in viewport px. */
  const measure = () => {
    if (!host) return null
    // The control itself is scaled while it swells: measure it unscaled. Its canvas undoes that
    // scale (see the trigger's lens), so both canvases draw in the page's own space.
    const r = host.getBoundingClientRect()
    const sc = Math.max(0.5, Number(swScale.x.toFixed(4)))
    const a = sc === 1 ? r : new DOMRect(r.left + (r.width - host.offsetWidth) / 2, r.top + (r.height - host.offsetHeight) / 2, host.offsetWidth, host.offsetHeight)
    if (a.width < 2 || a.height < 2) return null
    glowSmall = smallness(a.width, a.height)
    const sk = lerp(1, Math.min(PRESS_SCALE, maxScale()), clamp(swPress.x, -0.12, 1.15))
    const grow = a.height * HOVER_GROW
    const c = panelRect()
    const b = clamp(bridge.x, 0, 1.1)
    // The jolt in steps of 1/128 (a fortieth of a pixel on the glass): its long, slow tail
    // gives the same frame many times over, and the engine draws a frame once.
    const thrown = Math.round(recoil.x * 128) / 128
    // (A morphing control is thrown as a whole, below: it is not squeezed.)
    const rc = morphs ? 0 : thrown
    if (c) dir = c.top < a.top ? -1 : 1
    // The trigger: it sags towards the panel while they hold on, and jolts away when they part.
    // The pull on it grows as the panel comes out and eases off as it goes back in, so the
    // trigger is already at rest when the popup leaves.
    const hold = c ? b * smooth(0, 0.6, clamp(open.x)) : 0
    const body = {
      cx: a.left + a.width / 2,
      // (A morphing control is thrown down by its own weight at the press, before its surface comes out.)
      cy: a.top + a.height / 2 + dir * (TUNE.triggerSag * hold - TUNE.triggerJolt * rc) + (morphs ? way * MORPH.throw * thrown : 0),
      hx: (a.width / 2) * sk + grow * swX.x - 1.5 * hold + 3.2 * rc,
      hy: (a.height / 2) * sk + grow * swY.x + hold - 2 * rc,
    }
    let blob: GlassLens['blob']
    /** How far the surface sticks out of the control, 0–1: its shadow comes with it. */
    let out = 0
    joined = false
    if (c && !morphs) {
      const y = clamp(open.x, -0.04, 1.08)
      const t = clamp(y)
      const edge = dir < 0 ? a.top : a.bottom
      const panelNear = dir < 0 ? c.bottom : c.top
      const panelFar = dir < 0 ? c.top : c.bottom
      // The panel starts inside the trigger. Its near edge crosses the gap first and leans back
      // towards the trigger while the bridge holds; a jolt throws it the other way.
      // (A panel still inside the trigger has nowhere to be thrown.)
      const jolt = dir * TUNE.panelJolt * rc * smooth(0, 0.35, t)
      const near = lerp(edge - dir * 6, panelNear - dir * TUNE.neckPull * b, smooth(0, NEAR_EDGE, t)) + jolt
      const far = lerp(edge - dir, panelFar, y) + jolt * 0.5
      const hx = lerp(a.width * 0.3, c.width / 2, y) * (1 - 0.012 * rc)
      const hy = Math.max(Math.abs(far - near) / 2, 0.5)
      out = smooth(0, 48, dir * (far - edge))
      // The softness follows how far the panel sticks out: at full strength a panel still inside
      // the trigger would swell it, and with none the two bodies would meet in a visible crease.
      // How small the control is: 1 for a single icon or about five letters (up to twice as wide
      // as it is tall), 0 from 2.4 times as wide (seven letters).
      const small = 1 - smooth(2, 2.4, a.width / a.height)
      const k = Math.max(lerp(TUNE.neckSoftness, TUNE.smallNeckSoftness, small) * b * smooth(0, 90, dir * (far - edge)), 0.05)
      // Two facing edges stay bridged while the softness is over twice the gap between them.
      joined = k > 2 * Math.max(dir * (near - (body.cy + dir * body.hy)), 0)
      blob = {
        x: lerp(body.cx, c.left + c.width / 2, t) - body.cx,
        y: (near + far) / 2 - body.cy,
        hx,
        hy,
        // Still attached, the panel is rounder: surface tension lets go as the neck does.
        r: Math.min(lerp(panelRadius, panelRadius * 1.8, b), hx, hy),
        k,
        // The bridge spans the whole trigger at first and gathers into a neck at its middle. On a
        // small control a neck that narrow would stand out as a ridge: there it is no thinner
        // than the control's height allows, and the softness fades towards its far edge.
        neck: { x: 0, w: Math.max(a.width * lerp(0.2, 0.6, clamp(b)), small * a.height * lerp(TUNE.smallNeck, TUNE.smallNeckWide, clamp(b))) },
        fade: { amount: clamp(TUNE.smallEdgeFade) * small, reach: TUNE.smallEdgeReach },
        // One surface from start to finish: the card's glass, melted into the control's at the neck.
        material: surfaceGlass(),
      }
    }
    // `opening: 'morph'`: the same two glasses, the surface coming out over the control itself. It
    // grows from the control's box to its own, in the card's glass from the first frame, while the
    // control under it keeps Button's glass until it gives way (`card`, below).
    let morph: { cx: number; cy: number; hx: number; hy: number; r: number; zoomX: number; zoomY: number; list: Box | null } | undefined
    if (c && morphs && content) {
      // The side that has further to go leads, on `open`; the other follows on `cross`.
      const tall = Math.abs(c.height - a.height) >= Math.abs(c.width - a.width)
      const lead = open.x
      const follow = cross.x
      // Thinner across while the first side is ahead, wider once the other has passed it.
      const lean = clamp(1 - MORPH.pinch * (lead - follow), 0.5, 1.3)
      // It starts round, in the control's middle (MORPH.seed: 0 = a circle as tall as the control, 1 = the control's own box).
      const hx = Math.max(lerp(lerp(Math.min(body.hx, body.hy), body.hx, clamp(MORPH.seed)), c.width / 2, tall ? follow : lead) * (tall ? lean : 1), 1)
      const hy = Math.max(lerp(body.hy, c.height / 2, tall ? lead : follow) * (tall ? 1 : lean), 1)
      const cx = lerp(body.cx, c.left + c.width / 2, tall ? follow : lead)
      // It comes out of the control where the throw has taken it, and opens towards its own middle.
      // As it grows it is carried MORPH.drop px above its place (below it, coming from below), and comes into it on a soft spring of its own.
      const cy = lerp(body.cy, c.top + c.height / 2, tall ? lead : follow) - way * MORPH.drop * (clamp(lead) - Math.min(drop.x, clamp(lead)))
      // Round all the way while it grows; the surface's own corners as it settles.
      const r = Math.min(lerp(Math.min(hx, hy), panelRadius, smooth(Math.min(MORPH.cornersFrom, 0.99), 1, clamp(calm.x))), hx, hy)
      const list = listOf()
      // How far the surface sticks out of the control, as the stretch counts it: its shadow comes with it.
      out = smooth(0, 48, 2 * Math.max(hx - body.hx, hy - body.hy))
      // Two shapes laid over each other, with a clean edge where they meet; gooey only if asked for.
      blob = { x: cx - body.cx, y: cy - body.cy, hx, hy, r, k: MORPH.gooey > 0.5 ? Math.max(MORPH.softness, 0.05) : 0.05, material: surfaceGlass() }
      const fx = hx / (c.width / 2)
      const fy = hy / (c.height / 2)
      const even = Math.sqrt(fx * fy)
      morph = {
        cx,
        cy,
        hx,
        hy,
        r,
        // The content is as large as the glass is far along (MORPH.zoom of that: 0 keeps it full size),
        // side by side: it takes the swing of each, as far as its text can stretch without showing it.
        zoomX: lerp(1, clamp(even * clamp(fx / even, 1 / MAX_STRETCH, MAX_STRETCH), 0.1, 1.5), clamp(MORPH.zoom)),
        zoomY: lerp(1, clamp(even * clamp(fy / even, 1 / MAX_STRETCH, MAX_STRETCH), 0.1, 1.5), clamp(MORPH.zoom)),
        list: list && { L: c.left + content.clientLeft + list.offsetLeft, T: c.top + content.clientTop + list.offsetTop, W: list.offsetWidth, H: list.offsetHeight },
      }
    }
    const t = clamp(open.x)
    // The surface turns into the card as the neck lets go, and back before it forms again. A
    // morphing control gives way to the card under it as the surface settles.
    const card = !c ? 0 : morphs ? smooth(MORPH.frostFrom, Math.max(MORPH.frostTo, MORPH.frostFrom + 0.01), clamp(calm.x)) : (1 - smooth(0, 0.35, clamp(b))) * smooth(0.35, 0.8, t)
    // Parted: the control draws itself alone, with its own shadow, whatever the card does.
    // What the control's own content takes of all this: the sag and the throw, and the squash.
    const sway = { y: body.cy - (a.top + a.height / 2), sx: 1 + (3.2 * rc - 1.5 * hold) / (a.width / 2), sy: 1 + (hold - 2 * rc) / (a.height / 2) }
    // The list rides the panel the same way (its near edge is thrown twice as far as its far one).
    const ride = c ? 0.75 * dir * TUNE.panelJolt * rc * smooth(0, 0.35, clamp(open.x)) : 0
    // The light: around where the press landed, a little wider as it fades. The light that opens
    // the surface moves to the surface's middle and widens with it, until it covers it whole.
    // A choice in the list keeps its light around itself, and the light leaves with the surface:
    // a surface on its way back in is never lit whole. A press on the control while the surface
    // is out (the one that closes it) lights the control alone.
    const tune = glowTune()
    const wide = glowWide && blob && tune.cover > 0 ? smooth(0, 1, t) : 0
    const spreading = clamp(glowSpread.x)
    // A soft close takes a choice's light along: it slides into the control with the surface and
    // fades there in its own time, where the opening played backwards puts it out as it leaves.
    const carried = morphs && glowList && MORPH.closeSoft > 0.5 && !isOpen()
    const home = carried ? 1 - smooth(0, 1, t) : 0
    const reach = a.height * sc * (glowList ? tune.selectReach + tune.selectSpread * spreading : tune.reach + tune.spread * spreading)
    const lit =
      glow.x > 0.004
        ? {
            x: lerp(lerp(glowAt.x, 0, home), blob?.x ?? 0, wide),
            y: lerp(lerp(glowAt.y - sway.y, 0, home), blob?.y ?? 0, wide),
            r: lerp(lerp(reach, Math.min(reach, a.height * sc * MORPH.closeGlowReach), home), Math.max(reach, 2 * tune.cover * Math.hypot(blob?.hx ?? 0, blob?.hy ?? 0)), wide),
            amount: Math.max(0, glow.x) * tune.amount * (glowList && !carried ? smooth(Math.min(tune.selectLeave, 0.99), 1, t) : 1),
            blob: glowWide || glowList ? 1 : 0,
            spill: tune.halo,
          }
        : undefined
    // Borders, read here with the rest: after this, a frame only writes.
    const edge = { hostLeft: host.clientLeft, hostTop: host.clientTop, left: content?.clientLeft ?? 0, top: content?.clientTop ?? 0 }
    // Once the surface's canvas has drawn, it carries the whole body: the control's own canvas rests.
    const onPanel = !!morph && panelDrawn && (t >= 0.004 || isOpen())
    // Where the two canvases meet: the control's box, on whole device pixels. One draws inside
    // it and the other outside, with nothing drawn twice: a shadow drawn twice shows as a square.
    const dpr = window.devicePixelRatio || 1
    const snap = (v: number) => Math.round(v * dpr) / dpr
    const seam = { left: snap(a.left), top: snap(a.top), right: snap(a.right), bottom: snap(a.bottom) }
    return { a, c, sc, seam, body, blob, t, card, out, sway, ride, lit, edge, morph, onPanel, parted: morphs ? !!blob && card >= 0.999 : card > 0 && !joined }
  }
  // One measurement per frame. Both canvases draw the same shape, and each writes styles as
  // it draws: a second measurement after those writes would lay the page out again.
  let measured: ReturnType<typeof measure> = null
  let fresh = false
  const shape = () => {
    if (!fresh) {
      fresh = true
      measured = measure()
      queueMicrotask(() => (fresh = false))
    }
    return measured
  }

  /** The content moves with its glass: the control's label and the list take the sag, the throw and the squash. */
  const carry = (s: NonNullable<ReturnType<typeof shape>>) => {
    const set = (el: HTMLElement | null, name: string, value: string, rest: string) => {
      if (!el) return
      if (value === rest) el.style.removeProperty(name)
      else if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value)
    }
    set(host, '--glass-sway-y', `${s.sway.y.toFixed(2)}px`, '0.00px')
    set(host, '--glass-sway-sx', s.sway.sx.toFixed(4), '1.0000')
    set(host, '--glass-sway-sy', s.sway.sy.toFixed(4), '1.0000')
    if (!morphs) return set(content, '--glass-ride-y', `${s.ride.toFixed(2)}px`, '0.00px')
    // The control's label leaves as its glass does: softer, then gone.
    const gone = smooth(0, MORPH.labelOut, s.t)
    if (host && gone > 0 !== 'glassMorphing' in host.dataset) {
      if (gone > 0) host.dataset.glassMorphing = ''
      else delete host.dataset.glassMorphing
    }
    set(host, '--glass-label', (1 - gone).toFixed(3), '1.000')
    set(host, '--glass-label-blur', `${(MORPH.labelBlur * gone).toFixed(2)}px`, '0.00px')
    // The list rides the glass: as large as the glass is far along, cut to its shape, coming into focus.
    const m = s.morph
    const l = m?.list
    // The light reaches what lies on the glass too, as strong as it is there (x, y: from the control's centre).
    const litAt = (x: number, y: number) => {
      if (!s.lit) return ''
      const d = Math.hypot(x - s.lit.x, y - s.lit.y) / Math.max(s.lit.r, 1)
      const a = s.lit.amount * Math.exp(-d * d)
      if (a < 0.02) return ''
      return `brightness(${(1 + a * CONTENT_GLOW.lift).toFixed(3)}) drop-shadow(0 0 ${(CONTENT_GLOW.bloom * Math.min(a, 1)).toFixed(1)}px rgb(255 255 255 / ${(CONTENT_GLOW.alpha * Math.min(a / 2, 1)).toFixed(3)}))`
    }
    set(host, '--glass-lit', litAt(0, 0), '')
    // (A light kept to the control never reaches the surface's content.)
    set(content, '--glass-lit', m && s.lit?.blob ? litAt(m.cx - s.body.cx, m.cy - s.body.cy) : '', '')
    if (!m || !l || !s.c || (Math.abs(open.x - 1) < 1e-3 && Math.abs(cross.x - 1) < 1e-3 && calm.x > 0.999 && drop.x > 0.9995)) {
      for (const name of RIDE) set(content, name, '', '')
      return
    }
    const kx = m.zoomX
    const ky = m.zoomY
    const lx = l.L + l.W / 2
    const ly = l.T + l.H / 2
    // Where the list's middle is on the glass, and from there the glass's box in the list's own space (before its zoom).
    const x = m.cx + (lx - (s.c.left + s.c.width / 2)) * kx
    const y = m.cy + (ly - (s.c.top + s.c.height / 2)) * ky
    const inset = [l.H / 2 + (m.cy - m.hy - y) / ky, l.W / 2 - (m.cx + m.hx - x) / kx, l.H / 2 - (m.cy + m.hy - y) / ky, l.W / 2 + (m.cx - m.hx - x) / kx]
    const soft = MORPH.contentBlur * (1 - smooth(0, 1, clamp(calm.x)))
    set(content, '--glass-ride-x', `${(x - lx).toFixed(2)}px`, '')
    set(content, '--glass-ride-y', `${(y - ly).toFixed(2)}px`, '')
    set(content, '--glass-zoom', `${kx.toFixed(4)} ${ky.toFixed(4)}`, '')
    set(content, '--glass-clip', `inset(${inset.map((v) => `${v.toFixed(1)}px`).join(' ')} round ${(m.r / kx).toFixed(1)}px / ${(m.r / ky).toFixed(1)}px)`, '')
    set(content, '--glass-soft', soft > 0.05 ? `blur(${soft.toFixed(2)}px)` : '', '')
  }

  /** `card`: 0 draws the control's glass (the surface melted into it wears its own), 1 the surface alone. */
  const lensFor = (box: Box, s: NonNullable<ReturnType<typeof shape>>, page: Page, repaint: () => void, card = 0): Omit<GlassLens, 'left' | 'top'> => {
    // A swollen control's bevel and shadow swell with it, on both canvases alike.
    const unit = (s.a.height * s.sc) / DESIGN_HEIGHT
    return {
      width: box.W,
      height: box.H,
      unit,
      cx: s.body.cx - box.L,
      cy: s.body.cy - box.T,
      hx: s.body.hx,
      hy: s.body.hy,
      radius: 999,
      bodyX: 0,
      blob: s.blob,
      bevel: DESIGN_HEIGHT * 0.42,
      // The engine scales the shadow with `strength`, so both leave together as the card arrives.
      shadow: 0.12 * lerp(0.55, 1, s.t),
      shadowSoftness: 34 * lerp(0.6, 1, s.t),
      shadowOffset: 22 * lerp(0.5, 1, s.t),
      strength: 1 - card,
      tune: { bendCurve: lerp(1.6, CARD.bendCurve, card), bendDepth: lerp(1, CARD.bendDepth, card), fresnel: 1 - card },
      color: tint,
      border: card > 0 ? [1, 1, 1] : undefined,
      borderAlpha: card > 0 ? card * (tint[0] > 0.5 ? LINE.alpha : LINE.darkAlpha) : undefined,
      borderWidth: card > 0 ? LINE.width : undefined,
      surface,
      edgeClear: 0.2,
      cursorLight: card < 0.5,
      // The light may spill past the surface's edge, never past the control's.
      glow: s.lit && (s.blob && !s.parted && s.lit.blob ? { ...s.lit, halo: { around: 'blob' as const, amount: s.out * s.lit.spill } } : s.lit),
      refraction: {
        paint: (back) => {
          const fill = rgbCss(surface)
          const recoloured = fill !== page.fill
          page.fill = fill
          back.fillStyle = fill
          back.fillRect(0, 0, box.W, box.H)
          const target = back.canvas
          const key = `${target.width}:${target.height}:${box.L}:${box.T}:${Math.round(scrollX)}:${Math.round(scrollY)}`
          const now = performance.now()
          if (!page.ctx) page.ctx = page.canvas.getContext('2d')
          // Never re-read the page mid-flight: that would drop frames.
          const again = !!page.ctx && (page.stale || key !== page.key || (!moving && now - page.at > 120))
          if (page.ctx && again) {
            page.stale = false
            page.key = key
            page.at = now
            if (page.canvas.width !== target.width || page.canvas.height !== target.height) {
              page.canvas.width = target.width
              page.canvas.height = target.height
            }
            page.ctx.setTransform(1, 0, 0, 1, 0, 0)
            page.ctx.clearRect(0, 0, target.width, target.height)
            page.ctx.setTransform(back.getTransform())
            drawDom(page.ctx, document.body, {
              origin: { left: box.L, top: box.T },
              region: { left: box.L, top: box.T, right: box.L + box.W, bottom: box.T + box.H },
              skip: (el) => el === host || el === content || el.hasAttribute('data-glass-skip'),
              onStale: () => {
                page.stale = true
                repaint()
              },
            })
          }
          back.save()
          back.setTransform(1, 0, 0, 1, 0, 0)
          back.drawImage(page.canvas, 0, 0)
          back.restore()
          // The same picture of the page as last time: the engine keeps its texture, so an
          // opening uploads the page once and not on every frame.
          return again || recoloured
        },
        refract: 44,
        magnify: 0,
        dispersion: lerp(0.12, 0, card),
        blurCenter: 0.35,
        blurEdge: 2.2,
        frost: lerp(cover, cardCover, card),
        blur: CARD.blur * card,
      },
      screenX: s.body.cx,
      screenY: s.body.cy,
    }
  }

  const readColours = () => {
    if (!host || !engine) return
    const s = engine.resolveColor(surfaceColorOf(host.parentElement))
    surface = [s[0], s[1], s[2]]
    let light = 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2] > 0.5
    tint = light ? [1, 1, 1] : [0, 0, 0]
    cover = TINT
    cardCover = CARD.tint
    if ('glassFill' in host.dataset) {
      // A control painted in its own CSS background (`data-glass-fill`, as a tinted
      // GlassButtonGroup is): the glass takes that colour whole, and the surface follows it.
      // Read with the glass briefly lifted, as GlassLayer does.
      const had = 'glassReady' in host.dataset
      if (had) delete host.dataset.glassReady
      const fill = engine.resolveColor(getComputedStyle(host).backgroundColor)
      if (had) host.dataset.glassReady = ''
      if (fill[3] > 0.02) {
        tint = [fill[0], fill[1], fill[2]]
        cover = 1
        cardCover = FILLED
        light = 0.2126 * tint[0] + 0.7152 * tint[1] + 0.0722 * tint[2] > 0.5
      }
    }
    const tone = light ? 'light' : 'dark'
    if (host.dataset.glassTone !== tone) host.dataset.glassTone = tone
    if (content) {
      if (content.dataset.glassTone !== tone) content.dataset.glassTone = tone
      panelRadius = parseFloat(getComputedStyle(content).borderTopLeftRadius) || 24
      // The layout width, not --anchor-width: the surface is exactly as wide as its anchor.
      const width = `${host.offsetWidth}px`
      if (matchWidth && content.style.width !== width) content.style.width = width
    }
  }

  const setTrigger = (canvas: HTMLCanvasElement | null) => {
    const el = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    engine = getGlassEngine()
    if (!canvas || !el || !ctx || !engine) return () => {}
    const e = engine
    host = el
    el.dataset.glassAnchor = ''
    const page = newPage()
    const pages = [page]
    const advance = (dt: number, still: boolean): boolean => {
      const goal = isOpen() ? 1 : 0
      const live = !!panelRect()
      if (still) {
        open.x = cross.x = calm.x = drop.x = goal
        open.v = cross.v = calm.v = drop.v = bridge.x = bridge.v = recoil.x = recoil.v = 0
        rebounding = false
        stepItems(goal, dt, true)
        rec = []
        rewind = null
        if (!goal) release()
        return (moving = false)
      }
      if (goal && open.x === 0 && !pushed) {
        // Opened without a press (the keyboard): the light starts at the control's centre.
        if (!pressed && !glowHold && glow.x < 0.08) light(undefined, undefined, 1, false, true)
        for (const p of [...pages, panelPage]) if (p) p.stale = true
        rec = []
        recT = 0
      }
      // A morphing surface may stay as it is for a moment before it goes back in (MORPH.closeDelay).
      if (goal) lingered = 0, (rebounding = false)
      else if (morphs && rewind === null && open.x > 0.004 && lingered < MORPH.closeDelay) {
        lingered += dt
        return (moving = true)
      }
      // Closing is the opening played backwards: the same frames, in reverse.
      // (MORPH.closeSoft: a morphing surface goes back in on a spring of its own instead, below.)
      const soft = morphs && MORPH.closeSoft > 0.5
      if (!goal && rewind === null && rec.length > 1 && open.x > 0.004 && !soft) {
        // Skip the settled tail, where nothing visible is left to undo.
        const shown = (content?.querySelectorAll(ITEMS).length ?? 0) * TUNE.itemsGap + TUNE.itemsFade
        let i = rec.length - 1
        // (A morph landed past the surface and came back: that swell is undone too, only its rest is skipped.)
        const rested = (f: (typeof rec)[number]) =>
          morphs ? Math.abs(f.open - 1) < 0.012 && Math.abs(f.cross - 1) < 0.012 && f.calm > 0.95 && Math.abs(f.rc) < 0.01 && f.drop > 0.995 : f.open >= 0.995 && f.bridge <= 0.02 && f.reveal >= shown
        while (i > 0 && rested(rec[i])) i--
        rewind = rec[Math.min(i + 1, rec.length - 1)].t
      }
      if (goal && rewind !== null) {
        // Reopened on the way back: the opening carries on from this very frame.
        const at = rewind
        rec = rec.filter((f) => f.t <= at)
        recT = at
        rewind = null
        open.v = cross.v = calm.v = bridge.v = recoil.v = 0
        pushed = open.x > 0.02
      }
      if (rewind !== null) {
        rewind -= dt * (morphs ? MORPH.closePace : TUNE.closeSpeed / Math.max(TUNE.openSpeed, 0.1))
        if (rewind <= 0) {
          rewind = null
          rec = []
          open.x = open.v = cross.x = cross.v = calm.x = calm.v = drop.x = drop.v = bridge.x = bridge.v = recoil.x = recoil.v = 0
          pushed = snapped = wasJoined = false
          stepItems(0, dt, true)
          rebound()
          release()
          dirty()
          return (moving = rebounding)
        }
        let j = rec.length - 2
        while (j > 0 && rec[j].t > rewind) j--
        const f0 = rec[j]
        const f1 = rec[j + 1]
        const u = clamp((rewind - f0.t) / Math.max(f1.t - f0.t, 1e-4))
        open.x = lerp(f0.open, f1.open, u)
        bridge.x = lerp(f0.bridge, f1.bridge, u)
        recoil.x = lerp(f0.rc, f1.rc, u)
        cross.x = lerp(f0.cross, f1.cross, u)
        calm.x = lerp(f0.calm, f1.calm, u)
        drop.x = lerp(f0.drop, f1.drop, u)
        drop.v = 0
        open.v = cross.v = calm.v = bridge.v = recoil.v = 0
        snapped = f0.snapped
        wasJoined = joined
        stepItems(0, dt, false, lerp(f0.reveal, f1.reveal, u))
        return (moving = true)
      }
      if (morphs) {
        // The control becomes the surface: two sides on two springs, and what follows calmly.
        // (Shut with no opening to play back, it goes in at once and without a bounce.)
        // (Or asked to close softly: one spring for every side, so it lands slowing down.)
        const back = { omega: soft ? MORPH.closeSpeed : MORPH.openSpeed * 1.5, zeta: 1 }
        // Its weight: the press throws the control down (by MORPH.throw) and it swings back.
        // Heavier glass is thrown less and swings slower, as in the stretch.
        const heavy = Math.max(MORPH.weight, 0.1)
        if (goal && !pushed) {
          pushed = true
          // (Reopened on its way back in: it carries on from where it is, with no throw and no wait.)
          if (open.x > 0.02) waited = Math.max(MORPH.openDelay, MORPH.dropDelay)
          else {
            waited = 0
            recoil.v += MORPH.kick / heavy
          }
        }
        if (!goal) pushed = false
        // The surface waits for the throw (MORPH.openDelay), then opens out of the control.
        const held = goal === 1 && waited < MORPH.openDelay
        if (goal) waited += dt
        const m1 = held || stepSpring(open, goal, goal ? { omega: MORPH.openSpeed, zeta: MORPH.openDamping } : back, dt)
        const m2 = held || stepSpring(cross, goal, goal ? { omega: MORPH.crossSpeed, zeta: MORPH.crossDamping } : back, dt)
        const m3 = held || stepSpring(calm, goal, goal ? { omega: MORPH.calmSpeed, zeta: 1 } : back, dt)
        // The surface comes down into place on a soft spring of its own, MORPH.dropDelay after the press.
        const falls = goal === 1 && waited >= MORPH.dropDelay
        const m5 = (goal === 1 && !falls) || stepSpring(drop, falls ? 1 : goal, goal ? { omega: MORPH.dropSpeed, zeta: Math.min(MORPH.dropDamping, 1) } : back, dt)
        let m4 = stepSpring(recoil, 0, goal || rebounding ? { omega: MORPH.swingSpeed / Math.sqrt(heavy), zeta: Math.min(MORPH.swingDamping, 0.999) } : back, dt)
        if (m4 && Math.abs(recoil.x) < 0.006 && Math.abs(recoil.v) < 0.02) {
          recoil.x = recoil.v = 0
          m4 = false
        }
        stepItems(goal, dt, false)
        if (!goal && Math.max(open.x, cross.x, calm.x) < 0.004) {
          // Gone in on its spring, with no opening to play back: the same reaction.
          if (open.x || cross.x || calm.x) {
            rebound()
            m4 = rebounding
          }
          open.x = open.v = cross.x = cross.v = calm.x = calm.v = drop.x = drop.v = 0
          if (!m4) {
            recoil.x = recoil.v = 0
            rebounding = false
          }
          release()
          dirty()
          return (moving = rebounding)
        }
        moving = m1 || m2 || m3 || m4 || m5
        if (goal && moving && rec.length < 1500) {
          recT += dt
          rec.push({ t: recT, open: open.x, bridge: 0, rc: recoil.x, reveal, snapped: false, cross: cross.x, calm: calm.x, drop: drop.x })
        }
        return moving
      }
      const weight = Math.max(TUNE.weight, 0.1)
      const kick = TUNE.kick / weight
      const m1 = stepSpring(open, goal, goal ? { omega: TUNE.openSpeed, zeta: TUNE.openDamping } : { omega: TUNE.closeSpeed, zeta: 0.7 }, dt)
      const attached = live && (goal ? open.x < TUNE.detachAt : true)
      const m2 = stepSpring(bridge, attached ? 1 : 0, attached || !goal ? ATTACH : snapped ? LET_GO : { omega: TUNE.snapSpeed, zeta: 1 }, dt)
      // Jolts: the panel pushing out, the neck snapping, the panel bumping back in.
      if (goal && !pushed && open.x > 0.02) {
        pushed = true
        recoil.v += kick * 0.5
      }
      if (!goal) pushed = snapped = false
      if (wasJoined && !joined && goal && !snapped) {
        snapped = true
        recoil.v += kick
      }
      if (!wasJoined && joined && !goal) recoil.v += kick * 0.5
      wasJoined = joined
      let m3 = stepSpring(recoil, 0, { omega: TUNE.recoilSpeed / Math.sqrt(weight), zeta: Math.min(TUNE.recoilDamping, 0.999) }, dt)
      // The jolt dies out slowly: for its last seconds it moves the glass by less than a
      // fiftieth of a pixel. That is rest, and the loop may stop.
      if (m3 && Math.abs(recoil.x) < 0.006 && Math.abs(recoil.v) < 0.02) {
        recoil.x = recoil.v = 0
        m3 = false
      }
      const m4 = stepItems(goal, dt, false)
      // Only once nothing of the panel shows outside the trigger.
      if (!goal && open.x < 0.004) release()
      moving = m1 || m2 || m3 || m4
      if (goal && moving && rec.length < 1500) {
        recT += dt
        rec.push({ t: recT, open: open.x, bridge: bridge.x, rc: recoil.x, reveal, snapped, cross: 0, calm: 0, drop: 0 })
      }
      return moving
    }
    const view: GlassView = {
      canvas,
      ctx,
      dirty: true,
      visible: false,
      // The one place the springs advance; the popup's view reports the same answer.
      step: (dt, still) => {
        // The popup first: the control's swell reads where it has got to.
        const morphing = advance(dt, still)
        return stepSwell(dt, still) || morphing
      },
      lens: (refresh) => {
        if (refresh) readColours()
        const s = shape()
        if (!s) return null
        carry(s)
        if (s.onPanel) return null
        const { a } = s
        // A morphing control is thrown up when its surface comes back (or goes out, thrown the other way): its canvas leaves room for the furthest that throw can go.
        const thrownUp = morphs ? Math.ceil((Math.abs(MORPH.throw) * MORPH.kick) / (Math.sqrt(Math.max(MORPH.weight, 0.1)) * Math.max(MORPH.swingSpeed, 1))) : 0
        const box = {
          L: Math.floor(a.left - TRIGGER_PAD),
          T: Math.floor(a.top - TRIGGER_PAD - thrownUp),
          W: Math.ceil(a.width + 2 * TRIGGER_PAD) + 1,
          H: Math.ceil(a.height * 1.8 + 2 * TRIGGER_PAD + thrownUp) + 1,
        }
        // The control scales under a hover and a press, and this canvas with it: undo that here,
        // around the control's centre, so it lies on the page exactly as the popup's canvas does.
        write(canvas, 'transform-origin', `${a.left + a.width / 2 - box.L}px ${a.top + a.height / 2 - box.T}px`)
        write(canvas, 'scale', s.sc === 1 ? '' : (1 / s.sc).toFixed(6))
        // While the popup's canvas draws the rest, this one keeps to the trigger's own box.
        write(
          canvas,
          'clip-path',
          s.c && panelDrawn && !s.parted
            ? `inset(${s.seam.top - box.T}px ${box.L + box.W - s.seam.right}px ${box.T + box.H - s.seam.bottom}px ${s.seam.left - box.L}px)`
            : '',
        )
        return {
          ...lensFor(box, s, page, dirty),
          // What the control's rim mirrors while it is clear glass: the page around it. (Painted in its own fill it mirrors nothing, and neither does the surface: it is unlit.)
          reflection: {
            height: a.height,
            paint: (around, reach) => {
              drawAround(around, document.body, { left: box.L, top: box.T, width: box.W, height: box.H }, reach, {
                skip: (el) => el === host || el === content || el.hasAttribute('data-glass-skip'),
                onStale: dirty,
              })
            },
          },
          blob: s.parted ? undefined : s.blob,
          left: box.L - a.left - s.edge.hostLeft,
          top: box.T - a.top - s.edge.hostTop,
        }
      },
      drawn: () => {
        if (ready) return
        ready = true
        el.dataset.glassReady = ''
      },
      lost: () => {
        ready = false
        delete el.dataset.glassReady
        el.style.scale = ''
        delete el.dataset.glassMorphing
        if (content) content.dataset.glassOff = ''
        release()
      },
    }
    triggerView = view
    const off = () => el.matches(":disabled, [aria-disabled='true']")
    const onDown = (ev: PointerEvent) => {
      if (off() || ev.button > 0) return
      pressed = true
      light(ev.clientX, ev.clientY)
      dirty()
    }
    const onUp = () => {
      pressed = false
      dirty()
    }
    const onEnter = (ev: PointerEvent) => {
      if (ev.pointerType !== 'mouse' || off()) return
      hovered = true
      dirty()
    }
    const onLeave = () => {
      pressed = hovered = false
      dirty()
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('pointerenter', onEnter)
    el.addEventListener('pointerleave', onLeave)
    const io = new IntersectionObserver(([entry]) => {
      view.visible = entry.isIntersecting
      dirty()
    })
    io.observe(el)
    const ro = new ResizeObserver(dirty)
    ro.observe(el)
    // A scroll changes what lies behind, never the glass: colours and sizes are not read again.
    const onScroll = () => {
      if (triggerView) triggerView.repaint = true
      if (panelView) panelView.repaint = true
      e.wake()
    }
    addEventListener('scroll', onScroll, { passive: true, capture: true })
    e.add(view)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('pointerenter', onEnter)
      el.removeEventListener('pointerleave', onLeave)
      el.style.scale = ''
      for (const name of ['--glass-sway-y', '--glass-sway-sx', '--glass-sway-sy', '--glass-label', '--glass-label-blur', '--glass-lit']) el.style.removeProperty(name)
      delete el.dataset.glassAnchor
      delete el.dataset.glassMorphing
      setLabel('')
      pressed = hovered = false
      e.remove(view)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      io.disconnect()
      ro.disconnect()
      removeEventListener('scroll', onScroll, { capture: true })
      delete el.dataset.glassReady
      delete el.dataset.glassTone
      triggerView = null
      host = null
    }
  }

  let panelPage: Page | null = null
  const setPanel = (canvas: HTMLCanvasElement | null, hold: HTMLElement | null, cardShadow: HTMLElement | null) => {
    const el = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !el || !ctx) return () => {}
    const e = getGlassEngine()
    if (!e) {
      el.dataset.glassOff = ''
      return () => {}
    }
    engine = e
    content = el
    holdEl = hold
    const page = (panelPage = newPage())
    const view: GlassView = {
      canvas,
      ctx,
      dirty: true,
      // An open surface is drawn from its first frame: the observer below answers a frame late,
      // and a morphing surface is the only canvas its control has by then.
      visible: el.hasAttribute('data-open'),
      step: () => moving,
      lens: (refresh) => {
        if (refresh) readColours()
        const s = shape()
        if (!s?.c || (s.t < 0.004 && !isOpen())) {
          panelDrawn = false
          return null
        }
        const { a, c } = s
        const L = Math.floor(Math.min(a.left, c.left) - PAD)
        // A morphing surface is carried MORPH.drop px off its place on the way out: its canvas leaves room for that.
        const carried = morphs ? way * MORPH.drop : 0
        const T = Math.floor(Math.min(a.top, c.top) - PAD - Math.max(carried, 0))
        const box = { L, T, W: Math.ceil(Math.max(a.right, c.right) + PAD - L), H: Math.ceil(Math.max(a.bottom, c.bottom) + PAD_BOTTOM + Math.max(-carried, 0) - T) }
        // Everything but the trigger's box, which its own canvas draws beneath the label.
        const x0 = s.seam.left - L
        const y0 = s.seam.top - T
        // (A morphing surface lies over the control and draws it too: nothing is cut out.)
        write(canvas, 'clip-path', s.parted || s.morph ? '' : `path(evenodd,"M0 0H${box.W}V${box.H}H0Z M${x0} ${y0}H${s.seam.right - L}V${s.seam.bottom - T}H${x0}Z")`)
        // The surface's drop shadow is CSS, the card's own from the start: it follows the surface
        // as it swells out of the control.
        if (cardShadow && s.blob) {
          const bx = s.body.cx + s.blob.x
          const by = s.body.cy + s.blob.y
          write(
            cardShadow,
            'inset',
            `${(by - s.blob.hy - c.top - s.edge.top).toFixed(1)}px ${(c.right - bx - s.blob.hx - s.edge.left).toFixed(1)}px ${(c.bottom - by - s.blob.hy - s.edge.top).toFixed(1)}px ${(bx - s.blob.hx - c.left - s.edge.left).toFixed(1)}px`,
          )
          write(cardShadow, 'border-radius', `${s.blob.r.toFixed(1)}px`)
          write(cardShadow, 'opacity', s.out.toFixed(3))
        }
        // Parted, this canvas (above the control) draws the card alone: a control thrown past its
        // own box by the jolt must not show up here, on top of its glass.
        const alone =
          s.parted && s.blob
            ? {
                cx: s.body.cx + s.blob.x - box.L,
                cy: s.body.cy + s.blob.y - box.T,
                hx: s.blob.hx,
                hy: s.blob.hy,
                radius: s.blob.r,
                blob: undefined,
                // The same light, seen from the surface's own centre.
                // (A light kept to the control never reaches it.)
                glow: s.lit && s.lit.blob ? { ...s.lit, x: s.lit.x - s.blob.x, y: s.lit.y - s.blob.y, halo: { around: 'body' as const, amount: s.out * s.lit.spill } } : undefined,
              }
            : {}
        // Joined, the engine draws the surface's glass on the blob; alone, the same glass is the
        // whole lens. Nothing changes as the neck lets go.
        return { ...lensFor(box, s, page, dirty, s.parted ? 1 : s.morph ? s.card : 0), ...alone, left: L - c.left - s.edge.left, top: T - c.top - s.edge.top }
      },
      drawn: () => {
        if (panelDrawn) return
        panelDrawn = true
        if (triggerView) triggerView.dirty = true
      },
      lost: () => {
        el.dataset.glassOff = ''
      },
    }
    panelView = view
    // A choice in the list lights the surface where it lands, around the choice alone.
    const chosen = (item: Element | null | undefined): item is Element => !!item && !item.matches("[data-disabled], [aria-disabled='true']")
    const onPick = (ev: PointerEvent) => {
      if (ev.button > 0 || !(ev.target instanceof Element) || !chosen(ev.target.closest(PICKS))) return
      light(ev.clientX, ev.clientY, 1, true)
      dirty()
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return
      const item = document.activeElement?.closest(PICKS) ?? el.querySelector(`${ITEMS}[data-highlighted]`)
      if (!chosen(item) || !el.contains(item)) return
      const r = item.getBoundingClientRect()
      light(r.left + r.width / 2, r.top + r.height / 2, 1, true)
      dirty()
    }
    el.addEventListener('pointerdown', onPick)
    el.addEventListener('keydown', onKey)
    // The list's reveal and its ride are written to this element's own style on every frame:
    // a change of nothing else there is no reason to read colours and sizes again.
    const own = /--glass-(?:items|out|gap|fade|ride-x|ride-y|zoom|clip|soft)\s*:[^;]*;?\s*/g
    const mo = new MutationObserver((records) => {
      const now = (el.getAttribute('style') ?? '').replace(own, '')
      if (records.every((r) => r.attributeName === 'style')) {
        // Something else in the style moved the surface (its positioner follows the control as
        // it swells): the glass is drawn where it is now, and nothing is read or uploaded again.
        if (records.some((r) => (r.oldValue ?? '').replace(own, '') !== now)) {
          if (triggerView) triggerView.repaint = true
          view.repaint = true
          e.wake()
        }
        return
      }
      if (isOpen()) view.visible = true
      dirty()
    })
    mo.observe(el, { attributes: true, attributeOldValue: true, attributeFilter: ['data-open', 'data-closed', 'data-ending-style', 'data-side', 'style'] })
    const ro = new ResizeObserver(dirty)
    ro.observe(el)
    const io = new IntersectionObserver(([entry]) => {
      view.visible = entry.isIntersecting
      dirty()
    })
    io.observe(el)
    e.add(view)
    dirty()
    return () => {
      e.remove(view)
      el.removeEventListener('pointerdown', onPick)
      el.removeEventListener('keydown', onKey)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      mo.disconnect()
      ro.disconnect()
      io.disconnect()
      delete el.dataset.glassTone
      panelView = null
      panelPage = null
      panelDrawn = false
      content = null
      holdEl = null
      dirty()
    }
  }

  return { setTrigger, setPanel }
}

export type GlassPopup = ReturnType<typeof createMorph>

/**
 * How the surface comes out. `stretch`: it swells out of the control and holds on by a neck that
 * thins and snaps. `morph`: the control itself becomes the surface, which then lies over it (give
 * the content a negative `sideOffset`, the control's height).
 */
export type GlassPopupOpening = 'stretch' | 'morph'

/**
 * With `opening: 'morph'`, which way the surface comes into place. `top`: the control is thrown
 * down and the surface comes down from above. `bottom`: the other way up.
 */
export type GlassPopupFrom = 'top' | 'bottom'

/**
 * Classes that centre a popup over its control, whatever the control's height: UI SDK keeps that
 * height on the content (`--anchor-height`), so it is pulled back by half of it and then by half
 * of its own height. Always with a transform: UI SDK places the box as if it had none, while a
 * margin it would take for its own error and undo the moment the control moves (a hover's swell).
 */
export const OVER_CENTER =
  '[position-try-fallbacks:none]! data-[side=bottom]:-translate-y-1/2 data-[side=top]:translate-y-1/2 data-[side=bottom]:[transform:translateY(calc(var(--anchor-height)*-0.5))] data-[side=top]:[transform:translateY(calc(var(--anchor-height)*0.5))]'

/**
 * The popup a control inside may anchor: GlassDropdownMenu provides it, and a GlassButtonGroup
 * under it becomes the anchor, so the menu swells out of the whole group.
 */
/**
 * And classes that lay a popup edge on edge with its control, growing away from it: pulled back
 * by the control's whole height, from whichever side it landed on.
 */
export const OVER_EDGE = 'data-[side=bottom]:[transform:translateY(calc(var(--anchor-height)*-1))] data-[side=top]:[transform:translateY(var(--anchor-height))]'

export const GlassPopupContext = createContext<GlassPopup | null>(null)

const canvasStyle = { position: 'absolute', zIndex: -1, maxWidth: 'none', pointerEvents: 'none', width: 0, height: 0 } as const

/** The surface's share of the glass: the first child of the popup's content. */
export function GlassPopupSurface({ popup: morph }: { popup: GlassPopup }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const holdRef = useRef<HTMLSpanElement>(null)
  const shadowRef = useRef<HTMLSpanElement>(null)
  useEffect(() => morph.setPanel(canvasRef.current, holdRef.current, shadowRef.current), [morph])
  return (
    <>
      <canvas ref={canvasRef} aria-hidden style={canvasStyle} />
      <span ref={holdRef} aria-hidden data-glass-hold="" />
      <span ref={shadowRef} aria-hidden data-glass-card-shadow="" />
    </>
  )
}

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

/**
 * The label of a morphing control, coming back letter by letter the moment the surface is back in,
 * with the control's swell. `delay` (seconds) starts it that much later. Read aloud as one string.
 */
export function GlassPopupText({ children, delay = 0, className }: { children: string; delay?: number; className?: string }) {
  return (
    <span className={className}>
      <span className="sr-only">{children}</span>
      <span aria-hidden style={{ '--glass-at': `${delay}s` } as CSSProperties}>
        {Array.from(children, (char, i) => (
          <span key={i} data-glass-char="" style={{ '--glass-c': i } as CSSProperties}>
            {char}
          </span>
        ))}
      </span>
    </span>
  )
}

/** A control's children, each plain text among them in GlassPopupText: its label comes back letter by letter. */
export const spellLabel = (children: ReactNode) => Children.map(children, (child) => (typeof child === 'string' && child.trim() ? <GlassPopupText>{child}</GlassPopupText> : child))

/** One gooey popup: hand the result to its GlassPopupAnchor and GlassPopupSurface. `matchWidth` keeps the surface as wide as the anchor; `opening` picks the motion (see GlassPopupOpening) and `from` the way a morphing surface comes in (see GlassPopupFrom). */
export function useGlassPopup({ matchWidth = false, opening = 'stretch', from = 'top' }: { matchWidth?: boolean; opening?: GlassPopupOpening; from?: GlassPopupFrom } = {}): GlassPopup {
  return useMemo(() => createMorph(matchWidth, opening === 'morph', from), [matchWidth, opening, from])
}
