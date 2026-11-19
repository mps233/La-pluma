// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Switch from './Switch'

afterEach(cleanup)

describe('Switch', () => {
  it('keeps switch semantics and reports the next value', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    const { container } = render(
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

    const control = screen.getByRole('switch', { name: '启用定时执行' }) as HTMLButtonElement
    const wrapper = container.querySelector<HTMLElement>('.app-switch')
    const externalLabel = screen.getByText('启用定时执行', { selector: 'label' }) as HTMLLabelElement
    expect(control.getAttribute('aria-label')).toBe('启用定时执行')
    expect(control.getAttribute('aria-checked')).toBe('false')
    expect(externalLabel.control).toBe(control)
    expect(wrapper?.classList.contains('app-switch-compact')).toBe(true)
    expect(wrapper?.classList.contains('toggle')).toBe(false)
    expect(wrapper?.querySelectorAll('.app-switch-control:not([data-lg-copy]) > .lg-switch__track')).toHaveLength(1)
    expect(wrapper?.querySelectorAll('.app-switch-control:not([data-lg-copy]) > .lg-switch__thumb')).toHaveLength(1)
    expect(wrapper?.querySelector('.toggle-icon')).toBeNull()

    await user.click(externalLabel)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('disables the native control and its visual wrapper together', () => {
    const { container } = render(
      <Switch
        checked
        disabled
        label="关闭通知"
        onChange={() => undefined}
      />,
    )

    const control = screen.getByRole('switch', { name: '关闭通知' }) as HTMLButtonElement
    expect(control.disabled).toBe(true)
    expect(control.getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('.app-switch')?.classList.contains('is-disabled')).toBe(true)
  })
})
