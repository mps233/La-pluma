// The liquid-glass.vercel.app edge refraction, baked into an feDisplacementMap image
// so a CSS backdrop-filter can bend the live page behind a DOM element.

export const glassShapes = ['rounded', 'rectangle', 'circle', 'ellipse'] as const
export type GlassShape = (typeof glassShapes)[number]

export type RefractionMap = {
  /** PNG data URL: R/G hold the x/y sample offset around 0.5. */
  href: string
  /** feDisplacementMap scale that decodes the offsets back to px. */
  scale: number
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

function sdBox(px: number, py: number, bx: number, by: number) {
  const dx = Math.abs(px) - bx
  const dy = Math.abs(py) - by
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0)
}

function sdEllipse(px: number, py: number, a: number, b: number) {
  const k0 = Math.hypot(px / a, py / b)
  const k1 = Math.hypot(px / (a * a), py / (b * b))
  return k1 === 0 ? -Math.min(a, b) : (k0 * (k0 - 1)) / k1
}

/**
 * Offsets follow the reference shader: -dir · strength · ratio⁸, where strength is a
 * fraction of `basis` (the reference used its full-window canvas).
 */
export function createRefractionMap(
  shape: GlassShape,
  width: number,
  height: number,
  radius: number,
  strength: number,
  basis: { width: number; height: number },
): RefractionMap | null {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const hx = width / 2
  const hy = height / 2
  const minHalf = Math.min(hx, hy)
  const r = Math.min(radius, minHalf)
  const offsets = new Float32Array(w * h * 2)
  let max = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hx
      const py = y + 0.5 - hy
      let d: number
      let ratio: number
      if (shape === 'circle') {
        d = Math.hypot(px, py) - hx
        ratio = Math.hypot(px, py) / hx
      } else if (shape === 'ellipse') {
        d = sdEllipse(px, py, hx, hy)
        ratio = Math.hypot(px / hx, py / hy)
      } else {
        d = shape === 'rounded' ? sdBox(px, py, hx - r, hy - r) - r : sdBox(px, py, hx, hy)
        ratio = Math.min(Math.max(1 - Math.abs(d) / minHalf, 0), 1)
      }
      const len = Math.max(Math.hypot(px, py), 0.0001)
      const k = strength * Math.pow(Math.min(ratio, 1), 8) * smoothstep(1.5, -0.5, d)
      const ox = (-px / len) * k * basis.width
      const oy = (-py / len) * k * basis.height
      offsets[(y * w + x) * 2] = ox
      offsets[(y * w + x) * 2 + 1] = oy
      max = Math.max(max, Math.abs(ox), Math.abs(oy))
    }
  }

  const scale = Math.max(max * 2, 1)
  const image = ctx.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    image.data[i * 4] = Math.round((offsets[i * 2] / scale + 0.5) * 255)
    image.data[i * 4 + 1] = Math.round((offsets[i * 2 + 1] / scale + 0.5) * 255)
    image.data[i * 4 + 2] = 128
    image.data[i * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return { href: canvas.toDataURL(), scale }
}
