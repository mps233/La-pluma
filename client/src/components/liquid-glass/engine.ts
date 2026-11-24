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
// drawn, and neither is a frame that would come out exactly as the one on the canvas.
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
  /** Lens centre on screen, for aiming the cursor light. */
  screenX: number
  screenY: number
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
 * A press lets light into the glass where it lands. The light paints nothing: it brightens what
 * is already there, keeping its colour (luminance L becomes L^(1 / (1 + amount)) at the centre,
 * so black stays black and white stays white). Used by GlassPopup (`glass-popup.tsx`). These are
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
  halo: 1,
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
  band: 0.45,
  /**
   * How deep that band goes: this × the glass's shorter half (or its reach, on taller glass).
   * The rim's edge looks `reach` far; the look shortens with depth and ends here, so a
   * neighbour's picture fills the band where it is near and thins out where the rim turns
   * away from it: a crescent on a round glass.
   */
  depth: 1.1,
  /** How fast the picture fades from the rim inwards, an exponent (1 = evenly, higher = it keeps closer to the rim). */
  fall: 2,
  /** How soft the picture is: the patch each point gathers, × the reach (0 = a sharp mirror). */
  soft: 0.3,
  /** How much more than its plain difference from the surface a neighbour counts. */
  gain: 1.2,
  /** How much a darker neighbour dims the rim (× the above; 0 = not at all). */
  dim: 0.6,
  /** How far the rim's edge looks: this × the glass's height, between `reachMin` and `reachMax` px. */
  reach: 0.75,
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

/** Every spring the kit uses. Hover width/height bounce out of phase: the glass wobbles like a drop. */
export const SPRINGS = {
  press: { omega: 16, zeta: 0.6 },
  hoverX: { omega: 17, zeta: 0.42 },
  hoverY: { omega: 12, zeta: 0.34 },
  /** A droplet separating from the body: slow, one small overshoot. */
  dropletOut: { omega: 5, zeta: 0.72 },
  /** The droplet melting back in (pointer leaves or presses). */
  dropletIn: { omega: 13, zeta: 0.7 },
  /** A lens sliding to the newly selected option. */
  slide: { omega: 14, zeta: 0.75 },
  /** A dragged lens following the finger. */
  drag: { omega: 40, zeta: 0.999 },
} as const

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
   * lands, and the control takes it with a small swell: it is not thrown and does not light up. The content
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

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
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

const VERTEX = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }
`

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uSize, uCenter, uHalf, uLightDir;
uniform float uUnit, uDevicePx, uRadius, uBevel, uBodyX, uBand, uFieldRadius;
uniform vec3 uDrop;
uniform vec4 uBlob;
uniform vec2 uBlobShape, uBlobNeck, uBlobFade;
uniform float uRim, uCaustic, uInner, uTopRefl, uTopBase, uRimWidth, uFresnel;
uniform float uShadow, uShadowSoft, uShadowOffset;
uniform float uLightMix, uEdgeClear;
uniform vec3 uSurface, uColor, uBorder;
uniform float uBorderWidth, uBorderAlpha;
uniform sampler2D uBack, uFront;
uniform float uTextured, uRefract, uMag, uDisp, uBlurCenter, uBlurEdge, uBlurShift, uFrost, uFrostBlur, uFrostMix;
uniform float uFrostEdge, uSaturation, uBendCurve, uEdgeBand;
uniform vec2 uRadial;
uniform vec4 uGlow;
uniform vec2 uGlowHalo;
uniform float uGlowBlob;
uniform vec4 uBlobMat;
uniform vec3 uBlobLine;
uniform float uCssPx;
uniform sampler2D uAround;
uniform vec4 uAroundBox;
uniform float uAroundScale, uReach;
uniform vec4 uMirror, uSeen;
uniform vec2 uBounce;
uniform float uFall, uSoft;
out vec4 outColor;

// design units -> texture uv (textures are uploaded flipped: top row at v = 1)
vec2 toUv(vec2 d) {
  vec2 q = d * uUnit;
  return clamp(vec2(q.x / uSize.x, 1.0 - q.y / uSize.y), vec2(0.0005), vec2(0.9995));
}
vec3 backdrop(vec2 st, float lod) {
  vec4 c = textureLod(uBack, st, lod);
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
  if (uDrop.y <= 0.0) return body;
  float d = length(p - vec2(uDrop.x, 0.0)) - uDrop.y;
  float k = max(uDrop.z, 1e-3);
  float h = clamp(0.5 + 0.5 * (d - body) / k, 0.0, 1.0);
  return mix(d, body, h) - k * h * (1.0 - h);
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
float shape(vec2 p) {
  float s = bodyShape(p);
  if (uBlobShape.y <= 0.0) return s;
  return melt(roundRect(p - uBlob.xy, uBlob.zw, uBlobShape.x), s, blobSoft(p));
}
// What casts the drop shadow: the body alone once a blob has a glass of its own.
float caster(vec2 p) {
  return uBlobShape.y > 0.0 && uBlobLine.z > 0.5 ? bodyShape(p) : shape(p);
}
// The body with corners at least as round as the bend is deep (see uBand in main).
float field(vec2 p) {
  float f = roundRect(p - vec2(uBodyX, 0.0), uHalf, uFieldRadius);
  if (uBlobShape.y <= 0.0) return f;
  return melt(roundRect(p - uBlob.xy, uBlob.zw, uBlobShape.x), f, blobSoft(p));
}
// The reference darkens linear colour; on sRGB values the same factor is k^(1/2.2).
float dim(float k) { return pow(clamp(k, 0.0, 1.0), 1.0 / 2.2); }
vec3 dim(vec3 k) { return pow(clamp(k, 0.0, 1.0), vec3(1.0 / 2.2)); }
float height(vec2 p) {
  float t = pow(clamp(-shape(p) / uBevel, 0.0, 1.0), 1.0 / 1.4);
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

void main() {
  vec2 px = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  vec2 local = px / uUnit - uCenter;
  float dist = shape(local);

  // Drop shadow: tight + ambient, kept near the glass, faded before the canvas edge.
  float vFade = smoothstep(-0.1, 0.9, local.y / uHalf.y) * 0.92 + 0.08;
  float outside = smoothstep(-4.0, 14.0, dist);
  float near = 1.0 - smoothstep(-6.0, uShadowSoft, caster(local - vec2(0.0, uShadowOffset)));
  float far = 1.0 - smoothstep(-10.0, uShadowSoft * 1.5, caster(local - vec2(0.0, uShadowOffset * 1.6)));
  float border = min(min(px.x, px.y), min(uSize.x - px.x, uSize.y - px.y));
  float sh = clamp((near + far) * uShadow * vFade * outside, 0.0, 0.85) * smoothstep(0.0, 14.0, border);
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
  if (mask <= 0.0) {
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
  float e = 1.25;
  float h = height(local);
  vec2 grad = vec2(height(local + vec2(e, 0.0)) - h, height(local + vec2(0.0, e)) - h) / e;
  vec3 normal = normalize(vec3(-grad * 42.0, 1.0));
  float depth = clamp(1.0 - h, 0.0, 1.0);
  float edge = 1.0 - smoothstep(0.0, uBevel * edgeBand, -dist);
  vec2 dir = normalize(vec2(shape(local + vec2(e, 0.0)) - dist, shape(local + vec2(0.0, e)) - dist) + 1e-6);

  vec3 glass;
  if (uTextured > 0.5 && (uRadial.x > 0.0 || uRadial.y > 0.0)) {
    // Radial bend, then frost: the old SVG card's rim.
    float ratio = radialRatio(dist);
    float sharpLod = max(uBlurShift, 0.0);
    if (uFrostBlur > 0.0 && dist < 1.0) {
      vec3 frost = frostedRadial(local, dist, uFrostBlur * mix(1.0, uFrostEdge, pow(ratio, 1.3)));
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
    vec2 bend = -bendDir * uRefract * pow(bendEdge, bendCurve);
    float split = uDisp * 0.35 * (1.0 - own);
    float lod = max(mix(uBlurCenter, uBlurEdge, pow(bendEdge, 1.3)) + uBlurShift, 0.0);
    vec2 at = uCenter + magnified;
    if (frostBlur > 0.0 && dist < 1.0) {
      // Frosted (inside the glass only: outside, nothing of it shows). The frost hides the
      // colour split, so one bent point is enough; uFrostMix lets the sharp bend show through.
      vec3 frost = frosted(at + bend, frostBlur * mix(1.0, uFrostEdge, pow(bendEdge, 1.3)));
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

  // Top reflection.
  float ny = local.y / uHalf.y;
  float nx = (local.x - uBodyX) / uHalf.x;
  float top = ((1.0 - smoothstep(-0.05, 0.75, ny)) * (1.0 - nx * 0.12) * uTopRefl * 0.6 + uTopBase) * lit;
  glass *= dim(1.0 - vec3(1.0, 1.0, 0.72) * top);

  // Frosted resting state: a still lens is the flat highlight colour.
  glass = mix(glass, uColor, frostCover * step(0.5, uTextured));

  // Inner shading: just inside the rim, a wide band on the left, a deep ring.
  float up = clamp(-dir.y, 0.0, 1.0);
  float right = clamp(dir.x, 0.0, 1.0);
  float left = clamp(-dir.x, 0.0, 1.0);
  float down = clamp(dir.y, 0.0, 1.0);
  float inner = uInner * lit;
  float innerBand = smoothstep(uBevel * -0.19, uBevel * -0.024, dist);
  glass *= dim(1.0 - innerBand * (up + left * 0.6 + right * 0.3 + down * 0.15) * inner * 2.2);
  float deepBand = smoothstep(uBevel * -0.73, uBevel * -0.13, dist);
  glass *= dim(1.0 - deepBand * left * inner * 2.0);
  float hx = (dist + uBevel * 0.45) / (uBevel * 0.26);
  float ring = exp(-hx * hx);
  glass *= dim(1.0 - ring * (right * 0.9 + up * 0.5 + left * 0.4 + down * 0.3) * inner * 1.5);

  // Rim light + fresnel; leans a little towards the cursor when there is one.
  float fresnel = pow(clamp(1.0 - normal.z, 0.0, 1.0), 6.0);
  float rimW = max(uDevicePx * 1.1, 1.0) * uRimWidth;
  float rimLine = 1.0 - smoothstep(0.0, rimW * 1.6, abs(dist + rimW * 1.8));
  float fall = exp(-(local.y / 30.0) * (local.y / 30.0));
  float studio = right * right * fall * 0.9 + down * down * 0.2 + left * left * 0.55;
  float lightCos = dot(dir, uLightDir);
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
  float into = clamp(-dist / uMirror.z, 0.0, 1.0);
  float look = uReach * (1.0 - into);
  vec2 rimAt = uCenter + local - dir * dist;
  vec2 across = vec2(-dir.y, dir.x) * uSoft * 0.7;
  vec3 seen = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    vec2 at = rimAt + dir * look * (0.4 + 0.3 * float(i));
    seen += (around(at, uSoft) * 0.4 + around(at + across, uSoft) * 0.3 + around(at - across, uSoft) * 0.3) * uSeen[i];
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
  float mirror = min(lit * max(rimLine * uMirror.x, band), 1.0) * much;
  // What it lacks of the surface's colour is taken out of the glass; then the glass is lifted
  // towards the neighbour's colour: dark glass mirrors it on any page.
  glass *= 1.0 - max(-hue, 0.0) * mirror * uMirror.w;
  glass += max(clamp(uSurface + hue, 0.0, 1.0) - glass, 0.0) * mirror;

  // Glow: light let in at one point, fading smoothly with distance. It brightens whatever glass
  // is near, evenly from the middle to the rim, a melted blob included (the halo is above),
  // unless the light is kept to the body (uGlowBlob: how much of it the blob takes).
  float glassL = max(dot(glass, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  glass *= pow(glassL, 1.0 / (1.0 + glowAt * mix(uGlowBlob, 1.0, lit))) / glassL;

  // Caustic: warm light gathering inside the bottom edge.
  glass += vec3(1.0, 0.92, 0.86) * smoothstep(0.72, 0.98, depth) * down * uCaustic * lit;

  // Bordered body (outline buttons): a flat line just inside the edge.
  glass = mix(glass, uBorder, smoothstep(-uBorderWidth - aa, -uBorderWidth + aa, dist) * step(1e-4, uBorderWidth) * uBorderAlpha);
  // ...and the white line of a blob with its own glass.
  glass = mix(glass, vec3(1.0), smoothstep(-uBlobLine.x - aa, -uBlobLine.x + aa, dist) * uBlobLine.y * own);
  vec4 col = mix(outsideCol, vec4(clamp(glass, 0.0, 1.0), 1.0), mask);
  // Front layer (selected labels) sits on the frosted pill and fades as the lens clears.
  vec4 fg = texture(uFront, gl_FragCoord.xy / uSize) * mask * uFrost * step(0.5, uTextured);
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
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s
    console.warn('[liquid-glass] shader failed to compile', gl.getShaderInfoLog(s))
    return null
  }
  const vs = compile(gl.VERTEX_SHADER, VERTEX)
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT)
  const program = gl.createProgram()
  if (!vs || !fs || !program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const attr = gl.getAttribLocation(program, 'a')
  gl.enableVertexAttribArray(attr)
  gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0)

  // Two shared canvases for textured lenses: what lies beneath, and what rides on top.
  // Each view keeps its own pair of textures, so a frame that only moves the light re-uses them.
  const layer = () => {
    const canvas = document.createElement('canvas')
    return { canvas, ctx: canvas.getContext('2d') }
  }
  const texture = (mipmapped: boolean) => {
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
    if (mipmapped) gl.generateMipmap(gl.TEXTURE_2D)
    return tex
  }
  const back = layer()
  const front = layer()
  if (!back.ctx || !front.ctx) return null
  type Painted = { back: WebGLTexture | null; front: WebGLTexture | null; w: number; h: number; at: number }
  const painted = new Map<GlassView, Painted>()
  // A third, small one for what surrounds a lens (its reflection), and each view's own texture of it:
  // where the picture was taken (the canvas's box then, CSS px) and how far past it it reaches.
  const around = layer()
  if (!around.ctx) return null
  type Mirrored = { tex: WebGLTexture | null; w: number; h: number; at: number; left: number; top: number; reach: number; due: boolean; timer: number }
  const mirrored = new Map<GlassView, Mirrored>()
  /** Texels per CSS px of that picture: it is only ever seen blurred. */
  const AROUND_SCALE = 0.5
  /** It is taken again this often, at most (ms). */
  const AROUND_EVERY = 400
  // What a lens without layers samples (and ignores): a texture unit is never left empty.
  const blank = { back: texture(true), front: texture(false) }
  /** The page behind a still lens is read again this often while only the light moves (ms). */
  const REPAINT_EVERY = 120
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  gl.uniform1i(gl.getUniformLocation(program, 'uBack'), 0)
  gl.uniform1i(gl.getUniformLocation(program, 'uFront'), 1)
  gl.uniform1i(gl.getUniformLocation(program, 'uAround'), 2)
  const locations = new Map<string, WebGLUniformLocation | null>()
  const u = (name: string) => {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name))
    return locations.get(name) ?? null
  }
  // Every uniform of a frame goes through `set`, which keeps the values: a view whose frame
  // would come out exactly as the one already on its canvas is not drawn again.
  const sent: number[] = []
  const set = (name: string, a: number, b?: number, c?: number, d?: number) => {
    const at = u(name)
    if (b === undefined) gl.uniform1f(at, a)
    else if (c === undefined) gl.uniform2f(at, a, b)
    else if (d === undefined) gl.uniform3f(at, a, b, c)
    else gl.uniform4f(at, a, b, c, d)
    sent.push(a, b ?? 0, c ?? 0, d ?? 0)
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

  const draw = (v: GlassView, refresh: boolean, repaint: boolean) => {
    const m = v.lens(refresh)
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
    // The shared GL canvas only grows; each view is drawn into its bottom-left corner.
    if (glCanvas.width < devW || glCanvas.height < devH) {
      glCanvas.width = Math.max(glCanvas.width, devW)
      glCanvas.height = Math.max(glCanvas.height, devH)
    }
    gl.viewport(0, 0, devW, devH)

    const unit = m.unit
    const r = m.refraction
    /** The layers are the ones this view was last drawn with. */
    let fresh = true
    if (r) {
      let p = painted.get(v)
      if (!p) painted.set(v, (p = { back: texture(true), front: texture(false), w: 0, h: 0, at: 0 }))
      const now = performance.now()
      const sized = p.w === devW && p.h === devH
      // A painter that takes only `back` has no front layer: none is cleared or uploaded.
      const fronted = r.paint.length > 1
      fresh = !repaint && sized && now - p.at < REPAINT_EVERY
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, p.back)
      if (!fresh) {
        for (const l of fronted ? [back, front] : [back]) {
          if (l.canvas.width !== devW || l.canvas.height !== devH) {
            l.canvas.width = devW
            l.canvas.height = devH
          }
          l.ctx!.setTransform(1, 0, 0, 1, 0, 0)
          l.ctx!.clearRect(0, 0, devW, devH)
          l.ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
        }
        // A painter that says nothing changed keeps the textures it already has.
        fresh = r.paint(back.ctx!, front.ctx!) === false && sized
      }
      if (!fresh) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, back.canvas)
        gl.generateMipmap(gl.TEXTURE_2D)
      }
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, fronted ? p.front : blank.front)
      if (!fresh) {
        if (fronted) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, front.canvas)
        p.w = devW
        p.h = devH
        p.at = now
      }
    } else {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, blank.back)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, blank.front)
    }
    sent.length = 0
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
    gl.activeTexture(gl.TEXTURE2)
    if (f) {
      let a = mirrored.get(v)
      if (!a) mirrored.set(v, (a = { tex: texture(true), w: 0, h: 0, at: 0, left: 0, top: 0, reach: 0, due: true, timer: 0 }))
      const taken = a
      const reach = clamp(f.height * MIRROR.reach, MIRROR.reachMin, Math.max(MIRROR.reachMin, MIRROR.reachMax))
      const aw = Math.max(2, Math.ceil((m.width + 2 * reach) * AROUND_SCALE))
      const ah = Math.max(2, Math.ceil((m.height + 2 * reach) * AROUND_SCALE))
      const now = performance.now()
      gl.bindTexture(gl.TEXTURE_2D, a.tex)
      if (refresh || (f.live && repaint) || a.w !== aw || a.h !== ah || a.reach !== reach) a.due = true
      if (a.due && a.w && now - a.at < AROUND_EVERY) {
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
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, around.canvas)
        gl.generateMipmap(gl.TEXTURE_2D)
        a.w = aw
        a.h = ah
        a.at = now
        a.left = m.left
        a.top = m.top
        a.reach = reach
        fresh = false
      }
      set('uAroundBox', (a.left - m.left - a.reach) / unit, (a.top - m.top - a.reach) / unit, a.w / AROUND_SCALE / unit, a.h / AROUND_SCALE / unit)
      set('uAroundScale', AROUND_SCALE * unit)
      set('uReach', reach / unit)
    } else {
      gl.bindTexture(gl.TEXTURE_2D, blank.back)
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
    set('uSurface', ...m.surface)
    set('uColor', ...m.color)
    set('uEdgeClear', m.edgeClear)
    set('uBorder', ...(m.border ?? m.color))
    set('uBorderWidth', m.border ? Math.max(0, m.borderWidth ?? 1) / unit : 0)
    set('uBorderAlpha', clamp(m.borderAlpha ?? 1))
    const dx = pointer.x - m.screenX
    const dy = pointer.y - m.screenY
    const d = Math.hypot(dx, dy)
    // The light turns in half-degree steps (one step is less than a level of rim light on an
    // 8-bit screen), and stays put while it is off: a cursor moving far away, or over glass
    // without cursor light, leaves the frame as it is.
    const lightMix = m.cursorLight ? pointer.mix : 0
    const aim = lightMix > 0 && d > 0.5 ? (Math.round(Math.atan2(dy, dx) * (360 / Math.PI)) * Math.PI) / 360 : -Math.PI / 2
    set('uLightDir', Math.cos(aim), Math.sin(aim))
    set('uLightMix', lightMix)
    const glow = m.glow
    set('uGlow', (glow?.x ?? 0) / unit, (glow?.y ?? 0) / unit, (glow?.r ?? 0) / unit, Math.max(0, glow?.amount ?? 0))
    set('uGlowHalo', glow?.halo ? (glow.halo.around === 'blob' && blob ? 2 : 1) : 0, clamp(glow?.halo?.amount ?? 0))
    set('uGlowBlob', clamp(glow?.blob ?? 1))
    // The same layers and the same uniforms as the frame on the canvas: nothing to draw.
    if (fresh && on.sent.length === sent.length && sent.every((value, i) => value === on.sent[i])) return
    on.sent = sent.slice()
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
    for (const v of views) {
      const moving = v.step(dt, still)
      if (moving) running = true
      if (!v.visible) continue
      const again = v.repaint === true
      if (moving || v.dirty || again || relight) {
        const refresh = v.dirty
        v.dirty = false
        v.repaint = false
        // Only the light moved: the layers are as they were, so they are not painted again.
        draw(v, refresh, moving || refresh || again)
      }
    }
    // A view may have woken the engine during this frame (a popup that has just gone back in
    // does): the next frame is then already asked for, and asking again would start a second
    // loop beside this one, for as long as anything on the page moves.
    if (running) wake()
    else if (!raf) last = 0
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
    engine = undefined
  })

  return {
    add: (v) => {
      views.add(v)
      wake()
    },
    remove: (v) => {
      views.delete(v)
      const a = mirrored.get(v)
      if (a) {
        mirrored.delete(v)
        clearTimeout(a.timer)
        gl.deleteTexture(a.tex)
      }
      const p = painted.get(v)
      if (!p) return
      painted.delete(v)
      gl.deleteTexture(p.back)
      gl.deleteTexture(p.front)
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
