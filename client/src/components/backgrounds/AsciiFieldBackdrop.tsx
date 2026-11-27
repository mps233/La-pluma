import { useEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties } from 'react'

import './AsciiBackdrop.css'

const LIGHT_ACCENT = '#007aff'
const DARK_ACCENT = '#64b5ff'
const LIGHT_BACKGROUND = '#f2f2f7'

/** Faintest glyph first; the leading space is an empty cell. */
const GLYPHS = ' .:-=+*#%@'
/** Cell size in CSS px. The glyphs are read as texture, not as text. */
const CELL = 14
const DENSITY = 0.64
const FADE = 0.56

function subscribeTheme(callback: () => void) {
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

const getIsDark = () => document.documentElement.classList.contains('dark')

interface AsciiFieldBackdropProps {
  /** Ink colour for a single-tone field. Defaults to the project accent. */
  color?: string
  /** Two to six colours, faintest glyphs first. Overrides color. */
  colors?: readonly string[]
  /** Base colour behind the glyphs. Defaults to the page background. */
  background?: string
  className?: string
  /** Layer opacity. Keeps the field behind content instead of competing with it. */
  intensity?: number
}

// The field used to be a WebGL2 shader evaluating a multi-octave noise field for
// every pixel at 40 fps, for a decoration sitting at 0.18 opacity. The picture is
// static by nature, so it is resolved once into a canvas here: one paint per mount,
// theme change or resize, and no frames afterwards. Nothing else about it changes.

function hash(x: number, y: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function valueNoise(x: number, y: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi)
  const b = hash(xi + 1, yi)
  const c = hash(xi, yi + 1)
  const d = hash(xi + 1, yi + 1)
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

/** Two octaves of value noise, centred like the shader's simplex fbm. */
function fbm(x: number, y: number) {
  const first = valueNoise(x, y)
  const second = valueNoise(x * 2.03 + 3.1, y * 2.03 + 7.7)
  return first * 0.55 + second * 0.2475
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1e-6)))
  return t * t * (3 - 2 * t)
}

/** One still frame of the field, at one buffer pixel per CSS pixel. */
function paintField(canvas: HTMLCanvasElement, host: HTMLElement, ink: readonly string[], seed: number) {
  const width = host.clientWidth
  const height = host.clientHeight
  if (width < 2 || height < 2) return
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, width, height)
  ctx.font = `500 ${CELL}px ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const cols = Math.ceil(width / CELL) + 1
  const rows = Math.ceil(height / CELL) + 1
  const halfW = width / 2
  const halfH = height / 2
  const aspect = width / height
  const lo = 1 - DENSITY
  const top = DENSITY * 0.85
  const last = GLYPHS.length - 1

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * CELL
      const y = row * CELL
      const nx = (x / width - 0.5) * aspect * 2.4
      const ny = (y / height - 0.5) * 2.4
      // The same soft banks the shader drew, drifting nowhere. Its simplex fbm is
      // centred on zero and swings wider than value noise, so the spread is matched
      // here rather than changing the density constant that reads the field.
      const raw = 0.5 + (fbm(nx * 0.9 + seed, ny * 0.9 - seed) - 0.4) * 1.45
      const edge = Math.hypot(((x - halfW) / halfW) * 0.85, (y - halfH) / halfH)
      const mask = 1 - smoothstep(0.35, 1.25, edge) * FADE
      const v = smoothstep(lo, lo + top, raw) * mask
      if (v <= 0.02) continue
      const jitter = hash(col * 7 + seed * 13, row * 11 - seed * 17)
      const index = Math.min(last, Math.max(0, Math.round(v * last + (jitter - 0.5) * 0.7)))
      if (index === 0) continue
      ctx.globalAlpha = 0.3 + 0.7 * v
      ctx.fillStyle = ink.length > 1 ? ink[Math.min(ink.length - 1, Math.round(v * (ink.length - 1)))] : ink[0]
      ctx.fillText(GLYPHS[index], x, y)
    }
  }
  ctx.globalAlpha = 1
}

/**
 * Ambient ASCII backdrop: a still field of glyphs, painted once.
 *
 * It keeps the app's own opacity, stacking and theme rules around it. Clear glass
 * snapshots the page behind it, so the field stays out of that snapshot through
 * `data-glass-skip`; a still canvas is also far cheaper to copy than a live one.
 */
export default function AsciiFieldBackdrop({
  color,
  colors,
  background,
  className,
  intensity,
}: AsciiFieldBackdropProps) {
  const dark = useSyncExternalStore(subscribeTheme, getIsDark, () => false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const theme = useMemo(() => {
    if (typeof window === 'undefined') {
      return { accent: LIGHT_ACCENT, background: LIGHT_BACKGROUND }
    }
    const styles = window.getComputedStyle(document.documentElement)
    const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
    return {
      accent: read(dark ? '--app-accent-strong' : '--app-accent', dark ? DARK_ACCENT : LIGHT_ACCENT),
      background: read('--app-bg', LIGHT_BACKGROUND),
    }
  }, [dark])

  const ink = useMemo(() => {
    if (colors && colors.length) return colors
    return [color ?? theme.accent]
  }, [colors, color, theme.accent])

  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    if (!canvas || !host) return
    let frame = 0
    let timer = 0
    const paint = () => paintField(canvas, host, ink, dark ? 3 : 1)
    // A new theme or ink colour repaints on the next frame; a drag of the window
    // edge fires resize every frame, so the field waits until the drag settles
    // rather than repainting thousands of glyphs sixty times a second.
    const paintSoon = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(paint)
    }
    const paintWhenSettled = () => {
      clearTimeout(timer)
      timer = window.setTimeout(paintSoon, 140)
    }
    paintSoon()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(paintWhenSettled) : null
    observer?.observe(host)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      observer?.disconnect()
    }
  }, [ink, dark])

  const style: CSSProperties = {}
  if (background) style.backgroundColor = background
  if (typeof intensity === 'number') {
    ;(style as CSSProperties & Record<string, string | number>)['--ascii-field-opacity'] = intensity
  }

  return (
    <div
      aria-hidden="true"
      data-glass-skip=""
      className={className ? 'ascii-field ' + className : 'ascii-field'}
      style={style}
    >
      <canvas ref={canvasRef} className="ascii-field-canvas" />
    </div>
  )
}
