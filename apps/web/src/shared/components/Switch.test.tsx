// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Switch from './Switch'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('Switch', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps native switch semantics and reports the next value', async () => {
    const onChange = vi.fn()

    await act(async () => {
      root.render(
        <Switch
          compact
          checked={false}
          label="启用定时执行"
          onChange={onChange}
        />,
      )
    })

    const input = container.querySelector<HTMLInputElement>('input[role="switch"]')
    const wrapper = container.querySelector<HTMLLabelElement>('label')
    expect(input?.getAttribute('aria-label')).toBe('启用定时执行')
    expect(input?.checked).toBe(false)
    expect(wrapper?.htmlFor).toBe(input?.id)

    await act(async () => input?.click())
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('renders a disabled native control', async () => {
    await act(async () => {
      root.render(
        <Switch
          checked
          disabled
          label="关闭通知"
          onChange={() => undefined}
        />,
      )
    })

    expect(container.querySelector<HTMLInputElement>('input[role="switch"]')?.disabled).toBe(true)
  })
})
