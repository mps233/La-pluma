// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Button from './LegacyButton'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

describe('Button loading state', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps status text visible and blocks interaction while loading', async () => {
    await act(async () => root.render(
      <Button loading loadingText="执行中">立即执行</Button>,
    ))

    const button = container.querySelector<HTMLButtonElement>('button')

    expect(button?.disabled).toBe(true)
    expect(button?.getAttribute('aria-disabled')).toBe('true')
    expect(button?.tabIndex).toBe(-1)
    expect(button?.getAttribute('aria-busy')).toBe('true')
    expect(button?.textContent).toContain('执行中')
    expect(button?.textContent).not.toContain('立即执行')
  })
})
