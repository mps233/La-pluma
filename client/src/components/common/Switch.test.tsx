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

  it('keeps switch semantics and reports the next value', async () => {
    const onChange = vi.fn()

    await act(async () => {
      root.render(
        <div>
          <label htmlFor="scheduled-switch">启用定时执行</label>
          <Switch
            id="scheduled-switch"
            compact
            checked={false}
            label="启用定时执行"
            onChange={onChange}
          />
        </div>,
      )
    })

    const control = container.querySelector<HTMLButtonElement>('button[role="switch"]')
    const wrapper = container.querySelector<HTMLElement>('.app-switch')
    const externalLabel = container.querySelector<HTMLLabelElement>('label')
    expect(control?.getAttribute('aria-label')).toBe('启用定时执行')
    expect(control?.getAttribute('aria-checked')).toBe('false')
    expect(externalLabel?.control).toBe(control)
    expect(wrapper?.classList.contains('app-switch-compact')).toBe(true)
    expect(wrapper?.classList.contains('toggle')).toBe(false)
    expect(wrapper?.querySelectorAll('.app-switch-control:not([data-lg-copy]) > .lg-switch__track')).toHaveLength(1)
    expect(wrapper?.querySelectorAll('.app-switch-control:not([data-lg-copy]) > .lg-switch__thumb')).toHaveLength(1)
    expect(wrapper?.querySelector('.toggle-icon')).toBeNull()

    await act(async () => externalLabel?.click())
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('disables the native control and its visual wrapper together', async () => {
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

    const control = container.querySelector<HTMLButtonElement>('button[role="switch"]')
    expect(control?.disabled).toBe(true)
    expect(control?.getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('.app-switch')?.classList.contains('is-disabled')).toBe(true)
  })
})
