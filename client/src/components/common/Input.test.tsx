// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Input, { Select } from './Input'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('common form controls', () => {
  it('associates an input label and validation error with the control', () => {
    render(
      <Input
        label="账号"
        value=""
        onChange={vi.fn()}
        error="请输入账号"
        aria-describedby="account-help"
      />,
    )

    const input = screen.getByLabelText('账号') as HTMLInputElement
    const label = screen.getByText('账号', { selector: 'label' })
    const error = screen.getByRole('alert')
    expect(input.id).toBeTruthy()
    expect(label.getAttribute('for')).toBe(input.id)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-errormessage')).toBe(error.id)
    expect(input.getAttribute('aria-describedby')?.split(' ')).toEqual(['account-help', error.id])
  })

  it('associates select guidance while preserving an explicit id', () => {
    render(
      <Select
        id="billing-cycle"
        label="计费周期"
        value="month"
        onChange={vi.fn()}
        hint="可随时切换"
        options={[{ value: 'month', label: '按月' }]}
      />,
    )

    const select = screen.getByLabelText('计费周期') as HTMLSelectElement
    const hint = screen.getByText('可随时切换')
    expect(screen.getByText('计费周期', { selector: 'label' }).getAttribute('for')).toBe('billing-cycle')
    expect(select.getAttribute('aria-describedby')).toBe(hint.id)
    expect(hint.textContent).toBe('可随时切换')
    expect(select.classList.contains('app-native-control')).toBe(true)
    expect(select.classList.contains('control-surface')).toBe(true)
    expect(select.classList.contains('app-select-control')).toBe(true)
  })

  it('reserves leading space when an input has an icon', () => {
    render(
      <Input
        value=""
        onChange={vi.fn()}
        placeholder="搜索干员"
        icon={<span data-testid="search-icon" />}
      />,
    )

    const input = screen.getByPlaceholderText('搜索干员') as HTMLInputElement
    const icon = screen.getByTestId('search-icon')
    expect(input.classList.contains('app-input-has-icon')).toBe(true)
    expect(icon.parentElement?.classList.contains('app-input-leading-icon')).toBe(true)
  })
})
