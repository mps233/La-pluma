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
    const visual = wrapper?.querySelector<HTMLElement>('.app-switch-control')
    expect(visual?.classList.contains('lg-switch')).toBe(true)
    expect(visual?.querySelector('[role="switch"]')).not.toBeNull()
    expect(visual?.querySelector('canvas[aria-hidden="true"]')).not.toBeNull()
    expect(wrapper?.querySelector('.toggle-icon')).toBeNull()

    await user.click(externalLabel)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('renders a solid fallback that tracks the checked state', () => {
    const { container, rerender } = render(
      <Switch checked={false} label="启用定时执行" onChange={() => undefined} />,
    )

    const fallback = container.querySelector<HTMLElement>('[data-glass-fallback="switch"]')
    expect(fallback?.getAttribute('aria-hidden')).toBe('true')
    expect(fallback?.classList.contains('is-on')).toBe(false)

    rerender(<Switch checked label="启用定时执行" onChange={() => undefined} />)

    expect(container.querySelector('[data-glass-fallback="switch"]')?.classList.contains('is-on')).toBe(true)
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
