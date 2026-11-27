'use client'

// GlassLayer — turns any positioned element (a button, a link, a pill) into liquid glass.
// Put it as the FIRST child of the host and mark the host with `data-glass-host`:
//
//   <a data-glass-host href="/start" className="… rounded-full px-6 h-12">
//     <GlassLayer material="clear" />
//     Get started <ArrowRight />
//   </a>
//
// The host keeps its own CSS look until the first glass frame is drawn, then the layer
// sets `data-glass-ready` and the host drops its background, border and shadow (the
// glass now draws them). Without WebGL2 nothing changes: the CSS look stays. Clear glass
// also sets `data-glass-tone="light" | "dark"` from the colour it ends up, for the text.
//
// Hover swells the glass with wobbly springs and press grows it (the host scales with it);
// `swell={false}` keeps it still, as a card's glass is. `blur` frosts what clear glass shows.
// The gooey droplet (used only by GlassActionButton): the host's direct child marked
// `data-glass-drop` sits at the end, and the glass separates around it (`apart`) or melts
// back into one body (`merged`). Switching between the two animates, and the glass swells
// once as it does under the pointer.
// `pulse`: change it and the glass answers once, as if hovered and pressed for a moment
// (GlassActionButton does it when its action succeeds). While it does, the host carries `--glass-bend` (two numbers): put `scale: var(--glass-bend, 1)` on the
// content that should stretch with the glass. `pulseHold` (seconds) keeps it swollen longer
// before it lets go.
// Hold the glass and drag away, and it comes after the pointer a little way, stretched along the
// pull, then swings back like gel when let go (PULL in engine.ts): that is for buttons, which all
// stand on this layer. `pull={false}` keeps one in its place. The host is stretched with CSS, label
// included; the glass undoes that on its canvas and draws the stretch itself, so it stays a pill
// and bends what really lies behind it. COPY VERBATIM.
// MIT — https://github.com/bilalgursen/liquid-glass

import { useEffect, useRef } from 'react'

import { drawAround, drawDom } from './dom-snapshot'
import {
  DESIGN_HEIGHT,
  PULL,
  SPRINGS,
  clamp,
  cohesionSoftness,
  getGlassEngine,
  lerp,
  mixRgb,
  rgbCss,
  smooth,
  stepSpring,
  surfaceColorOf,
  type GlassView,
  type Rgb,
  type Spring,
} from './engine'

export type GlassMaterial = 'clear' | 'tinted'
export type GlassDroplet = 'none' | 'apart' | 'merged'

/**
 * Fine-tuning of the glass. Read on every frame: changing a value redraws the glass without
 * rebuilding it, so it can follow a slider. Colours and frost apply to clear glass.
 */
export type GlassOptics = {
  /** Tint colour, any CSS colour. Default: white on a light page, black on a dark one. */
  tintColor?: string
  /** A line just inside the rim: its colour, opacity (0–1, default 0: none) and width in px (default 1). */
  borderColor?: string
  borderAlpha?: number
  borderWidth?: number
  /** With `blur`: how much of the frost shows over the sharp bend (0–1, default 1). */
  frostMix?: number
  /** With `blur`: × the frost at the rim, where the glass bends (default 1). */
  frostEdge?: number
  /** Saturation of what shows through the glass (default 1; 1.5 = more vivid, 0 = grey). */
  saturation?: number
  /** Without frost: blur of the clear glass in its middle and at its rim, in mip levels (default 0.35 and 2.2). */
  clearBlur?: number
  clearBlurEdge?: number
  /** The bend at the rim, × the kit's own (default 1). */
  refraction?: number
  /**
   * How the rim bends. `edge` (default): along the rim, as deep as the bevel. `radial`: towards
   * the centre, by 6.5% of the viewport × `refraction`, fading over half the glass (`bendCurve`
   * sets how fast, `bendDepth` how far), and the frost blurs the bent picture: the SVG card's rim.
   */
  bendMode?: 'edge' | 'radial'
  /** × how far in from the rim the bend reaches (default 1). */
  bendDepth?: number
  /** How sharply the bend falls off from the rim inwards, an exponent (default 1.6; higher = tighter to the rim). */
  bendCurve?: number
  /** Colour split at the rim (default 0.12). */
  dispersion?: number
  /** Magnification of the middle (default 0). */
  magnify?: number
  /** Light on the glass, all of it (default 1). */
  light?: number
  /** × the rim light (default 1) and × its line's thickness (default 1). */
  rim?: number
  rimWidth?: number
  /** × the width of the bevel that shades the rim (default 1). */
  bevel?: number
  /** × the fresnel glow, inner shading, top reflection and warm caustic (each default 1). */
  fresnel?: number
  inner?: number
  reflection?: number
  caustic?: number
  /** Clear glass: × what the rim mirrors of the page around it, where a colourful neighbour lights the rim that faces it (default 1, 0 = nothing). Tinted glass mirrors nothing. */
  mirror?: number
  /** The rim light leans towards the cursor (default true). */
  cursorLight?: boolean
  /** The drop shadow: × its strength, softness and offset (each default 1). */
  shadow?: number
  shadowSoftness?: number
  shadowOffset?: number
  /** Dark glass (a black tint, on a dark page): its own tint cover (in place of `tint`) and rim line. Unset values follow the rest. */
  dark?: { tint?: number; borderColor?: string; borderAlpha?: number }
}

export type GlassLayerProps = {
  /**
   * `clear`: transparent glass that bends the page behind it (default).
   * `tinted`: glass painted in the host's own CSS background colour, with light and shadow.
   */
  material?: GlassMaterial
  /**
   * The host's `[data-glass-drop]` child as a gooey droplet: `apart` (separated; it melts in
   * while pressed) or `merged` (one body). Changing it animates the split or the merge. Default `none`.
   */
  droplet?: GlassDroplet
  /** Clear glass: how much of the tint covers the backdrop (0 = invisible, 1 = solid). */
  tint?: number
  /** Clear glass: frost the backdrop with a blur of this many px, like CSS `blur()` (default 0: sharp). */
  blur?: number
  /** Clear glass: CSS selector of the ancestor whose content is refracted (default: the page). */
  backdrop?: string
  /** Clear glass: repaint the backdrop every frame (for animated content behind the glass). */
  live?: boolean
  /** Listen for hover/press on this ancestor instead of the host (e.g. a whole card link). */
  trigger?: string
  /** Turn the glass off and keep the host's CSS look. */
  disabled?: boolean
  /** Swell on hover and grow when pressed (default). `false` keeps the glass still under the pointer. */
  swell?: boolean
  /**
   * Change it (a counter) and the glass answers once: it swells as if hovered and pressed for a
   * moment. Meanwhile the host has `--glass-bend`, for content that
   * stretches with it (`scale: var(--glass-bend, 1)`). Nothing happens on mount, or under reduced motion.
   */
  pulse?: unknown
  /** How long a pulse stays swollen before it lets go, in seconds (default 0.16: a nod). */
  pulseHold?: number
  /**
   * Hold the glass and drag: it follows the pointer a little way through a rubber band (small glass
   * from where it was pressed, larger glass once the pointer is past its edge), stretches along the
   * pull and thins across it, and swings back like gel when let go. The host is moved and scaled
   * with CSS `translate` and `scale`, content included. Default `true`; `false` keeps the glass in
   * its place. Glass that does not swell (`swell={false}`) is never pulled.
   */
  pull?: boolean
  /** Fine-tuning: tint colour, a rim line, frost mix, bend, light and shadow (see GlassOptics). */
  optics?: GlassOptics
}

/** Size of the hover/press response. Matches the kit's Button. */
const PRESS_SCALE = 1.08
const HOVER_SCALE = 1.04
const HOVER_GROW = 0.08
const MAX_GROW_PX = 6
/** Gap between the separated droplet and the body, as a share of the height. */
const DROPLET_GAP = 0.25
/** A pulse: the glass swells as if hovered and pressed for this long (seconds, unless `pulseHold` says otherwise), then lets go. */
const PULSE = 0.16
/** A droplet melting in: the glass nods once it is this far in (0–1 of the way out). */
const NOD_AT = 0.15
/** Already hovered, its hover swell is at rest: the pulse pushes its width and height instead (per second). */
const PULSE_KICK = { x: 24, y: 20 }
/**
 * During a pulse the content stretches with the glass, each way by this much of what the pulse
 * adds to the glass's swell that way (`--glass-bend`). It comes in and fades at these rates (per second).
 * Held swollen, the content does not stay stretched: it evens out at `even`, and as the glass
 * lets go it follows at `back` (per second).
 */
const PULSE_BEND = { amount: 0.5, in: 30, out: 5, even: 4, back: 12 }

/** The CSS the glass relies on. Rendered once per page by <GlassStyles /> (React 19 dedupes it). */
export const GLASS_CSS = `
/* Layered, so a utility class on the host (absolute, fixed) still wins over relative. */
@layer components{:where([data-glass-host]){position:relative;isolation:isolate}}
/* Unlayered on purpose: once the glass draws, it must beat the host's own fill utilities. */
[data-glass-host][data-glass-ready]{background:transparent!important;border-color:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
@keyframes glass-marquee{to{transform:translateX(-50%)}}
[data-glass-marquee]{animation:glass-marquee var(--glass-marquee-duration,5s) linear infinite}
/* Swapped labels and icons rise from a soft blur; a check draws itself in. */
@keyframes glass-in{from{opacity:0;filter:blur(3px);transform:translateY(4px)}}
[data-glass-in]{animation:glass-in .38s cubic-bezier(.2,.8,.2,1) both}
@keyframes glass-draw{from{stroke-dashoffset:25}}
[data-glass-draw]{stroke-dasharray:25;animation:glass-draw .42s cubic-bezier(.65,0,.35,1) .12s both}
@keyframes glass-spin{to{transform:rotate(1turn)}}
[data-glass-spin]{animation:glass-spin .8s linear infinite}
[data-glass-ready] [data-glass-fallback]{visibility:hidden}
@media (prefers-reduced-motion:reduce){[data-glass-marquee],[data-glass-in],[data-glass-draw],[data-glass-spin]{animation:none}}
`

/** Injects GLASS_CSS once (React 19 hoists and dedupes `<style href precedence>`). */
export function GlassStyles() {
  return (
    <style href="liquid-glass" precedence="default">
      {GLASS_CSS}
    </style>
  )
}

export function GlassLayer({
  material = 'clear',
  droplet = 'none',
  tint = 0.6,
  blur = 0,
  backdrop,
  live = false,
  trigger,
  disabled = false,
  swell = true,
  pulse,
  pulseHold,
  pull = true,
  optics,
}: GlassLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The droplet mode changes without rebuilding the glass, so the change itself animates.
  const dropletRef = useRef(droplet)
  dropletRef.current = droplet
  // Tint, frost and optics are read on every frame: changing them redraws, never rebuilds.
  const tuneRef = useRef({ tint, blur, optics })
  tuneRef.current = { tint, blur, optics }
  const pokeRef = useRef<(() => void) | null>(null)
  useEffect(() => pokeRef.current?.(), [droplet, tint, blur, optics])
  // A pulse plays when the value changes, never for the one the glass was mounted with.
  const pulseRef = useRef<(() => void) | null>(null)
  const pulseHoldRef = useRef(pulseHold)
  pulseHoldRef.current = pulseHold
  // The droplet splitting off or melting in: the glass swells once, as under a hover.
  const nodRef = useRef<(() => void) | null>(null)
  const lastDroplet = useRef(droplet)
  useEffect(() => {
    const from = lastDroplet.current
    lastDroplet.current = droplet
    if (from !== droplet && from !== 'none' && droplet !== 'none') nodRef.current?.()
  }, [droplet])
  const lastPulse = useRef(pulse)
  useEffect(() => {
    if (Object.is(lastPulse.current, pulse)) return
    lastPulse.current = pulse
    pulseRef.current?.()
  }, [pulse])

  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    const engine = disabled ? null : getGlassEngine()
    if (!canvas || !host || !ctx || !engine) return

    const clear = material === 'clear'
    let w = 0
    let h = 0
    let hasDroplet = false
    /** The host's own corner radius in px; null = a pill. */
    let corner: number | null = null
    let surface: Rgb = [1, 1, 1]
    // Colours come from the host's own CSS (rest, hover, selected…) and cross-fade.
    let color: [Rgb, Rgb] = [
      [1, 1, 1],
      [1, 1, 1],
    ]
    let border: [Rgb, Rgb] | null = null
    /** Clear glass: opacity of the optional rim line (GlassOptics). */
    let borderAlpha = 1
    /** Clear glass: the tint ended up dark (optics.dark applies). */
    let darkGlass = false
    let colorT = 1
    let unpaintable = false
    let sampled = false
    let pressed = false
    let hovered = false
    let ready = false
    const page = {
      canvas: document.createElement('canvas'),
      ctx: null as CanvasRenderingContext2D | null,
      key: '',
      at: 0,
      stale: true,
      /** The surface colour the picture was last filled with. */
      fill: '',
      // Where the glass and the page were when the picture was taken, and what the walk found:
      // elements pinned to the viewport, and whether everything else scrolls as one piece.
      size: '',
      lx: 0,
      ly: 0,
      sx: 0,
      sy: 0,
      pinned: [] as Element[],
      rigid: false,
      /** The glass this one melted into when the picture was taken (COHESION): left out of it. */
      near: undefined as Element[] | undefined,
    }
    const press: Spring = { x: 0, v: 0 }
    const growX: Spring = { x: 0, v: 0 }
    const growY: Spring = { x: 0, v: 0 }
    const scale: Spring = { x: 1, v: 0 }
    const drop: Spring = { x: 0, v: 0 }
    /** How much the droplet is on its way in (0–1), eased: the bridge is held flat then (see the lens). */
    let closing = 0
    // A pulse: seconds of its swell left, and how much the content bends with it (0–1).
    let settle = 0
    /** A nod: seconds left of a hover's swell alone (the droplet splitting off or melting in). */
    let nod = 0
    /** A nod asked for while the droplet is still on its way in: it plays once the two are one body. */
    let nodDue = false
    const playNod = () => {
      nodDue = false
      // Hovered, the hover swell is at rest already: its springs are pushed instead (a pulse's push).
      if (hovered) {
        growX.v += PULSE_KICK.x
        growY.v += PULSE_KICK.y
      } else nod = PULSE
    }
    let bend = 0
    /** The swell the glass is settling at (0–1, eased): the content bends by what is beyond it, so it is even once the glass holds still. */
    let bendFrom = 0
    let bent = ''
    /** What this canvas carries to undo a pull's stretch of the host: its `scale`, and the point it is taken about. */
    let unstretched = ''
    let unstretchedAt = ''
    const setBend = (next: string) => {
      if (bent === next) return
      bent = next
      if (next) host.style.setProperty('--glass-bend', next)
      else host.style.removeProperty('--glass-bend')
    }
    const maxScale = () => 1 + (2 * MAX_GROW_PX) / Math.max(w, 1)
    const view: GlassView = {
      canvas,
      ctx,
      dirty: true,
      visible: false,
      // What this glass is, for the light of a press (see GLOW in engine.ts): one that swells is a
      // button and takes the flash of a press; one that holds still (a card) is a surface.
      button: swell,
      // A button is pulled after the pointer that holds it (PULL); glass that holds still (a card) is not.
      pull: pull && swell,
      grow: 1,
      step: (dt, still) => {
        if (still) {
          press.x = growX.x = growY.x = press.v = growX.v = growY.v = 0
          drop.x = hasDroplet && dropletRef.current === 'apart' ? 1 : 0
          drop.v = 0
          closing = drop.x ? 0 : 1
          bendFrom = hovered ? 1 : 0
          settle = nod = bend = 0
          nodDue = false
          setBend('')
          scale.x = 1
          view.grow = 1
          if (colorT !== 1) view.dirty = true
          colorT = 1
          return false
        }
        const greeting = settle > 0
        settle = Math.max(0, settle - dt)
        const nodding = nod > 0
        nod = Math.max(0, nod - dt)
        const hov = hovered || greeting || nodding ? 1 : 0
        // A pulse swells the glass as a press does, on top of the hover.
        // (A pointer that holds the glass to pull it keeps it pressed outside it too.)
        const down = pressed || (swell && view.held === true) || greeting
        const target = down ? Math.min(PRESS_SCALE, maxScale()) : hov ? Math.min(HOVER_SCALE, maxScale()) : 1
        const a = stepSpring(press, down ? 1 : 0, SPRINGS.press, dt)
        const b = stepSpring(growX, hov, SPRINGS.hoverX, dt)
        const c = stepSpring(growY, hov, SPRINGS.hoverY, dt)
        const d = stepSpring(scale, target, SPRINGS.press, dt)
        const apart = dropletRef.current === 'apart' && view.visible && !pressed
        const e = hasDroplet ? stepSpring(drop, apart ? 1 : 0, apart ? SPRINGS.dropletOut : SPRINGS.dropletIn, dt) : false
        closing = clamp(closing + (apart ? -1 : 1) * dt * 12)
        if (nodDue && (apart || drop.x < NOD_AT)) playNod()
        // The content follows the glass while the pulse lasts, and lets go as it settles.
        bend = clamp(bend + ((greeting ? 1 : 0) - bend) * Math.min(1, dt * (greeting ? PULSE_BEND.in : PULSE_BEND.out)))
        if (!greeting && bend < 0.004) bend = 0
        bendFrom = clamp(bendFrom + (hov - bendFrom) * Math.min(1, dt * (hov > bendFrom ? PULSE_BEND.even : PULSE_BEND.back)))
        const by = bend * PULSE_BEND.amount * 2 * HOVER_GROW
        setBend(bend ? `${(1 + (by * (growX.x - bendFrom) * h) / Math.max(w, 1)).toFixed(4)} ${(1 + by * (growY.x - bendFrom)).toFixed(4)}` : '')
        // The engine writes the host's scale: this, times the stretch of a pull.
        view.grow = scale.x
        const fading = 1 - colorT > 0.004
        colorT = fading ? colorT + (1 - colorT) * Math.min(1, dt * 14) : 1
        return a || b || c || d || e || greeting || nodding || nodDue || bend > 0 || fading || (clear && live && view.visible)
      },
      lens: (refresh) => {
        if (refresh) {
          w = host.offsetWidth
          h = host.offsetHeight
          // The glass takes the host's corners (`rounded-lg`); round enough is a pill.
          const rounding = getComputedStyle(host).borderTopLeftRadius
          const px = rounding.endsWith('%') ? (Math.min(w, h) * parseFloat(rounding)) / 100 : parseFloat(rounding) || 0
          corner = px >= Math.min(w, h) / 2 - 0.5 ? null : px
          // The droplet: a direct child marked `data-glass-drop`, laid out by its owner at the end.
          const had = hasDroplet
          hasDroplet = dropletRef.current !== 'none' && [...host.children].some((c) => c.hasAttribute('data-glass-drop'))
          // Springs step before shapes are read: one more frame lets the droplet start moving.
          if (hasDroplet !== had) engine.wake()
          const s = engine.resolveColor(surfaceColorOf(host.parentElement))
          surface = [s[0], s[1], s[2]]
          if (clear) {
            const o = tuneRef.current.optics
            const custom = o?.tintColor || getComputedStyle(host).getPropertyValue('--glass-tint').trim()
            const luminance = 0.2126 * surface[0] + 0.7152 * surface[1] + 0.0722 * surface[2]
            const t = custom ? engine.resolveColor(custom) : null
            const tc: Rgb = t ? [t[0], t[1], t[2]] : luminance > 0.5 ? [1, 1, 1] : [0, 0, 0]
            // Light or dark glass: lets the host pick a readable text colour (data-[glass-tone=…]:).
            const tone = 0.2126 * tc[0] + 0.7152 * tc[1] + 0.0722 * tc[2] > 0.5 ? 'light' : 'dark'
            if (host.dataset.glassTone !== tone) host.dataset.glassTone = tone
            darkGlass = tone === 'dark'
            color = [tc, tc]
            // An optional line just inside the rim.
            const line = darkGlass ? { ...o, ...o?.dark } : o
            const bc = line?.borderColor && (line.borderAlpha ?? 0) > 0 ? engine.resolveColor(line.borderColor) : null
            border = bc ? [[bc[0], bc[1], bc[2]], [bc[0], bc[1], bc[2]]] : null
            borderAlpha = bc ? clamp((line?.borderAlpha ?? 0) * bc[3]) : 1
            colorT = 1
            sampled = true
          } else {
            // Read the host's own fill and border with the glass briefly lifted.
            const had = 'glassReady' in host.dataset
            const transition = host.style.transition
            host.style.transition = 'none'
            if (had) delete host.dataset.glassReady
            const st = getComputedStyle(host)
            const fill = engine.resolveColor(st.backgroundColor)
            const bw = st.borderTopStyle === 'solid' ? parseFloat(st.borderTopWidth) || 0 : 0
            const bc = engine.resolveColor(st.borderTopColor)
            const cannot = st.backgroundImage !== 'none' || (st.borderTopStyle !== 'solid' && st.borderTopStyle !== 'none')
            if (had) {
              host.dataset.glassReady = ''
              void getComputedStyle(host).backgroundColor
            }
            host.style.transition = transition
            const next = mixRgb(surface, [fill[0], fill[1], fill[2]], fill[3])
            const nextBorder: Rgb | null = bw > 0 && bc[3] > 0.02 ? mixRgb(next, [bc[0], bc[1], bc[2]], bc[3]) : null
            unpaintable = cannot || (fill[3] < 0.02 && !nextBorder)
            const now = sampled ? mixRgb(color[0], color[1], colorT) : next
            const nowBorder = sampled && border ? mixRgb(border[0], border[1], colorT) : (nextBorder ?? next)
            const changed = sampled && (now.some((v, i) => Math.abs(v - next[i]) > 0.004) || !!border !== !!nextBorder)
            color = [now, next]
            border = nextBorder ? [nowBorder, nextBorder] : null
            colorT = changed ? 0 : 1
            sampled = true
            if (changed) engine.wake()
          }
        }
        if (w < 2 || h < 2) return null
        if (unpaintable) {
          if (ready) {
            ready = false
            delete host.dataset.glassReady
          }
          return null
        }
        // The host itself is scaled; the glass inside the canvas is divided by that scale.
        const p = clamp(press.x, -0.12, 1.15)
        const s = Math.max(0.5, scale.x)
        const k = lerp(1, Math.min(PRESS_SCALE, maxScale()), p) / s
        const grow = (h * HOVER_GROW) / s
        const t = hasDroplet ? clamp(drop.x, 0, 1.06) : 0
        const pull = h * (1 + DROPLET_GAP) * t
        const hy = (h / 2) * k + grow * growY.x
        // Swollen, the droplet's end sits a little off the body's. It joins it as the two
        // become one, or the end would jump when the droplet goes (the spring's last
        // ripple brings it back for a moment).
        const dropX = (w / 2 - h / 2) * k + grow * lerp(growX.x - growY.x, growX.x * 0.5, smooth(0, 0.15, t))
        // The canvas keeps 8px beside the glass and 10px above it, and more whenever the glass
        // swells past that (a push while it is already swollen): its end is never cut off.
        const reach = Math.max((w / 2) * k + grow * growX.x, t > 0.001 ? dropX + hy : 0)
        // A pull stretches the host. That stretch is undone on this canvas and drawn by the glass
        // itself: it stays a pill with round ends, as long and as thin as the pull makes it, and
        // bends what really lies behind it (not a picture of it, pulled out of shape with the host).
        const px = view.pulled?.sx ?? 1
        const py = view.pulled?.sy ?? 1
        // Room for the longest a pull can make it, taken once: a canvas that changed size on
        // every frame of a pull would be painted from scratch each time.
        const most = px === 1 && py === 1 ? 0 : Math.max(w, h) <= PULL.smallUntil ? PULL.smallStretchMax : PULL.stretchMax
        // A button also keeps room for its side of a bridge to glass it melts into (COHESION).
        const melt = swell ? Math.ceil(cohesionSoftness(h) / 4) + 3 : 0
        const padX = Math.max(8, Math.ceil(reach * (1 + most) - w / 2 + 2), melt)
        const padTop = Math.max(10, Math.ceil(hy * (1 + most) - h / 2 + 2), melt)
        const padBottom = Math.round(h * 0.8 + 4)
        const origin = `${padX + w / 2}px ${padTop + h / 2}px`
        const undo = px === 1 && py === 1 ? '' : `${(1 / px).toFixed(6)} ${(1 / py).toFixed(6)}`
        if (undo !== unstretched || (undo && origin !== unstretchedAt)) {
          canvas.style.transformOrigin = unstretchedAt = origin
          canvas.style.scale = unstretched = undo
        }
        const rect = host.getBoundingClientRect()
        const pc = clamp(press.x)
        const unit = h / DESIGN_HEIGHT
        const bevel = lerp(DESIGN_HEIGHT * 0.42, 62, pc)
        // Square corners swell with the glass.
        const radius = corner === null ? 999 : corner * (hy / (h / 2))
        const { tint, blur, optics: o } = tuneRef.current
        // The engine scales the shadow with the light too; divide it back out, so they tune apart.
        const strength = Math.max(clamp(o?.light ?? 1, 0, 3), 1e-4)
        // The gooey bridge opens as the droplet leaves and closes once it has snapped.
        const bridge = h * 0.34 * py * smooth(0, 0.15, t) * (1 - smooth(0.8, 1, t))
        // On its way in, the droplet ends up inside the body's end, and a bridge that soft would
        // swell that end past the body (it grew, then shrank as the droplet went). There the
        // bridge only fills the dip between the two: the end stays as tall as the rest.
        const dip = Math.hypot(hy * py, (pull * k * px) / 2) - hy * py
        return {
          // The canvas is placed against the padding box; the glass is measured on the border box.
          left: -padX - host.clientLeft,
          top: -padTop - host.clientTop,
          width: w + 2 * padX,
          height: h + padTop + padBottom,
          unit,
          cx: padX + w / 2,
          cy: padTop + h / 2,
          hx: ((w / 2 - pull / 2) * k + grow * growX.x) * px,
          hy: hy * py,
          radius,
          bodyX: (-pull / 2) * k * px,
          droplet:
            t > 0.001
              ? {
                  x: dropX * px,
                  r: hy * py,
                  k: lerp(bridge, Math.min(bridge, 4 * dip), closing),
                }
              : undefined,
          // Shading bands deeper than a square corner would meet in diagonal seams: the bevel
          // stays within the corner, and the bend keeps the depth it has on a pill.
          bevel: (corner === null ? bevel : Math.min(bevel, (radius / unit) * 1.2)) * Math.max(0.05, o?.bevel ?? 1),
          band: corner === null || hasDroplet ? undefined : bevel * 0.35 * Math.max(0.05, o?.bendDepth ?? 1),
          shadow: (0.12 * lerp(0.55, 1, pc) * Math.max(0, o?.shadow ?? 1)) / strength,
          shadowSoftness: 34 * lerp(0.6, 1, pc) * Math.max(0.05, o?.shadowSoftness ?? 1),
          shadowOffset: 22 * lerp(0.5, 1, pc) * Math.max(0, o?.shadowOffset ?? 1),
          strength,
          tune: o && {
            rim: o.rim,
            rimWidth: o.rimWidth,
            fresnel: o.fresnel,
            inner: o.inner,
            reflection: o.reflection,
            caustic: o.caustic,
            mirror: o.mirror,
            bendCurve: o.bendCurve,
            bendDepth: o.bendDepth,
            saturation: o.saturation,
            frostEdge: o.frostEdge,
          },
          color: mixRgb(color[0], color[1], colorT),
          border: border ? mixRgb(border[0], border[1], colorT) : undefined,
          borderAlpha: clear ? borderAlpha : undefined,
          borderWidth: clear ? o?.borderWidth : undefined,
          surface,
          edgeClear: 0.2,
          cursorLight: o?.cursorLight ?? true,
          pointerLight: true,
          // What the rim of clear glass mirrors: the page around it. Tinted glass mirrors nothing.
          reflection: !clear ? undefined : {
            height: h,
            live,
            paint: (around, reach) => {
              const r = host.getBoundingClientRect()
              const box = { left: r.left + (r.width - w) / 2 - padX, top: r.top + (r.height - h) / 2 - padTop, width: w + 2 * padX, height: h + padTop + padBottom }
              drawAround(around, (backdrop ? host.closest(backdrop) : null) ?? document.body, box, reach, {
                skip: (el) => el === host || el.hasAttribute('data-glass-skip'),
                onStale: dirty,
              })
            },
          },
          refraction: clear
            ? {
                paint: (back) => {
                  back.translate(padX, padTop)
                  const fill = rgbCss(surface)
                  const recoloured = fill !== page.fill
                  page.fill = fill
                  back.fillStyle = fill
                  back.fillRect(-padX, -padTop, w + 2 * padX, h + padTop + padBottom)
                  const root = (backdrop ? host.closest(backdrop) : null) ?? document.body
                  const r = host.getBoundingClientRect()
                  const lx = r.left + (r.width - w) / 2
                  const ly = r.top + (r.height - h) / 2
                  const target = back.canvas
                  const key = `${target.width}:${target.height}:${Math.round(lx * 2)}:${Math.round(ly * 2)}:${Math.round(scrollX)}:${Math.round(scrollY)}`
                  const now = performance.now()
                  if (!page.ctx) page.ctx = page.canvas.getContext('2d')
                  const region = { left: lx - padX, top: ly - padTop, right: lx + w + padX, bottom: ly + h + padBottom }
                  // Scrolling with the page, the glass keeps the same page behind it: the picture it has
                  // is still right. Not when something in it moves by itself, or is pinned to the
                  // viewport (a sticky header) and touches the glass, now or when it was painted.
                  const rides =
                    !live &&
                    page.rigid &&
                    page.size === `${target.width}:${target.height}` &&
                    Math.abs(lx - page.lx + scrollX - page.sx) < 0.05 &&
                    Math.abs(ly - page.ly + scrollY - page.sy) < 0.05 &&
                    !page.pinned.some((el) => {
                      const b = el.getBoundingClientRect()
                      return b.width > 0 && b.height > 0 && b.right > region.left && b.left < region.right && b.bottom > region.top && b.top < region.bottom
                    })
                  // Glass this one melts into (COHESION) is the same body now: the picture leaves it out.
                  if (page.near !== view.near) {
                    page.near = view.near
                    page.stale = true
                  }
                  // The page is re-painted when the glass moves over it, and at most every 120 ms otherwise.
                  // `live` reads it again every frame at 60 Hz, and every second or third frame on a faster display.
                  const again = !!page.ctx && (page.stale || (key !== page.key && !rides) || now - page.at > (live ? 12 : 120))
                  if (page.ctx && again) {
                    page.stale = false
                    page.key = key
                    page.at = now
                    page.size = `${target.width}:${target.height}`
                    page.lx = lx
                    page.ly = ly
                    page.sx = scrollX
                    page.sy = scrollY
                    if (page.canvas.width !== target.width || page.canvas.height !== target.height) {
                      page.canvas.width = target.width
                      page.canvas.height = target.height
                    }
                    const pc2 = page.ctx
                    pc2.setTransform(1, 0, 0, 1, 0, 0)
                    pc2.clearRect(0, 0, target.width, target.height)
                    pc2.setTransform(back.getTransform())
                    const found = { pinned: [] as Element[], touched: false, loose: false }
                    drawDom(pc2, root, {
                      origin: { left: lx, top: ly },
                      region,
                      skip: (el) => el === host || el.hasAttribute('data-glass-skip') || !!view.near?.includes(el),
                      onStale: () => {
                        page.stale = true
                        view.dirty = true
                        engine.wake()
                      },
                      found,
                    })
                    page.pinned = found.pinned
                    page.rigid = !found.loose && !found.touched
                  }
                  back.save()
                  back.setTransform(1, 0, 0, 1, 0, 0)
                  back.drawImage(page.canvas, 0, 0)
                  back.restore()
                  // The same picture of the page as last time: the engine keeps its texture.
                  return again || recoloured
                },
                refract: lerp(44, 37, pc) * Math.max(0, o?.refraction ?? 1),
                magnify: Math.max(0, o?.magnify ?? 0),
                dispersion: Math.max(0, o?.dispersion ?? 0.12),
                blurCenter: Math.max(0, o?.clearBlur ?? 0.35),
                blurEdge: Math.max(0, o?.clearBlurEdge ?? 2.2),
                frost: clamp(darkGlass ? (o?.dark?.tint ?? tint) : tint),
                blur,
                blurMix: o?.frostMix,
                radial: o?.bendMode === 'radial' ? 0.065 * Math.max(0, o?.refraction ?? 1) : undefined,
              }
            : undefined,
          screenX: rect.left + rect.width / 2,
          screenY: rect.top + rect.height / 2,
          // The host's scale on screen (its own and its ancestors'), without a pull's stretch, which the canvas undoes.
          scale: rect.width / Math.max(w * px, 1e-3),
        }
      },
      drawn: () => {
        if (ready) return
        ready = true
        host.dataset.glassReady = ''
      },
      lost: () => {
        delete host.dataset.glassReady
        view.grow = 1
      },
    }

    const isDisabled = () => host.matches(":disabled, [aria-disabled='true']")
    const dirty = () => {
      view.dirty = true
      engine.wake()
    }
    pokeRef.current = dirty
    // The nod: a hover's swell alone, for PULSE seconds. A droplet melting in swells once it is
    // in: pushed while it is still out, its end would stick out past the body's.
    nodRef.current = () => {
      if (!swell || host.matches(':disabled')) return
      if (hasDroplet && dropletRef.current === 'merged' && drop.x >= NOD_AT) nodDue = true
      else playNod()
      dirty()
    }
    // The pulse (see `pulse`): the glass swells as under a hover and a press at once, and lets
    // go. Hovered, its hover swell is at rest already: those springs are pushed, so it wobbles.
    pulseRef.current = () => {
      if (!swell || host.matches(':disabled')) return
      if (hovered) {
        growX.v += PULSE_KICK.x
        growY.v += PULSE_KICK.y
      }
      settle = Math.max(0, pulseHoldRef.current ?? PULSE)
      dirty()
    }
    const onDown = () => {
      if (!swell || isDisabled()) return
      pressed = true
      engine.wake()
    }
    const onUp = () => {
      pressed = false
      engine.wake()
    }
    const onEnter = (e: PointerEvent) => {
      if (!swell || e.pointerType !== 'mouse' || isDisabled()) return
      hovered = true
      dirty()
    }
    const onLeave = () => {
      pressed = false
      hovered = false
      dirty()
    }
    const target: HTMLElement = (trigger ? host.closest<HTMLElement>(trigger) : null) ?? host
    if (target !== host) view.pressArea = target
    target.addEventListener('pointerdown', onDown)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
    target.addEventListener('pointerenter', onEnter)
    target.addEventListener('pointerleave', onLeave)
    const io = new IntersectionObserver(([entry]) => {
      view.visible = entry.isIntersecting
      dirty()
    })
    io.observe(host)
    const ro = new ResizeObserver(dirty)
    ro.observe(host)
    // Content changes (label, selected state) re-check the droplet and colours.
    const mo = new MutationObserver(dirty)
    mo.observe(host, {
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'disabled', 'aria-pressed', 'aria-checked', 'aria-selected', 'aria-expanded', 'data-state'],
    })
    // A scroll changes what lies behind, never the glass: sizes and colours are not read again.
    const onScroll = () => {
      view.repaint = true
      engine.wake()
    }
    if (clear) addEventListener('scroll', onScroll, { passive: true, capture: true })
    engine.add(view)

    return () => {
      engine.remove(view)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      io.disconnect()
      ro.disconnect()
      mo.disconnect()
      removeEventListener('scroll', onScroll, { capture: true })
      target.removeEventListener('pointerdown', onDown)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
      target.removeEventListener('pointerenter', onEnter)
      target.removeEventListener('pointerleave', onLeave)
      delete host.dataset.glassReady
      delete host.dataset.glassTone
      host.style.removeProperty('--glass-bend')
      canvas.style.scale = ''
      pokeRef.current = null
      pulseRef.current = null
      nodRef.current = null
    }
  }, [material, backdrop, live, trigger, disabled, swell, pull])

  return (
    <>
      <GlassStyles />
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{ position: 'absolute', zIndex: -1, maxWidth: 'none', pointerEvents: 'none', width: 0, height: 0 }}
      />
    </>
  )
}

export default GlassLayer
