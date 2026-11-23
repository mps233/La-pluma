'use client'

// Behaviour (role, keyboard, the hidden input a form reads) comes from UI SDK's checkbox.
// Needs @ui-sdk/core and @ui-sdk/react, and `three` for the glass.

import { Checkbox as CheckboxControl } from '@ui-sdk/react/checkbox'
import { useId, useRef, type ReactNode } from 'react'

import { roundRect, scaleOptics } from './glass/draw'
import { PRESS, pressedLens, saturate, sliderOptics, stepSpring, type Spring } from './glass/physics'
import type { GlassTokens } from './glass/tokens'
import { useGlassCanvas } from './glass/useGlassCanvas'
import { focusRing, useSyncedState, type Theme } from './shared'

export type CheckboxProps = {
  checked?: boolean
  onChange?: (checked: boolean) => void
  label?: string
  description?: string
  theme?: Theme
  /** Colour of the box while checked: a hex, rgb() or named colour, not a CSS variable. Defaults to the kit's blue. */
  color?: string
  shape?: 'rounded' | 'circle'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  /** Submits with the form around it under this name while checked. */
  name?: string
  /** Lens swell while pressed. */
  swell?: number
}

const boxSizes = { sm: 18, md: 22, lg: 28 }
// A 100-unit glass cap over a recessed box.
const BOX = 100
const MARGIN = { x: 40, top: 40, bottom: 120 }
// The cap overhangs the box and bends it at rest too, so the glass always reads as glass.
const CAP = 1.2
const REST_BEND = 0.55

/** Shared by Checkbox and RadioGroup: a glass cap over a recessed box whose mark draws beneath it. */
export function useGlassCap({
  box,
  radius,
  on,
  pressed,
  swell,
  color,
  drawMark,
}: {
  box: number
  radius: number
  on: boolean
  pressed: () => boolean
  swell: number
  color?: string
  drawMark: (ctx: CanvasRenderingContext2D, progress: number, cx: number, cy: number, box: number, tokens: GlassTokens) => void
}) {
  const unit = box / BOX
  const sim = useRef({ fill: { x: on ? 1 : 0, v: 0 } as Spring, press: { x: 0, v: 0 } as Spring })
  const size = { width: (BOX + MARGIN.x * 2) * unit, height: (BOX + MARGIN.top + MARGIN.bottom) * unit }

  const { canvasRef } = useGlassCanvas({
    ...size,
    unit,
    cursorLight: true,
    step(dt, reduced) {
      const s = sim.current
      if (reduced) {
        s.fill = { x: on ? 1 : 0, v: 0 }
        s.press = { x: pressed() ? 1 : 0, v: 0 }
        return false
      }
      const a = stepSpring(s.fill, on ? 1 : 0, 18, 1, dt)
      const b = stepSpring(s.press, pressed() ? 1 : 0, PRESS.omega, PRESS.zeta, dt)
      return a || b
    },
    draw(bg, _fg, tokens) {
      const s = sim.current
      const x = MARGIN.x * unit
      const y = MARGIN.top * unit
      const r = (radius / BOX) * box
      // Recessed box, accent fill, then the mark — all beneath the glass.
      roundRect(bg, x, y, box, box, r)
      bg.fillStyle = tokens.well
      bg.fill()
      const p = saturate(s.fill.x)
      if (p > 0) {
        bg.save()
        bg.globalAlpha = p
        roundRect(bg, x, y, box, box, r)
        bg.fillStyle = color ?? tokens.accent
        bg.fill()
        bg.restore()
        drawMark(bg, p, x + box / 2, y + box / 2, box, tokens)
      }
      const scaled = scaleOptics(sliderOptics, (BOX * CAP * swell) / 120)
      const o = { ...scaled, restRefraction: scaled.refraction * REST_BEND, cornerRadius: radius * CAP * swell }
      const lens = pressedLens(s.press.x, { w: BOX * CAP, h: BOX * CAP }, { w: BOX * CAP * swell, h: BOX * CAP * swell }, 0, o)
      lens.radius = radius * (lens.hy / (BOX / 2))
      return { ...lens, x: MARGIN.x + BOX / 2, y: MARGIN.top + BOX / 2, stretchX: 1, stretchY: 1, shiftX: 0 }
    },
  })

  const canvas: ReactNode = (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{ left: -MARGIN.x * unit, top: -MARGIN.top * unit, ...size }}
    />
  )
  return canvas
}

export function Checkbox({
  checked = true,
  onChange,
  label = 'Remember this device',
  description,
  theme,
  color,
  shape = 'rounded',
  size = 'md',
  disabled = false,
  name,
  swell = 1.18,
}: CheckboxProps) {
  const id = useId()
  const [on, setOn] = useSyncedState(checked, onChange)
  const box = boxSizes[size]
  const pressedRef = useRef(false)
  const canvas = useGlassCap({
    box,
    radius: shape === 'circle' ? BOX / 2 : 30,
    on,
    pressed: () => pressedRef.current,
    swell,
    color,
    drawMark(ctx, progress, cx, cy, b) {
      // The check stroke draws itself in as the fill arrives.
      const pts = [
        [-0.27, 0.02],
        [-0.08, 0.2],
        [0.29, -0.2],
      ].map(([px, py]) => [cx + px * b, cy + py * b])
      const l1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
      const l2 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1])
      ctx.save()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = b * 0.13
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.setLineDash([l1 + l2, l1 + l2])
      ctx.lineDashOffset = (l1 + l2) * (1 - progress)
      ctx.beginPath()
      ctx.moveTo(pts[0][0], pts[0][1])
      ctx.lineTo(pts[1][0], pts[1][1])
      ctx.lineTo(pts[2][0], pts[2][1])
      ctx.stroke()
      ctx.restore()
    },
  })

  return (
    <div data-theme={theme} className="inline-flex items-start gap-3">
      <CheckboxControl
        id={id}
        checked={on}
        onCheckedChange={(next) => setOn(next === true)}
        disabled={disabled}
        name={name}
        onPointerDown={() => (pressedRef.current = true)}
        onPointerUp={() => (pressedRef.current = false)}
        onPointerLeave={() => (pressedRef.current = false)}
        onPointerCancel={() => (pressedRef.current = false)}
        className={`relative shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
        style={{ width: box, height: box, borderRadius: shape === 'circle' ? box / 2 : box * 0.3 }}
      >
        {canvas}
      </CheckboxControl>
      {label && (
        <label htmlFor={id} className="relative flex cursor-pointer flex-col justify-center select-none" style={{ minHeight: box }}>
          <span className="text-[13px] leading-5 font-medium text-neutral-900 dark:text-white">{label}</span>
          {description && <span className="text-[12px] text-neutral-500">{description}</span>}
        </label>
      )}
    </div>
  )
}

export default Checkbox
