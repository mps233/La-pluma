// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PreviewModeControls from './PreviewModeControls'
import { usePreviewStore } from '../stores'

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<PreviewModeControls />))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  usePreviewStore.setState({ mode: 'off' })
  vi.unstubAllGlobals()
})

describe('PreviewModeControls', () => {
  it('selects snapshot and live modes by clicking', () => {
    const node = render()
    const snapshot = [...node.querySelectorAll('button')].find(button => button.textContent?.includes('快照'))
    expect(snapshot).toBeTruthy()
    act(() => snapshot?.click())
    expect(usePreviewStore.getState().mode).toBe('snapshot')

    const live = [...node.querySelectorAll('button')].find(button => button.textContent?.includes('实时'))
    act(() => live?.click())
    expect(usePreviewStore.getState().mode).toBe('live')
  })

  it('renders the compact control with theme binding', () => {
    const node = render()
    const track = node.querySelector('.lg-track')
    expect(track?.classList.contains('lg-track--sm')).toBe(true)
    expect(node.querySelector('.preview-mode-shell')?.getAttribute('data-theme')).toBe('dark')
  })

  it('moves selection with arrow keys and exposes tab semantics', () => {
    const node = render()
    const group = node.querySelector('[role="tablist"]')
    expect(group?.getAttribute('aria-label')).toBe('预览模式')
    act(() => {
      group?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(usePreviewStore.getState().mode).toBe('snapshot')
    expect(node.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('快照')
  })
})
