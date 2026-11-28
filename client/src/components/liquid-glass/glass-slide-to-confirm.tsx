'use client'

// GlassSlideToConfirm — a slide-to-confirm track whose thumb is a liquid glass lens.
// Drag the thumb to the end to run one deliberate action; let go early and it springs back:
//
//   <GlassSlideToConfirm pendingLabel="Sending" successLabel="Sent" onConfirm={send}>
//     Slide to send $240
//   </GlassSlideToConfirm>
//
//   idle      ( › )  Slide to send $240       the thumb rests as frosted white glass
//   drag      ███═( › )  to send $240         clear glass: it bends the fill and the label
//                                             it passes and stretches with its speed; its
//                                             icon takes the fill's text colour; the fill trails it
//                                             on a bridge that thins as they pull apart,
//                                             and the track swells around it like a membrane.
//                                             Past the end the track stretches like a rubber
//                                             band; against the start the wall gives a little
//   pending              Sending ((◌))        the track draws in to a ring around the thumb; the
//                                             chevron gives way to a spinner
//   success                 Sent  ( ✓ )       the glass takes the fill's colour and the
//                                             chevron's stroke bends into a check. It stays
//                                             confirmed, unless `resetAfter` is set: then the
//                                             track opens first, the label leaving with its edge,
//                                             and the thumb flies home after it, squashing a little
//                                             as it lands against the start
//
// Keyboard: arrow keys move the thumb in tenths, End confirms, Home returns, and holding
// Space or Enter glides it to the end. Colour the fill with `fillClassName`. Without WebGL2
// or with reduced motion the thumb is a plain white disc that follows the finger. COPY VERBATIM. MIT.

import { useEffect, useRef, useState, type ReactNode } from 'react'

import { drawAround, drawDom } from './dom-snapshot'
import { GlassStyles } from './glass-layer'
import { SPRINGS, clamp, getGlassEngine, lerp, mixRgb, smooth, stepSpring, surfaceColorOf, type GlassView, type Rgb, type Spring } from './engine'

export type GlassSlideState = 'idle' | 'pending' | 'success'
export type GlassSlideSize = 'sm' | 'md' | 'lg' | 'xl'

export type GlassSlideToConfirmProps = {
  /** The instruction, written in the track and used as the slider's name: "Slide to send $240". */
  children: string
  /** Runs once the thumb reaches the end. Return a promise to stay pending until it settles. */
  onConfirm: () => unknown
  /** Called when `onConfirm` throws or rejects; the thumb springs back to the start. */
  onConfirmError?: (error: unknown) => void
  /** Written beside the spinner while `onConfirm` runs. */
  pendingLabel?: string
  /** Written beside the check once it succeeds. */
  successLabel?: string
  /** Replaces the instruction after a failure, until the next slide. */
  errorLabel?: string
  /** Share of the track the thumb must pass before letting go confirms. */
  threshold?: number
  /** Milliseconds after a success before the track opens again. `0` stays confirmed. */
  resetAfter?: number
  /** Nudge the thumb every few seconds until it has been touched, to show that it moves. */
  hint?: boolean
  /** The thumb's idle icon (default: a chevron). */
  icon?: ReactNode
  size?: GlassSlideSize
  /** Classes of the fill the thumb pulls behind it: its `bg-*` and the `text-*` written on it. */
  fillClassName?: string
  /** `false` leaves the track bare: the thumb pulls no fill behind it, and `fillClassName` colours the success alone. */
  fill?: boolean
  /** The held thumb's rim mirrors the page around the track: a colourful neighbour lights the rim that faces it, and the icon glows. */
  mirror?: boolean
  disabled?: boolean
  className?: string
}

/** The thumb is designed 80 units tall; the optics are scaled to the slider's 120-unit lens. */
const OPTION_UNITS = 80
const OPTICS = (OPTION_UNITS * 1.35) / 120
/** The lens swells evenly while it is held or travels, so the thumb stays round. */
const SWELL = 0.12
/** Speed stretches the thumb along its travel, like a drop: up to +20 % wide, −12 % tall. */
const STRETCH_W = 0.2
const STRETCH_H = 0.12
/** The fill's tail follows the thumb about 90 ms behind and overshoots it by a hair as it lands. */
const TAIL = { omega: 17, zeta: 0.8 }
/** The bridge between the tail and the thumb pinches in by this share of their distance, up to this share of the thumb's radius. */
const NECK_SLOPE = 0.2
const NECK_PINCH = 0.74
/** The track swells around the held thumb like a membrane: a bell this share of the track's height tall… */
const BULGE = 0.043
/** …this many thumb radii wide, growing by up to this share with the thumb's speed… */
const BULGE_REACH = 1.35
const BULGE_SPEED = 0.8
/** …on an underdamped spring, so its edge wobbles once as it settles. */
const MEMBRANE = { omega: 24, zeta: 0.32 }
/**
 * Past the end the track stretches like a rubber band: the thumb follows the finger ever less
 * (half of the way is reached with the finger this many track heights past the limit), and the
 * track's end gives this share of the thumb's way…
 */
const RUBBER_GIVE = 1.35
const RUBBER_TRACK = 0.78
/** …but neither end of the track ever reaches further out than this (px), however hard the pull. */
const OVERFLOW = 16
/** Pushed against the start the thumb leans into the wall: the wall gives this share of its way (up to the thumb's inset). */
const WALL_GIVE = 0.75
/**
 * Landing against the start (not pushed there by a finger) the thumb squashes instead of passing
 * the wall: narrower by this share per thumb width it pushes in, at most this share, and taller
 * by this share of that.
 */
const SQUASH_RATE = 1.15
const SQUASH = 0.2
const SQUASH_TALL = 0.6
/** With `mirror`, the thumb's mark glows while the glass is clear: a faint white light, just around itself. */
const MARK_GLOW = 'transition-[filter] duration-200 [[data-glass-traveling]_&]:[filter:drop-shadow(0_0_5px_rgb(255_255_255/0.35))]'
/** The fill swells with the track, by this share of the track's bell. */
const FILL_BULGE = 0.8
/** Reaching this far (px) out from under the thumb, the fill is fully shown. */
const FILL_SHOWN = 6
/** The track's and the fill's shape at rest: their boxes are 8 px taller on both sides, to leave the swell room. */
const REST = 'inset(8px 0 round 999px)'
/** Holding Space or Enter glides the thumb to the end in this many seconds. */
const HOLD_SECONDS = 0.9
/** Milliseconds between two idle nudges. */
const HINT_EVERY = 4200
/** Once confirmed, the spinner takes the chevron's place when the track is this far drawn in. */
const SPIN_AT = 0.6
const SPIN = { omega: 18, zeta: 1 }
/** On a success the white disc dissolves into the fill's colour… */
const DISSOLVE = { omega: 40, zeta: 1 }
/** …and the chevron's three points travel to the check's. */
const MORPH = { omega: 20, zeta: 1 }
/**
 * A custom `icon` cannot bend into the check: the two swap in place instead. The one that leaves
 * shrinks to this scale, blurs by this many px and fades, while the other comes in the same way
 * reversed, both at once and in about 0.3 s.
 */
const SWAP = { omega: 30, zeta: 1 }
const SWAP_SCALE = 0.25
const SWAP_BLUR = 4
/** Opening again, the dissolved disc stays until the track is this far drawn in, and the thumb waits at the end until it is this close to open. */
const REFORM = 0.75
const REOPEN = 0.09
/**
 * As the check appears the thumb swells and settles, as a button does under the pointer: by this
 * share of its width at most, on the button's own two springs (a kick that peaks at about 1 on each).
 */
const POP = 0.12
const POP_KICK_X = 29
const POP_KICK_Y = 18.7
/** The track counts as drawn in around the thumb from here on (0–1 of the way): a success shows only then. */
const DRAWN = 0.99
/** The track draws into the thumb, and opens out of it again, in one glide that does not rebound. */
const DRAW = { omega: 13.4, zeta: 1 }
/** Once the track is open again the thumb flies home, quicker than an early release springs back. */
const HOME = { omega: 22, zeta: 0.75 }

// Track height, thumb (inset 4 px), the fill's box (8 px taller on both sides than the thumb),
// and the boxes that keep both copies of the label aligned.
const sizes: Record<GlassSlideSize, { host: string; thumb: string; fill: string; label: string; copy: string }> = {
  sm: { host: 'h-10 text-[13px] [&_svg]:size-4', thumb: 'size-8', fill: 'h-12 w-8', label: 'left-10', copy: 'left-9 h-10' },
  md: { host: 'h-12 text-sm [&_svg]:size-[18px]', thumb: 'size-10', fill: 'h-14 w-10', label: 'left-12', copy: 'left-11 h-12' },
  lg: { host: 'h-14 text-[15px] [&_svg]:size-5', thumb: 'size-12', fill: 'h-16 w-12', label: 'left-14', copy: 'left-[52px] h-14' },
  xl: { host: 'h-24 text-[20px] [&_svg]:size-8', thumb: 'size-[88px]', fill: 'h-[104px] w-[88px]', label: 'left-24', copy: 'left-[92px] h-24' },
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const
// The thumb's mark is one stroke of three points: a chevron at 0, a check at 1.
const CHEVRON = [9.5, 5.5, 16, 12, 9.5, 18.5]
const CHECK = [4.5, 12.75, 10.5, 18.75, 19.5, 5.25]
const markPath = (k: number) => {
  const p = CHEVRON.map((from, i) => +lerp(from, CHECK[i], k).toFixed(2))
  return `M${p[0]} ${p[1]}L${p[2]} ${p[3]}L${p[4]} ${p[5]}`
}
const Spinner = () => (
  <svg {...svg} strokeWidth="2.5" data-glass-spin="">
    <path d="M21 12a9 9 0 1 1-6.22-8.56" />
  </svg>
)

type Controller = { unlock: () => void; wake: () => void }

export function GlassSlideToConfirm({
  children,
  onConfirm,
  onConfirmError,
  pendingLabel,
  successLabel,
  errorLabel,
  threshold = 0.9,
  resetAfter = 0,
  hint = true,
  icon,
  size = 'md',
  fillClassName = 'bg-[#3291FF] text-white',
  fill = true,
  mirror = false,
  disabled = false,
  className = '',
}: GlassSlideToConfirmProps) {
  const s = sizes[size]
  const [state, setState] = useState<GlassSlideState>('idle')
  const [failed, setFailed] = useState(false)
  // Swaps animate only after the first slide, never on page load.
  const [touched, setTouched] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controller = useRef<Controller | null>(null)
  const alive = useRef(true)
  const lastStatus = useRef('')

  const toIdle = (didFail: boolean) => {
    setState('idle')
    setFailed(didFail)
    controller.current?.unlock()
  }
  const run = async () => {
    setTouched(true)
    setFailed(false)
    setState('pending')
    try {
      await onConfirm()
      if (alive.current) setState('success')
    } catch (error) {
      if (alive.current) toIdle(true)
      onConfirmError?.(error)
    }
  }
  // What the gesture reads: always the latest props, without rebuilding the glass.
  const live = useRef({ run, threshold, hint, disabled, state, fill, mirror })
  live.current = { run, threshold, hint, disabled, state, fill, mirror }

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // The thumb's marks are driven by springs: a new state starts them.
  useEffect(() => controller.current?.wake(), [state])

  useEffect(() => {
    if (state !== 'success' || !resetAfter) return
    const id = setTimeout(() => toIdle(false), resetAfter)
    return () => clearTimeout(id)
  }, [state, resetAfter])

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!root || !canvas || !ctx) return
    const part = (name: string) => root.querySelector<HTMLElement>(`[data-glass-slide="${name}"]`)
    const track = part('track')
    const bed = part('bed')
    const label = part('label')
    const fill = part('fill')
    const copy = part('copy')
    const status = part('status')
    const thumb = part('thumb')
    const disc = part('disc')
    const done = part('done')
    const mark = part('mark')
    const glyph = part('glyph')
    const spinner = part('spinner')
    const check = part('check')
    if (!track || !bed || !label || !fill || !copy || !status || !thumb || !disc || !done || !mark || !spinner || !check) return
    // The default chevron bends into the check; a custom `icon` fades to it instead.
    const ink = mark.querySelector('[data-glass-slide="ink"]')
    const checkPath = check.querySelector('path')
    let engine = getGlassEngine()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

    // Geometry (CSS px): track width and height, thumb diameter and inset, the thumb's travel.
    let W = 0
    let h = 0
    let d = 0
    let pad = 0
    let travel = 1
    let color: Rgb = [1, 1, 1]
    /** The fill's colour: the glass takes it on a success. */
    let fillColor: Rgb = [0.2, 0.57, 1]
    let surface: Rgb = [1, 1, 1]
    // The gesture. `locked`: the thumb's home is the end (the action is running or done).
    let input: 'none' | 'drag' | 'hold' | 'keys' = 'none'
    let locked = live.current.state !== 'idle'
    let arrived = locked
    // Opening again: the track opens first, the thumb waits at the end.
    let reopening = false
    let dragGoal = 0
    let grab = 0
    let hold = 0
    let keyValue = 0
    let nudged = false
    let lensOn = false
    let valueNow = ''
    const x: Spring = { x: 0, v: 0 }
    // The fill's tail: it trails the thumb both ways. Ahead of it the thumb pulls a thinning
    // bridge; on the way back the tail is absorbed after the thumb has passed.
    const tail: Spring = { x: 0, v: 0 }
    let stretchX = 1
    let stretchY = 1
    let shown = 0
    // The membrane: how far the track is pushed outward around the held thumb (0…1 and a wobble).
    const swell: Spring = { x: 0, v: 0 }
    let margin = 8
    let rim = 8
    let shaped = false
    let fillVeil = ''
    // The thumb is flying home after the track opened again.
    let homing = false
    let bulged = false
    const press: Spring = { x: 0, v: 0 }
    const collapse: Spring = { x: locked ? 1 : 0, v: 0 }
    // The thumb's marks: the spinner's share, the disc dissolved into the fill, chevron (0) to check (1).
    const spin: Spring = { x: 0, v: 0 }
    const dissolve: Spring = { x: 0, v: 0 }
    const morph: Spring = { x: 0, v: 0 }
    const swap: Spring = { x: 0, v: 0 }
    // The swell that greets the check, wider and taller on springs of their own.
    const popX: Spring = { x: 0, v: 0 }
    const popY: Spring = { x: 0, v: 0 }
    let greeted = live.current.state === 'success'
    let marks = ''

    const measure = () => {
      W = root.offsetWidth
      h = root.offsetHeight
      d = thumb.offsetWidth
      pad = (h - d) / 2
      travel = Math.max(1, W - h)
      margin = Math.max(0, -bed.offsetTop)
      rim = Math.max(0, pad - fill.offsetTop)
      root.style.setProperty('--glass-slide-ink', getComputedStyle(fill).color)
      copy.style.width = `${W - h}px`
      if (arrived && input === 'none') x.x = tail.x = travel
      if (engine) {
        const c = engine.resolveColor(getComputedStyle(disc).backgroundColor)
        color = [c[0], c[1], c[2]]
        const f = engine.resolveColor(getComputedStyle(done).backgroundColor)
        fillColor = [f[0], f[1], f[2]]
        const page = engine.resolveColor(surfaceColorOf(root.parentElement))
        surface = [page[0], page[1], page[2]]
      }
    }

    /** Writes the springs to the DOM: thumb, fill, both labels, the retreating track. */
    const write = () => {
      const p = clamp(x.x / travel)
      const c = clamp(collapse.x)
      const off = c * travel
      const r = d / 2
      // Landing against the start the thumb squashes into the wall; a finger only leans it in.
      const push = input === 'drag' ? 0 : Math.max(0, -x.x)
      const squash = Math.min(SQUASH, (SQUASH_RATE * push) / d)
      // Where the thumb sits: past the start it leans in only as far as its squashed edge stays inside the track.
      const at = Math.max(x.x, -(pad + r * squash))
      shown = at
      // The fill starts at the thumb's squashed edge, so its cap stays under the disc.
      const back = Math.min(0, shown + r * squash)
      // In the fill's own box: where the tail's cap and the thumb sit.
      const tailAt = Math.max(0, tail.x - off - back)
      const headAt = Math.max(0, shown - off - back)
      const gap = headAt - tailAt
      const shift = 12 * p
      const speed = clamp(Math.abs(x.v) / (22 * d))
      // Against the start the wall gives a little; past the end the track stretches after the thumb.
      const lead = Math.min(OVERFLOW, WALL_GIVE * Math.min(pad, Math.max(0, -at)))
      const stretch = Math.min(OVERFLOW, RUBBER_TRACK * Math.max(0, at - travel))
      stretchX = (1 + STRETCH_W * speed) * (1 - squash) * (1 + POP * popX.x)
      stretchY = (1 - STRETCH_H * speed) * (1 + SQUASH_TALL * squash) * (1 + POP * popY.x)
      disc.style.scale = Math.abs(stretchX - 1) > 0.004 || Math.abs(stretchY - 1) > 0.004 ? `${stretchX.toFixed(3)} ${stretchY.toFixed(3)}` : ''
      const fade = String(+((1 - 0.7 * p) * (1 - smooth(0, 1 / 3, c))).toFixed(3))
      // The membrane: how far the held thumb pushes the track outward, and how wide that bell is.
      const amp = Math.max(0, swell.x) * BULGE * h * (1 + BULGE_SPEED * speed)
      const reach = (BULGE_REACH * d) / 2
      thumb.style.translate = `${shown.toFixed(2)}px`
      track.style.left = `${(off - lead).toFixed(2)}px`
      track.style.right = `${(-stretch).toFixed(2)}px`
      fill.style.translate = `${(off + back).toFixed(2)}px`
      fill.style.width = `${(Math.max(tailAt, headAt) + d).toFixed(2)}px`
      // The fill's outline: the tail's pill and the thumb's disc, joined by a bridge that thins as
      // they pull apart. Its long edges rise with the track's bell, a little less.
      const lift = amp * FILL_BULGE
      if (gap > 0.5 || lift > 0.02) {
        const a = tailAt + r
        const b = headAt + r
        const rise = (at: number) => lift * Math.exp(-(((at - b) / reach) ** 2))
        const steps = Math.max(1, Math.round((a - r) / 6))
        let upper = ''
        let lower = ''
        for (let i = 0; i <= steps; i++) {
          const at = r + ((a - r) * i) / steps
          const up = rise(at)
          upper += `L${at.toFixed(1)} ${(rim - up).toFixed(2)}`
          lower = `L${at.toFixed(1)} ${(rim + d + up).toFixed(2)}${lower}`
        }
        let end = a
        let over = ''
        let under = ''
        if (gap > 0.5) {
          const waist = Math.min(NECK_SLOPE * gap, NECK_PINCH * r)
          const mid = (a + gap / 2).toFixed(1)
          const top = (rim + waist).toFixed(2)
          const low = (rim + d - waist).toFixed(2)
          over = `C${mid} ${top} ${mid} ${top} ${b.toFixed(1)} ${(rim - rise(b)).toFixed(2)}`
          under = `C${mid} ${low} ${mid} ${low} ${a.toFixed(1)} ${(rim + d + rise(a)).toFixed(2)}`
          end = b
        }
        const first = rise(r)
        const last = rise(end)
        const cap = (by: number) => `A${r} ${(r + by).toFixed(2)} 0 0 1 `
        fill.style.clipPath = `path('M${r} ${(rim - first).toFixed(2)}${upper}${over}${cap(last)}${end.toFixed(1)} ${(rim + d + last).toFixed(2)}${under}${lower}${cap(first)}${r} ${(rim - first).toFixed(2)}Z')`
        shaped = true
      } else if (shaped) {
        fill.style.clipPath = REST
        shaped = false
      }
      // Lying only under the thumb, the fill would just fringe its edge: under the flat disc it
      // waits hidden, and under the glass it shows only as far as the glass is clear, so the
      // frosting lens never rims itself in blue. It comes out over its first few pixels of reach.
      const out = Math.max(tailAt, headAt) - 0.5
      // A bare track (`fill={false}`) never shows it.
      const show = live.current.fill ? lerp(lensOn ? clamp(press.x) : 0, 1, clamp(out / FILL_SHOWN)) : 0
      const veil = show < 0.01 ? 'hidden' : show > 0.99 ? '' : String(+show.toFixed(3))
      if (veil !== fillVeil) {
        fillVeil = veil
        fill.style.visibility = veil === 'hidden' ? 'hidden' : ''
        fill.style.opacity = veil === 'hidden' ? '' : veil
      }
      // The track's outline: a pill whose long edges rise in a bell around the thumb.
      const width = W - off + lead + stretch
      if (amp > 0.02 && width - h > 1) {
        const R = h / 2
        const centre = pad + shown + d / 2 - off + lead
        const rise = (at: number) => amp * Math.exp(-(((at - centre) / reach) ** 2))
        const steps = Math.max(2, Math.round((width - h) / 6))
        let upper = ''
        let lower = ''
        for (let i = 0; i <= steps; i++) {
          const at = R + ((width - h) * i) / steps
          const up = rise(at)
          upper += `L${at.toFixed(1)} ${(margin - up).toFixed(2)}`
          lower = `L${at.toFixed(1)} ${(margin + h + up).toFixed(2)}${lower}`
        }
        const start = rise(R)
        const end = rise(width - R)
        const cap = (by: number) => `A${R} ${(R + by).toFixed(2)} 0 0 1 `
        bed.style.clipPath = `path('M${R} ${(margin - start).toFixed(2)}${upper}${cap(end)}${(width - R).toFixed(1)} ${(margin + h + end).toFixed(2)}${lower}${cap(start)}${R} ${(margin - start).toFixed(2)}Z')`
        bulged = true
      } else if (bulged) {
        bed.style.clipPath = REST
        bulged = false
      }
      label.style.translate = `${shift.toFixed(2)}px`
      label.style.opacity = fade
      // The copy on the fill stays exactly over the label, wherever the fill starts.
      copy.style.translate = `${(shift - off - back).toFixed(2)}px`
      copy.style.opacity = fade
      status.style.opacity = String(+smooth(0.5, 1, c).toFixed(3))
      const s = +clamp(spin.x).toFixed(3)
      const u = +clamp(dissolve.x).toFixed(3)
      const k = +clamp(morph.x).toFixed(3)
      // How far the check has taken the icon's place.
      const v = +clamp(swap.x).toFixed(3)
      const next = `${s} ${u} ${k} ${v} ${lensOn}`
      if (next !== marks) {
        marks = next
        // Without the glass the success colour comes in a little ahead of the disc's fading, and
        // leaves a little after it. With the glass, the glass itself takes the fill's colour.
        done.style.opacity = lensOn ? '0' : String(+Math.sqrt(u).toFixed(3))
        // The grey track gives way under it, so no grey rim shows around the disc.
        bed.style.opacity = u > 0 ? String(+(1 - u).toFixed(3)) : ''
        // Left to its classes until it dissolves, so the glass can still hide it.
        disc.style.opacity = u > 0 && !lensOn ? String(+(1 - u).toFixed(3)) : ''
        mark.style.opacity = String(+((1 - s) * (1 - v)).toFixed(3))
        spinner.style.opacity = String(s)
        check.style.opacity = String(+((1 - s) * v).toFixed(3))
        if (ink && checkPath) {
          const d = markPath(k)
          ink.setAttribute('d', d)
          checkPath.setAttribute('d', d)
        } else if (glyph) {
          // A custom icon and the check swap in place: one shrinks, blurs and fades as the other comes in.
          const leave = v > 0 && v < 1
          glyph.style.scale = leave ? String(+lerp(1, SWAP_SCALE, v).toFixed(3)) : ''
          glyph.style.filter = leave ? `blur(${+(SWAP_BLUR * v).toFixed(2)}px)` : ''
          check.style.scale = leave ? String(+lerp(SWAP_SCALE, 1, v).toFixed(3)) : ''
          check.style.filter = leave ? `blur(${+(SWAP_BLUR * (1 - v)).toFixed(2)}px)` : ''
        }
      }
      const now = String(Math.round(p * 100))
      if (now !== valueNow) root.setAttribute('aria-valuenow', (valueNow = now))
    }

    const stopLens = () => {
      if (!lensOn) return
      lensOn = false
      press.x = press.v = 0
      delete root.dataset.glassMoving
      delete root.dataset.glassTraveling
      view.dirty = true
    }
    const startLens = () => {
      if (lensOn || !engine || !view.visible || reduced.matches) return
      measure()
      lensOn = true
    }
    const commit = () => {
      locked = true
      input = 'none'
      root.style.cursor = ''
    }

    /** One step of every spring. Driven by the glass engine, or by our own loop without WebGL2. */
    const tick = (dt: number, still: boolean) => {
      let goal = locked ? travel : 0
      if (input === 'drag') {
        // The finger may pass both ends: the thumb follows it there ever less.
        const over = dragGoal - travel
        const give = RUBBER_GIVE * h
        // The thumb's own way past the end: as far as the track's overflow lets its end follow.
        const most = OVERFLOW / RUBBER_TRACK
        goal = over > 0 ? travel + (most * over) / (over + give) : dragGoal < 0 ? (pad * dragGoal) / (d / 2 - dragGoal) : dragGoal
      }
      else if (input === 'keys') goal = keyValue * travel
      else if (input === 'hold') {
        hold = still ? 1 : Math.min(1, hold + dt / HOLD_SECONDS)
        goal = hold * travel
        if (hold >= 1) commit()
      }
      let moving = false
      if (still) {
        x.x = tail.x = goal
        x.v = tail.v = swell.x = swell.v = 0
        stopLens()
      } else {
        const following = input === 'drag' || input === 'hold'
        if (input !== 'none') homing = false
        const a = stepSpring(x, goal, following ? SPRINGS.drag : homing ? HOME : SPRINGS.slide, dt)
        if (!a) homing = false
        // The lens stays clear until it is within 6 % of the thumb's width from its target.
        const open = lensOn && (following || Math.abs(x.x - goal) > d * 0.06)
        const b = lensOn && stepSpring(press, open ? 1 : 0, SPRINGS.press, dt)
        if (lensOn) {
          // While the lens is clear the icon is written in the fill's text colour. On a bare track
          // the clear glass shows the page itself, so a thumb that has landed keeps that colour
          // until the lens is half frosted over: the icon then never sits dark on dark glass.
          const landing = locked && input === 'none' && !live.current.fill && press.x > 0.5
          if (!open && !landing) delete root.dataset.glassTraveling
          else if ('glassMoving' in root.dataset) root.dataset.glassTraveling = ''
        }
        const c = stepSpring(tail, x.x, TAIL, dt)
        const e = stepSpring(swell, following ? 1 : 0, MEMBRANE, dt)
        moving = a || b || c || e
      }
      // The thumb reached the end: the action starts and the track draws into the thumb.
      if (locked && !arrived && !reopening && Math.abs(x.x - travel) <= d * 0.06) {
        arrived = true
        nudged = true
        live.current.run()
      }
      const target = arrived ? 1 : 0
      let closing = false
      if (still) {
        collapse.x = target
        collapse.v = 0
      } else closing = stepSpring(collapse, target, DRAW, dt)
      // The track is open again: the thumb goes home.
      let freed = false
      if (reopening && collapse.x <= REOPEN) {
        reopening = locked = false
        freed = homing = true
      }
      const now = live.current.state
      // A success shows once the track has drawn in around the thumb, however soon it came: the
      // glass takes the fill's colour and the icon turns into the check only then.
      const confirmed = now === 'success' && input === 'none' && collapse.x > DRAWN
      // The check's first frame kicks the swell, once per success.
      if (confirmed && !greeted && !still) {
        popX.v += POP_KICK_X
        popY.v += POP_KICK_Y
      }
      greeted = confirmed
      const spinGoal = now === 'pending' && collapse.x > SPIN_AT ? 1 : 0
      // Opening again, the disc forms back once the track has let go of the thumb.
      const dissolveGoal = confirmed || (now !== 'success' && dissolve.x > 0.5 && collapse.x > REFORM) ? 1 : 0
      const morphGoal = confirmed ? 1 : 0
      let marking = false
      if (still) {
        spin.x = spinGoal
        dissolve.x = swap.x = dissolveGoal
        morph.x = morphGoal
        popX.x = popY.x = 0
        spin.v = dissolve.v = morph.v = swap.v = popX.v = popY.v = 0
      } else {
        // The spinner comes in softly and leaves as fast as the disc dissolves.
        const a = stepSpring(spin, spinGoal, spinGoal ? SPIN : DISSOLVE, dt)
        const b = stepSpring(dissolve, dissolveGoal, DISSOLVE, dt)
        const c = stepSpring(morph, morphGoal, MORPH, dt)
        // The default chevron bends into the check as the disc dissolves; a custom icon swaps with it at its own pace.
        const e = stepSpring(swap, dissolveGoal, ink ? DISSOLVE : SWAP, dt)
        const f = stepSpring(popX, 0, SPRINGS.hoverX, dt)
        const g = stepSpring(popY, 0, SPRINGS.hoverY, dt)
        marking = a || b || c || e || f || g
      }
      write()
      return moving || closing || marking || freed || (input === 'hold' && !still)
    }

    let raf = 0
    let last = 0
    const loop = (now: number) => {
      raf = 0
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60
      last = now
      if (tick(dt, reduced.matches)) raf = requestAnimationFrame(loop)
      else last = 0
    }
    const wake = () => {
      if (engine) engine.wake()
      else if (!raf) raf = requestAnimationFrame(loop)
    }

    const view: GlassView = {
      canvas,
      ctx,
      dirty: false,
      visible: false,
      step: tick,
      lens: (refresh) => {
        if (!lensOn || !engine) return null
        // A theme switch (or anything else that asks for the colours again): the thumb is glass at
        // rest too, so it re-reads its own colour, the fill's and the page's here.
        if (refresh) measure()
        const p = clamp(press.x, -0.12, 1.15)
        const pc = clamp(press.x)
        const frost = 1 - pc
        // Room for the thumb's shadow on either side: its far, soft part reaches about 0.6 of the
        // thumb's width past its edge while it is held, and the canvas fades out over its last 14 px.
        const padX = Math.round(d * 0.75 + 12) + OVERFLOW
        const padTop = Math.round(d * 0.3 + 6)
        const padBottom = Math.round(d * 1.1 + 8)
        const box = root.getBoundingClientRect()
        const cx = pad + shown + d / 2
        const gl = engine
        return {
          left: -padX,
          top: -padTop,
          width: W + 2 * padX,
          height: h + padTop + padBottom,
          unit: d / OPTION_UNITS,
          cx: padX + cx,
          cy: padTop + h / 2,
          hx: (d / 2) * (1 + SWELL * p) * stretchX,
          hy: (d / 2) * (1 + SWELL * p) * stretchY,
          radius: 999,
          bodyX: 0,
          bevel: lerp(OPTION_UNITS * 0.42, 62 * OPTICS, pc),
          shadow: 0.12 * lerp(0.55, 1, pc),
          shadowSoftness: 34 * OPTICS * lerp(0.6, 1, pc),
          shadowOffset: 22 * OPTICS * lerp(0.5, 1, pc),
          strength: 1,
          color: mixRgb(color, fillColor, clamp(dissolve.x)),
          surface,
          edgeClear: 0,
          refraction: {
            // What lies beneath the thumb: the track, the label and the fill.
            paint: (back) => {
              back.translate(padX, padTop)
              drawDom(back, root, {
                origin: box,
                skip: (el) => el === canvas || el === thumb,
                onStale: () => {
                  view.dirty = true
                  gl.wake()
                },
              })
            },
            refract: lerp(6, 37, pc) * OPTICS * lerp(0.06, 1, pc),
            magnify: 0.12 * pc,
            dispersion: 0.12 * pc,
            blurCenter: lerp(0.35, 4, frost),
            blurEdge: lerp(2.2, 4, frost),
            frost,
          },
          cursorLight: true,
          pointerLight: true,
          // With `mirror`, what the thumb's rim mirrors while it is held (clear): the page around the track.
          reflection: live.current.mirror
            ? {
                height: d,
                paint: (around, reach) => {
                  drawAround(around, document.body, { left: box.left - padX, top: box.top - padTop, width: W + 2 * padX, height: h + padTop + padBottom }, reach, {
                    skip: (el) => el === canvas || el === thumb || el.hasAttribute('data-glass-skip'),
                    onStale: () => {
                      view.dirty = true
                      gl.wake()
                    },
                  })
                },
              }
            : undefined,
          screenX: box.left + cx,
          screenY: box.top + h / 2,
        }
      },
      // The flat disc hides only once the lens has drawn its first frame. The icon takes the
      // fill's text colour only while the glass is clear, never on the frosted glass at rest.
      drawn: () => {
        if (!lensOn || 'glassMoving' in root.dataset) return
        root.dataset.glassMoving = ''
        if (input !== 'none' || press.x > 0.05) root.dataset.glassTraveling = ''
      },
      // The GPU context is gone: the plain disc takes over, on our own loop.
      lost: () => {
        engine = null
        stopLens()
        wake()
      },
    }

    const usable = () => !locked && !live.current.disabled && live.current.state === 'idle'
    const localX = (e: PointerEvent) => e.clientX - root.getBoundingClientRect().left
    const onMove = (e: PointerEvent) => {
      if (input !== 'drag') return
      dragGoal = localX(e) - grab
      wake()
    }
    const onUp = (e: PointerEvent) => {
      if (input !== 'drag') return
      root.style.cursor = ''
      if (e.type === 'pointerup' && clamp(dragGoal, 0, travel) / travel >= live.current.threshold) commit()
      else input = 'none'
      wake()
    }
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !usable()) return
      const at = localX(e)
      const left = pad + x.x
      // Only the thumb starts a slide: a press elsewhere on the track does nothing.
      if (at < left - 10 || at > left + d + 10) return
      nudged = true
      input = 'drag'
      grab = at - x.x
      dragGoal = x.x
      // Keeps the slide alive when the finger leaves the track (a scripted pointer cannot be captured).
      try {
        root.setPointerCapture(e.pointerId)
      } catch {}
      root.style.cursor = 'grabbing'
      startLens()
      wake()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (!usable()) return
      const k = e.key
      const step = k === 'ArrowRight' || k === 'ArrowUp' ? 0.1 : k === 'ArrowLeft' || k === 'ArrowDown' ? -0.1 : k === 'PageUp' ? 0.25 : k === 'PageDown' ? -0.25 : 0
      const holds = k === ' ' || k === 'Enter'
      if (!step && !holds && k !== 'Home' && k !== 'End') return
      e.preventDefault()
      if (input === 'drag' || (holds && e.repeat)) return
      nudged = true
      if (holds) {
        input = 'hold'
        hold = clamp(x.x / travel)
      } else {
        keyValue = k === 'Home' ? 0 : k === 'End' ? 1 : clamp((input === 'keys' ? keyValue : 0) + step)
        input = 'keys'
        if (keyValue >= 0.999) commit()
        else if (keyValue <= 0.001) input = 'none'
      }
      startLens()
      wake()
    }
    const letGo = () => {
      if (input !== 'hold' && input !== 'keys') return
      input = 'none'
      wake()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (input === 'hold' && (e.key === ' ' || e.key === 'Enter')) letGo()
    }

    controller.current = {
      unlock: () => {
        if (!locked) return
        // The track opens first; the thumb waits at the end and then goes home as it is,
        // a white disc: the glass opens only under a finger.
        arrived = false
        reopening = true
        input = 'none'
        wake()
      },
      wake: () => wake(),
    }

    root.addEventListener('pointerdown', onDown)
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerup', onUp)
    root.addEventListener('pointercancel', onUp)
    root.addEventListener('keydown', onKeyDown)
    root.addEventListener('keyup', onKeyUp)
    root.addEventListener('blur', letGo)
    const io = new IntersectionObserver(([entry]) => {
      view.visible = entry.isIntersecting
      // The thumb is glass at rest too: white, then the fill's colour once confirmed.
      if (view.visible) {
        startLens()
        view.dirty = true
        wake()
      }
    })
    io.observe(root)
    const ro = new ResizeObserver(() => {
      measure()
      write()
      if (lensOn) view.dirty = true
      wake()
    })
    ro.observe(root)
    // The idle nudge: a small push the spring returns, until the thumb has been touched.
    const nudge = setInterval(() => {
      if (nudged || !live.current.hint || !usable() || input !== 'none' || !view.visible || reduced.matches || document.hidden) return
      x.v = 8 * d
      wake()
    }, HINT_EVERY)
    measure()
    write()
    engine?.add(view)

    return () => {
      engine?.remove(view)
      cancelAnimationFrame(raf)
      clearInterval(nudge)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      io.disconnect()
      ro.disconnect()
      root.removeEventListener('pointerdown', onDown)
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerup', onUp)
      root.removeEventListener('pointercancel', onUp)
      root.removeEventListener('keydown', onKeyDown)
      root.removeEventListener('keyup', onKeyUp)
      root.removeEventListener('blur', letGo)
      root.style.cursor = ''
      delete root.dataset.glassMoving
      delete root.dataset.glassTraveling
      root.style.removeProperty('--glass-slide-ink')
      controller.current = null
    }
  }, [])

  const swap = touched ? { 'data-glass-in': '' } : {}
  const text = failed ? (errorLabel ?? children) : children
  const statusText = state === 'pending' ? (pendingLabel ?? '') : state === 'success' ? (successLabel ?? '') : ''
  // The last status stays written while the track opens again, so it leaves with the track's edge.
  if (statusText) lastStatus.current = statusText
  const centered = 'absolute flex items-center justify-center overflow-hidden px-2'
  const stacked = 'absolute inset-0 flex items-center justify-center opacity-0'

  return (
    <div
      ref={rootRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={children}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={state === 'idle' ? 0 : 100}
      aria-valuetext={statusText || undefined}
      aria-busy={state === 'pending'}
      aria-disabled={disabled || state !== 'idle' || undefined}
      data-glass-host=""
      data-state={state}
      data-disabled={disabled ? '' : undefined}
      className={`relative isolate block w-full cursor-grab touch-pan-y rounded-full font-medium whitespace-nowrap text-neutral-600 outline-none select-none focus-visible:ring-2 focus-visible:ring-[#3291FF] focus-visible:ring-offset-2 aria-disabled:cursor-default data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 dark:text-neutral-300 ${s.host} ${className}`}
    >
      <GlassStyles />
      <canvas ref={canvasRef} aria-hidden style={{ position: 'absolute', zIndex: 30, maxWidth: 'none', pointerEvents: 'none', width: 0, height: 0 }} />
      {/* The track. Once confirmed its left edge retreats into the thumb, carrying the status text. */}
      <span aria-hidden data-glass-slide="track" className="absolute inset-y-0 right-0 left-0">
        <span data-glass-slide="bed" className="absolute inset-x-0 -inset-y-2 rounded-full bg-black/[0.06] dark:bg-white/[0.1]" style={{ clipPath: REST }} />
        {/* The success disc is rounded, not clipped: a clip-path leaves a dark seam on its edge. */}
        <span data-glass-slide="done" className={`absolute inset-0 rounded-full opacity-0 ${fillClassName}`} />
        <span data-glass-slide="status" className="absolute top-0 right-full flex h-full items-center pr-3 text-neutral-900 opacity-0 dark:text-white">
          <span key={lastStatus.current} {...swap}>
            {lastStatus.current}
          </span>
        </span>
      </span>
      <span aria-hidden data-glass-slide="label" className={`${centered} inset-y-0 right-0 ${s.label} ${failed ? 'text-red-600 dark:text-red-400' : ''}`}>
        {text}
      </span>
      {/* The fill the thumb pulls behind it, with its own copy of the label. */}
      <span aria-hidden data-glass-slide="fill" className={`absolute -top-1 left-1 overflow-hidden rounded-full ${s.fill} ${fillClassName}`} style={{ clipPath: REST }}>
        <span data-glass-slide="copy" className={`${centered} top-1 ${s.copy}`}>
          {text}
        </span>
      </span>
      {/* The thumb: frosted white glass with a dark icon, drawn by the glass engine (the flat disc is
          only its fallback). It clears while it moves, the icon on top in the fill's text colour (on a
          bare track: dark on a light page, white on a dark one). Once
          confirmed the spinner takes the icon's place; on a success the glass takes the fill's colour. */}
      <span
        aria-hidden
        data-glass-slide="thumb"
        className={`absolute top-1 left-1 z-40 flex items-center justify-center text-neutral-900 transition-colors duration-150 ${fill ? '[[data-glass-traveling]_&]:text-[color:var(--glass-slide-ink)]' : 'dark:[[data-glass-traveling]_&]:text-white'} [&_svg]:shrink-0 ${s.thumb}`}
      >
        <span
          data-glass-slide="disc"
          className={`absolute inset-0 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.14),0_3px_8px_rgb(0_0_0/0.12)] [[data-glass-moving]_&]:opacity-0`}
        />
        <span data-glass-slide="mark" className={`relative flex ${mirror ? MARK_GLOW : ''}`}>
          <span data-glass-slide="glyph" className="flex">
            {icon ?? (
              <svg {...svg} strokeWidth="2.25">
                <path data-glass-slide="ink" d={markPath(0)} />
              </svg>
            )}
          </span>
        </span>
        <span data-glass-slide="spinner" className={stacked}>
          <Spinner />
        </span>
        <span data-glass-slide="check" className={`${stacked} text-[color:var(--glass-slide-ink)]`}>
          <svg {...svg} strokeWidth={icon ? 2.5 : 2.25}>
            <path d={markPath(1)} />
          </svg>
        </span>
      </span>
      <span role="status" className="sr-only">
        {statusText || (failed ? (errorLabel ?? '') : '')}
      </span>
    </div>
  )
}

export default GlassSlideToConfirm
