// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRetainedSnapshot } from './useRetainedSnapshot'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let latest: ReturnType<typeof useRetainedSnapshot>
let container: HTMLDivElement
let root: Root

function Harness({ snapshot, active }: { snapshot: string | null; active: boolean }) {
  const retained = useRetainedSnapshot(snapshot, active)
  useEffect(() => { latest = retained })
  return <span data-image={retained.snapshot ?? ''} data-visible={String(retained.visible)} />
}

async function render(snapshot: string | null, active: boolean) {
  await act(async () => root.render(<Harness snapshot={snapshot} active={active} />))
}

describe('useRetainedSnapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('retains the last snapshot until the fade window ends', async () => {
    await render('frame-a', true)
    expect(latest.snapshot).toBe('frame-a')
    expect(latest.visible).toBe(true)

    await render(null, false)
    expect(latest.snapshot).toBe('frame-a')
    expect(latest.visible).toBe(false)

    await act(async () => vi.advanceTimersByTime(199))
    expect(latest.snapshot).toBe('frame-a')

    await act(async () => vi.advanceTimersByTime(1))
    expect(latest.snapshot).toBeNull()
  })

  it('keeps the fresh snapshot when it arrives during the fade window', async () => {
    await render('frame-a', true)
    await render(null, false)
    await act(async () => vi.advanceTimersByTime(100))
    await render('frame-b', true)
    await act(async () => vi.advanceTimersByTime(200))

    expect(latest.snapshot).toBe('frame-b')
    expect(latest.visible).toBe(true)
  })
})
