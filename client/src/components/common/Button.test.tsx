// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Button, { IconButton } from './Button'

afterEach(cleanup)

describe('Button loading state', () => {
  it('keeps a compact indicator and status text visible while loading', () => {
    render(<Button loading loadingText="执行中">立即执行</Button>)

    const button = screen.getByRole('button') as HTMLButtonElement
    const indicator = button.querySelector<HTMLElement>('.app-activity-indicator-fallback')

    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.tabIndex).toBe(-1)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.classList.contains('is-loading')).toBe(true)
    expect(button.classList.contains('opacity-50')).toBe(false)
    expect(button.textContent).toContain('执行中')
    expect(button.textContent).not.toContain('立即执行')
    const indicatorSize = Number.parseFloat(indicator?.style.width ?? '')
    expect(indicatorSize).toBeGreaterThanOrEqual(14)
    expect(indicatorSize).toBeLessThanOrEqual(16)
    expect(indicator?.querySelectorAll(':scope > span')).toHaveLength(8)
  })

  it('keeps the status text visible in the native button', () => {
    render(<Button loading loadingText="正在检查">检查更新</Button>)

    const button = screen.getByRole('button') as HTMLButtonElement

    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.textContent).toContain('正在检查')
    expect(button.textContent).not.toContain('检查更新')
  })

  it('uses a custom tooltip without duplicating the native title', () => {
    const { container } = render(
      <IconButton
        icon={<span aria-hidden="true">+</span>}
        title="安装 La Pluma"
        tooltip="安装 La Pluma"
      />,
    )

    const button = screen.getByRole('button', { name: '安装 La Pluma' }) as HTMLButtonElement

    expect(button.getAttribute('title')).toBeNull()
    expect(button.getAttribute('aria-label')).toBe('安装 La Pluma')
    expect(container.querySelector('span.inline-flex')).not.toBeNull()
  })
})
