// Liquid Glass engine — one shared WebGL2 context that draws every glass surface on the
// page and copies each result into the surface's own 2D <canvas>, so a page full of
// glass never hits the browser's WebGL context limit.
//
// Zero dependencies. A GLSL lens with tinted glass, a 1 px border, a frosted resting
// state, an opt-in gooey droplet and an opt-in frosted blur (cards). The rim mirrors what
// surrounds the glass: a colourful neighbour shows on the side that faces it.
//
// Cost model: the loop runs only while a spring moves, a surface is dirty or the
// cursor light changes; at rest it stops completely. Off-screen surfaces are not
// drawn, and neither is a frame that would come out exactly as the one on the canvas:
// nothing is asked of the GPU for it, and a frame that is drawn sends only what changed.
// `prefers-reduced-motion` freezes every spring at its target.
// If WebGL2 is missing or the context is lost, every surface falls back to plain CSS.
//
// COPY THIS FILE VERBATIM. Do not rewrite or "simplify" the shader: the look comes
// from the exact constants below. MIT — https://github.com/bilalgursen/liquid-glass

export type Rgb = [number, number, number]
export type Rgba = [number, number, number, number]

/** One frame of one glass shape. Lengths in CSS px; origin = the canvas's top-left. */
export type GlassLens = {
  /** Canvas position inside its positioned parent, and its size. */
  left: number
  top: number
  width: number
  height: number
  /** CSS px per design unit (the shading is designed for a 120-unit-tall lens). */
  unit: number
  /** Body centre and half size. */
  cx: number
  cy: number
  hx: number
  hy: number
  radius: number
  /** Horizontal shift of the body (it pulls back while a droplet separates). */
  bodyX: number
  /** Separated droplet: centre x relative to the lens centre, radius, gooey bridge softness. */
  droplet?: { x: number; r: number; k: number }
  /**
   * More droplets, four at most, each melted into the shape before it (the body, then the
   * droplets listed earlier), so a row of them buds off as one chain (see BUD): centre relative
   * to the lens centre, radius and gooey bridge softness, in CSS px.
   */
  droplets?: { x: number; y: number; r: number; k: number }[]
  /**
   * A second rounded box melted into the body, in any direction: centre relative to the body's
   * centre, half size, corner radius and gooey bridge softness (all CSS px). Omit it and the
   * shape is exactly the body (and droplet) alone.
   */
  blob?: {
    x: number
    y: number
    hx: number
    hy: number
    r: number
    k: number
    /** Gathers the bridge around one point: the softness falls off from `x` (relative to the body's centre) over `w` px, so a thinning bridge narrows into a neck there. */
    neck?: { x: number; w: number }
    /** Fades the softness out towards the body's far edge: `amount` 0–1 (0 = none), recovering over `reach` × the body's height from that edge. */
    fade?: { amount: number; reach: number }
    /**
     * The blob's own glass, when it is not the body's: tint cover (0–1), frost in CSS px, the
     * bend's falloff and depth (as `tune.bendCurve` / `tune.bendDepth`) and a white rim line
     * (opacity, width in CSS px). It casts no shadow then, and the two glasses melt at the neck.
     */
    material?: { frost: number; blur: number; bendCurve: number; bendDepth: number; borderAlpha: number; borderWidth: number }
  }
  /** Bevel width (design units). */
  bevel: number
  /**
   * Width of the band that bends the backdrop (design units), when it must not follow
   * the bevel: a lens with square corners keeps its bevel within the corner radius but
   * still bends as deep as a pill. Omit for the default, `bevel × 0.35`.
   */
  band?: number
  shadow: number
  shadowSoftness: number
  shadowOffset: number
  /** `true`: the drop shadow begins right at the glass's edge. Left out, it comes up a little way off the edge, as the kit's buttons cast it. */
  shadowFlush?: boolean
  /** 0 = flat liquid (no light or shadow), 1 = full glass lighting. */
  strength: number
  color: Rgb
  surface: Rgb
  /** How much the rim thins towards the surface colour (tinted glass). */
  edgeClear: number
  border?: Rgb
  /** Opacity of the border line (0–1, default 1). */
  borderAlpha?: number
  /** Width of the border line in CSS px (default 1). */
  borderWidth?: number
  /** An outline: a second flat line on the very edge of the glass, `width` CSS px wide. The border line, if any, then lies just inside it. */
  outline?: { color: Rgb; alpha: number; width: number }
  /** Textured lens: paints what lies beneath and bends it. */
  refraction?: {
    /**
     * Return `false` when both layers came out exactly as the last time, colours included: they
     * are not uploaded again, not even on a frame that re-read sizes and colours.
     * A painter that declares only `back` has no front layer (none is cleared or uploaded).
     */
    paint: (back: CanvasRenderingContext2D, front: CanvasRenderingContext2D) => void | boolean
    refract: number
    magnify: number
    dispersion: number
    blurCenter: number
    blurEdge: number
    /** 1 = frosted (flat `color`), 0 = perfectly clear. */
    frost: number
    /** Frosted blur of the backdrop: a gaussian deviation in CSS px, like CSS `blur()`. 0 or omitted = sharp. */
    blur?: number
    /** How much of the frost shows over the sharp bend (0–1, default 1). */
    blurMix?: number
    /**
     * Radial bend, as the old SVG card drew it: each point near the rim looks towards the
     * centre, by this fraction of the viewport (0.065 there), falling off as (1 − d/half)^bendCurve,
     * and the frost blurs the bent picture. `refract`, `magnify` and the bend band are then unused.
     */
    radial?: number
  }
  /**
   * What the rim mirrors, while the glass is clear: the page around it (see MIRROR). `paint` draws it into a context
   * whose origin is the canvas's top-left (one unit = one CSS px), `reach` CSS px past the canvas
   * on every side; leave the glass itself out. `height` is the glass's own height at rest, in CSS
   * px: the rim looks about that far. A neighbour brighter or more colourful than the surface
   * shows on the rim that faces it, and the rim light's far side takes its colour. Without it the
   * glass mirrors the surface colour alone, which shows nothing. The picture is small and taken
   * rarely: when sizes and colours are re-read and when the canvas changes size, a few times a
   * second at most. `live` takes it again while the glass moves, too.
   */
  reflection?: { paint: (around: CanvasRenderingContext2D, reach: number) => void; height: number; live?: boolean }
  /** Fine-tuning of the look. Every field defaults to the kit's own value, noted in brackets. */
  tune?: {
    /** × rim light [1] and × its line's thickness [1]. */
    rim?: number
    rimWidth?: number
    /** × fresnel glow on the lit side [1], × inner shading [1], × top reflection [1], × warm caustic [1]. */
    fresnel?: number
    inner?: number
    reflection?: number
    caustic?: number
    /** × what the rim of clear glass mirrors of its surroundings [1] (see `reflection` above; 0 = nothing). */
    mirror?: number
    /** Falloff of the bend from the rim inwards, an exponent [1.6]; × how far in it reaches [1]. */
    bendCurve?: number
    bendDepth?: number
    /** Saturation of what shows through [1]; × the frost at the rim [1]. */
    saturation?: number
    frostEdge?: number
  }
  /** Rim light leans towards the cursor. */
  cursorLight: boolean
  /**
   * Light let into the glass at one point (a press): centre relative to the body's centre and
   * reach, in CSS px, and how strong (0 = none; see GLOW). It brightens all the glass near it alike, a melted blob
   * included, unless `blob` says how much of it the blob takes (0–1; 0 keeps the light to the body). `halo` lets it
   * spill past one edge, the body's or the blob's (0–1, how much): there
   * it brightens the page's colour the same way. Without it nothing shows outside the glass.
   */
  glow?: { x: number; y: number; r: number; amount: number; blob?: number; halo?: { around: 'body' | 'blob'; amount: number } }
  /** `false`: this glass does not take the light under the pointer (see LIGHT). Every other glass does, unless that light is turned off. */
  pointerLight?: boolean
  /**
   * Another view this glass continues (one shape drawn by two canvases, each on its side of a
   * seam): it takes that view's light of a press (LIGHT) as it is, where it is on screen, instead
   * of one of its own, so the light does not stop at the seam.
   */
  lightOf?: GlassView
  /** Lens centre on screen, for aiming the cursor light. */
  screenX: number
  screenY: number
  /**
   * How large one CSS px of the canvas is on screen: the host's own CSS `scale` and its
   * ancestors' (1 when omitted). Glass that melts into its neighbours (COHESION) is measured with it.
   */
  scale?: number
}

export type GlassView = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  dirty: boolean
  /**
   * Set it (and wake the engine) when what lies behind the glass may have changed and the glass
   * itself has not, as on scroll: the layers are painted again, sizes and colours are not re-read.
   */
  repaint?: boolean
  visible: boolean
  /** Advance springs; return true while anything still moves. */
  step: (dt: number, reducedMotion: boolean) => boolean
  /** The shape to draw, or null to clear. `refresh`: re-read sizes and colours. */
  lens: (refresh: boolean) => GlassLens | null
  /** The first frame reached the canvas. */
  drawn?: () => void
  /** The GPU context is gone: return to the plain CSS look. */
  lost: () => void
  /**
   * `true`: a pointer that holds this glass pulls it after itself (see PULL). Buttons ask for it;
   * no other glass is pulled. A view may change it at any time: set back to `false`, held glass is let go.
   */
  pull?: boolean
  /** Set by the engine: a pointer holds this glass and may be pulling it. The press lasts as long, outside the glass too. */
  held?: boolean
  /**
   * The CSS scale this view wants on its host (1 = none), when it swells its host itself. The
   * engine writes the host's `scale`: this, times the stretch of a pull. A view that sets it
   * never writes `host.style.scale` itself.
   */
  grow?: number
  /**
   * `true`: this glass is a button (see "The light of a press", above GLOW). A press on it lets
   * light in where it lands (GLOW), on top of the light every glass takes under a press (LIGHT).
   * Left out, the glass is a surface (a card, a menu, a lens) and takes LIGHT alone. The engine
   * hears the press and the keys itself: a view only says what it is.
   */
  button?: boolean
  /** With `button`: the element a press must land in, when it is not the glass's host. */
  pressArea?: Element
  /**
   * `false`: this surface does not take the engine's light around a choice pressed in it (see the
   * rule above GLOW), because it brings that light itself (GlassPopup's lists do) or wants none.
   */
  choices?: boolean
  /**
   * Set by the engine: where a pull has this glass (px from its rest) and how it stretches its
   * host (1 = not at all), as written on the host this frame. A view reads it to undo the stretch
   * on its canvas and draw it in the glass instead (GlassLayer and GlassPopup do).
   */
  pulled?: { x: number; y: number; sx: number; sy: number }
  /**
   * Set by the engine: the hosts of the glass this one melts into (COHESION), or none. Melted,
   * they are one body with it, so a view leaves them out of its picture of what lies behind
   * (GlassLayer does). The list is replaced only when the glass it names changes.
   */
  near?: Element[]
}

export type GlassEngine = {
  add: (view: GlassView) => void
  remove: (view: GlassView) => void
  /** Schedule a frame (call after changing state the springs read). */
  wake: () => void
  /** Any CSS colour (oklch, var(), color-mix…) → 0..1 RGBA. */
  resolveColor: (css: string) => Rgba
}

/** Damped spring. `omega` = speed (rad/s), `zeta` = damping ratio (< 1 bounces). Returns true while moving. */
export type Spring = { x: number; v: number }
export function stepSpring(s: Spring, target: number, { omega, zeta }: { omega: number; zeta: number }, dt: number) {
  const d = s.x - target
  if (zeta > 0.9995) {
    const b = s.v + omega * d
    const e = Math.exp(-omega * dt)
    s.x = target + (d + b * dt) * e
    s.v = (s.v - omega * b * dt) * e
  } else {
    const wd = omega * Math.sqrt(1 - zeta * zeta)
    const b = (s.v + zeta * omega * d) / wd
    const e = Math.exp(-zeta * omega * dt)
    const cos = Math.cos(wd * dt)
    const sin = Math.sin(wd * dt)
    const x = (d * cos + b * sin) * e
    s.x = target + x
    s.v = e * wd * (b * cos - d * sin) - zeta * omega * x
  }
  // Thresholds scale with the target so pixel springs do not idle on an invisible tail.
  const scale = Math.max(1, Math.abs(target))
  const settled = Math.abs(s.x - target) < 5e-4 * scale && Math.abs(s.v) < 0.005 * scale
  if (settled) {
    s.x = target
    s.v = 0
  }
  return !settled
}

/**
 * The light of a press. The rule, kept here and applied by the engine:
 *
 * - A button is lit by GLOW: a press lets light in where it lands, the light holds a moment and
 *   fades as it spreads. A view says `button: true` and the engine does the rest (Button, Action
 *   Button and Button Group, through GlassLayer). The control of a surface that opens (GlassPopup)
 *   is a button too and brings the same light itself (`glow` on its lens), because there it goes
 *   on to open the surface.
 * - A surface is lit by LIGHT alone: a soft white light where the press lands, for as long as it
 *   is held. Every glass that is not a button is a surface: a card, a menu or a list that has
 *   opened, a lens, a thumb, a badge. Nothing asks for it; `pointerLight: false` on a lens opts out.
 * - A surface that holds choices also lights up around a choice pressed in it, with GLOW's
 *   `select` values: a wide, soft light that stays inside the glass. A choice is an option, a
 *   menu item, or anything marked `data-glass-item` or `data-glass-pick`. The engine does it for
 *   every surface (a menu, a submenu, a card with rows); the lists of a Select, a Dropdown Menu
 *   and a Popover bring the same light themselves (theirs leaves with the surface) and say
 *   `choices: false`.
 * - A button takes LIGHT too, beneath its GLOW. No light follows the pointer, and a pointer that
 *   only rests on the glass lights nothing.
 *
 * A new component follows the rule by saying what it is: it never draws a light of its own.
 *
 * GLOW: a press lets light into the glass where it lands. The light paints nothing: it brightens what
 * is already there, keeping its colour (luminance L becomes L^(1 / (1 + amount)) at the centre,
 * so black stays black and white stays white). These are
 * the values for wider controls; GLOW_SMALL, below, holds the same set for small ones.
 */
export const GLOW = {
  /** One press, at the centre of the light. Presses that land before the last has faded add up, to `stack` presses at most. */
  amount: 3.55,
  stack: 3,
  /**
   * A choice made inside an open surface: this much of a press, and a light of its own size. It
   * is a wide, soft light around the choice (`selectReach` at first, `selectSpread` more as it
   * fades, both × the control's height) and it leaves as the surface starts back in.
   */
  select: 0.45,
  selectReach: 1.6,
  selectSpread: 1.2,
  /** A choice's light is gone once the surface is this far back in (0–1 of the way open; higher = it leaves sooner). */
  selectLeave: 0.5,
  /** The light's reach at first, and how much further it spreads as it fades (both × the control's height). */
  reach: 1.65,
  spread: 3,
  /** It stays for at least this long (seconds), comes up at `riseSpeed`, fades at `fadeSpeed` and spreads at `spreadSpeed` (springs: higher = faster). */
  hold: 0.2,
  riseSpeed: 60,
  fadeSpeed: 5.5,
  spreadSpeed: 5,
  /**
   * The press that opens a surface: its light grows with the surface until it covers it whole
   * (its reach ends at `cover` × the surface's diagonal). It lets go once the surface is this
   * far open (0–1) and fades at `coverFadeSpeed`: a flash, not a wash.
   */
  cover: 0.9,
  coverUntil: 0.1,
  coverFadeSpeed: 10,
  /** How much of the light spills past an open surface's edge (0 = none). */
  halo: 0.35,
}
/**
 * What the rim mirrors of the page around the glass. Each point of the rim looks outwards and
 * takes the colour of what it faces, where that differs from the surface the glass sits on: an
 * orange button above a control shows as an orange edge along its top. Only clear glass
 * mirrors: glass in its own colour (tinted, or a lens frosted over at rest) shows nothing.
 * These values are the look.
 */
export const MIRROR = {
  /**
   * How much of a neighbour shows on the rim's line (1 at most: the line is the rim light's own,
   * as thin as the one that leans towards the cursor), and in the band that begins inside it.
   */
  line: 1,
  band: 0.7,
  /**
   * How deep that band goes: this × the glass's shorter half (or its reach, on taller glass).
   * The rim's edge looks `reach` far; the look shortens with depth and ends here, so a
   * neighbour's picture fills the band where it is near and thins out where the rim turns
   * away from it: a crescent on a round glass.
   */
  depth: 0.58,
  /** How fast the picture fades from the rim inwards, an exponent (1 = evenly, higher = it keeps closer to the rim). */
  fall: 1,
  /** How soft the picture is: the patch each point gathers, × the reach (0 = a sharp mirror). */
  soft: 1,
  /** How much more than its plain difference from the surface a neighbour counts. */
  gain: 1.8,
  /** How much a darker neighbour dims the rim (× the above; 0 = not at all). */
  dim: 0.65,
  /** How far the rim's edge looks: this × the glass's height, between `reachMin` and `reachMax` px. */
  reach: 0.55,
  reachMin: 24,
  reachMax: 96,
  /** What a point gathers along its look: shares from its near part, from further out and from its far end. */
  near: 0.25,
  mid: 0.35,
  far: 0.4,
  /** The rim light's far side: its brightness (× the lit side's), and how much of the surroundings' colour it takes (0 = always white). */
  bounce: 0.6,
  tint: 1,
}

/**
 * The same light on a small control: a single icon, or a label of about five letters (up to
 * roughly twice as wide as it is tall, as in GOOEY). In between the two sets are blended. The
 * light stays close to the press there, comes up slower and holds until the surface is half open.
 */
export const GLOW_SMALL: typeof GLOW = { ...GLOW, reach: 0.7, spread: 0.7, riseSpeed: 24, coverUntil: 0.5 }

/** The light on a morphing control (Popover): GLOW's, staying longer and adding up a little further. */
export const MORPH_GLOW: typeof GLOW = { ...GLOW, stack: 3.5, hold: 0.5 }
export const MORPH_GLOW_SMALL: typeof GLOW = { ...GLOW_SMALL, stack: MORPH_GLOW.stack, hold: MORPH_GLOW.hold }

/**
 * LIGHT, the light every glass takes under a press and the only one a surface takes (the rule is
 * above GLOW): glass lit from within, beginning where the press landed. A press (any
 * pointer, or Space / Enter on the focused control) brings it up, and it stays at that point of
 * the glass for as long as the press is held, wherever the pointer goes; let go, it sinks back.
 * It follows nothing, and a pointer that only rests on the glass lights nothing. It is white laid over the
 * glass: strongest at that point, falling off evenly to nothing at its radius, and it never
 * leaves the glass. Every glass takes it: the kit's controls, and a surface that opens
 * (GlassPopup), on top of its own light (GLOW). A lens that says `pointerLight: false` does not,
 * and `on: false` turns it off everywhere. The light and its numbers are those of Glass HQ's liquid-glass 0.0.2 (MIT,
 * https://github.com/Glass-HQ/liquid-glass). Read on every frame: do not tune them casually.
 */
export const LIGHT = {
  on: true,
  /** How white the glass is under the pointer at full light (0–1): on a light page, and on a dark one. */
  strength: 0.3,
  strengthDark: 0.16,
  /** How much of the full light a press brings. */
  press: 1,
  /** The light's radius: `size ×` the glass's longer side, between `sizeMin` and `sizeMax` px. */
  size: 0.9,
  sizeMin: 36,
  sizeMax: 180,
  /** A press comes up in about `rise` seconds, overshooting a little (`riseBounce`: 0 = none), and sinks back in `fade` seconds, without bounce. */
  rise: 0.24,
  riseBounce: 0.2,
  fade: 0.42,
}

/** Every spring the kit uses. Hover width/height bounce out of phase: the glass wobbles like a drop. */
export const SPRINGS = {
  press: { omega: 16, zeta: 0.6 },
  hoverX: { omega: 17, zeta: 0.42 },
  hoverY: { omega: 12, zeta: 0.34 },
  /** A droplet separating from the body: slow, one small overshoot. */
  dropletOut: { omega: 5, zeta: 0.72 },
  /** The droplet melting back in (pointer leaves or presses). */
  dropletIn: { omega: 13, zeta: 0.7 },
  /** A row of droplets budding off (BUD): the body pulling back, a droplet on its way out, and all of it going back in. */
  budBody: { omega: 9, zeta: 0.6 },
  budOut: { omega: 10.8, zeta: 0.75 },
  budIn: { omega: 31.46, zeta: 1 },
  /** A lens sliding to the newly selected option. */
  slide: { omega: 14, zeta: 0.75 },
  /** A dragged lens following the finger. */
  drag: { omega: 40, zeta: 0.999 },
} as const

/**
 * Glass that a held pointer pulls after itself: press it, drag away, and it follows a little way
 * through a rubber band, stretches along the pull and thins across it, then swings back like gel
 * when let go. It is for buttons: the engine does it for glass whose view says `pull: true`
 * (GlassLayer does, so Button, Action Button and Button Group; `pull={false}` there keeps one in
 * its place), the innermost one under the press, by moving and stretching its host (CSS
 * `translate` and `scale`, content included). The control of a surface that opens (GlassPopup:
 * Select, Dropdown Menu, Popover, Menu) is a button too while it is shut, and opens when the press
 * is let go on it. No other glass is pulled, and `on: false` here turns it off everywhere. The motion and its numbers are those of Glass HQ's liquid-glass 0.0.2 (MIT,
 * https://github.com/Glass-HQ/liquid-glass). Read on every frame: do not tune them casually.
 */
export const PULL = {
  on: true,
  /**
   * Glass whose longer side is at most this (px) is small: it follows the pointer from the point
   * it was pressed at. Larger glass moves only once the pointer is past its edge, by how far past.
   */
  smallUntil: 72,
  /** The furthest the pull moves small glass, px: `smallReach + smallReachPerPx × its longer side`. */
  smallReach: 4,
  smallReachPerPx: 0.15,
  /** The same for larger glass, `reachMax` at most. */
  reach: 3,
  reachPerPx: 0.04,
  reachMax: 10,
  /** How fast the band stiffens: 0.55 is a scroll view's. */
  resistance: 0.55,
  /** Following the pointer takes `follow + followPerPx × the longer side` seconds, without bounce (larger glass is heavier). */
  follow: 0.18,
  followPerPx: 5e-4,
  /** Let go: back to rest in about `release` seconds, overshooting like gel (`releaseBounce`: 0 = none, towards 1 = more). */
  release: 0.5,
  releaseBounce: 0.42,
  /**
   * The stretch along one axis: `stretch × the pull ÷ the glass's size that way`, plus
   * `stretchPerSpeed ×` the pull's own speed and `stretchPerDrift ×` the speed the glass's place
   * on the page moves at (px/s). Small glass stretches by `smallStretchMax` at most, larger by
   * `stretchMax`. Across, the glass thins by the square root of the stretch.
   */
  stretch: 0.5,
  stretchPerSpeed: 7e-5,
  stretchPerDrift: 5e-5,
  smallStretchMax: 0.2,
  stretchMax: 0.12,
  /** The drift speed is smoothed in at this rate while held, and dies out at `driftOut` (per second). */
  driftIn: 12,
  driftOut: 10,
}

/**
 * Cohesion: the glass of two buttons that come near each other melts into one body, as two drops
 * of liquid do. Within reach the sides that face each other lean out, nearer still a bridge forms
 * between them, and it thins and lets go as they part, whatever brings them together: a pull, a
 * swell, the layout. It is for buttons: the engine does it for glass whose view says
 * `button: true` (GlassLayer's, so Button, Action Button and Button Group). A surface (a card, a
 * menu, a lens) never melts, and a button never melts into glass it sits inside. Each canvas
 * draws its own side of the bridge, up to the line where the two glasses are as near, and across
 * the bridge they share their looks (bevel, bend, tint, shadow), so the line does not show. Joined,
 * the light of a press on one runs on into the other (`light` says how much of it), as far as it
 * reaches (GLOW and LIGHT, measured from where the press landed). The shape is a smooth union of
 * the glasses' distance fields, the fusion of Liquid Glass Studio (MIT,
 * https://github.com/iyinchao/liquid-glass-studio). `on: false` turns it off everywhere. Read on
 * every frame: do not tune them casually.
 */
export const COHESION = {
  on: true,
  /**
   * How soft the bridge is: `reach ×` the shorter glass's height, between `reachMin` and
   * `reachMax` px. Two glasses begin to melt once the gap between them is under this (it eases in
   * until the gap is half of it), and join into one once the gap is under half of it.
   */
  reach: 1.2,
  reachMin: 2,
  reachMax: 6,
  /**
   * How much of the light of a press on one glass runs on into a glass it has melted into, once
   * the bridge between them has some body (0 = none: each keeps its own light; 1 = all of it, as
   * one body). Short of that, the light crosses only where the two meet.
   */
  light: 0.07,
  /** That light fades as it goes into the other glass, as a reflection would: it is down to a third this far from where the two meet (× that glass's half height). */
  lightFade: 1,
}

/** The bridge's softness between glass of this height (px) and glass as tall or taller (COHESION); 0 while it is off. */
export function cohesionSoftness(height: number) {
  if (!COHESION.on) return 0
  return Math.min(Math.max(COHESION.reach * height, COHESION.reachMin), Math.max(COHESION.reachMin, COHESION.reachMax))
}

/**
 * Budding: a row of droplets let out of a body's end as one chain (GlassLayer with more than one
 * `data-glass-drop`; GlassSearch's layers). The body pulls back, and its end leaves the first
 * droplet behind where that one belongs: it swells there and pinches off. The others come out
 * of the first one's far side as one small string, and grow as they spread to their places,
 * letting go of each other on the way. Going back in is one quick motion (SPRINGS.budIn). Each
 * droplet's own element rides with it (GlassLayer writes where it is and how far out). These
 * values are the look: do not tune them casually.
 */
export const BUD = {
  /**
   * The body has pulled back for this long (seconds) before the first droplet shows. The others
   * follow it together, `lead` later, each of them `stagger` after the one before: the first is
   * out and free of the body while the rest are still a small cluster at its end.
   */
  wait: 0.117,
  lead: 0.05,
  stagger: 0.02,
  /** Where the others start from: this share of the way from the first droplet's place to their own (0 = all out of the first, 1 = each in its place). */
  from: 0.5,
  /** A droplet's size as it comes out (× its own). It is full size this far along its way (0–1), each one after the first that much later. */
  seed: 0.35,
  grown: 0.55,
  grownStep: 0.05,
  /** The furthest a droplet swings past its place (× its way there). The canvas keeps room for it. */
  overshoot: 0.06,
  /** The bridge between a droplet and what it buds from: its softness at most, × the glass's height at rest. */
  softness: 0.26,
}

/**
 * Presses the kit sends itself: GlassPopup keeps a press that would open its surface and hands it
 * on when it is let go. Such a press is no pointer holding the glass: nothing is pulled or lit by
 * it, and no release follows it. Whoever dispatches one adds it here first.
 */
export const HANDED_ON = new WeakSet<Event>()

/** A rubber band: a short pull follows almost one to one, a long one nears `limit` and never reaches it. */
export function rubberBand(offset: number, limit: number, resistance = 0.55) {
  if (!(limit > 0)) return 0
  return Math.sign(offset) * limit * (1 - 1 / ((Math.abs(offset) * resistance) / limit + 1))
}

/**
 * The gooey popup: a surface (a list, a menu, a popover) that swells out of its anchor as one
 * body of glass, holds on by a neck that thins and snaps, and plays the same motion backwards to
 * close. Used by GlassPopup (`glass-popup.tsx`). These values are the look: do not tune them casually.
 */
export const GOOEY = {
  /** How heavy the two halves are. Heavier glass is thrown less by a jolt and swings back slower. */
  weight: 6,
  /** The panel opening: speed, and damping (below 1 it overshoots as it lands). */
  openSpeed: 11,
  openDamping: 1,
  /** Closing replays the opening backwards, at closeSpeed / openSpeed × its pace (equal = the same pace). */
  closeSpeed: 26,
  /** The panel lets go of the trigger once it is this far open (0–1). */
  detachAt: 0.1,
  /** How fast the neck thins once it lets go (lower = a slower snap). */
  snapSpeed: 5.6,
  /** Bridge softness in px at full strength, and how far the panel leans back towards the trigger. */
  neckSoftness: 50,
  neckPull: 11,
  /** The jolt when the neck snaps: its strength, how fast it swings, how soon it dies out (higher = sooner). */
  kick: 6,
  recoilSpeed: 4,
  recoilDamping: 1,
  /** How far each half is thrown by a jolt, and how far the trigger sags while attached (px). */
  triggerJolt: 0,
  panelJolt: 0,
  triggerSag: 6,
  /** The list: how far open the panel is when the first option appears (0–1), the delay between options and each one's fade (seconds). */
  itemsAt: 0.85,
  itemsGap: 0.06,
  itemsFade: 0.22,
  /**
   * Small controls only: a single icon, or a label of about five letters (up to roughly twice as
   * wide as they are tall). The bridge is as wide as the whole control there, so it gets its own
   * softness in px (in place of neckSoftness), a fade of that softness towards the control's far
   * edge (0–1, and how far in it recovers, × the height) and a neck no thinner than this × the
   * height, at first and once it has gathered. Wider controls keep the values above.
   */
  smallNeckSoftness: 14,
  smallEdgeFade: 1,
  smallEdgeReach: 0.5,
  smallNeck: 0.6,
  smallNeckWide: 1.2,
}

/**
 * The morphing popup: a control that becomes its surface. The surface (Card's glass, as in the
 * gooey popup) comes out over the control itself: round all the way, a little past its own box,
 * then settled, while the control lets go of its label and its glass gives way to the card. The
 * surface's content comes into focus inside it as it grows. Closing is a calmer motion of its
 * own: the content goes first and the surface slides back into the control, slowing as it lands. Used by GlassPopup with `opening: 'morph'` (`glass-popup.tsx`). These values are the
 * look: do not tune them casually.
 */
export const MORPH = {
  /** The side that grows the most: its speed, and damping (below 1 it lands past the surface and comes back). */
  openSpeed: 30,
  openDamping: 1,
  /** The other side follows on a slower spring with more bounce. */
  crossSpeed: 16,
  crossDamping: 0.58,
  /**
   * While the first side runs ahead of the other, the glass is this much thinner across (× how
   * far ahead, 0–1); as the other catches up and passes it, as much wider.
   */
  pinch: 0,
  /** Corners, frost and the content's focus follow at this speed, without a bounce. */
  calmSpeed: 12,
  /** Closing replays the opening backwards, at this × its pace. */
  closePace: 1.7,
  /** The control's label is gone once the surface is this far out (0–1). */
  labelOut: 0.02,
  /** The content fades in with the calm follow, and is fully visible once that is this far (0–1). */
  contentFade: 0.75,
  /** How soft the label gets as it goes, and the content as it starts (a blur, CSS px). */
  labelBlur: 0,
  contentBlur: 5.5,
  /** How much of the surface's growth the content takes: 1 = it is as small as the glass is, 0 = full size from the start, only cut to the glass. */
  zoom: 1,
  /**
   * Not gooey: the surface and the control are two shapes laid over each other, with a clean
   * edge where they meet. `gooey: 1` melts them there instead, by `softness` CSS px.
   */
  gooey: 0,
  softness: 40,
  /** How the surface starts, in the control's middle: 0 = a circle as tall as the control, 1 = the control's own box. */
  seed: 1,
  /** It stays round all the way until the calm follow is this far (0–1); its own corners come after. */
  cornersFrom: 0.3,
  /**
   * Its weight. At the press the control is thrown down (`kick`: how hard; `throw`: how far a
   * throw of 1 carries it, CSS px) and swings back at `swingSpeed`, dying out by `swingDamping`
   * (below 1 it swings to and fro). Heavier glass is thrown less and swings slower.
   */
  weight: 8,
  kick: 8,
  swingSpeed: 17.5,
  swingDamping: 0.6,
  throw: 80,
  /** The surface comes out this long after the press (seconds): the control is thrown first. */
  openDelay: 0.1,
  /**
   * The surface's way into place: as it grows it is carried up to `drop` CSS px above its place
   * (negative: below), and comes down `dropDelay` seconds after the press on a soft spring
   * (`dropSpeed`; `dropDamping` 1 = no bounce). 0 px = it grows where it is.
   */
  drop: 60,
  dropDelay: 0.2,
  dropSpeed: 9,
  dropDamping: 1,
  /** Asked to close, the surface stays as it is this long (seconds) before it goes back in. */
  closeDelay: 0,
  /**
   * `closeSoft: 1`: closing is a motion of its own (`0`: the opening played backwards). The
   * surface goes back into the control on one spring with no bounce (`closeSpeed`), slowing as it
   * lands, and the control stays still: it is not thrown, does not swell and does not light up. The content
   * does not wait for the glass: it is gone `closeFade` seconds after the close begins. A choice's
   * light comes into the control with the surface and narrows to `closeGlowReach` (× the control's
   * height) as it does, so it does not flood the control. `closeKick`:
   * with the opening played backwards, how much of the throw the control takes once the surface
   * is back in (× `kick`; 0 = it stays still).
   */
  closeSoft: 1,
  closeSpeed: 14,
  closeFade: 0.12,
  closeGlowReach: 1,
  closeKick: 1,
  /** The control's own glass (clear, lit) gives way to the card's between these two points of the calm follow (0–1). */
  frostFrom: 0,
  frostTo: 0.05,
}

/**
 * The growing popup: a control whose glass becomes its menu. One shape on one spring: the
 * control's own outline grows into the menu's, wherever the menu lies (below, above or beside
 * it), and shrinks back along the same path to close. The side the menu lies on runs ahead and
 * the other follows, so the glass pours towards its place instead of scaling up. The control's
 * label goes as the glass leaves it; the menu's content stays where it is and the glass opens
 * over it. A close that is interrupted carries on from where it is, at the speed it has. It takes
 * no light from a press (GLOW is not used here). Used by
 * GlassPopup with `opening: 'grow'` (`glass-popup.tsx`). The motion and its numbers are those of
 * Glass HQ's liquid-glass 0.0.2 (MIT, https://github.com/Glass-HQ/liquid-glass). These values
 * are the look: do not tune them casually.
 */
export const MENU = {
  /** Opening takes about `open` seconds and lands a little past the menu (`openBounce`: 0 = not at all, towards 1 = more). */
  open: 0.42,
  openBounce: 0.18,
  /** Closing: the same, on its own spring. */
  close: 0.32,
  closeBounce: 0.1,
  /**
   * The side the menu lies on leads and the other follows, both as exponents: the leading side
   * goes as 1 − (1 − p)^lead, the other as p^follow (1 and 1: both sides grow evenly).
   */
  lead: 1.6,
  follow: 1.4,
  /**
   * On the way the corners stay round: no tighter than `round` × the shape's shorter side, until
   * the motion is `roundFrom` of the way (0–1), easing to the menu's own corners by `roundUntil`.
   */
  round: 0.34,
  roundFrom: 0.35,
  roundUntil: 0.8,
  /** The control's label goes between these two points of the way (0–1), softening by `labelBlur` CSS px. */
  labelFrom: 0.02,
  labelTo: 0.3,
  labelBlur: 3,
  /** The menu's content shows between these two points, coming out of a blur of `contentBlur` CSS px (0 = none: the cheapest). */
  contentFrom: 0.4,
  contentTo: 0.9,
  /** Closing, the content does not wait for the glass: it is gone this long (seconds) after the close begins. */
  closeFade: 0.12,
  contentBlur: 6,
  /** The control's glass (clear, lit) gives way to the card's between these two points. Done by `labelTo`, so the label is gone before the menu's layer takes the glass over. */
  frostFrom: 0,
  frostTo: 0.3,
}

export const lerp =(a: number, b: number, t: number) => a + (b - a) * t
export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
export const rgbCss = (c: Rgb) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`

const isVisibleColor = (c: string) => !!c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c) && !/\/\s*0\)$/.test(c)

/** The colour an element sits on: the first ancestor with a painted background. */
export function surfaceColorOf(el: Element | null): string {
  for (let a = el; a; a = a.parentElement) {
    const c = getComputedStyle(a).backgroundColor
    if (isVisibleColor(c)) return c
  }
  return getComputedStyle(document.documentElement).colorScheme.includes('dark') ? 'black' : 'white'
}

/** The lens is designed 120 units tall; every optic below is in those units. */
export const DESIGN_HEIGHT = 120

/** The shader's uniforms for a row of droplets (GlassLens.droplets): four at most. */
const DROP_NAMES = ['uDrops[0]', 'uDrops[1]', 'uDrops[2]', 'uDrops[3]']

const VERTEX = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }
`

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uSize, uCenter, uHalf, uLightDir;
uniform float uUnit, uDevicePx, uRadius, uBevel, uBodyX, uBand, uFieldRadius;
uniform vec3 uDrop;
// More droplets (GlassLens.droplets), four at most: centre, radius, bridge softness.
uniform vec4 uDrops[4];
uniform float uDropCount;
uniform vec4 uBlob;
uniform vec2 uBlobShape, uBlobNeck, uBlobFade;
uniform float uRim, uCaustic, uInner, uTopRefl, uTopBase, uRimWidth, uFresnel;
uniform float uShadow, uShadowSoft, uShadowOffset, uShadowFlush;
uniform float uLightMix, uEdgeClear;
uniform vec3 uSurface, uColor, uBorder;
uniform float uBorderWidth, uBorderAlpha;
// An outline (GlassLens.outline): its colour and opacity, and its width.
uniform vec4 uOutline;
uniform float uOutlineWidth;
uniform sampler2D uBack, uFront;
uniform float uTextured, uRefract, uMag, uDisp, uBlurCenter, uBlurEdge, uBlurShift, uFrost, uFrostBlur, uFrostMix;
uniform float uFrostEdge, uSaturation, uBendCurve, uEdgeBand;
uniform vec2 uRadial;
uniform vec4 uGlow;
uniform vec2 uGlowHalo;
uniform float uGlowBlob;
uniform vec4 uLight;
uniform vec4 uBlobMat;
uniform vec3 uBlobLine;
// The frost of large glass, worked out beforehand at a fraction of the size (FROST_PASS in the
// engine). uFrostPass.x: 0 = no such picture, the frost is worked out here as ever; 1 = this draw
// is that picture; 2 = this draw reads it. Then how many pixels one of its texels covers each
// way, and 1 / (that x the picture's size), to find a pixel in it.
uniform sampler2D uFrostPic;
uniform vec4 uFrostPass;
// How many halvings smaller the picture of the page was painted (BACK_SKIP in the engine): its
// mip levels are read that many lower.
uniform float uBackSkip;
uniform float uCssPx;
uniform sampler2D uAround;
uniform vec4 uAroundBox;
uniform float uAroundScale, uReach;
uniform vec4 uMirror, uSeen;
uniform vec2 uBounce;
uniform float uFall, uSoft;
// The glass this one melts into (COHESION), up to four, in this glass's design units. uNear: centre
// (from the lens centre) and half size. uNearShape: corner radius, the radius its bend follows (as
// uFieldRadius), the bridge's softness, bevel. What the two share across the bridge: uNearTint
// (tint colour and how much of it covers clear glass, or the colour of tinted glass), uNearLine
// (rim line colour and opacity), uNearLook (bend, 1 = clear, rim line width, cursor light angle),
// uNearShade (shadow, its softness and offset, its design unit in this glass's), uNearMirror (as
// uMirror.z, uReach and uSoft, and how much it mirrors, × this glass's) and the light of a press,
// uNearGlow and uNearLight (as uGlow and uLight).
// uNearPair: 1 = that glass's canvas lies over this one's; how joined the two are (0 = apart, 1 =
// the bridge between them has some body: the light of a press on either fills both).
uniform float uNearCount;
uniform vec4 uNear[4], uNearShape[4], uNearTint[4], uNearLine[4], uNearLook[4], uNearShade[4], uNearMirror[4], uNearGlow[4], uNearLight[4];
uniform vec2 uNearPair[4];
// How far the light of a press runs into the glass it reaches before it has faded (× its half height).
uniform float uNearFade;
out vec4 outColor;

// design units -> texture uv (textures are uploaded flipped: top row at v = 1)
vec2 toUv(vec2 d) {
  vec2 q = d * uUnit;
  return clamp(vec2(q.x / uSize.x, 1.0 - q.y / uSize.y), vec2(0.0005), vec2(0.9995));
}
vec3 backdrop(vec2 st, float lod) {
  vec4 c = textureLod(uBack, st, max(lod - uBackSkip, 0.0));
  return c.rgb + (1.0 - c.a) * uSurface;
}
// What surrounds the glass (GlassLens.reflection), at a point of the canvas in design units and
// blurred over spread. Where the picture is empty, or there is none, it is the surface colour.
vec3 around(vec2 d, float spread) {
  vec2 st = clamp((d - uAroundBox.xy) / uAroundBox.zw, vec2(0.002), vec2(0.998));
  vec4 c = textureLod(uAround, vec2(st.x, 1.0 - st.y), log2(max(spread * uAroundScale, 1.0)));
  return c.rgb + (1.0 - c.a) * uSurface;
}
// Frosted glass: the backdrop under a gaussian blur of deviation sigma (design units),
// gathered from 32 taps on a golden-angle spiral out to 2.5 deviations. Each tap reads a
// mip about as wide as the gap between taps, so the frost stays smooth while the backdrop moves.
vec3 frosted(vec2 p, float sigma) {
  float lod = max(log2(sigma * 0.8 * uUnit) - 0.5, 0.0);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 32; i++) {
    float f = float(i) + 0.5;
    float r = sqrt(f / 32.0) * 2.5 * sigma;
    float a = f * 2.39996323;
    float w = exp(-0.5 * r * r / (sigma * sigma));
    sum += backdrop(toUv(p + r * vec2(cos(a), sin(a))), lod) * w;
    total += w;
  }
  return sum / total;
}
// The sharp bend: the backdrop at p pushed by bend, its colours split slightly.
vec3 bent(vec2 p, vec2 bend, float split, float lod) {
  return vec3(
    backdrop(toUv(p + bend * (1.0 + split)), lod).r,
    backdrop(toUv(p + bend), lod).g,
    backdrop(toUv(p + bend * (1.0 - split)), lod).b);
}
float roundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float melt(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
  return mix(a, b, h) - k * h * (1.0 - h);
}
// The glass shape: a pill body, smoothly unioned with a separating droplet.
float bodyShape(vec2 p) {
  float body = roundRect(p - vec2(uBodyX, 0.0), uHalf, uRadius);
  if (uDrop.y > 0.0) {
    float d = length(p - vec2(uDrop.x, 0.0)) - uDrop.y;
    float k = max(uDrop.z, 1e-3);
    float h = clamp(0.5 + 0.5 * (d - body) / k, 0.0, 1.0);
    body = mix(d, body, h) - k * h * (1.0 - h);
  }
  // A row of droplets: each melts into the body and the droplets before it, so they leave as a chain.
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uDropCount) break;
    body = melt(length(p - uDrops[i].xy) - uDrops[i].z, body, max(uDrops[i].w, 1e-3));
  }
  return body;
}
// ...and with the optional second box (uBlobShape.y = its bridge softness, 0 = none).
float blobSoft(vec2 p) {
  float k = uBlobShape.y;
  if (uBlobNeck.y > 0.0) {
    float n = (p.x - uBlobNeck.x) / uBlobNeck.y;
    // A peaked falloff: as the softness drops, the bridge thins into a thread before it breaks.
    k *= exp(0.2 - sqrt(n * n + 0.04));
  }
  // On a small body the bridge belongs to the side that faces the second box: towards the far
  // edge the softness fades out (uBlobFade: how much, and how far in), or it raises a ridge there.
  if (uBlobFade.x > 0.0) {
    float back = smoothstep(-uHalf.y, -uHalf.y + 2.0 * uHalf.y * max(uBlobFade.y, 0.01), p.y * sign(uBlob.y));
    k *= mix(1.0, back, uBlobFade.x);
  }
  return max(k, 1e-3);
}
// The glass's own shape: the body, its droplet and its blob.
float selfShape(vec2 p) {
  float s = bodyShape(p);
  if (uBlobShape.y <= 0.0) return s;
  return melt(roundRect(p - uBlob.xy, uBlob.zw, uBlobShape.x), s, blobSoft(p));
}
// A glass this one melts into (COHESION): a rounded box.
float nearBox(int i, vec2 p) {
  return roundRect(p - uNear[i].xy, uNear[i].zw, uNearShape[i].x);
}
// The shape: its own, melted into every glass within reach.
float shape(vec2 p) {
  float s = selfShape(p);
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uNearCount) break;
    s = melt(nearBox(i, p), s, max(uNearShape[i].z, 1e-3));
  }
  return s;
}
// What casts the drop shadow: the body alone once a blob has a glass of its own.
float caster(vec2 p) {
  return uBlobShape.y > 0.0 && uBlobLine.z > 0.5 ? bodyShape(p) : shape(p);
}
// The body with corners at least as round as the bend is deep (see uBand in main).
float field(vec2 p) {
  float f = roundRect(p - vec2(uBodyX, 0.0), uHalf, uFieldRadius);
  if (uBlobShape.y > 0.0) f = melt(roundRect(p - uBlob.xy, uBlob.zw, uBlobShape.x), f, blobSoft(p));
  for (int i = 0; i < 4; i++) {
    if (float(i) >= uNearCount) break;
    f = melt(roundRect(p - uNear[i].xy, uNear[i].zw, uNearShape[i].y), f, max(uNearShape[i].z, 1e-3));
  }
  return f;
}
// The reference darkens linear colour; on sRGB values the same factor is k^(1/2.2).
float dim(float k) { return pow(clamp(k, 0.0, 1.0), 1.0 / 2.2); }
vec3 dim(vec3 k) { return pow(clamp(k, 0.0, 1.0), vec3(1.0 / 2.2)); }
float height(vec2 p, float bevel) {
  float t = pow(clamp(-shape(p) / bevel, 0.0, 1.0), 1.0 / 1.4);
  return sqrt(1.0 - (1.0 - t) * (1.0 - t));
}
// Radial bend (the SVG card's): towards the centre, strongest at the rim, fading over the
// half size. uRadial is the full bend per axis (design units); uEdgeBand / 0.35 = bendDepth.
float radialRatio(float d) {
  return clamp(1.0 - abs(d) / (min(uHalf.x, uHalf.y) * uEdgeBand / 0.35), 0.0, 1.0);
}
// d = shape(q): the caller has it already.
vec2 radialBend(vec2 q, float d) {
  vec2 c = q - vec2(uBodyX, 0.0);
  float k = pow(radialRatio(d), uBendCurve) * smoothstep(1.5 * uCssPx, -0.5 * uCssPx, d);
  return -c / max(length(c), 1e-4) * k * uRadial;
}
// Frost after the bend: every tap is bent on its own, and taps outside the glass are left
// out (the SVG filter saw nothing beyond the card), so the rim keeps its colour.
vec3 frostedRadial(vec2 q, float dq, float sigma) {
  float lod = max(log2(sigma * 0.8 * uUnit) - 0.5, 0.0);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 32; i++) {
    float f = float(i) + 0.5;
    float r = sqrt(f / 32.0) * 2.5 * sigma;
    float a = f * 2.39996323;
    vec2 t = q + r * vec2(cos(a), sin(a));
    // One shape per tap: it masks the tap and bends it.
    float dt = shape(t);
    float w = exp(-0.5 * r * r / (sigma * sigma)) * step(dt, 0.0);
    sum += backdrop(toUv(uCenter + t + radialBend(t, dt)), lod) * w;
    total += w;
  }
  return total > 1e-4 ? sum / total : backdrop(toUv(uCenter + q + radialBend(q, dq)), lod);
}
// How much of the frost this deep in the glass is read from the picture (0 = worked out here).
// Within four of the picture's texels of the rim it is worked out in full: it changes too fast
// there for a smaller picture. The picture fades in over the inner half of that band.
float frostDeep(float d) {
  if (uFrostPass.x < 1.5) return 0.0;
  float band = 4.0 * uFrostPass.y * uDevicePx;
  return 1.0 - smoothstep(-band, -0.5 * band, d);
}
vec3 frostPicture() {
  return texture(uFrostPic, gl_FragCoord.xy * uFrostPass.zw).rgb;
}

void main() {
  // The frost's own pass draws one texel for every uFrostPass.y pixels each way, and a little
  // past the rim, so that a pixel on the rim finds its neighbours in the picture.
  bool pre = uFrostPass.x > 0.5 && uFrostPass.x < 1.5;
  vec2 fc = pre ? gl_FragCoord.xy * uFrostPass.y : gl_FragCoord.xy;
  float frostReach = pre ? 1.0 + 2.0 * uFrostPass.y * uDevicePx : 1.0;
  vec2 px = vec2(fc.x, uSize.y - fc.y);
  vec2 local = px / uUnit - uCenter;
  float dist = shape(local);

  // Melted into other glass (COHESION), both canvases draw one body: each its own side of the line
  // where the two glasses are as near (side: how much nearer the nearest neighbour is here). What
  // the look depends on is shared across the bridge: a neighbour takes r / (1 + Σ r) of it, none
  // deep in this glass, half on that line, all of it deep in its own glass. Both canvases work out
  // the same values on the line, so it does not show. Without neighbours, each is this glass's own.
  float side = -1.0;
  float share = 1.0;
  float mine = dist;
  float nearTotal = 1.0;
  float nearT[4] = float[4](0.0, 0.0, 0.0, 0.0);
  float nearD[4] = float[4](0.0, 0.0, 0.0, 0.0);
  float scale = 1.0;
  float bevel = uBevel;
  float refract = uRefract;
  float blurShift = uBlurShift;
  float shadowAmount = uShadow;
  float shadowSoft = uShadowSoft;
  float shadowOffset = uShadowOffset;
  float ny = local.y / uHalf.y;
  float nx = (local.x - uBodyX) / uHalf.x;
  float ly = local.y;
  vec2 lightDir = uLightDir;
  vec3 lineColor = uBorder;
  float lineAlpha = step(1e-4, uBorderWidth) * uBorderAlpha;
  float lineWidth = uBorderWidth;
  vec3 mirrorShape = vec3(uMirror.z, uReach, uSoft);
  float glowNear = 0.0;
  float lightNear = 0.0;
  float ownLight = 1.0;
  if (uNearCount > 0.0) {
    mine = selfShape(local);
    float nearest = 1e9;
    float sumScale = 1.0;
    float sumBevel = uBevel;
    float sumRefract = uRefract;
    vec3 sumShadow = vec3(uShadow, uShadowSoft, uShadowOffset);
    vec3 sumPlace = vec3(ny, nx, ly);
    vec2 sumDir = uLightDir;
    vec3 sumLine = uBorder * lineAlpha;
    float sumAlpha = lineAlpha;
    float sumWidth = uBorderWidth * lineAlpha;
    vec3 sumMirror = mirrorShape;
    float apartAll = 0.0;
    float glowJoined = 0.0;
    float lightJoined = 0.0;
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uNearCount) break;
      float d = nearBox(i, local);
      nearD[i] = d;
      nearest = min(nearest, d);
      // How far this point has gone over to the neighbour: 0 to 1 across the bridge's softness.
      float t = clamp(0.5 + (mine - d) / max(uNearShape[i].z, 1e-3), 0.0, 1.0);
      nearT[i] = t;
      float r = t / max(1.0 - t, 1e-4);
      nearTotal += r;
      vec4 n = uNear[i];
      sumScale += r * uNearShade[i].w;
      sumBevel += r * uNearShape[i].w;
      sumRefract += r * uNearLook[i].x;
      sumShadow += r * uNearShade[i].xyz;
      sumPlace += r * vec3((local.y - n.y) / n.w, (local.x - n.x) / n.z, local.y - n.y);
      sumDir += r * vec2(cos(uNearLook[i].w), sin(uNearLook[i].w));
      float a = uNearLine[i].w;
      sumLine += r * a * uNearLine[i].rgb;
      sumAlpha += r * a;
      sumWidth += r * a * uNearLook[i].z;
      sumMirror += r * uNearMirror[i].xyz;
      // The light of a press on either glass: shared like the rest while they are apart, and all of
      // it everywhere once they are joined, so it runs on through the whole body.
      // ...fading as it goes deeper into this glass from the line between them, as a reflection would.
      float join = uNearPair[i].y * exp(-max(d - mine, 0.0) / max(uHalf.y * uNearFade, 0.5));
      float apart = r * (1.0 - join);
      apartAll += apart;
      vec2 gd = (local - uNearGlow[i].xy) / max(uNearGlow[i].z, 1.0);
      float glow = uNearGlow[i].w * exp(-dot(gd, gd));
      float light = uNearLight[i].w * max(1.0 - length(local - uNearLight[i].xy) / max(uNearLight[i].z, 1e-3), 0.0);
      glowNear += apart * glow;
      lightNear += apart * light;
      glowJoined += join * glow;
      lightJoined += join * light;
    }
    side = mine - nearest;
    share = clamp(0.5 - side / (4.0 * uDevicePx), 0.0, 1.0);
    // Lengths built into the look (in design units) follow the shared design unit.
    scale = sumScale / nearTotal;
    bevel = sumBevel / nearTotal;
    refract = sumRefract / nearTotal;
    blurShift = uBlurShift + log2(max(scale, 1e-3));
    shadowAmount = sumShadow.x / nearTotal;
    shadowSoft = sumShadow.y / nearTotal;
    shadowOffset = sumShadow.z / nearTotal;
    ny = sumPlace.x / nearTotal;
    nx = sumPlace.y / nearTotal;
    ly = sumPlace.z / nearTotal;
    if (dot(sumDir, sumDir) > 1e-6) lightDir = normalize(sumDir);
    lineAlpha = sumAlpha / nearTotal;
    if (sumAlpha > 1e-4) {
      lineColor = sumLine / sumAlpha;
      lineWidth = sumWidth / sumAlpha;
    }
    mirrorShape = sumMirror / nearTotal;
    glowNear = glowNear / nearTotal + glowJoined;
    lightNear = lightNear / nearTotal + lightJoined;
    ownLight = 1.0 - apartAll / nearTotal;
  }

  // Drop shadow: tight + ambient, kept near the glass, faded before the canvas edge.
  float vFade = smoothstep(-0.1, 0.9, ny) * 0.92 + 0.08;
  // (uShadowFlush: the shadow is whole from the edge on, with no lighter band between it and the glass.)
  float outside = mix(smoothstep(-4.0 * scale, 14.0 * scale, dist), 1.0, uShadowFlush);
  float near = 1.0 - smoothstep(-6.0 * scale, shadowSoft, caster(local - vec2(0.0, shadowOffset)));
  float far = 1.0 - smoothstep(-10.0 * scale, shadowSoft * 1.5, caster(local - vec2(0.0, shadowOffset * 1.6)));
  float border = min(min(px.x, px.y), min(uSize.x - px.x, uSize.y - px.y));
  float sh = clamp((near + far) * shadowAmount * vFade * outside, 0.0, 0.85) * smoothstep(0.0, 14.0, border);
  vec4 outsideCol = vec4(0.0, 0.0, 0.0, 1.0 - dim(1.0 - sh));

  // Glow (see below): its strength here. It stays inside the glass unless a halo is asked for
  // (uGlowHalo: 1 = around the body, 2 = around the blob; and how much).
  float glowAt = 0.0;
  if (uGlow.w > 0.0) {
    vec2 gd = (local - uGlow.xy) / max(uGlow.z, 1.0);
    glowAt = uGlow.w * exp(-dot(gd, gd));
    if (uGlowHalo.x > 0.5) {
      // Past that edge it brightens the page the same way: the page's own colour at its
      // brightest, laid over just thick enough to lift the surface colour to L^(1 / (1 + halo)).
      float edgeDist = uGlowHalo.x > 1.5 ? roundRect(local - uBlob.xy, uBlob.zw, uBlobShape.x) : roundRect(local - vec2(uBodyX, 0.0), uHalf, uRadius);
      float halo = glowAt * uGlowHalo.y * exp(-max(edgeDist, 0.0) / 28.0) * smoothstep(0.0, 14.0, border);
      float pageL = max(dot(uSurface, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
      float pageMax = max(max(uSurface.r, uSurface.g), uSurface.b);
      float cover = clamp((pow(pageL, 1.0 / (1.0 + halo)) / pageL - 1.0) * pageMax / max(1.0 - pageMax, 1e-3), 0.0, 1.0);
      outsideCol = vec4(uSurface / max(pageMax, 1e-3) * cover, cover + outsideCol.a * (1.0 - cover));
    }
  }

  // Outside the glass the shadow (and the halo) is the whole pixel: about half of every canvas
  // stops here, before the bevel, the bend and the light are worked out.
  float aa = max(fwidth(dist), 1e-4);
  float mask = 1.0 - smoothstep(-aa, aa, dist);
  // Past the line, the neighbour's own canvas draws the body: here only this glass's share of the
  // shadow the two cast together. Along the line the two canvases cross-fade over a few px: the
  // one beneath draws its glass a little past the line, and the one above fades in over it, so
  // what little the two pictures differ by (each blurs its own picture of the page) does not show
  // as a line. cover: how much of the glass this canvas draws here.
  float cover = 1.0;
  if (uNearCount > 0.0) {
    outsideCol *= share;
    float fade = 4.0 * uCssPx;
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uNearCount) break;
      float s = mine - nearD[i];
      if (uNearPair[i].x > 0.5) cover *= step(s, fade + 2.0 * uDevicePx);
      else cover *= smoothstep(fade, -fade, s);
    }
    if (cover <= 0.0 && !pre) {
      outColor = outsideCol * (1.0 - mask);
      return;
    }
  }
  if (mask <= 0.0 && !pre) {
    outColor = outsideCol;
    return;
  }

  // The lighting belongs to the body. A melted blob takes none of it (no reflection, inner
  // shading, rim light or caustic): its face stays flat, and the light fades out where it begins.
  float lit = 1.0;
  if (uBlobShape.y > 0.0) lit = 1.0 - smoothstep(-2.0, 8.0, roundRect(local - vec2(uBodyX, 0.0), uHalf, uRadius));
  // A blob with a glass of its own: its tint, frost and bend take over where the light leaves.
  float own = (1.0 - lit) * uBlobLine.z;
  float frostCover = mix(uFrost, uBlobMat.x, own);
  float frostBlur = mix(uFrostBlur, uBlobMat.y, own);
  float bendCurve = mix(uBendCurve, uBlobMat.z, own);
  float edgeBand = mix(uEdgeBand, uBlobMat.w, own);

  // Surface normal from the bevel height field.
  float e = 1.25 * scale;
  float h = height(local, bevel);
  vec2 grad = vec2(height(local + vec2(e, 0.0), bevel) - h, height(local + vec2(0.0, e), bevel) - h) / e;
  vec3 normal = normalize(vec3(-grad * 42.0 * scale, 1.0));
  float depth = clamp(1.0 - h, 0.0, 1.0);
  float edge = 1.0 - smoothstep(0.0, bevel * edgeBand, -dist);
  vec2 dir = normalize(vec2(shape(local + vec2(e, 0.0)) - dist, shape(local + vec2(0.0, e)) - dist) + 1e-6);

  vec3 glass;
  if (uTextured > 0.5 && (uRadial.x > 0.0 || uRadial.y > 0.0)) {
    // Radial bend, then frost: the old SVG card's rim.
    float ratio = radialRatio(dist);
    float sharpLod = max(uBlurShift, 0.0);
    if (uFrostBlur > 0.0 && dist < frostReach) {
      float deep = frostDeep(dist);
      vec3 frost = deep > 0.0 ? frostPicture() : vec3(0.0);
      if (deep < 1.0) frost = mix(frostedRadial(local, dist, uFrostBlur * mix(1.0, uFrostEdge, pow(ratio, 1.3))), frost, deep);
      if (pre) {
        outColor = vec4(frost, 1.0);
        return;
      }
      glass = uFrostMix < 1.0 ? mix(bent(uCenter + local, radialBend(local, dist), uDisp * 0.35, sharpLod), frost, uFrostMix) : frost;
    } else {
      glass = bent(uCenter + local, radialBend(local, dist), uDisp * 0.35, sharpLod);
    }
    if (uSaturation != 1.0) glass = max(mix(vec3(dot(glass, vec3(0.2126, 0.7152, 0.0722))), glass, uSaturation), 0.0);
  } else if (uTextured > 0.5) {
    // Refraction: magnify the middle, bend inwards at the rim, split colours slightly.
    // A lens with square corners (uBand > 0) bends deeper than its corner radius. The
    // bend then follows a shape whose corners are at least that round: on the real
    // shape its direction would break along the diagonals. Mask and light keep the real shape.
    float bendEdge = edge;
    vec2 bendDir = dir;
    if (uBand > 0.0) {
      float fd = field(local);
      bendDir = normalize(vec2(field(local + vec2(e, 0.0)) - fd, field(local + vec2(0.0, e)) - fd) + 1e-6);
      bendEdge = 1.0 - smoothstep(0.0, uBand, -fd);
    }
    vec2 magnified = local / (uMag * h + 1.0);
    vec2 bend = -bendDir * refract * pow(bendEdge, bendCurve);
    float split = uDisp * 0.35 * (1.0 - own);
    float lod = max(mix(uBlurCenter, uBlurEdge, pow(bendEdge, 1.3)) + blurShift, 0.0);
    vec2 at = uCenter + magnified;
    if (frostBlur > 0.0 && dist < frostReach) {
      // Frosted (inside the glass only: outside, nothing of it shows). The frost hides the
      // colour split, so one bent point is enough; uFrostMix lets the sharp bend show through.
      float deep = frostDeep(dist);
      vec3 frost = deep > 0.0 ? frostPicture() : vec3(0.0);
      if (deep < 1.0) frost = mix(frosted(at + bend, frostBlur * mix(1.0, uFrostEdge, pow(bendEdge, 1.3))), frost, deep);
      if (pre) {
        outColor = vec4(frost, 1.0);
        return;
      }
      glass = uFrostMix < 1.0 ? mix(bent(at, bend, split, lod), frost, uFrostMix) : frost;
    } else {
      glass = bent(at, bend, split, lod);
    }
    // Vibrancy: what shows through, more (or less) saturated.
    if (uSaturation != 1.0) glass = max(mix(vec3(dot(glass, vec3(0.2126, 0.7152, 0.0722))), glass, uSaturation), 0.0);
  } else {
    // Tinted glass: its own colour in the middle, thinning towards the rim.
    glass = mix(uSurface, uColor, 1.0 - edge * uEdgeClear);
  }

  // (The frost's own pass ends here: where there is no frost, its picture is empty.)
  if (pre) {
    outColor = vec4(0.0);
    return;
  }

  // Top reflection.
  float top = ((1.0 - smoothstep(-0.05, 0.75, ny)) * (1.0 - nx * 0.12) * uTopRefl * 0.6 + uTopBase) * lit;
  vec3 topDim = dim(1.0 - vec3(1.0, 1.0, 0.72) * top);
  glass *= topDim;
  vec3 seenThrough = glass;

  // Frosted resting state: a still lens is the flat highlight colour.
  glass = mix(glass, uColor, frostCover * step(0.5, uTextured));
  // Melted into a neighbour (COHESION), the glass turns into that one's tint or colour across the
  // bridge. Clear glass beside tinted turns all the way by the line, for the tinted side cannot
  // draw what lies behind: that one keeps its own look, and the clear side meets it there.
  float mirrorShare = 1.0;
  if (uNearCount > 0.0) {
    vec3 sumLook = glass;
    float sumW = 1.0;
    float sumMirrors = 1.0;
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uNearCount) break;
      bool clearNear = uNearLook[i].y > 0.5;
      float t = clearNear == (uTextured > 0.5) ? nearT[i] : (clearNear ? 0.0 : min(1.0, 2.0 * nearT[i]));
      float w = t / max(1.0 - t, 1e-4);
      vec3 look = clearNear ? mix(seenThrough, uNearTint[i].rgb, uNearTint[i].a) : mix(uSurface, uNearTint[i].rgb, 1.0 - edge * uEdgeClear) * topDim;
      sumLook += w * look;
      sumW += w;
      sumMirrors += w * uNearMirror[i].w;
    }
    glass = sumLook / sumW;
    // What it mirrors is shared the same way: towards tinted glass, which mirrors nothing, it fades
    // out. Each canvas mirrors its own picture of the surroundings, so the mirror fades out across
    // the bridge too, to nothing on the line: the middle of one body mirrors nothing anyway.
    mirrorShare = sumMirrors / sumW;
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uNearCount) break;
      mirrorShare *= 1.0 - 4.0 * nearT[i] * (1.0 - nearT[i]);
    }
  }

  // Inner shading: just inside the rim, a wide band on the left, a deep ring.
  float up = clamp(-dir.y, 0.0, 1.0);
  float right = clamp(dir.x, 0.0, 1.0);
  float left = clamp(-dir.x, 0.0, 1.0);
  float down = clamp(dir.y, 0.0, 1.0);
  float inner = uInner * lit;
  float innerBand = smoothstep(bevel * -0.19, bevel * -0.024, dist);
  glass *= dim(1.0 - innerBand * (up + left * 0.6 + right * 0.3 + down * 0.15) * inner * 2.2);
  float deepBand = smoothstep(bevel * -0.73, bevel * -0.13, dist);
  glass *= dim(1.0 - deepBand * left * inner * 2.0);
  float hx = (dist + bevel * 0.45) / (bevel * 0.26);
  float ring = exp(-hx * hx);
  glass *= dim(1.0 - ring * (right * 0.9 + up * 0.5 + left * 0.4 + down * 0.3) * inner * 1.5);

  // Rim light + fresnel; leans a little towards the cursor when there is one.
  float fresnel = pow(clamp(1.0 - normal.z, 0.0, 1.0), 6.0);
  float rimW = max(uDevicePx * 1.1, scale) * uRimWidth;
  float rimLine = 1.0 - smoothstep(0.0, rimW * 1.6, abs(dist + rimW * 1.8));
  float fall = exp(-(ly / (30.0 * scale)) * (ly / (30.0 * scale)));
  float studio = right * right * fall * 0.9 + down * down * 0.2 + left * left * 0.55;
  float lightCos = dot(dir, lightDir);
  float facing = clamp(lightCos, 0.0, 1.0);
  float away = clamp(-lightCos, 0.0, 1.0);
  float aimed = facing * facing * 0.9 + away * away * 0.55;
  float lean = uLightMix * 0.4;
  float rimDir = mix(studio, aimed, lean);
  float front = mix(right, facing, lean);
  float back = mix(left, away, lean);
  // What this point of the glass mirrors. The bevel is a curved mirror: its very edge looks far
  // out, the way the rim faces there, and the look shortens with depth, down to nothing at the
  // band's inner end (uMirror.z). So a neighbour's picture is squeezed into the rim, deepest
  // where it is nearest and thinner as the rim turns away from it: a crescent on a round glass,
  // on a pill a band that tapers round the ends. Each point gathers a soft patch of the
  // surroundings (uSoft wide) at three places along its look, so the picture has no hard edge.
  float into = clamp(-dist / mirrorShape.x, 0.0, 1.0);
  float look = mirrorShape.y * (1.0 - into);
  vec2 rimAt = uCenter + local - dir * dist;
  vec2 across = vec2(-dir.y, dir.x) * mirrorShape.z * 0.7;
  vec3 seen = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    vec2 at = rimAt + dir * look * (0.4 + 0.3 * float(i));
    seen += (around(at, mirrorShape.z) * 0.4 + around(at + across, mirrorShape.z) * 0.3 + around(at - across, mirrorShape.z) * 0.3) * uSeen[i];
  }
  // The light is white where it lands; the far side and the bottom are lit by what bounces back
  // from the surroundings, and take their colour (white from anything dark or grey).
  float seenMax = max(max(seen.r, seen.g), seen.b);
  vec3 bounce = mix(vec3(1.0), seen / max(seenMax, 1e-3), smoothstep(0.08, 0.5, seenMax) * uBounce.y);
  vec3 rimCol = mix(vec3(1.0), bounce, down * 0.6);
  rimCol = mix(rimCol, bounce * uBounce.x, back * 0.85);
  glass += rimCol * (rimLine * rimDir * uRim + fresnel * front * uFresnel * step(0.001, uRim)) * lit;

  // Reflection: the rim mirrors what differs from the surface the glass sits on. A neighbour
  // of another colour shows on the rim that faces it; a darker one dims it a little.
  // (uMirror: on the line, in the band inside it, that band's depth, the dimming. uSeen.w: the gain.)
  // much: how far what is seen differs from the surface; hue: that difference at full strength.
  vec3 differs = (seen - uSurface) * uSeen.w;
  float much = max(max(abs(differs.r), abs(differs.g)), abs(differs.b));
  vec3 hue = differs / max(much, 1e-4);
  much = min(much, 1.0);
  // On the rim it is the rim light's own line, no thicker; the band begins inside that line.
  float band = pow(1.0 - into, uFall) * uMirror.y * smoothstep(0.0, rimW * 1.8, -dist);
  float mirror = min(lit * max(rimLine * uMirror.x, band), 1.0) * much * mirrorShare;
  // What it lacks of the surface's colour is taken out of the glass; then the glass is lifted
  // towards the neighbour's colour: dark glass mirrors it on any page.
  glass *= 1.0 - max(-hue, 0.0) * mirror * uMirror.w;
  glass += max(clamp(uSurface + hue, 0.0, 1.0) - glass, 0.0) * mirror;

  // Glow: light let in at one point, fading smoothly with distance. It brightens whatever glass
  // is near, evenly from the middle to the rim, a melted blob included (the halo is above),
  // unless the light is kept to the body (uGlowBlob: how much of it the blob takes).
  // Melted, the light of a press on a neighbour runs on into this side of the bridge.
  float glassL = max(dot(glass, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  float glowHere = glowAt * mix(uGlowBlob, 1.0, lit);
  if (uNearCount > 0.0) glowHere = glowHere * ownLight + glowNear;
  glass *= pow(glassL, 1.0 / (1.0 + glowHere)) / glassL;

  // Pointer light (LIGHT): white laid over the glass, strongest where the press landed and falling
  // off evenly to nothing at its radius. (uLight: its centre, its radius, how white.)
  float white = uLight.w > 0.0 ? uLight.w * max(1.0 - length(local - uLight.xy) / max(uLight.z, 1e-3), 0.0) : 0.0;
  if (uNearCount > 0.0) white = white * ownLight + lightNear;
  if (white > 0.0) glass = mix(glass, vec3(1.0), min(white, 1.0));

  // Caustic: warm light gathering inside the bottom edge.
  glass += vec3(1.0, 0.92, 0.86) * smoothstep(0.72, 0.98, depth) * down * uCaustic * lit;

  // Bordered body (outline buttons): a flat line just inside the edge.
  glass = mix(glass, lineColor, smoothstep(-lineWidth - aa, -lineWidth + aa, dist) * lineAlpha);
  // An outline on the very edge, over that line: what is left of the line shows just inside it.
  if (uOutlineWidth > 0.0) glass = mix(glass, uOutline.rgb, smoothstep(-uOutlineWidth - aa, -uOutlineWidth + aa, dist) * uOutline.a);
  // ...and the white line of a blob with its own glass.
  glass = mix(glass, vec3(1.0), smoothstep(-uBlobLine.x - aa, -uBlobLine.x + aa, dist) * uBlobLine.y * own);
  vec4 col = mix(outsideCol, vec4(clamp(glass, 0.0, 1.0), 1.0), mask * cover);
  // Front layer (selected labels) sits on the frosted pill and fades as the lens clears.
  vec4 fg = texture(uFront, gl_FragCoord.xy / uSize) * mask * cover * uFrost * step(0.5, uTextured);
  outColor = fg + col * (1.0 - fg.a);
}
`

function createEngine(): GlassEngine | null {
  const glCanvas = document.createElement('canvas')
  const gl = glCanvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false })
  if (!gl) return null
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)
    if (!s) return null
    gl.shaderSource(s, src)
    gl.compileShader(s)
    return s
  }
  const vs = compile(gl.VERTEX_SHADER, VERTEX)
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT)
  const program = gl.createProgram()
  if (!vs || !fs || !program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  // A shader's own status is asked for only when linking fails: every such question waits for
  // the GPU, and a program that linked has answered it.
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    for (const s of [vs, fs]) if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn('[liquid-glass] shader failed to compile', gl.getShaderInfoLog(s))
    return null
  }
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const attr = gl.getAttribLocation(program, 'a')
  gl.enableVertexAttribArray(attr)
  gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0)

  // Shared canvases for textured lenses: what lies beneath, and what rides on top.
  // Each view keeps its own pair of textures, so a frame that only moves the light re-uses them.
  const layer = () => {
    const canvas = document.createElement('canvas')
    return { canvas, ctx: canvas.getContext('2d') }
  }
  const filters = (mipmapped: boolean) => {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
  }
  const texture = (mipmapped: boolean) => {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    filters(mipmapped)
    if (mipmapped) gl.generateMipmap(gl.TEXTURE_2D)
    return tex
  }
  /** A picture on the GPU, and the size its storage was made for (0 = none yet). */
  type Picture = { tex: WebGLTexture | null; w: number; h: number }
  /**
   * Puts a canvas into a picture, on the texture unit that is active. Its storage is made once
   * for a size (with every mip level, where the picture is seen blurred) and a canvas of that size
   * is then written into it in place: asking for a new image on every upload makes the GPU give
   * the texture new storage each time.
   */
  const upload = (to: Picture, from: HTMLCanvasElement, mipmapped: boolean) => {
    const w = from.width
    const h = from.height
    if (!to.tex || to.w !== w || to.h !== h) {
      if (to.tex) gl.deleteTexture(to.tex)
      to.tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, to.tex)
      filters(mipmapped)
      gl.texStorage2D(gl.TEXTURE_2D, mipmapped ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1, gl.RGBA8, w, h)
      to.w = w
      to.h = h
    } else gl.bindTexture(gl.TEXTURE_2D, to.tex)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, from)
    if (mipmapped) gl.generateMipmap(gl.TEXTURE_2D)
  }
  const back = layer()
  const front = layer()
  if (!back.ctx || !front.ctx) return null
  // The pair is kept per size, for the sizes last drawn: one pair sized to every view in turn was
  // given a new backing store for each of them, on every frame. The front canvas is made when a
  // painter first asks for one.
  type Layer = ReturnType<typeof layer>
  type Layers = { back: Layer; front: Layer | null; used: number }
  const LAYER_SIZES = 12
  const layersOf = new Map<string, Layers>()
  let layerUse = 0
  const sized = (w: number, h: number) => {
    const l = layer()
    l.canvas.width = w
    l.canvas.height = h
    return l
  }
  const layersFor = (w: number, h: number, fw: number, fh: number) => {
    const key = `${w}x${h}|${fw}x${fh}`
    let l = layersOf.get(key)
    if (!l) {
      if (layersOf.size >= LAYER_SIZES) {
        // The size drawn longest ago gives its canvases back.
        let oldest = ''
        let least = Infinity
        for (const [k, o] of layersOf) if (o.used < least) [oldest, least] = [k, o.used]
        const gone = layersOf.get(oldest)
        for (const o of gone ? [gone.back, gone.front] : []) if (o) o.canvas.width = o.canvas.height = 0
        layersOf.delete(oldest)
      }
      layersOf.set(key, (l = { back: sized(w, h), front: null, used: 0 }))
    }
    if (fw && !l.front) l.front = sized(fw, fh)
    l.used = ++layerUse
    return l
  }
  /**
   * Glass frosted all over shows nothing of the page sharper than its frost: every reading of the
   * page is at mip level log2(0.8 × the frost's softness in device px) − 0.5 or above (frosted in
   * FRAGMENT). The levels beneath that are never read. So the page is painted that many halvings
   * smaller to begin with, `most` at most, and the shader reads it that many levels lower
   * (uBackSkip): a quarter or a sixteenth of the pixels to paint, upload and build mipmaps from,
   * on every frame of live glass. Glass that shows the page sharp anywhere (no frost, a frost
   * mixed with the sharp bend, a blob with a glass of its own) keeps the full picture.
   */
  const BACK_SKIP = { most: 2 }
  const backSkipOf = (m: GlassLens, dpr: number) => {
    const r = m.refraction
    if (!r || m.blob?.material || clamp(r.blurMix ?? 1) < 1) return 0
    const soft = Math.max(0, r.blur ?? 0) * Math.min(1, Math.max(0.05, m.tune?.frostEdge ?? 1)) * dpr
    return soft > 0 ? clamp(Math.floor(Math.log2(soft * 0.8) - 0.5), 0, BACK_SKIP.most) : 0
  }
  type Painted = { back: Picture; front: Picture; w: number; h: number; skip: number; at: number }
  const painted = new Map<GlassView, Painted>()
  // A third, small one for what surrounds a lens (its reflection), and each view's own texture of it:
  // where the picture was taken (the canvas's box then, CSS px) and how far past it it reaches.
  const around = layer()
  if (!around.ctx) return null
  /** `busy`: a picture is due (or was taken) while something on the page moved or was lit: it is taken once all is still. */
  type Mirrored = { pic: Picture; w: number; h: number; at: number; left: number; top: number; reach: number; due: boolean; timer: number; busy: boolean }
  /** The pictures of the surroundings taken on this frame. */
  const pictured: Mirrored[] = []
  const mirrored = new Map<GlassView, Mirrored>()
  /** Texels per CSS px of that picture: it is only ever seen blurred. */
  const AROUND_SCALE = 0.5
  /** It is taken again this often, at most (ms). */
  const AROUND_EVERY = 400
  /**
   * While something on the page moves or is lit, a picture already taken is kept, at most this long
   * (ms), and taken again once all is still: taken half way, it would keep a neighbour lit by a
   * press after its light has gone (until something took it again). `live` glass does not wait.
   */
  const AROUND_WAIT = 2000
  /** Something on the page moved or was lit on the last frame, or so far on this one. */
  let busy = false
  let ranLast = false
  // What a lens without layers samples (and ignores): a texture unit is never left empty.
  const blank = { back: texture(true), front: texture(false) }
  // (The frost's picture has a texture unit of its own, never left empty either.)
  gl.activeTexture(gl.TEXTURE3)
  gl.bindTexture(gl.TEXTURE_2D, blank.front)
  gl.activeTexture(gl.TEXTURE0)
  /** The page behind a still lens is read again this often while only the light moves (ms). */
  const REPAINT_EVERY = 120
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  gl.uniform1i(gl.getUniformLocation(program, 'uBack'), 0)
  gl.uniform1i(gl.getUniformLocation(program, 'uFront'), 1)
  gl.uniform1i(gl.getUniformLocation(program, 'uAround'), 2)
  /**
   * The frost's own pass. Frost is 32 readings of the page for every pixel of the glass, most of
   * what the GPU does for a frosted card. From `area` device px of glass up, and where the frost
   * is at least `sigma` device px soft, it is first worked out into a picture a fraction of the
   * size: one texel for every (its softness ÷ `texel`) px each way, `most` at most, since a frost
   * that soft has nothing finer to show. The glass then reads that picture, except along its rim
   * (frostDeep in FRAGMENT). Smaller glass gains nothing from a second pass and keeps the one.
   * Measured on the same cards drawn both ways, the two pictures differ by 5 levels in 255 at
   * most, and by more than 1 on fewer than one pixel in a thousand. A blob with a glass of its own (a surface that opens)
   * frosts by a different amount at every point, and keeps the one pass too.
   */
  const FROST_PASS = { area: 150_000, sigma: 5, texel: 2.5, most: 3 }
  gl.uniform1i(gl.getUniformLocation(program, 'uFrostPic'), 3)
  const frostPassAt = gl.getUniformLocation(program, 'uFrostPass')
  /** What uFrostPass.x holds now. */
  let frostPassHeld = 0
  const frostPic = { tex: null as WebGLTexture | null, fbo: null as WebGLFramebuffer | null, w: 0, h: 0, broken: false }
  /** Makes room in the frost's picture for w × h texels (it only grows). False where this GPU cannot draw into it. */
  const frostRoom = (w: number, h: number) => {
    if (frostPic.broken) return false
    if (frostPic.tex && frostPic.w >= w && frostPic.h >= h) return true
    const tw = Math.max(frostPic.w, w)
    const th = Math.max(frostPic.h, h)
    if (frostPic.tex) gl.deleteTexture(frostPic.tex)
    frostPic.tex = gl.createTexture()
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, frostPic.tex)
    filters(false)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, tw, th)
    frostPic.fbo ??= gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, frostPic.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, frostPic.tex, 0)
    // Asked once for each size the picture grows to: the answer waits for the GPU.
    frostPic.broken = gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    frostPic.w = tw
    frostPic.h = th
    return !frostPic.broken
  }
  const locations = new Map<string, WebGLUniformLocation | null>()
  const u = (name: string) => {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name))
    return locations.get(name) ?? null
  }
  // Every uniform of a frame goes through `set`, which keeps the values: a view whose frame
  // would come out exactly as the one already on its canvas is not drawn again, and nothing is
  // asked of the GPU for it. A frame that is drawn sends them with `send`: only those that differ
  // from what the program (one for every view) already holds.
  const sent: number[] = []
  const names: string[] = []
  const sizes: number[] = []
  const set = (name: string, a: number, b?: number, c?: number, d?: number) => {
    names.push(name)
    sizes.push(b === undefined ? 1 : c === undefined ? 2 : d === undefined ? 3 : 4)
    sent.push(a, b ?? 0, c ?? 0, d ?? 0)
  }
  const held = new Map<string, [number, number, number, number]>()
  const send = () => {
    for (let i = 0; i < names.length; i++) {
      const at = i * 4
      const a = sent[at]
      const b = sent[at + 1]
      const c = sent[at + 2]
      const d = sent[at + 3]
      let h = held.get(names[i])
      if (h && h[0] === a && h[1] === b && h[2] === c && h[3] === d) continue
      if (!h) held.set(names[i], (h = [a, b, c, d]))
      else [h[0], h[1], h[2], h[3]] = [a, b, c, d]
      const to = u(names[i])
      if (sizes[i] === 1) gl.uniform1f(to, a)
      else if (sizes[i] === 2) gl.uniform2f(to, a, b)
      else if (sizes[i] === 3) gl.uniform3f(to, a, b, c)
      else gl.uniform4f(to, a, b, c, d)
    }
  }
  /** What a view's canvas shows now: its uniforms (empty = nothing usable) and its CSS box. */
  const shown = new WeakMap<GlassView, { sent: number[]; box: string }>()

  const views = new Set<GlassView>()
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  let dead = false

  // Colour resolving: paint any CSS colour into a 1×1 canvas and read it back.
  const probeCanvas = document.createElement('canvas')
  probeCanvas.width = probeCanvas.height = 1
  const probe = probeCanvas.getContext('2d', { willReadFrequently: true })
  // A colour that means the same on every page and in every theme is resolved once: a scroll
  // or a hover asks for the same few again and again, and asking touches the DOM.
  const ABSOLUTE = /^(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|black|white|transparent)$/i
  const resolved = new Map<string, Rgba>()
  const resolveColor = (css: string): Rgba => {
    if (!probe) return [1, 1, 1, 1]
    const fixed = ABSOLUTE.test(css) && !/currentcolor/i.test(css)
    const known = fixed ? resolved.get(css) : undefined
    if (known) return [known[0], known[1], known[2], known[3]]
    const span = document.createElement('span')
    span.style.color = css
    // Measured on <body>, never inside a host whose children are observed.
    document.body.appendChild(span)
    const computed = getComputedStyle(span).color
    span.remove()
    probe.clearRect(0, 0, 1, 1)
    probe.fillStyle = computed
    probe.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data
    if (fixed) {
      if (resolved.size > 400) resolved.clear()
      resolved.set(css, [r / 255, g / 255, b / 255, a / 255])
    }
    return [r / 255, g / 255, b / 255, a / 255]
  }

  // Cursor light: shared, fades in on the first mouse move, out when the pointer leaves.
  const pointer = { x: 0, y: 0, active: false, moved: false, mix: 0 }

  // Pointer light (LIGHT). `beam` is the pointer that lights: where it is, what it is over
  // and which pointer is held (`id`, -1 = none).
  // Each lit view keeps its own light: how bright (a spring), where on the glass, and why.
  const beam = { x: 0, y: 0, over: null as EventTarget | null, id: -1 }
  type Lit = {
    glow: Spring
    /** The light's centre, relative to the lens centre (CSS px). */
    x: number
    y: number
    press: boolean
    key: boolean
    /** The glass's host takes no pointer events (a badge): the pointer only has to be over the glass. */
    free: boolean
    /** The body on screen, as last drawn: centre, half size and its shift from the lens centre. */
    sx: number
    sy: number
    hx: number
    hy: number
    bodyX: number
    /** A second box melted into the body (a surface that has opened), as last drawn: its centre from the lens centre, and its half size. */
    blob: { x: number; y: number; hx: number; hy: number } | null
    /** The press landed on that box: the light takes its size from it. */
    onBlob: boolean
  }
  const lights = new Map<GlassView, Lit>()
  let relit = false
  const hostOf = (v: GlassView) => v.canvas.parentElement
  /** The pointer is on this glass: inside its body, and on its host (not on something lying over it). */
  const onBlob = (s: Lit) => !!s.blob && Math.abs(beam.x - (s.sx - s.bodyX + s.blob.x)) <= s.blob.hx && Math.abs(beam.y - (s.sy + s.blob.y)) <= s.blob.hy
  const under = (v: GlassView, s: Lit) => {
    if ((Math.abs(beam.x - s.sx) > s.hx || Math.abs(beam.y - s.sy) > s.hy) && !onBlob(s)) return false
    if (s.free) return true
    const host = hostOf(v)
    return !!host && beam.over instanceof Node && host.contains(beam.over) && !host.matches(':disabled, [data-disabled], [aria-disabled="true"]')
  }
  /** A press belongs to the innermost glass under it: a button on a card lights up, the card does not. */
  const innermost = (v: GlassView) => {
    const host = hostOf(v)
    for (const [other, s] of lights) {
      const inner = hostOf(other)
      if (other !== v && !s.free && other.visible && host && inner && inner !== host && host.contains(inner) && under(other, s)) return false
    }
    return true
  }
  /** Advances a view's light; true while it still changes. */
  const stepLight = (v: GlassView, dt: number, still: boolean) => {
    const s = lights.get(v)
    if (!s) return false
    const held = s.press || s.key
    const target = LIGHT.on && held ? LIGHT.press : 0
    if (still) {
      const changed = s.glow.x !== target
      s.glow.x = target
      s.glow.v = 0
      return changed
    }
    return stepSpring(s.glow, target, held ? { omega: (2 * Math.PI) / Math.max(LIGHT.rise, 0.01), zeta: clamp(1 - LIGHT.riseBounce, 0.05, 1) } : { omega: (2 * Math.PI) / Math.max(LIGHT.fade, 0.01), zeta: 1 }, dt)
  }

  // The flash of a press on a button (GLOW): the rule above GLOW, applied. A view that says
  // `button: true` is lit where a press lands on it (or at its centre, by Space / Enter): the
  // light comes up, holds for as long as the press does (`hold` at least) and fades as it
  // spreads. Each button keeps its own: how bright, how far it has spread, where it landed (from
  // the host's centre, px), how long it still holds, how many presses' worth is asked for, how
  // small the glass is (which set of values it takes), its height, and what holds it.
  // A surface keeps one too, for a choice pressed in it (`choice`): the same light with GLOW's
  // `select` values, measured in the choice's own height.
  type Flash = { glow: Spring; spread: Spring; x: number; y: number; hold: number; level: number; small: number; height: number; by: number; key: boolean; choice: boolean }
  /** What counts as a choice inside a surface. */
  const CHOICES = ':is([role=option],[role=menuitem],[data-glass-item],[data-glass-pick])'
  const flashes = new Map<GlassView, Flash>()
  const flashTune = (small: number): typeof GLOW => {
    if (small <= 0) return GLOW
    if (small >= 1) return GLOW_SMALL
    const mixed = { ...GLOW }
    for (const name of Object.keys(mixed) as (keyof typeof GLOW)[]) mixed[name] = lerp(GLOW[name], GLOW_SMALL[name], small)
    return mixed
  }
  /**
   * Light on this glass at this point (viewport px), or at its centre. Presses that land before
   * the last has faded add up. `choice`: the element chosen inside a surface, whose light it is.
   */
  const flash = (v: GlassView, x?: number, y?: number, choice?: HTMLElement) => {
    const host = hostOf(v)
    if (!host) return null
    let f = flashes.get(v)
    if (!f) flashes.set(v, (f = { glow: { x: 0, v: 0 }, spread: { x: 0, v: 0 }, x: 0, y: 0, hold: 0, level: 0, small: 0, height: 0, by: -1, key: false, choice: false }))
    const r = host.getBoundingClientRect()
    // A light that is still bright keeps spreading from where it is: only a fresh one starts small.
    if (f.glow.x < 0.08) f.spread.x = f.spread.v = 0
    f.x = x === undefined ? 0 : clamp(x - (r.left + r.width / 2), -r.width / 2, r.width / 2)
    f.y = y === undefined ? 0 : clamp(y - (r.top + r.height / 2), -r.height / 2, r.height / 2)
    f.choice = !!choice
    f.height = (choice ?? host).offsetHeight
    // (A surface takes the wide set of values, whatever its own shape.)
    f.small = choice ? 0 : 1 - smooth(2, 2.4, host.offsetWidth / Math.max(f.height, 1))
    const tune = flashTune(f.small)
    f.level = Math.min(Math.max(f.glow.x, 0) + (choice ? tune.select : 1), tune.stack)
    f.hold = tune.hold
    wake()
    return f
  }
  /** Advances a button's flash; true while it still changes. */
  const stepFlash = (v: GlassView, dt: number, still: boolean) => {
    const f = flashes.get(v)
    if (!f) return false
    if (still) {
      const changed = f.glow.x !== 0
      f.glow.x = f.glow.v = f.spread.x = f.spread.v = f.hold = 0
      return changed
    }
    const lit = f.by !== -1 || f.key || f.hold > 0
    const holding = f.hold > 0
    f.hold = Math.max(0, f.hold - dt)
    const tune = flashTune(f.small)
    const a = stepSpring(f.glow, lit ? f.level : 0, { omega: lit ? tune.riseSpeed : tune.fadeSpeed, zeta: 1 }, dt)
    const b = stepSpring(f.spread, lit || f.glow.x > 0.004 ? 1 : 0, { omega: tune.spreadSpeed, zeta: 1 }, dt)
    // A press held still changes nothing: the loop rests until the hold runs out or the press ends.
    return holding || a || (b && f.glow.x > 0.004)
  }
  /** The flash as a lens's `glow`, for a lens that brings none of its own. (The canvas is scaled with the host: the light is measured on the page, so it is divided by that scale.) */
  const flashOf = (v: GlassView): GlassLens['glow'] => {
    const f = flashes.get(v)
    if (!f || f.glow.x <= 0.004) return undefined
    const tune = flashTune(f.small)
    const k = Math.max(0.5, v.grow ?? 1)
    const far = clamp(f.spread.x)
    const reach = f.choice ? tune.selectReach + tune.selectSpread * far : tune.reach + tune.spread * far
    return { x: f.x / k, y: f.y / k, r: f.height * reach, amount: Math.max(0, f.glow.x) * tune.amount, blob: 1 }
  }

  // Pull (PULL): glass a held pointer drags after itself, where the view asks for it (buttons).
  // One pointer holds one glass, the innermost under the press. The engine moves its host (CSS `translate`) and stretches it (CSS
  // `scale`, times the view's own `grow`), and lets go when the pointer does.
  type Pulled = {
    /** How far the glass has come after the pointer, each way (px). */
    x: Spring
    y: Spring
    /** The pointer that holds it: where it pressed, where it is, and where the glass rested then. */
    by: { id: number; x: number; y: number; nowX: number; nowY: number; cx: number; cy: number; lastX: number; lastY: number; size: number } | null
    /** How fast the glass's own place on the page moves while held (px/s, smoothed). */
    driftX: number
    driftY: number
    /** The host's own CSS `translate` (a centring class), which the pull adds to. */
    own: string[] | null
    /** What the engine last wrote on the host. */
    moved: string
    scaled: string
  }
  const pulls = new Map<GlassView, Pulled>()
  const pulledOf = (v: GlassView) => {
    let p = pulls.get(v)
    if (!p) pulls.set(v, (p = { x: { x: 0, v: 0 }, y: { x: 0, v: 0 }, by: null, driftX: 0, driftY: 0, own: null, moved: '', scaled: '' }))
    return p
  }
  /** The centre of the glass on screen where it rests, without the pull. */
  const restOf = (host: HTMLElement, p: Pulled) => {
    const r = host.getBoundingClientRect()
    return { x: r.left + r.width / 2 - p.x.x, y: r.top + r.height / 2 - p.y.x }
  }
  const letGo = (v: GlassView, p: Pulled) => {
    p.by = null
    v.held = false
  }
  /** Advances a view's pull and writes its host's `translate` and `scale`; true while it still moves. */
  const stepPull = (v: GlassView, dt: number, still: boolean) => {
    const p = pulls.get(v)
    if (!p && v.grow === undefined) return false
    const host = hostOf(v)
    if (!host) return false
    const s = p ?? pulledOf(v)
    if (s.by && (v.pull !== true || !PULL.on)) letGo(v, s)
    let sx = 1
    let sy = 1
    let moving = false
    if (still) {
      s.x.x = s.x.v = s.y.x = s.y.v = s.driftX = s.driftY = 0
    } else if (s.by || s.x.x !== 0 || s.y.x !== 0 || s.x.v !== 0 || s.y.v !== 0 || s.driftX !== 0 || s.driftY !== 0) {
      const w = Math.max(host.offsetWidth, 1)
      const h = Math.max(host.offsetHeight, 1)
      const size = Math.max(w, h)
      const small = size <= PULL.smallUntil
      let tx = 0
      let ty = 0
      const by = s.by
      if (by) {
        const at = restOf(host, s)
        // Small glass: how far the pointer has gone since the press. Larger: how far past the edge it is.
        const dx = small ? by.nowX - by.x - (at.x - by.cx) : by.nowX - clamp(by.nowX, at.x - w / 2, at.x + w / 2)
        const dy = small ? by.nowY - by.y - (at.y - by.cy) : by.nowY - clamp(by.nowY, at.y - h / 2, at.y + h / 2)
        const limit = small ? PULL.smallReach + PULL.smallReachPerPx * size : Math.min(PULL.reachMax, PULL.reach + PULL.reachPerPx * size)
        tx = rubberBand(dx, limit, PULL.resistance)
        ty = rubberBand(dy, limit, PULL.resistance)
        if (dt > 0) {
          s.driftX += ((at.x - by.lastX) / dt - s.driftX) * Math.min(1, dt * PULL.driftIn)
          s.driftY += ((at.y - by.lastY) / dt - s.driftY) * Math.min(1, dt * PULL.driftIn)
        }
        by.lastX = at.x
        by.lastY = at.y
      } else {
        s.driftX = Math.abs(s.driftX) < 1 ? 0 : s.driftX * Math.exp(-dt * PULL.driftOut)
        s.driftY = Math.abs(s.driftY) < 1 ? 0 : s.driftY * Math.exp(-dt * PULL.driftOut)
      }
      const spring = by ? { omega: (2 * Math.PI) / (PULL.follow + PULL.followPerPx * by.size), zeta: 1 } : { omega: (2 * Math.PI) / PULL.release, zeta: 1 - PULL.releaseBounce }
      const mx = stepSpring(s.x, tx, spring, dt)
      const my = stepSpring(s.y, ty, spring, dt)
      const most = small ? PULL.smallStretchMax : PULL.stretchMax
      const along = (pull: Spring, length: number, drift: number) =>
        Math.min(most, (PULL.stretch * Math.abs(pull.x)) / length + PULL.stretchPerSpeed * Math.abs(pull.v) + PULL.stretchPerDrift * Math.abs(drift))
      const kx = along(s.x, w, s.driftX)
      const ky = along(s.y, h, s.driftY)
      sx = (1 + kx) / Math.sqrt(1 + ky)
      sy = (1 + ky) / Math.sqrt(1 + kx)
      moving = !!by || mx || my || s.driftX !== 0 || s.driftY !== 0
    }
    const on = Math.abs(s.x.x) > 0.01 || Math.abs(s.y.x) > 0.01
    const px = `${s.x.x.toFixed(3)}px`
    const py = `${s.y.x.toFixed(3)}px`
    const moved = !on ? '' : s.own ? `calc(${s.own[0]} + ${px}) calc(${s.own[1] ?? '0px'} + ${py})` : `${px} ${py}`
    const grow = v.grow ?? 1
    const even = Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4
    const scaled = even ? (grow === 1 ? '' : grow.toFixed(4)) : `${(grow * sx).toFixed(5)} ${(grow * sy).toFixed(5)}`
    // The frame that brings the host to rest is still drawn: a view that draws the pull itself (see `pulled`) must see it end.
    if (moved !== s.moved || scaled !== s.scaled) moving = true
    if (moved !== s.moved) host.style.translate = s.moved = moved
    if (scaled !== s.scaled) host.style.scale = s.scaled = scaled
    const at = v.pulled ?? (v.pulled = { x: 0, y: 0, sx: 1, sy: 1 })
    at.x = on ? s.x.x : 0
    at.y = on ? s.y.x : 0
    at.sx = even ? 1 : sx
    at.sy = even ? 1 : sy
    return moving
  }

  /** The way the cursor light comes from for a lens (uLightDir, as an angle), and how much the rim leans to it (uLightMix). */
  const aimOf = (m: GlassLens) => {
    const dx = pointer.x - m.screenX
    const dy = pointer.y - m.screenY
    const d = Math.hypot(dx, dy)
    // The light turns in half-degree steps (one step is less than a level of rim light on an
    // 8-bit screen), and stays put while it is off: a cursor moving far away, or over glass
    // without cursor light, leaves the frame as it is.
    const mix = m.cursorLight ? pointer.mix : 0
    const aim = mix > 0 && d > 0.5 ? (Math.round(Math.atan2(dy, dx) * (360 / Math.PI)) * Math.PI) / 360 : -Math.PI / 2
    return { aim, mix }
  }
  /** A glass's light of a press (LIGHT) as its shader takes it (uLight): centre and radius (canvas px, from the lens centre) and how white; null while it is out. */
  const shineOf = (lit: Lit, m: GlassLens): [number, number, number, number] | null => {
    const shine = LIGHT.on && m.pointerLight !== false ? clamp(lit.glow.x) : 0
    if (shine <= 0) return null
    const pageL = 0.2126 * m.surface[0] + 0.7152 * m.surface[1] + 0.0722 * m.surface[2]
    // (A press on a surface beside the control takes the surface's size, not the control's.)
    const side = lit.onBlob && lit.blob ? Math.max(lit.blob.hx, lit.blob.hy) : Math.max(m.hx, m.hy)
    const span = clamp(LIGHT.size * 2 * side, LIGHT.sizeMin, Math.max(LIGHT.sizeMin, LIGHT.sizeMax))
    return [lit.x, lit.y, span, shine * clamp(lerp(LIGHT.strengthDark, LIGHT.strength, smooth(0.25, 0.6, pageL)))]
  }

  // Cohesion (COHESION): buttons near each other melt into one body. On a frame that changes a
  // button, every button on screen is measured as it is (its body on the page, and what its look
  // depends on), and each takes the ones within reach, nearest first, four at most. `nears` holds
  // what its shader is given for them (uNear… in FRAGMENT): NEAR_VALUES numbers (nine vec4) for each.
  type Melt = {
    v: GlassView
    m: GlassLens
    host: Element
    /** Screen px per canvas px, and the lens centre on screen (the canvas's own (cx, cy)). */
    g: number
    sx: number
    sy: number
    /** The body on screen: centre, half size, corner radius and the radius its bend follows (px). */
    x: number
    y: number
    hx: number
    hy: number
    r: number
    fr: number
    /** Its height at rest, and one of its design units, on screen (px). */
    rest: number
    du: number
  }
  const NEAR = 4
  const NEAR_NAMES = Array.from({ length: NEAR }, (_, i) =>
    ['uNear', 'uNearShape', 'uNearTint', 'uNearLine', 'uNearLook', 'uNearShade', 'uNearMirror', 'uNearGlow', 'uNearLight'].map((name) => `${name}[${i}]`),
  )
  const NEAR_PAIR = Array.from({ length: NEAR }, (_, i) => `uNearPair[${i}]`)
  /** Per neighbour: its vec4s, then whether its canvas lies over this one's and how joined the two are. */
  const NEAR_VALUES = NEAR_NAMES[0].length * 4 + 2
  /** How much a lens mirrors of its surroundings (see `mirror` in `draw`): only clear glass does. */
  const mirrorOf = (m: GlassLens) => (m.refraction ? m.strength * Math.max(0, m.tune?.mirror ?? 1) * clamp((1 - m.refraction.frost) / 0.4) : 0)
  /** How far into the glass the mirrored band goes, how far the rim looks, and how soft the picture is (CSS px; see uMirror.z, uReach and uSoft). */
  const mirrorShapeOf = (m: GlassLens) => {
    const reached = m.reflection ? clamp(m.reflection.height * MIRROR.reach, MIRROR.reachMin, Math.max(MIRROR.reachMin, MIRROR.reachMax)) : 0
    const deep = Math.max(0.01, MIRROR.depth) * Math.max(1, Math.min(m.hx, m.hy, reached || Infinity))
    return { deep, reach: mirrorOf(m) > 0 && m.reflection ? reached : 0, soft: Math.max(0, MIRROR.soft) * reached }
  }
  const nears = new Map<GlassView, number[]>()
  /** The buttons that were on screen when they were last measured: one that comes or goes changes its neighbours. */
  let shownButtons = new Set<GlassView>()
  let meltsChanged = false
  const measure = (v: GlassView, m: GlassLens | null | undefined): Melt | null => {
    const host = hostOf(v)
    if (!host || !m || m.width < 2 || m.height < 2) return null
    const g = m.scale && m.scale > 0 ? m.scale : 1
    const radius = Math.max(0, Math.min(m.radius, m.hx - 0.5, m.hy - 0.5))
    const band = m.refraction ? (m.band ?? 0) * m.unit : 0
    return {
      v,
      m,
      host,
      g,
      sx: m.screenX,
      sy: m.screenY,
      x: m.screenX + m.bodyX * g,
      y: m.screenY,
      hx: Math.max(m.hx, 0.5 * m.unit) * g,
      hy: Math.max(m.hy, 0.5 * m.unit) * g,
      r: radius * g,
      fr: Math.min(Math.max(radius, band), Math.max(0, Math.min(m.hx, m.hy) - 0.5)) * g,
      rest: DESIGN_HEIGHT * m.unit * g,
      du: m.unit * g,
    }
  }
  /**
   * What glass `a` takes for its neighbour `b` (see uNear… in FRAGMENT), in a's design units, at
   * bridge softness `k` (screen px), the two `join`ed this much (0 = apart, 1 = one body for the light).
   */
  const nearValues = (a: Melt, b: Melt, k: number, join: number, out: number[]) => {
    const to = 1 / a.du
    const m = b.m
    const r = m.refraction
    const width = m.border ? Math.max(0, m.borderWidth ?? 1) : 0
    const line = m.border ?? m.color
    out.push((b.x - a.sx) * to, (b.y - a.sy) * to, b.hx * to, b.hy * to)
    out.push(b.r * to, b.fr * to, Math.max(k * to, 1e-3), Math.max(m.bevel, 2) * b.du * to)
    out.push(m.color[0], m.color[1], m.color[2], r ? clamp(r.frost) : 0)
    out.push(line[0], line[1], line[2], width > 0 ? clamp(m.borderAlpha ?? 1) : 0)
    out.push((r?.refract ?? 0) * b.du * to, r ? 1 : 0, width * b.g * to, aimOf(m).aim)
    out.push(m.shadow * m.strength, m.shadowSoftness * b.du * to, m.shadowOffset * b.du * to, b.du * to)
    const shapeB = mirrorShapeOf(m)
    const mine = mirrorOf(a.m)
    out.push(shapeB.deep * b.g * to, shapeB.reach * b.g * to, shapeB.soft * b.g * to, mine > 0 ? mirrorOf(m) / mine : 0)
    // Its light of a press, where it is on screen.
    const glow = m.glow ?? flashOf(b.v)
    if (glow) out.push((b.sx + glow.x * b.g - a.sx) * to, (b.sy + glow.y * b.g - a.sy) * to, glow.r * b.g * to, Math.max(0, glow.amount))
    else out.push(0, 0, 1, 0)
    const lit = lights.get(b.v)
    const light = lit ? shineOf(lit, m) : null
    if (light) out.push((b.sx + light[0] * b.g - a.sx) * to, (b.sy + light[1] * b.g - a.sy) * to, light[2] * b.g * to, light[3])
    else out.push(0, 0, 1, 0)
    // Glass later on the page is painted over glass before it.
    out.push(a.host.compareDocumentPosition(b.host) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : 0, join)
  }
  /**
   * Measures every button on screen and works out each one's neighbours. `lensOf` holds the lenses
   * already read this frame; any other is read now. Returns the views whose neighbours (as their
   * shaders take them) changed, and those whose `near` changed, which must paint what lies behind again.
   */
  const cohere = (lensOf: Map<GlassView, GlassLens | null>) => {
    const pool: Melt[] = []
    const showing = new Set<GlassView>()
    for (const v of views) {
      if (v.button !== true || !v.visible) continue
      showing.add(v)
      let m = lensOf.get(v)
      if (m === undefined) lensOf.set(v, (m = v.lens(false)))
      const at = measure(v, m)
      if (at) pool.push(at)
    }
    shownButtons = showing
    const changed = new Set<GlassView>()
    const regrouped = new Set<GlassView>()
    const melted = new Set<GlassView>()
    for (const a of pool) {
      const found: { b: Melt; gap: number; k: number; join: number }[] = []
      for (const b of pool) {
        if (b === a || a.host.contains(b.host) || b.host.contains(a.host)) continue
        const soft = cohesionSoftness(Math.min(a.rest, b.rest))
        if (soft <= 0) continue
        const gap = Math.max(Math.abs(b.x - a.x) - a.hx - b.hx, Math.abs(b.y - a.y) - a.hy - b.hy)
        // The bridge eases in as they near each other: none at `soft` apart, all of it at half that.
        const k = soft * (1 - smooth(0.5, 1, gap / soft))
        // Joined from the moment the bridge forms (half of `soft` apart), fully once it has some body
        // (a quarter of `soft` apart); for the light, by as much as COHESION.light lets it run on.
        if (k > 0.05) found.push({ b, gap, k, join: (1 - smooth(soft / 4, soft / 2, gap)) * clamp(COHESION.light) })
      }
      found.sort((p, q) => p.gap - q.gap)
      const values: number[] = []
      const hosts: Element[] = []
      for (const { b, k, join } of found.slice(0, NEAR)) {
        nearValues(a, b, k, join, values)
        hosts.push(b.host)
      }
      const was = nears.get(a.v)
      if ((was?.length ?? 0) !== values.length || values.some((x, i) => x !== was![i])) changed.add(a.v)
      if (values.length) {
        nears.set(a.v, values)
        melted.add(a.v)
      } else nears.delete(a.v)
      const before = a.v.near ?? []
      if (before.length !== hosts.length || hosts.some((h) => !before.includes(h))) {
        a.v.near = hosts.length ? hosts : undefined
        regrouped.add(a.v)
      }
    }
    // A button that has left the screen (or the page) melts into nothing any more.
    for (const v of [...nears.keys()]) {
      if (melted.has(v)) continue
      nears.delete(v)
      changed.add(v)
    }
    return { changed, regrouped }
  }

  const draw = (v: GlassView, refresh: boolean, repaint: boolean, read?: GlassLens | null) => {
    const m = read !== undefined ? read : v.lens(refresh)
    let on = shown.get(v)
    if (!on) shown.set(v, (on = { sent: [], box: '' }))
    if (!m || m.width < 2 || m.height < 2) {
      v.ctx.clearRect(0, 0, v.canvas.width, v.canvas.height)
      on.sent.length = 0
      return
    }
    // The canvas's box is written only when it changes.
    const box = `${m.left}|${m.top}|${m.width}|${m.height}`
    if (box !== on.box) {
      on.box = box
      const st = v.canvas.style
      st.left = `${m.left}px`
      st.top = `${m.top}px`
      st.width = `${m.width}px`
      st.height = `${m.height}px`
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const devW = Math.max(2, Math.round(m.width * dpr))
    const devH = Math.max(2, Math.round(m.height * dpr))
    if (v.canvas.width !== devW || v.canvas.height !== devH) {
      v.canvas.width = devW
      v.canvas.height = devH
      on.sent.length = 0
    }

    // Nothing is asked of the GPU until this frame is known to differ from the one on the canvas:
    // the layers are painted here, on plain 2D canvases, and put into their textures at the end.
    const unit = m.unit
    const r = m.refraction
    /** The layers are the ones this view was last drawn with. */
    let fresh = true
    let p: Painted | undefined
    /** The layers painted on this frame, to upload. */
    let layers: Layers | undefined
    // A painter that takes only `back` has no front layer: none is cleared or uploaded.
    const fronted = !!r && r.paint.length > 1
    const skip = backSkipOf(m, dpr)
    if (r) {
      p = painted.get(v)
      if (!p) painted.set(v, (p = { back: { tex: null, w: 0, h: 0 }, front: { tex: null, w: 0, h: 0 }, w: 0, h: 0, skip: 0, at: 0 }))
      const now = performance.now()
      const sized = p.w === devW && p.h === devH && p.skip === skip
      fresh = !repaint && sized && now - p.at < REPAINT_EVERY
      if (!fresh) {
        // The page's picture, smaller where the frost never reads it at full size (BACK_SKIP),
        // and fitted to its canvas, so that it covers the glass's canvas exactly as before.
        const bw = skip ? Math.max(2, Math.ceil(devW / 2 ** skip)) : devW
        const bh = skip ? Math.max(2, Math.ceil(devH / 2 ** skip)) : devH
        const l = layersFor(bw, bh, fronted ? devW : 0, fronted ? devH : 0)
        l.back.ctx!.setTransform(1, 0, 0, 1, 0, 0)
        l.back.ctx!.clearRect(0, 0, bw, bh)
        if (skip) l.back.ctx!.setTransform(bw / m.width, 0, 0, bh / m.height, 0, 0)
        else l.back.ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
        if (fronted && l.front) {
          l.front.ctx!.setTransform(1, 0, 0, 1, 0, 0)
          l.front.ctx!.clearRect(0, 0, devW, devH)
          l.front.ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
        }
        // A painter that says nothing changed keeps the textures it already has.
        fresh = r.paint(l.back.ctx!, (l.front ?? front).ctx!) === false && sized
        if (!fresh) {
          layers = l
          p.w = devW
          p.h = devH
          p.skip = skip
          p.at = now
        }
      }
    }
    sent.length = names.length = sizes.length = 0
    // The surroundings, for the reflection. The picture is taken when it is first needed, and
    // again when sizes and colours are re-read or the canvas changes size, AROUND_EVERY apart at
    // most (a change that comes sooner waits its turn). A scroll takes none: what surrounds the
    // glass rides along. Until then the picture stays where it was taken, even if the canvas has
    // moved since.
    // Only clear glass mirrors: in full while its own colour covers it no more than a clear
    // button's tint does (0.6), less as the cover grows, and not at all once the glass is its
    // own colour (tinted glass, a lens frosted over at rest, a control painted in its fill).
    // Unlit glass mirrors nothing either. Glass that mirrors nothing takes no picture.
    const clear = r ? clamp((1 - r.frost) / 0.4) : 0
    const mirror = m.strength * Math.max(0, m.tune?.mirror ?? 1) * clear
    const f = mirror > 0 ? m.reflection : undefined
    if (refresh && m.reflection && !f) {
      const idle = mirrored.get(v)
      if (idle) idle.due = true
    }
    /** A picture of the surroundings taken on this frame, to upload. */
    let picture: Mirrored | undefined
    if (f) {
      let a = mirrored.get(v)
      if (!a) mirrored.set(v, (a = { pic: { tex: null, w: 0, h: 0 }, w: 0, h: 0, at: 0, left: 0, top: 0, reach: 0, due: true, timer: 0, busy: false }))
      const taken = a
      const reach = clamp(f.height * MIRROR.reach, MIRROR.reachMin, Math.max(MIRROR.reachMin, MIRROR.reachMax))
      const aw = Math.max(2, Math.ceil((m.width + 2 * reach) * AROUND_SCALE))
      const ah = Math.max(2, Math.ceil((m.height + 2 * reach) * AROUND_SCALE))
      const now = performance.now()
      if (refresh || (f.live && repaint) || a.w !== aw || a.h !== ah || a.reach !== reach) a.due = true
      if (a.due && a.w && busy && !f.live && now - a.at < AROUND_WAIT) {
        // It waits for all to be still (see AROUND_WAIT): the picture it has is kept meanwhile.
        a.busy = true
      } else if (a.due && a.w && now - a.at < AROUND_EVERY) {
        if (!a.timer)
          a.timer = window.setTimeout(
            () => {
              taken.timer = 0
              if (mirrored.get(v) !== taken) return
              v.repaint = true
              wake()
            },
            AROUND_EVERY - (now - a.at),
          )
      } else if (a.due) {
        a.due = false
        if (around.canvas.width !== aw || around.canvas.height !== ah) {
          around.canvas.width = aw
          around.canvas.height = ah
        }
        const c = around.ctx!
        c.setTransform(1, 0, 0, 1, 0, 0)
        c.clearRect(0, 0, aw, ah)
        c.setTransform(AROUND_SCALE, 0, 0, AROUND_SCALE, reach * AROUND_SCALE, reach * AROUND_SCALE)
        f.paint(c, reach)
        picture = a
        a.w = aw
        a.h = ah
        a.at = now
        a.left = m.left
        a.top = m.top
        a.reach = reach
        pictured.push(a)
        fresh = false
      }
      set('uAroundBox', (a.left - m.left - a.reach) / unit, (a.top - m.top - a.reach) / unit, a.w / AROUND_SCALE / unit, a.h / AROUND_SCALE / unit)
      set('uAroundScale', AROUND_SCALE * unit)
      set('uReach', reach / unit)
    } else {
      set('uAroundBox', 0, 0, 1, 1)
      set('uAroundScale', 1)
      set('uReach', 0)
    }
    set('uTextured', r ? 1 : 0)
    set('uRefract', r?.refract ?? 0)
    set('uMag', r?.magnify ?? 0)
    set('uDisp', r?.dispersion ?? 0)
    set('uBlurCenter', r?.blurCenter ?? 0)
    set('uBlurEdge', r?.blurEdge ?? 0)
    // Blur level follows screen density (reference: 2.27 device px per design unit).
    set('uBlurShift', Math.log2(Math.max((unit * dpr) / 2.27, 1e-3)))
    set('uFrost', r?.frost ?? 0)
    set('uBackSkip', skip)
    set('uFrostBlur', Math.max(0, r?.blur ?? 0) / unit)
    set('uFrostMix', clamp(r?.blurMix ?? 1))
    // Radial bend: a share of the viewport per axis, as the SVG card's map was.
    const radial = Math.max(0, r?.radial ?? 0)
    set('uRadial', (radial * window.innerWidth) / unit, (radial * window.innerHeight) / unit)
    set('uCssPx', 1 / unit)
    set('uSize', devW, devH)
    set('uUnit', unit * dpr)
    set('uDevicePx', 1 / (unit * dpr))
    set('uCenter', m.cx / unit, m.cy / unit)
    set('uHalf', Math.max(m.hx / unit, 0.5), Math.max(m.hy / unit, 0.5))
    const radius = Math.max(0, Math.min(m.radius, m.hx - 0.5, m.hy - 0.5) / unit)
    set('uRadius', radius)
    const band = r ? (m.band ?? 0) : 0
    set('uBand', band)
    set('uFieldRadius', Math.min(Math.max(radius, band), Math.max(0, (Math.min(m.hx, m.hy) - 0.5) / unit)))
    set('uBodyX', m.bodyX / unit)
    set('uDrop', (m.droplet?.x ?? 0) / unit, (m.droplet?.r ?? 0) / unit, (m.droplet?.k ?? 0) / unit)
    const drops = m.droplets
    const dropCount = drops ? Math.min(DROP_NAMES.length, drops.length) : 0
    set('uDropCount', dropCount)
    for (let i = 0; i < dropCount; i++) set(DROP_NAMES[i], drops![i].x / unit, drops![i].y / unit, drops![i].r / unit, drops![i].k / unit)
    const blob = m.blob
    set('uBlob', (blob?.x ?? 0) / unit, (blob?.y ?? 0) / unit, (blob?.hx ?? 0) / unit, (blob?.hy ?? 0) / unit)
    set('uBlobShape', (blob?.r ?? 0) / unit, (blob?.k ?? 0) / unit)
    set('uBlobNeck', (blob?.neck?.x ?? 0) / unit, (blob?.neck?.w ?? 0) / unit)
    set('uBlobFade', blob?.fade?.amount ?? 0, blob?.fade?.reach ?? 0.5)
    const mat = blob?.material
    set('uBlobMat', clamp(mat?.frost ?? 0), Math.max(0, mat?.blur ?? 0) / unit, Math.max(0.05, mat?.bendCurve ?? 1.6), 0.35 * Math.max(0.05, mat?.bendDepth ?? 1))
    set('uBlobLine', Math.max(0, mat?.borderWidth ?? 0) / unit, clamp(mat?.borderAlpha ?? 0), mat ? 1 : 0)
    set('uBevel', Math.max(m.bevel, 2))
    const k = m.tune ?? {}
    set('uRim', 0.55 * m.strength * (k.rim ?? 1))
    set('uCaustic', 0.08 * m.strength * (k.caustic ?? 1))
    set('uInner', 0.1 * m.strength * (k.inner ?? 1))
    set('uTopRefl', 0.3 * m.strength * (k.reflection ?? 1))
    set('uTopBase', 0.02 * m.strength * (k.reflection ?? 1))
    set('uRimWidth', Math.max(0.05, k.rimWidth ?? 1))
    set('uFresnel', 0.02 * (k.fresnel ?? 1))
    // The band is as deep as a share of the glass's shorter half, and of its reach on glass taller than that.
    const reached = m.reflection ? clamp(m.reflection.height * MIRROR.reach, MIRROR.reachMin, Math.max(MIRROR.reachMin, MIRROR.reachMax)) : 0
    const deep = (Math.max(0.01, MIRROR.depth) * Math.max(1, Math.min(m.hx, m.hy, reached || Infinity))) / unit
    set('uMirror', clamp(MIRROR.line) * mirror, MIRROR.band * mirror, deep, clamp(MIRROR.dim))
    set('uSoft', (Math.max(0, MIRROR.soft) * reached) / unit)
    const shares = Math.max(MIRROR.near + MIRROR.mid + MIRROR.far, 1e-3)
    set('uSeen', MIRROR.near / shares, MIRROR.mid / shares, MIRROR.far / shares, Math.max(0, MIRROR.gain))
    // The far side of the rim light takes the surroundings' colour on clear glass only.
    set('uBounce', Math.max(0, MIRROR.bounce), clamp(MIRROR.tint) * clear)
    set('uFall', Math.max(0.05, MIRROR.fall))
    set('uBendCurve', Math.max(0.05, k.bendCurve ?? 1.6))
    set('uEdgeBand', 0.35 * Math.max(0.05, k.bendDepth ?? 1))
    set('uSaturation', Math.max(0, k.saturation ?? 1))
    set('uFrostEdge', Math.max(0.05, k.frostEdge ?? 1))
    set('uShadow', m.shadow * m.strength)
    set('uShadowSoft', m.shadowSoftness)
    set('uShadowOffset', m.shadowOffset)
    set('uShadowFlush', m.shadowFlush ? 1 : 0)
    set('uSurface', ...m.surface)
    set('uColor', ...m.color)
    set('uEdgeClear', m.edgeClear)
    set('uBorder', ...(m.border ?? m.color))
    // Under an outline the border line is as much wider as the outline covers of it.
    const outlined = m.outline && m.outline.alpha > 0 ? Math.max(0, m.outline.width) : 0
    set('uBorderWidth', m.border ? (Math.max(0, m.borderWidth ?? 1) + outlined) / unit : 0)
    set('uOutline', ...(m.outline?.color ?? m.color), outlined ? clamp(m.outline!.alpha) : 0)
    set('uOutlineWidth', outlined / unit)
    set('uBorderAlpha', clamp(m.borderAlpha ?? 1))
    const { aim, mix: lightMix } = aimOf(m)
    set('uLightDir', Math.cos(aim), Math.sin(aim))
    set('uLightMix', lightMix)
    const glow = m.glow ?? flashOf(v)
    set('uGlow', (glow?.x ?? 0) / unit, (glow?.y ?? 0) / unit, (glow?.r ?? 0) / unit, Math.max(0, glow?.amount ?? 0))
    set('uGlowHalo', glow?.halo ? (glow.halo.around === 'blob' && blob ? 2 : 1) : 0, clamp(glow?.halo?.amount ?? 0))
    set('uGlowBlob', clamp(glow?.blob ?? 1))
    // Pointer light: what the pointer is doing to this glass is worked out here, where the
    // glass's place on screen is fresh; the light itself is advanced once a frame (stepLight).
    let lit = lights.get(v)
    // A glass that continues another takes that one's light (see `lightOf`), measured from here.
    const shared = m.lightOf && m.lightOf !== v ? lights.get(m.lightOf) : undefined
    if (shared) {
      lit = { ...shared, x: shared.x + shared.sx - shared.bodyX - m.screenX, y: shared.y + shared.sy - m.screenY }
    } else if (LIGHT.on && m.pointerLight !== false) {
      if (!lit) {
        const host = hostOf(v)
        lit = { glow: { x: 0, v: 0 }, x: 0, y: 0, press: false, key: false, free: !!host && getComputedStyle(host).pointerEvents === 'none', sx: 0, sy: 0, hx: 0, hy: 0, bodyX: 0, blob: null, onBlob: false }
        lights.set(v, lit)
      }
      lit.sx = m.screenX + m.bodyX
      lit.sy = m.screenY
      lit.hx = m.hx
      lit.hy = m.hy
      lit.bodyX = m.bodyX
      lit.blob = blob ? { x: blob.x, y: blob.y, hx: blob.hx, hy: blob.hy } : null
      // A held pointer lights the glass it is on, or comes onto (a lens arriving under it), until it lets go.
      // The light stays at the point of the glass it began at: it does not follow the pointer.
      const press = lit.press || (beam.id !== -1 && under(v, lit) && innermost(v))
      if (press !== lit.press) {
        relit = true
        if (press) {
          lit.x = beam.x - m.screenX
          lit.y = beam.y - m.screenY
          lit.onBlob = onBlob(lit) && (Math.abs(beam.x - lit.sx) > lit.hx || Math.abs(beam.y - lit.sy) > lit.hy)
        }
      }
      lit.press = press
    }
    const light = lit ? shineOf(lit, m) : null
    if (light) set('uLight', light[0] / unit, light[1] / unit, light[2] / unit, light[3])
    else set('uLight', 0, 0, 1, 0)
    // The glass it melts into (COHESION), as its shader takes them (see uNear in FRAGMENT).
    const near = v.button === true && COHESION.on ? nears.get(v) : undefined
    const count = near ? Math.min(NEAR, near.length / NEAR_VALUES) : 0
    set('uNearCount', count)
    if (count) set('uNearFade', Math.max(0.01, COHESION.lightFade))
    for (let i = 0; i < count; i++) {
      const names = NEAR_NAMES[i]
      for (let j = 0; j < names.length; j++) {
        const at = i * NEAR_VALUES + j * 4
        set(names[j], near![at], near![at + 1], near![at + 2], near![at + 3])
      }
      set(NEAR_PAIR[i], near![i * NEAR_VALUES + NEAR_VALUES - 2], near![i * NEAR_VALUES + NEAR_VALUES - 1])
    }
    // The same layers and the same uniforms as the frame on the canvas: nothing to draw.
    if (fresh && on.sent.length === sent.length && sent.every((value, i) => value === on.sent[i])) return
    on.sent = sent.slice()
    // The shared GL canvas only grows; each view is drawn into its bottom-left corner.
    if (glCanvas.width < devW || glCanvas.height < devH) {
      glCanvas.width = Math.max(glCanvas.width, devW)
      glCanvas.height = Math.max(glCanvas.height, devH)
    }
    gl.viewport(0, 0, devW, devH)
    // What lies beneath, what rides on top and what surrounds the glass: the pictures taken on
    // this frame are uploaded, the others are the ones this view already has.
    gl.activeTexture(gl.TEXTURE0)
    if (p && layers) upload(p.back, layers.back.canvas, true)
    else gl.bindTexture(gl.TEXTURE_2D, p?.back.tex ?? blank.back)
    gl.activeTexture(gl.TEXTURE1)
    if (p && layers?.front && fronted) upload(p.front, layers.front.canvas, false)
    else gl.bindTexture(gl.TEXTURE_2D, (fronted && p?.front.tex) || blank.front)
    gl.activeTexture(gl.TEXTURE2)
    if (picture) upload(picture.pic, around.canvas, true)
    else gl.bindTexture(gl.TEXTURE_2D, (f && mirrored.get(v)?.pic.tex) || blank.back)
    send()
    // The frost's own pass (FROST_PASS): on large, softly frosted glass the frost is drawn first,
    // into a smaller picture that the glass then reads.
    const sigma = r && !blob?.material ? Math.max(0, r.blur ?? 0) * Math.min(1, Math.max(0.05, k.frostEdge ?? 1)) * dpr : 0
    const texel = sigma >= FROST_PASS.sigma && 4 * m.hx * m.hy * dpr * dpr >= FROST_PASS.area ? Math.min(FROST_PASS.most, Math.floor(sigma / FROST_PASS.texel)) : 0
    const fw = texel >= 2 ? Math.ceil(devW / texel) + 1 : 0
    const fh = texel >= 2 ? Math.ceil(devH / texel) + 1 : 0
    if (texel >= 2 && frostRoom(fw, fh)) {
      const sx = 1 / (texel * frostPic.w)
      const sy = 1 / (texel * frostPic.h)
      // The picture is not bound while it is drawn into.
      gl.activeTexture(gl.TEXTURE3)
      gl.bindTexture(gl.TEXTURE_2D, blank.front)
      gl.bindFramebuffer(gl.FRAMEBUFFER, frostPic.fbo)
      // Nothing of what it held is kept: a GPU that draws in tiles need not load it back.
      gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.COLOR_ATTACHMENT0])
      gl.viewport(0, 0, fw, fh)
      gl.uniform4f(frostPassAt, 1, texel, sx, sy)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, devW, devH)
      gl.bindTexture(gl.TEXTURE_2D, frostPic.tex)
      gl.uniform4f(frostPassAt, 2, texel, sx, sy)
      frostPassHeld = 2
    } else if (frostPassHeld) {
      gl.uniform4f(frostPassAt, 0, 1, 0, 0)
      frostPassHeld = 0
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    v.ctx.clearRect(0, 0, devW, devH)
    v.ctx.drawImage(glCanvas, 0, glCanvas.height - devH, devW, devH, 0, 0, devW, devH)
    v.drawn?.()
  }

  let raf = 0
  let last = 0
  const frame = (now: number) => {
    raf = 0
    if (dead) return
    const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60
    last = now
    const still = reduced.matches
    const target = pointer.active && !still ? 1 : 0
    const before = pointer.mix
    pointer.mix += (target - pointer.mix) * Math.min(1, dt * 6)
    if (Math.abs(pointer.mix - target) < 0.002) pointer.mix = target
    const relight = pointer.moved || pointer.mix !== before
    pointer.moved = false
    let running = pointer.mix !== target
    busy = ranLast || running
    // Buttons melt into each other (COHESION): they are drawn after the rest, once every one has
    // been measured, so each melts into the others as they are on this frame.
    const melting = COHESION.on
    if (!melting && nears.size) {
      for (const v of nears.keys()) {
        v.near = undefined
        v.dirty = true
      }
      nears.clear()
    }
    const due: { v: GlassView; refresh: boolean; repaint: boolean }[] = []
    let regroup = meltsChanged
    meltsChanged = false
    for (const v of views) {
      const stepped = v.step(dt, still)
      // After the view's own springs: its `grow` is this frame's.
      const pulled = stepPull(v, dt, still)
      const moving = stepped || pulled
      // (Both lights of a press: what a surface takes, and a button's flash.)
      const lit = stepLight(v, dt, still)
      const flashing = stepFlash(v, dt, still)
      const glowing = lit || flashing
      if (moving || glowing) running = busy = true
      const melts = melting && v.button === true
      if (melts && v.visible !== shownButtons.has(v)) regroup = true
      if (!v.visible) continue
      const again = v.repaint === true
      if (moving || glowing || v.dirty || again || relight) {
        const refresh = v.dirty
        v.dirty = false
        v.repaint = false
        // Only the light moved: the layers are as they were, so they are not painted again.
        if (melts) due.push({ v, refresh, repaint: moving || refresh || again })
        else draw(v, refresh, moving || refresh || again)
      }
    }
    if (melting && (due.length || regroup)) {
      const lensOf = new Map<GlassView, GlassLens | null>()
      for (const d of due) lensOf.set(d.v, d.v.lens(d.refresh))
      const { changed, regrouped } = cohere(lensOf)
      // A button whose neighbours moved is drawn again too; one that melts into other glass now (or
      // no longer) paints what lies behind it again, leaving that glass out (or taking it back in).
      for (const d of due) draw(d.v, d.refresh, d.repaint || regrouped.has(d.v), lensOf.get(d.v))
      for (const v of changed) if (v.visible && !due.some((d) => d.v === v)) draw(v, false, regrouped.has(v), lensOf.get(v))
    }
    // A view may have woken the engine during this frame (a popup that has just gone back in
    // does): the next frame is then already asked for, and asking again would start a second
    // loop beside this one, for as long as anything on the page moves.
    // A draw found the pointer on (or off) some glass: its light starts on the next frame.
    if (relit) running = true
    relit = false
    // Pictures of the surroundings that waited while something moved or was lit (or were taken
    // then, having waited as long as they may) are taken once all is still, at once: the glass
    // that takes one is drawn again on the next frame.
    if (running) for (const a of pictured) a.busy = true
    pictured.length = 0
    ranLast = running
    if (running) wake()
    else {
      if (!raf) last = 0
      let again = false
      for (const [v, a] of mirrored) {
        if (!a.busy) continue
        a.busy = false
        a.due = true
        a.at = 0
        v.repaint = true
        again = true
      }
      if (again) wake()
    }
  }
  const wake = () => {
    if (!raf && !dead) raf = requestAnimationFrame(frame)
  }
  const invalidateAll = () => {
    for (const v of views) v.dirty = true
    wake()
  }

  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse') return
      pointer.x = e.clientX
      pointer.y = e.clientY
      pointer.active = true
      pointer.moved = true
      wake()
    },
    { passive: true },
  )
  document.documentElement.addEventListener('pointerleave', () => {
    pointer.active = false
    pointer.moved = true
    wake()
  })
  // Pull (PULL): a press holds the innermost glass under it that asks to be pulled, and it is
  // followed over the whole window until it lets go.
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!PULL.on || e.button !== 0 || reduced.matches || !(e.target instanceof Node) || HANDED_ON.has(e)) return
      let held: GlassView | null = null
      let heldHost: HTMLElement | null = null
      for (const v of views) {
        const host = hostOf(v)
        if (v.pull !== true || !host || !host.contains(e.target) || host.matches(':disabled, [data-disabled], [aria-disabled="true"]')) continue
        if (pulls.get(v)?.by) return
        if (!heldHost || heldHost.contains(host)) {
          held = v
          heldHost = host
        }
      }
      if (!held || !heldHost) return
      const p = pulledOf(held)
      // The host's own translate is read while the pull's is off it.
      if (!p.moved) {
        const own = getComputedStyle(heldHost).translate
        p.own = !own || own === 'none' ? null : own.split(' ')
      }
      const at = restOf(heldHost, p)
      p.by = { id: e.pointerId, x: e.clientX, y: e.clientY, nowX: e.clientX, nowY: e.clientY, cx: at.x, cy: at.y, lastX: at.x, lastY: at.y, size: Math.max(heldHost.offsetWidth, heldHost.offsetHeight) }
      p.driftX = p.driftY = 0
      held.held = true
      wake()
    },
    { passive: true, capture: true },
  )
  window.addEventListener(
    'pointermove',
    (e) => {
      for (const p of pulls.values()) {
        if (p.by?.id !== e.pointerId) continue
        p.by.nowX = e.clientX
        p.by.nowY = e.clientY
        wake()
      }
    },
    { passive: true, capture: true },
  )
  const unhold = (e: PointerEvent) => {
    for (const [v, p] of pulls) {
      if (p.by?.id !== e.pointerId) continue
      letGo(v, p)
      wake()
    }
  }
  window.addEventListener('pointerup', unhold, { passive: true, capture: true })
  window.addEventListener('pointercancel', unhold, { passive: true, capture: true })
  // Pointer light (LIGHT): where the lighting pointer is, what it is over and whether it is held.
  // Which glass that lights is decided when each glass is drawn, so every change asks for a frame.
  const lightMoved = () => {
    pointer.moved = true
    wake()
  }
  window.addEventListener(
    'pointermove',
    (e) => {
      // Only the held pointer counts (a lens may come under it): one that moves over the page without pressing asks for nothing.
      if (!LIGHT.on || e.pointerId !== beam.id) return
      beam.x = e.clientX
      beam.y = e.clientY
      beam.over = e.target
      lightMoved()
    },
    { passive: true, capture: true },
  )
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!LIGHT.on || e.button !== 0 || HANDED_ON.has(e)) return
      beam.x = e.clientX
      beam.y = e.clientY
      beam.over = e.target
      beam.id = e.pointerId
      lightMoved()
    },
    { passive: true, capture: true },
  )
  const lift = (e: PointerEvent) => {
    if (e.pointerId !== beam.id) return
    beam.id = -1
    for (const s of lights.values()) s.press = false
    lightMoved()
  }
  window.addEventListener('pointerup', lift, { passive: true, capture: true })
  window.addEventListener('pointercancel', lift, { passive: true, capture: true })
  // A button's flash (GLOW): a press lights the innermost button under it where it lands, and
  // holds it until that pointer lets go; Space or Enter lights the focused button's centre.
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || HANDED_ON.has(e) || !(e.target instanceof Node)) return
      // A choice pressed inside a surface lights that surface around it.
      const choice = e.target instanceof Element ? e.target.closest<HTMLElement>(CHOICES) : null
      const chosen = choice && !choice.matches('[data-disabled], [aria-disabled="true"]') ? choice : null
      let hit: GlassView | null = null
      let hitHost: HTMLElement | null = null
      for (const v of views) {
        const host = hostOf(v)
        if (!host || host.matches(':disabled, [data-disabled], [aria-disabled="true"]')) continue
        if (v.button === true ? !(v.pressArea ?? host).contains(e.target) : !chosen || v.choices === false || !v.visible || !host.contains(chosen)) continue
        if (!hitHost || hitHost.contains(host)) {
          hit = v
          hitHost = host
        }
      }
      const f = hit && flash(hit, e.clientX, e.clientY, hit.button === true ? undefined : (chosen ?? undefined))
      if (f) f.by = e.pointerId
    },
    { passive: true, capture: true },
  )
  const unflash = (e: PointerEvent) => {
    for (const f of flashes.values()) {
      if (f.by !== e.pointerId) continue
      f.by = -1
      wake()
    }
  }
  window.addEventListener('pointerup', unflash, { passive: true, capture: true })
  window.addEventListener('pointercancel', unflash, { passive: true, capture: true })
  const flashKey = (e: KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    const down = e.type === 'keydown'
    if (down && e.repeat) return
    if (!down) {
      for (const f of flashes.values()) f.key = false
      return wake()
    }
    const focused = document.activeElement
    if (!focused) return
    // On a surface, the key chooses the focused choice: the light starts at its middle.
    const choice = focused.closest<HTMLElement>(CHOICES)
    const chosen = choice && !choice.matches('[data-disabled], [aria-disabled="true"]') ? choice : null
    let surface: GlassView | null = null
    let surfaceHost: HTMLElement | null = null
    for (const v of views) {
      const host = hostOf(v)
      if (!host || host.matches(':disabled, [data-disabled], [aria-disabled="true"]')) continue
      if (v.button === true) {
        if (!focused.contains(v.canvas)) continue
        const f = flash(v)
        if (f) f.key = true
      } else if (chosen && v.choices !== false && v.visible && host.contains(chosen) && (!surfaceHost || surfaceHost.contains(host))) {
        surface = v
        surfaceHost = host
      }
    }
    if (surface && chosen) {
      const r = chosen.getBoundingClientRect()
      const f = flash(surface, r.left + r.width / 2, r.top + r.height / 2, chosen)
      if (f) f.key = true
    }
    wake()
  }
  window.addEventListener('keydown', flashKey, true)
  window.addEventListener('keyup', flashKey, true)
  window.addEventListener(
    'focusout',
    () => {
      for (const f of flashes.values()) f.key = false
      wake()
    },
    true,
  )
  // Space or Enter on the focused control lights the middle of its glass while the key is down.
  const key = (e: KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    const down = e.type === 'keydown'
    if (down && (!LIGHT.on || e.repeat)) return
    const focused = document.activeElement
    for (const [v, s] of lights) {
      const held = down && !s.free && !!focused && focused.contains(v.canvas)
      if (held && !s.key && !s.press) {
        s.x = s.bodyX
        s.y = 0
      }
      s.key = held
    }
    wake()
  }
  window.addEventListener('keydown', key, true)
  window.addEventListener('keyup', key, true)
  window.addEventListener(
    'focusout',
    () => {
      for (const s of lights.values()) s.key = false
      wake()
    },
    true,
  )
  // Theme switches (class="dark", data-theme, color-scheme) re-read every colour.
  new MutationObserver(invalidateAll).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'style'],
  })
  new MutationObserver(invalidateAll).observe(document.body, { attributes: true, attributeFilter: ['data-theme'], subtree: true })
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', invalidateAll)
  // A radial bend scales with the viewport.
  window.addEventListener('resize', invalidateAll, { passive: true })
  glCanvas.addEventListener('webglcontextlost', () => {
    dead = true
    for (const v of views) {
      v.lost()
      v.ctx.clearRect(0, 0, v.canvas.width, v.canvas.height)
    }
    // No frame comes after this: the hosts get back what the engine wrote on them.
    for (const [v, p] of pulls) {
      const host = hostOf(v)
      v.held = false
      if (host && p.moved) host.style.translate = ''
      if (host && p.scaled) host.style.scale = ''
    }
    pulls.clear()
    engine = undefined
  })

  return {
    add: (v) => {
      views.add(v)
      meltsChanged = true
      wake()
    },
    remove: (v) => {
      views.delete(v)
      lights.delete(v)
      flashes.delete(v)
      // The glass that melted into it lets go.
      if (v.button === true) {
        meltsChanged = true
        wake()
      }
      nears.delete(v)
      shownButtons.delete(v)
      v.near = undefined
      const pulled = pulls.get(v)
      if (pulled) {
        pulls.delete(v)
        v.held = false
        const host = hostOf(v)
        if (host && pulled.moved) host.style.translate = ''
        if (host && pulled.scaled) host.style.scale = ''
      }
      const a = mirrored.get(v)
      if (a) {
        mirrored.delete(v)
        clearTimeout(a.timer)
        gl.deleteTexture(a.pic.tex)
      }
      const p = painted.get(v)
      if (!p) return
      painted.delete(v)
      gl.deleteTexture(p.back.tex)
      gl.deleteTexture(p.front.tex)
    },
    wake,
    resolveColor,
  }
}

let engine: GlassEngine | null | undefined

/** The shared engine (created on first use, client only). `null` = no WebGL2: use the CSS look. */
export function getGlassEngine(): GlassEngine | null {
  if (typeof window === 'undefined') return null
  if (engine === undefined) engine = createEngine()
  return engine
}
