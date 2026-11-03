// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Tooltip from './Tooltip'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const getTrigger = () => container.querySelector<HTMLSpanElement>('span.inline-flex')
const getTooltip = () => document.querySelector<HTMLElement>('[role="tooltip"]')

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    container.remove()
  })

  it('opens after the hover delay and closes on Escape', async () => {
    await act(async () => root.render(
      <Tooltip content="安装 La Pluma">
        <button type="button" aria-label="安装 La Pluma">安装</button>
      </Tooltip>,
    ))

    const trigger = getTrigger()
    expect(trigger).not.toBeNull()

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true, relatedTarget: null }))
    })
    expect(getTooltip()).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(400)
    })
    expect(getTooltip()?.textContent).toBe('安装 La Pluma')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(getTooltip()).toBeNull()
  })

  it('opens immediately on focus', async () => {
    await act(async () => root.render(
      <Tooltip content="提示">
        <button type="button">焦点</button>
      </Tooltip>,
    ))

    await act(async () => {
      getTrigger()?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })

    expect(getTooltip()?.textContent).toBe('提示')
  })

  it('does not render when disabled', async () => {
    await act(async () => root.render(
      <Tooltip content="提示" disabled>
        <button type="button">禁用</button>
      </Tooltip>,
    ))

    await act(async () => {
      getTrigger()?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      vi.advanceTimersByTime(400)
    })

    expect(getTooltip()).toBeNull()
  })
})
