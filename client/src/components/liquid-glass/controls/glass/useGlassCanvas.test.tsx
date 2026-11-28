// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGlassCanvas } from './useGlassCanvas'

const runtime = vi.hoisted(() => ({
  createView: vi.fn(() => ({
    invalidate: vi.fn(),
    dispose: vi.fn(),
    stats: () => ({ renders: 0, ms: 0 }),
  })),
}))

vi.mock('./runtime', () => ({
  getGlassRuntime: vi.fn(async () => ({ createView: runtime.createView })),
}))

function Harness({ label }: { label: string }) {
  const { canvasRef } = useGlassCanvas({
    width: 10,
    height: 10,
    unit: 1,
    draw: () => ({
      x: 0,
      y: 0,
      hx: 1,
      hy: 1,
      radius: 1,
      bevel: 1,
      refract: 0,
      mag: 0,
      disp: 0,
      blurCenter: 0,
      blurEdge: 0,
      frost: 1,
      rim: 0,
      caustic: 0,
      inner: 0,
      topRefl: 0,
      shadowOpacity: 0,
      shadowSoftness: 0,
      shadowOffset: 0,
      stretchX: 1,
      stretchY: 1,
      shiftX: 0,
    }),
  })
  return (
    <button type="button" aria-label={label}>
      <canvas ref={canvasRef} />
    </button>
  )
}

afterEach(() => {
  cleanup()
  runtime.createView.mockClear()
})

describe('useGlassCanvas', () => {
  it('does not import the renderer before the first interaction', async () => {
    render(<Harness label="glass control" />)

    expect(runtime.createView).not.toHaveBeenCalled()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'glass control' }))

    await waitFor(() => expect(runtime.createView).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'glass control' }).querySelector('canvas')?.dataset.glassReady).toBe('true')
  })

  it('upgrades every mounted control after one control loads the runtime', async () => {
    render(
      <>
        <Harness label="first control" />
        <Harness label="second control" />
      </>,
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'first control' }))

    await waitFor(() => expect(runtime.createView).toHaveBeenCalledTimes(2))
  })
})
