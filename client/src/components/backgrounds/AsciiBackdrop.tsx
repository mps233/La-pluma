import { useEffect, useRef, type CSSProperties } from 'react'
import './AsciiBackdrop.css'

export type AsciiPattern = 'flow' | 'waves' | 'rings'

export interface AsciiBackdropProps {
  /** Ink colour for a single-tone field. Falls back to the element's own color. */
  color?: string
  /** Two to six hex colours, faintest glyphs first. Overrides color. */
  colors?: readonly string[]
  /** Shape of the field: drifting banks, crossing swells, or spreading rings. */
  pattern?: AsciiPattern
  /** Glyphs from empty to dense; the first is usually a space. Up to 24. */
  characters?: string
  /** Height of a row of type. */
  cellSize?: number
  /** Size of the shapes; larger is calmer. */
  scale?: number
  /** How much of the field carries glyphs. */
  density?: number
  /** How far the glyphs fade toward the edges. */
  fade?: number
  /** Tint under the dense areas. */
  glow?: number
  /** Odd cells that flare now and then. */
  twinkle?: number
  /** Animation speed; 1 is the designed pace. */
  speed?: number
  /** Shifts the composition. */
  seed?: number
  /** Move on its own. Off draws one still frame. */
  animate?: boolean
  /** A lens follows the pointer and leaves a fading trail; a click sends a ring outward. */
  interactive?: boolean
  /** How far the pointer lens reaches, in CSS pixels. */
  radius?: number
  /** How much the lens enlarges the field under it. */
  magnify?: number
  /** Strength of the fading trail the pointer leaves. */
  wake?: number
  /** Base colour behind the glyphs; empty follows the page. */
  background?: string
  className?: string
  /** Layer opacity. Keeps the ambient field behind content instead of competing with it. */
  intensity?: number
}

const DEFAULT_CHARACTERS = ' .:-=+*#%@'
const MAX_CELLS = 13000
const FRAME_MS = 1000 / 24
const TRAIL_DECAY = 1.7
const RING_LIFE = 1.35
const RING_SPEED = 26
const RING_WIDTH = 2.6
const MAX_RINGS = 5
const FONT_FAMILY = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

function smoothstep(edge0: number, edge1: number, value: number) {
  if (edge1 === edge0) return value < edge0 ? 0 : 1
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function mulberry32(seed: number) {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NOISE_SIZE = 128
const NOISE_MASK = NOISE_SIZE - 1

function makeNoise(seed: number) {
  const random = mulberry32(Math.imul(seed | 0, 2654435761) + 0x9e3779b9)
  const table = new Float32Array(NOISE_SIZE * NOISE_SIZE)
  for (let i = 0; i < table.length; i += 1) table[i] = random()
  return table
}

function sampleNoise(table: Float32Array, x: number, y: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const x0 = xi & NOISE_MASK
  const y0 = yi & NOISE_MASK
  const x1 = (x0 + 1) & NOISE_MASK
  const y1 = (y0 + 1) & NOISE_MASK
  const row0 = y0 * NOISE_SIZE
  const row1 = y1 * NOISE_SIZE
  const top = table[row0 + x0] + (table[row0 + x1] - table[row0 + x0]) * u
  const bottom = table[row1 + x0] + (table[row1 + x1] - table[row1 + x0]) * u
  return top + (bottom - top) * v
}

function fbm(table: Float32Array, x: number, y: number) {
  let total = 0
  let amplitude = 0.56
  let frequency = 1
  let norm = 0
  for (let octave = 0; octave < 3; octave += 1) {
    total += sampleNoise(table, x * frequency, y * frequency) * amplitude
    norm += amplitude
    amplitude *= 0.5
    frequency *= 2.03
  }
  return total / norm
}

function hash01(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed + 1, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function parseColor(value: string): [number, number, number] | null {
  const input = value.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input)
  if (hex) {
    const body = hex[1]
    if (body.length === 3) {
      return [
        parseInt(body[0] + body[0], 16),
        parseInt(body[1] + body[1], 16),
        parseInt(body[2] + body[2], 16),
      ]
    }
    return [
      parseInt(body.slice(0, 2), 16),
      parseInt(body.slice(2, 4), 16),
      parseInt(body.slice(4, 6), 16),
    ]
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(input)
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    if (parts.length >= 3 && parts.slice(0, 3).every(part => Number.isFinite(part))) {
      return [parts[0], parts[1], parts[2]]
    }
  }
  return null
}

function buildPalette(stops: readonly string[] | undefined, ink: string, count: number) {
  const palette: string[] = []
  const parsed = stops && stops.length >= 2
    ? stops.slice(0, 6).map(stop => parseColor(stop) ?? ([63, 107, 255] as [number, number, number]))
    : null
  if (!parsed) {
    const base = parseColor(ink) ?? ([63, 107, 255] as [number, number, number])
    for (let i = 0; i < count; i += 1) {
      const t = count === 1 ? 1 : i / (count - 1)
      const alpha = 0.08 + 0.92 * Math.pow(t, 1.15)
      palette.push('rgba(' + base[0] + ', ' + base[1] + ', ' + base[2] + ', ' + alpha.toFixed(3) + ')')
    }
    return palette
  }
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 1 : i / (count - 1)
    const position = t * (parsed.length - 1)
    const lower = Math.floor(position)
    const upper = Math.min(parsed.length - 1, lower + 1)
    const mix = position - lower
    const from = parsed[lower]
    const to = parsed[upper]
    const red = Math.round(from[0] + (to[0] - from[0]) * mix)
    const green = Math.round(from[1] + (to[1] - from[1]) * mix)
    const blue = Math.round(from[2] + (to[2] - from[2]) * mix)
    const alpha = 0.22 + 0.78 * t
    palette.push('rgba(' + red + ', ' + green + ', ' + blue + ', ' + alpha.toFixed(3) + ')')
  }
  return palette
}

/**
 * Ambient ASCII field: a slow light field drawn as type, glyphs thickening
 * where it brightens. The pointer brings a lens that reshuffles them and
 * leaves a fading trail; a click sends a ring of type outward.
 *
 * One canvas, glyph buckets so each shade costs a single fillStyle switch per
 * frame, 24 fps cap, parked while hidden or off-screen, and a single still
 * frame when reduced motion is requested.
 */
export default function AsciiBackdrop(props: AsciiBackdropProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const propsRef = useRef(props)

  useEffect(() => {
    propsRef.current = props
  })

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const motionQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
    const coarseQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)')
      : null

    let clock = 0
    let lastPaint = 0
    let lastNow = performance.now()
    let frame = 0
    let visible = true
    let width = 0
    let height = 0
    let cols = 0
    let rows = 0
    let cells = 0
    let cell = 14
    let cellW = 8.7
    let mainFont = ''
    let glowFont = ''
    let configKey = ''
    let ramp: string[] = [...DEFAULT_CHARACTERS]
    let palette: string[] = buildPalette(undefined, 'rgb(63, 107, 255)', ramp.length)
    let noise = makeNoise(0)
    let offsetX = 0
    let offsetY = 0
    let trail = new Float32Array(0)
    let bucketX: Float32Array[] = ramp.map(() => new Float32Array(0))
    let bucketY: Float32Array[] = ramp.map(() => new Float32Array(0))
    let bucketCount = new Int32Array(ramp.length)

    let pointerX = -1e5
    let pointerY = -1e5
    let lensX = -1e5
    let lensY = -1e5
    let pointerActive = false
    const rings: Array<{ x: number; y: number; born: number }> = []

    const readInk = () => {
      const computed = window.getComputedStyle(host)
      return computed.color || 'rgb(63, 107, 255)'
    }

    const allocateBuckets = () => {
      const size = Math.max(1, cells)
      bucketX = ramp.map(() => new Float32Array(size))
      bucketY = ramp.map(() => new Float32Array(size))
      bucketCount = new Int32Array(ramp.length)
    }

    const syncConfig = () => {
      const live = propsRef.current
      const characters = live.characters && live.characters.length > 0
        ? live.characters.slice(0, 24)
        : DEFAULT_CHARACTERS
      const colors = live.colors ? [...live.colors] : []
      const key = characters + '|' + colors.join(',') + '|' + (live.color ?? '') + '|' + (live.seed ?? 0)
      if (key === configKey) return
      configKey = key
      ramp = [...characters]
      palette = buildPalette(colors.length >= 2 ? colors : undefined, live.color ?? readInk(), ramp.length)
      noise = makeNoise(live.seed ?? 0)
      const random = mulberry32(((live.seed ?? 0) | 0) * 7919 + 13)
      offsetX = random() * 512
      offsetY = random() * 512
      allocateBuckets()
    }

    const resize = () => {
      const rect = host.getBoundingClientRect()
      width = Math.round(rect.width)
      height = Math.round(rect.height)
      if (!width || !height) return

      const live = propsRef.current
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = width + 'px'
      canvas.style.height = height + 'px'
      context.setTransform(dpr, 0, 0, dpr, 0, 0)

      const floor = coarseQuery?.matches ? 20 : 11
      cell = Math.max(floor, live.cellSize ?? 14)
      cellW = cell * 0.62
      for (let guard = 0; guard < 24; guard += 1) {
        cols = Math.max(2, Math.ceil(width / cellW))
        rows = Math.max(2, Math.ceil(height / cell))
        if (cols * rows <= MAX_CELLS) break
        cell *= 1.16
        cellW = cell * 0.62
      }
      cells = cols * rows

      mainFont = '500 ' + Math.round(cell * 0.92) + 'px ' + FONT_FAMILY
      glowFont = '500 ' + Math.round(cell * 1.75) + 'px ' + FONT_FAMILY
      context.font = mainFont
      context.textAlign = 'center'
      context.textBaseline = 'middle'

      trail = new Float32Array(cells)
      allocateBuckets()
      configKey = ''
      lensX = pointerX
      lensY = pointerY
    }

    const sampleField = (cx: number, cy: number, time: number, pattern: AsciiPattern, scale: number) => {
      const inverse = 1 / Math.max(0.2, scale)
      if (pattern === 'rings') {
        let best = 0
        for (let index = 0; index < 3; index += 1) {
          const phase = offsetX * 0.01 + index * 2.1
          const centerX = cols * (0.5 + 0.3 * Math.sin(phase + time * 0.045))
          const centerY = rows * (0.5 + 0.28 * Math.cos(phase * 1.3 + time * 0.033))
          const dx = (cx - centerX) * 0.6
          const dy = cy - centerY
          const distance = Math.sqrt(dx * dx + dy * dy)
          const falloff = Math.max(0, 1 - distance / (34 * Math.max(0.6, scale) + 12))
          if (falloff <= 0) continue
          const ring = 0.5 + 0.5 * Math.sin(distance * 0.44 * inverse - time * 0.85 + phase)
          const value = Math.pow(ring, 1.6) * falloff
          if (value > best) best = value
        }
        return clamp01(best)
      }
      if (pattern === 'waves') {
        const k = 0.3 * inverse
        const a = Math.sin(cx * k + time * 0.4 + offsetX)
        const b = Math.sin(cy * k * 1.7 - time * 0.32 + offsetY)
        const c = Math.sin((cx * 0.62 + cy * 0.9) * k * 0.85 + time * 0.23)
        return clamp01(0.5 + (a * 0.36 + b * 0.36 + c * 0.28) * 0.62)
      }
      const f = 0.078 * inverse
      const nx = cx * f + offsetX * 0.012 + Math.sin(cy * 0.011 + time * 0.1) * 1.3 + time * 0.035
      const ny = cy * f * 0.72 + offsetY * 0.012 - time * 0.027
      const value = fbm(noise, nx, ny)
      return clamp01(0.5 + (value - 0.5) * 2.15)
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(paint)
    }

    const paint = (now: number) => {
      frame = 0
      const live = propsRef.current
      if (!visible || document.hidden) return
      if (now - lastPaint < FRAME_MS) {
        schedule()
        return
      }

      const still = motionQuery?.matches === true
      const animated = live.animate !== false && !still
      const dt = animated ? Math.min(0.12, (now - lastNow) / 1000) : 0
      lastNow = now
      lastPaint = now
      clock += dt * (live.speed ?? 1)

      const pattern = live.pattern ?? 'flow'
      const scale = live.scale ?? 1
      const density = clamp01(live.density ?? 0.7)
      const fade = clamp01(live.fade ?? 0.6)
      const glow = clamp01(live.glow ?? 0.6)
      const twinkle = clamp01(live.twinkle ?? 0.5)
      const interactive = live.interactive !== false
      const radius = Math.max(1, live.radius ?? 100)
      const magnify = Math.max(0, live.magnify ?? 0.6)
      const wake = clamp01(live.wake ?? 0.7)
      const seed = live.seed ?? 0
      const levels = ramp.length
      const lastIndex = Math.max(0, levels - 1)

      if (!cells) {
        schedule()
        return
      }

      if (animated) {
        const decay = Math.exp(-dt * TRAIL_DECAY)
        for (let i = 0; i < cells; i += 1) trail[i] *= decay
      }

      if (interactive && pointerActive) {
        const spread = 1.8
        const fromX = Math.max(0, Math.floor(pointerX - spread))
        const toX = Math.min(cols - 1, Math.ceil(pointerX + spread))
        const fromY = Math.max(0, Math.floor(pointerY - spread))
        const toY = Math.min(rows - 1, Math.ceil(pointerY + spread))
        for (let row = fromY; row <= toY; row += 1) {
          for (let col = fromX; col <= toX; col += 1) {
            const dx = col - pointerX
            const dy = row - pointerY
            const distance = Math.sqrt(dx * dx + dy * dy)
            if (distance > spread) continue
            const amount = (1 - distance / spread) * wake * 0.55
            const at = row * cols + col
            trail[at] = Math.min(1, trail[at] + amount)
          }
        }
        lensX += (pointerX - lensX) * 0.24
        lensY += (pointerY - lensY) * 0.24
      } else {
        pointerActive = false
      }

      for (let i = rings.length - 1; i >= 0; i -= 1) {
        if ((now - rings[i].born) / 1000 > RING_LIFE) rings.splice(i, 1)
      }

      bucketCount.fill(0)
      const densityEdge = 1 - density * 0.93
      const spawnCut = 0.055 * twinkle
      const time = clock

      for (let row = 0; row < rows; row += 1) {
        const normalizedY = row / Math.max(1, rows - 1) - 0.5
        for (let col = 0; col < cols; col += 1) {
          let sampleX = col
          let sampleY = row
          let lens = 0

          if (interactive && pointerActive) {
            const dx = (col - lensX) * cellW
            const dy = (row - lensY) * cell
            const distance = Math.sqrt(dx * dx + dy * dy)
            if (distance < radius) {
              lens = smoothstep(0, 1, 1 - distance / radius)
              const zoom = 1 + magnify * lens
              sampleX = lensX + (col - lensX) / zoom
              sampleY = lensY + (row - lensY) / zoom
            }
          }

          let level = sampleField(sampleX, sampleY, time, pattern, scale)
          level = smoothstep(densityEdge, 1, level)

          const normalizedX = col / Math.max(1, cols - 1) - 0.5
          const radial = Math.sqrt(
            normalizedX * normalizedX * 1.32 + normalizedY * normalizedY * 1.82,
          )
          const atten = 1 - smoothstep(0.16, 0.82, radial) * fade

          let boost = 0
          const trailValue = trail[row * cols + col]
          if (trailValue > 0.002) boost += trailValue * 0.55
          if (lens > 0) boost += lens * 0.16

          if (spawnCut > 0) {
            const spark = hash01(col, row, seed)
            if (spark < spawnCut) {
              boost += (0.5 + 0.5 * Math.sin(time * 2.1 + spark * 220)) * 0.42 * twinkle
            }
          }

          for (let i = 0; i < rings.length; i += 1) {
            const ring = rings[i]
            const age = (now - ring.born) / 1000
            const ringRadius = age * RING_SPEED
            const dx = col - ring.x
            const dy = row - ring.y
            const distance = Math.sqrt(dx * dx + dy * dy)
            const band = Math.abs(distance - ringRadius)
            if (band < RING_WIDTH) {
              const strength = (1 - band / RING_WIDTH) * (1 - age / RING_LIFE)
              if (strength > boost) boost = strength
            }
          }

          const shaped = clamp01(level * atten + boost * atten)
          if (shaped <= 0.02) continue

          const x = col * cellW + cellW * 0.5
          const y = row * cell + cell * 0.5

          let index = Math.round(shaped * lastIndex)
          if (lens > 0.02) {
            index = (index + Math.round(lens * (2 + 4 * hash01(col, row, 7)))) % levels
          }
          const glyph = ramp[index]
          if (!glyph || glyph === ' ') continue
          const slot = bucketCount[index]
          if (slot >= cells) continue
          bucketX[index][slot] = x
          bucketY[index][slot] = y
          bucketCount[index] = slot + 1
        }
      }

      context.clearRect(0, 0, width, height)

      if (glow > 0.01) {
        context.font = glowFont
        context.fillStyle = palette[lastIndex] ?? palette[0]
        context.globalAlpha = 0.11 * glow
        const cut = Math.max(1, Math.floor(levels * 0.55))
        for (let index = cut; index < levels; index += 1) {
          const count = bucketCount[index]
          if (!count) continue
          const glyph = ramp[index]
          const xs = bucketX[index]
          const ys = bucketY[index]
          for (let i = 0; i < count; i += 1) context.fillText(glyph, xs[i], ys[i])
        }
        context.globalAlpha = 1
        context.font = mainFont
      }

      for (let index = 0; index < levels; index += 1) {
        const count = bucketCount[index]
        if (!count) continue
        context.fillStyle = palette[index] ?? palette[0]
        const glyph = ramp[index]
        const xs = bucketX[index]
        const ys = bucketY[index]
        for (let i = 0; i < count; i += 1) context.fillText(glyph, xs[i], ys[i])
      }

      if (animated) schedule()
    }

    const onPointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      pointerX = ((event.clientX - rect.left) / rect.width) * cols
      pointerY = ((event.clientY - rect.top) / rect.height) * rows
      if (!pointerActive) {
        lensX = pointerX
        lensY = pointerY
        pointerActive = true
      }
      schedule()
    }

    const onPointerLeave = () => {
      pointerActive = false
      schedule()
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('a, button, input, textarea, select, label, [role="button"], [contenteditable="true"]')) {
        return
      }
      const rect = host.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      if (event.clientX < rect.left || event.clientY < rect.top || event.clientX > rect.right || event.clientY > rect.bottom) return
      rings.push({
        x: ((event.clientX - rect.left) / rect.width) * cols,
        y: ((event.clientY - rect.top) / rect.height) * rows,
        born: performance.now(),
      })
      if (rings.length > MAX_RINGS) rings.shift()
      schedule()
    }

    const sizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
        resize()
        schedule()
      })
      : null
    const themeObserver = new MutationObserver(() => {
      configKey = ''
      schedule()
    })
    const visibilityObserver = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
        visible = entries[0]?.isIntersecting ?? true
        if (visible) schedule()
      })
      : null

    syncConfig()
    resize()
    sizeObserver?.observe(host)
    visibilityObserver?.observe(host)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    })
    document.addEventListener('visibilitychange', schedule)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    document.addEventListener('pointerleave', onPointerLeave)
    motionQuery?.addEventListener?.('change', schedule)
    schedule()

    return () => {
      cancelAnimationFrame(frame)
      sizeObserver?.disconnect()
      themeObserver.disconnect()
      visibilityObserver?.disconnect()
      document.removeEventListener('visibilitychange', schedule)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointerleave', onPointerLeave)
      motionQuery?.removeEventListener?.('change', schedule)
    }
  }, [])

  const style: CSSProperties = {}
  if (props.background) style.backgroundColor = props.background
  if (typeof props.intensity === 'number') {
    const tokens = style as CSSProperties & Record<string, string | number>
    tokens['--ascii-field-opacity'] = props.intensity
  }

  return (
    <div
      ref={hostRef}
      className={props.className ? 'ascii-field ' + props.className : 'ascii-field'}
      style={style}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="ascii-field-canvas" />
    </div>
  )
}
