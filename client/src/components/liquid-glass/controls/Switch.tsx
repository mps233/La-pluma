'use client'

// Behaviour (role, keyboard, the hidden input a form reads) comes from UI SDK's switch.
// Needs @ui-sdk/core and @ui-sdk/react, and `three` for the glass.

import { Switch as SwitchControl } from '@ui-sdk/react/switch'
import { useId, useRef, type PointerEvent } from 'react'

import { drawTrack, scaleOptics } from './glass/draw'
import { PRESS, pressedLens, saturate, sliderOptics, stepSpring, type Spring } from './glass/physics'
import { useGlassCanvas } from './glass/useGlassCanvas'
import { focusRing, useSyncedState, type Theme } from './shared'

export type SwitchProps = {
  checked?: boolean
  onChange?: (checked: boolean) => void
  label?: string
  description?: string
  theme?: Theme
  /** Colour of the track while on: a hex, rgb() or named colour, not a CSS variable. Defaults to the kit's blue. */
  color?: string
  size?: 'sm' | 'md' | 'lg'
  labelSide?: 'left' | 'right'
  disabled?: boolean
  /** Submits with the form around it under this name while on. */
  name?: string
  /** Pressed lens size relative to the resting knob. */
  lensScale?: number
  refraction?: number
  knobBounce?: number
}

// Design units: a 60-unit-tall track with a 51-unit frosted knob (iOS proportions).
const TRACK = { w: 137, h: 60 }
const KNOB = { w: 81, h: 51 }
const PAD = (TRACK.h - KNOB.h) / 2
const MARGIN = { x: 60, top: 50, bottom: 130 }
const heights = { sm: 22, md: 28, lg: 36 }

export function Switch({
  checked = false,
  onChange,
  label = 'Notifications',
  description,
  theme,
  color,
  size = 'md',
  labelSide = 'right',
  disabled = false,
  name,
  lensScale = 1.55,
  refraction = 26,
  knobBounce = 0.3,
}: SwitchProps) {
  const id = useId()
  const [on, setOn] = useSyncedState(checked, onChange)
  const unit = heights[size] / TRACK.h
  const w = TRACK.w * unit
  const h = TRACK.h * unit
  const travel = TRACK.w - KNOB.w - PAD * 2

  const sim = useRef({
    pos: { x: on ? 1 : 0, v: 0 } as Spring,
    press: { x: 0, v: 0 } as Spring,
    pressed: false,
    dragPos: null as number | null,
  })
  const drag = useRef<{ startX: number; startPos: number; moved: boolean } | null>(null)
  const pointerToggled = useRef(false)

  const { canvasRef } = useGlassCanvas({
    width: (TRACK.w + MARGIN.x * 2) * unit,
    height: (TRACK.h + MARGIN.top + MARGIN.bottom) * unit,
    unit,
    cursorLight: true,
    step(dt, reduced) {
      const s = sim.current
      const target = s.dragPos ?? (on ? 1 : 0)
      if (reduced) {
        s.pos = { x: target, v: 0 }
        s.press = { x: s.pressed ? 1 : 0, v: 0 }
        return false
      }
      // The knob swells into the clear lens while it crosses the track, then settles.
      const travelling = s.dragPos === null && Math.abs(s.pos.x - target) > 0.08
      const a = s.dragPos !== null ? stepSpring(s.pos, target, 40, 1, dt) : stepSpring(s.pos, target, 15, 1 - knobBounce, dt)
      const b = stepSpring(s.press, s.pressed || travelling ? 1 : 0, PRESS.omega, PRESS.zeta, dt)
      return a || b
    },
    draw(bg, _fg, tokens) {
      const s = sim.current
      drawTrack(bg, {
        x: MARGIN.x * unit,
        y: (MARGIN.top + TRACK.h / 2) * unit,
        length: w,
        height: h,
        fillEnd: (MARGIN.x + TRACK.w) * unit,
        track: tokens.track,
        accent: color ?? tokens.accent,
        fillOpacity: saturate(s.pos.x),
      })
      const k = (KNOB.h * lensScale) / 120
      const o = { ...scaleOptics(sliderOptics, k), refraction, cornerRadius: 999 }
      const lens = pressedLens(s.press.x, KNOB, { w: KNOB.w * lensScale, h: KNOB.h * lensScale }, 1, o)
      return {
        ...lens,
        x: MARGIN.x + PAD + KNOB.w / 2 + s.pos.x * travel,
        y: MARGIN.top + TRACK.h / 2,
        stretchX: 1,
        stretchY: 1,
        shiftX: 0,
        // The resting knob stays a white pill in both themes.
        frostCenter: '#ffffff',
        frostEdge: '#e9ebef',
      }
    },
  })

  const localX = (e: PointerEvent<HTMLButtonElement>) => e.clientX - e.currentTarget.getBoundingClientRect().left
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    sim.current.pressed = true
    drag.current = { startX: localX(e), startPos: on ? 1 : 0, moved: false }
  }
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    const dx = localX(e) - d.startX
    if (!d.moved && Math.abs(dx) < 3) return
    d.moved = true
    sim.current.dragPos = saturate(d.startPos + dx / (travel * unit))
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    const s = sim.current
    s.pressed = false
    if (!d) return
    const next = d.moved ? (s.dragPos ?? 0) > 0.5 : !on
    s.dragPos = null
    pointerToggled.current = true
    setOn(next)
  }

  const control = (
    <SwitchControl
      id={id}
      checked={on}
      // Pointer presses toggle on pointerup; keyboard and label clicks only arrive here.
      onCheckedChange={(next, details) => {
        if (!pointerToggled.current) return setOn(next)
        pointerToggled.current = false
        details.cancel()
      }}
      disabled={disabled}
      name={name}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`relative shrink-0 cursor-pointer touch-none rounded-full disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
      style={{ width: w, height: h }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: -MARGIN.x * unit,
          top: -MARGIN.top * unit,
          width: (TRACK.w + MARGIN.x * 2) * unit,
          height: (TRACK.h + MARGIN.top + MARGIN.bottom) * unit,
        }}
      />
    </SwitchControl>
  )

  if (!label) return <span data-theme={theme} className="inline-flex">{control}</span>

  return (
    <div data-theme={theme} className={`inline-flex items-center gap-3 ${labelSide === 'left' ? 'flex-row-reverse' : ''}`}>
      {control}
      <label htmlFor={id} className="relative flex cursor-pointer flex-col select-none">
        <span className="text-[13px] font-medium text-neutral-900 dark:text-white">{label}</span>
        {description && <span className="text-[12px] text-neutral-500">{description}</span>}
      </label>
    </div>
  )
}

export default Switch
