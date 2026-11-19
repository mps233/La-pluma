// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCopilotItemFollow } from './useCopilotItemFollow'

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

beforeEach(() => {
  scrollSpy = vi.fn()
  HTMLElement.prototype.scrollIntoView = scrollSpy as unknown as typeof HTMLElement.prototype.scrollIntoView
})

afterEach(cleanup)

describe('useCopilotItemFollow', () => {
  it('scrolls the current copilot row into view when it changes', () => {
    const { container, rerender } = render(<Harness index={0} />)
    scrollSpy.mockClear()

    rerender(<Harness index={1} />)

    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrollSpy.mock.instances[0]).toBe(container.querySelector('[data-copilot-item-index="1"]'))
  })

  it('does not steal scroll position right after the user scrolls', async () => {
    const { rerender } = render(<Harness index={0} />)
    await new Promise(resolve => window.setTimeout(resolve, 220))

    fireEvent.scroll(screen.getByTestId('list'))
    scrollSpy.mockClear()

    rerender(<Harness index={1} />)

    expect(scrollSpy).not.toHaveBeenCalled()
  })
})
