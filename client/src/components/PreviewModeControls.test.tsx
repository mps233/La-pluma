// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import PreviewModeControls from './PreviewModeControls'
import { usePreviewStore } from '../stores'

let root: Root | null = null
let container: HTMLDivElement | null = null

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

  it('moves selection with arrow keys and exposes radio semantics', () => {
    const node = render()
    const group = node.querySelector('[role="radiogroup"]')
    expect(group?.getAttribute('aria-label')).toBe('预览模式')
    act(() => {
      group?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(usePreviewStore.getState().mode).toBe('snapshot')
    expect(node.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain('快照')
  })
})
