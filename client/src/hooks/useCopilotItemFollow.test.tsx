// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCopilotItemFollow } from './useCopilotItemFollow'

let root: Root | null = null
let container: HTMLDivElement | null = null
let scrollSpy: ReturnType<typeof vi.fn>

function Harness({ index }: { index: number }) {
  const listRef = useCopilotItemFollow({ currentIndex: index, enabled: true })
  return (
    <div ref={listRef} data-testid="list">
      <div data-copilot-item-index="0">one</div>
      <div data-copilot-item-index="1">two</div>
    </div>
  )
}

function render(index: number) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Harness index={index} />))
}

beforeEach(() => {
  scrollSpy = vi.fn()
  HTMLElement.prototype.scrollIntoView = scrollSpy as unknown as typeof HTMLElement.prototype.scrollIntoView
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('useCopilotItemFollow', () => {
  it('scrolls the current copilot row into view when it changes', () => {
    render(0)
    scrollSpy.mockClear()
    act(() => root?.render(<Harness index={1} />))
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrollSpy.mock.instances[0]).toBe(container?.querySelector('[data-copilot-item-index="1"]'))
  })

  it('does not steal scroll position right after the user scrolls', async () => {
    render(0)
    await new Promise(resolve => window.setTimeout(resolve, 220))
    const list = container?.querySelector('[data-testid="list"]')
    act(() => list?.dispatchEvent(new Event('scroll')))
    scrollSpy.mockClear()
    act(() => root?.render(<Harness index={1} />))
    expect(scrollSpy).not.toHaveBeenCalled()
  })
})
