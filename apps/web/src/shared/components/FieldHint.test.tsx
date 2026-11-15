// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FieldHint from './FieldHint'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const HINT = '不切换时沿用游戏内当前难度；指定未解锁的难度会被降到已解锁上限。'

let container: HTMLDivElement
let root: Root

const render = async () => {
  await act(async () => root.render(<FieldHint id="field-hint" label="难度" hint={HINT} />))
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('FieldHint', () => {
  it('mounts the tooltip only while open and keeps the trigger accessible', async () => {
    await render()

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="难度说明"]')
    expect(trigger).not.toBeNull()
    expect(trigger?.querySelector('svg')).not.toBeNull()
    expect(trigger?.getAttribute('aria-describedby')).toBeNull()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()

    await act(async () => trigger!.focus())
    const tooltipId = trigger!.getAttribute('aria-describedby')
    const tooltip = tooltipId ? document.getElementById(tooltipId) : null
    expect(tooltip?.getAttribute('role')).toBe('tooltip')
    expect(tooltip?.textContent).toBe(HINT)

    await act(async () => trigger!.blur())
    await act(async () => {})
    expect(trigger!.getAttribute('aria-describedby')).toBeNull()
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('opens on click and stays open when the trigger is clicked again', async () => {
    await render()

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="难度说明"]')!
    await act(async () => trigger.click())
    expect(trigger.getAttribute('aria-describedby')).not.toBeNull()
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(HINT)

    await act(async () => trigger.click())
    expect(trigger.getAttribute('aria-describedby')).not.toBeNull()
  })
})
