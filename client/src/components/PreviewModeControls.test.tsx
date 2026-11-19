// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PreviewModeControls from './PreviewModeControls'
import { usePreviewStore } from '../stores'

afterEach(cleanup)

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

function renderControls() {
  return render(<PreviewModeControls />)
}

afterEach(() => {
  cleanup()
  usePreviewStore.setState({ mode: 'off' })
  vi.unstubAllGlobals()
})

describe('PreviewModeControls', () => {
  it('selects snapshot and live modes by clicking', () => {
    renderControls()
    // The segmented control selects through its native click listener; jsdom's
    // zero-size layout makes userEvent's pointer simulation suppress it.
    fireEvent.click(screen.getByRole('tab', { name: '快照' }))
    expect(usePreviewStore.getState().mode).toBe('snapshot')

    fireEvent.click(screen.getByRole('tab', { name: '实时' }))
    expect(usePreviewStore.getState().mode).toBe('live')
  })

  it('renders the compact control with theme binding', () => {
    const { container } = renderControls()
    const track = container.querySelector('.lg-track')
    expect(track?.classList.contains('lg-track--sm')).toBe(true)
    expect(container.querySelector('.preview-mode-shell')?.getAttribute('data-theme')).toBe('dark')
  })

  it('moves selection with arrow keys and exposes tab semantics', () => {
    const { container } = renderControls()
    const group = screen.getByRole('tablist', { name: '预览模式' })
    expect(group?.getAttribute('aria-label')).toBe('预览模式')
    fireEvent.keyDown(group, { key: 'ArrowRight', bubbles: true })
    expect(usePreviewStore.getState().mode).toBe('snapshot')
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('快照')
  })
})
