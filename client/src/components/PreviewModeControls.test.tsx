// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PreviewModeControls from './PreviewModeControls'
import { usePreviewStore } from '@/state'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(() => {
  cleanup()
  usePreviewStore.setState({ mode: 'off' })
  vi.unstubAllGlobals()
})

function renderControls() {
  return render(<PreviewModeControls />)
}

describe('PreviewModeControls', () => {
  it('selects snapshot and live modes by clicking', () => {
    renderControls()
    fireEvent.click(screen.getByRole('radio', { name: '快照' }))
    expect(usePreviewStore.getState().mode).toBe('snapshot')

    fireEvent.click(screen.getByRole('radio', { name: '实时' }))
    expect(usePreviewStore.getState().mode).toBe('live')
  })

  it('exposes one radiogroup, one tab stop and the checked state', () => {
    const { container } = renderControls()
    const group = screen.getByRole('radiogroup', { name: '预览模式' })
    expect(group.getAttribute('aria-label')).toBe('预览模式')
    expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain('关闭')
    const stops = [...container.querySelectorAll<HTMLElement>('[role="radio"]')].filter(el => el.tabIndex === 0)
    expect(stops).toHaveLength(1)
  })

  it('moves the selection with arrow keys', () => {
    renderControls()
    const group = screen.getByRole('radiogroup', { name: '预览模式' })
    fireEvent.keyDown(group.querySelector('[role="radio"][aria-checked="true"]')!, { key: 'ArrowRight' })
    expect(usePreviewStore.getState().mode).toBe('snapshot')
    expect(screen.getByRole('radio', { name: '快照' }).getAttribute('aria-checked')).toBe('true')
  })
})
