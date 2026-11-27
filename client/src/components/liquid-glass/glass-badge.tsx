'use client'

// GlassBadge — a small tinted glass drop with text flowing through it ("New ▪ New ▪ …").
// The text is drawn beneath the glass, so the rim bends the letters as they pass; what
// sits behind the badge (a card corner) shows through, softly blurred.
//
//   <div className="relative">
//     <Card />
//     <GlassBadge className="absolute -top-2 -right-2">New</GlassBadge>
//   </div>
//
// Colour: the badge's own CSS background (default blue) and text colour. Hovering the
// badge's positioned parent speeds the flow up. Reduced motion: still, centred text.
// Without WebGL2 a CSS marquee runs instead. COPY VERBATIM. MIT.

import { useEffect, useRef } from 'react'

import { drawAround, drawDom } from './dom-snapshot'
import { GlassStyles } from './glass-layer'
import { getGlassEngine, rgbCss, surfaceColorOf, type GlassView, type Rgb } from './engine'

export type GlassBadgeProps = {
  children: string
  /** Separator colour (CSS). Default: the text colour. */
  dotColor?: string
  /** Loops per second at rest. */
  speed?: number
  /** Opacity of the tint over the backdrop (0–1). */
  tint?: number
  className?: string
}

const OPTION_UNITS = 80
const OPTICS = (OPTION_UNITS * 1.35) / 120
const HOVER_SPEED = 3.5
const HOVER_ACCEL = 1.6

export function GlassBadge({ children, dotColor, speed = 0.4, tint = 0.82, className = '' }: GlassBadgeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    const engine = getGlassEngine()
    if (!canvas || !host || !ctx || !engine) return

    let w = 0
    let h = 0
    let surface: Rgb = [1, 1, 1]
    let paint = 'blue'
    let ink = 'white'
    let dot = 'white'
    let font = '600 12px sans-serif'
    let offset = 0
    let still = false
    let rate = 1
    let hovered = false
    const snap = { canvas: document.createElement('canvas'), small: document.createElement('canvas'), stale: true, at: 0 }

    const measure = () => {
      w = host.offsetWidth
      h = host.offsetHeight
      const s = engine.resolveColor(surfaceColorOf(host.parentElement))
      surface = [s[0], s[1], s[2]]
      const had = 'glassReady' in host.dataset
      if (had) delete host.dataset.glassReady
      const st = getComputedStyle(host)
      const p = engine.resolveColor(st.backgroundColor)
      if (had) host.dataset.glassReady = ''
      paint = rgbCss([p[0], p[1], p[2]])
      ink = st.color
      dot = dotColor ?? st.color
      font = `${st.fontWeight} ${st.fontSize} ${st.fontFamily}`
      snap.stale = true
    }

    const view: GlassView = {
      canvas,
      ctx,
      dirty: true,
      visible: false,
      step: (dt, reduced) => {
        still = reduced
        if (reduced || !view.visible) return false
        rate += ((hovered ? HOVER_SPEED : 1) - rate) * Math.min(1, dt * HOVER_ACCEL)
        offset += dt * speed * rate
        return true
      },
      lens: (refresh) => {
        if (refresh || !w) measure()
        if (w < 2 || h < 2) return null
        const padX = 6
        const padTop = 8
        const padBottom = Math.round(h * 0.9 + 6)
        const box = host.getBoundingClientRect()
        return {
          left: -padX,
          top: -padTop,
          width: w + 2 * padX,
          height: h + padTop + padBottom,
          unit: h / OPTION_UNITS,
          cx: padX + w / 2,
          cy: padTop + h / 2,
          hx: w / 2,
          hy: h / 2,
          radius: 999,
          bodyX: 0,
          bevel: OPTION_UNITS * 0.42,
          shadow: 0.1,
          shadowSoftness: 30 * OPTICS,
          shadowOffset: 12 * OPTICS,
          strength: 1,
          color: surface,
          surface,
          edgeClear: 0,
          refraction: {
            paint: (back) => {
              const dpr = back.getTransform().a
              back.translate(padX, padTop)
              // What sits behind the badge, painted at a quarter resolution: a cheap blur.
              const now = performance.now()
              const W = back.canvas.width
              const H = back.canvas.height
              if (snap.stale || now - snap.at > 500) {
                snap.stale = false
                snap.at = now
                const sw = Math.max(1, Math.round(W / 4))
                const sh = Math.max(1, Math.round(H / 4))
                snap.small.width = sw
                snap.small.height = sh
                const sc = snap.small.getContext('2d')
                if (sc) {
                  sc.setTransform(dpr / 4, 0, 0, dpr / 4, (padX * dpr) / 4, (padTop * dpr) / 4)
                  sc.fillStyle = rgbCss(surface)
                  sc.fillRect(-padX, -padTop, W, H)
                  const root = host.offsetParent ?? document.body
                  drawDom(sc, root, {
                    origin: { left: box.left, top: box.top },
                    region: { left: box.left - padX, top: box.top - padTop, right: box.right + padX, bottom: box.bottom + padBottom },
                    skip: (el) => el === host,
                    onStale: () => {
                      snap.stale = true
                      view.dirty = true
                      engine.wake()
                    },
                  })
                }
              }
              back.save()
              back.setTransform(1, 0, 0, 1, 0, 0)
              back.imageSmoothingQuality = 'high'
              back.drawImage(snap.small, 0, 0, W, H)
              back.restore()
              back.globalAlpha = tint
              back.fillStyle = paint
              back.fillRect(-padX, -padTop, w + 2 * padX, h + padTop + padBottom)
              back.globalAlpha = 1
              back.font = font
              back.textBaseline = 'middle'
              back.fillStyle = ink
              const mid = h / 2 + 0.5
              if (still) {
                back.textAlign = 'center'
                back.fillText(children, w / 2, mid)
                return
              }
              const tw = back.measureText(children).width + 12
              back.textAlign = 'left'
              for (let x = -((offset % 1) * tw) - tw; x < w + tw; x += tw) {
                back.fillStyle = ink
                back.fillText(children, x + 6, mid)
                back.fillStyle = dot
                back.fillRect(x - 2, h / 2 - 1.5, 4, 4)
              }
            },
            refract: 22 * OPTICS,
            magnify: 0.1,
            dispersion: 0.12,
            blurCenter: 0,
            blurEdge: 2.2,
            frost: 0,
          },
          cursorLight: true,
          pointerLight: true,
          // What the rim of a clear badge mirrors: the page around it. A badge in its own
          // colour (`tint` above a clear button's 0.6) mirrors nothing.
          reflection:
            tint > 0.6
              ? undefined
              : {
                  height: h,
                  paint: (around, reach) => {
                    drawAround(around, document.body, { left: box.left - padX, top: box.top - padTop, width: w + 2 * padX, height: h + padTop + padBottom }, reach, {
                      skip: (el) => el === host || el.hasAttribute('data-glass-skip'),
                      onStale: dirty,
                    })
                  },
                },
          screenX: box.left + w / 2,
          screenY: box.top + h / 2,
        }
      },
      drawn: () => {
        host.dataset.glassReady = ''
      },
      lost: () => {
        delete host.dataset.glassReady
      },
    }

    const dirty = () => {
      view.dirty = true
      engine.wake()
    }
    const io = new IntersectionObserver(([entry]) => {
      view.visible = entry.isIntersecting
      dirty()
    })
    io.observe(host)
    const ro = new ResizeObserver(dirty)
    ro.observe(host)
    const parent = host.offsetParent
    if (parent) ro.observe(parent)
    const enter = (e: Event) => {
      if ((e as PointerEvent).pointerType === 'mouse') hovered = true
    }
    const leave = () => {
      hovered = false
    }
    parent?.addEventListener('pointerenter', enter)
    parent?.addEventListener('pointerleave', leave)
    engine.add(view)
    return () => {
      engine.remove(view)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      io.disconnect()
      ro.disconnect()
      parent?.removeEventListener('pointerenter', enter)
      parent?.removeEventListener('pointerleave', leave)
      delete host.dataset.glassReady
    }
  }, [children, dotColor, speed, tint])

  return (
    <span
      data-glass-host=""
      className={`pointer-events-none inline-flex h-[22px] w-16 items-center overflow-visible rounded-full bg-[#3291FF] text-xs leading-none font-semibold tracking-[-0.01em] [:where(&)]:text-white ${className}`}
    >
      <GlassStyles />
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{ position: 'absolute', maxWidth: 'none', pointerEvents: 'none', width: 0, height: 0 }}
      />
      <span className="sr-only">{children}</span>
      {/* CSS fallback until the glass draws (and without WebGL2). */}
      <span
        aria-hidden
        data-glass-fallback=""
        className="flex w-full overflow-hidden rounded-full [mask-image:linear-gradient(to_right,transparent,#000_18%,#000_82%,transparent)] motion-reduce:hidden"
      >
        <span data-glass-marquee="" className="flex w-max shrink-0 items-center">
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className="flex items-center">
              <span className="px-1">{children}</span>
              <span className="size-1" style={{ background: dotColor ?? 'currentColor' }} />
            </span>
          ))}
        </span>
      </span>
      <span aria-hidden data-glass-fallback="" className="hidden w-full text-center motion-reduce:block">
        {children}
      </span>
    </span>
  )
}

export default GlassBadge
