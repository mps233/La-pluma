// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccessTokenGate from './AccessTokenGate'
import { ACCESS_TOKEN_STORAGE_KEY, AUTH_REQUIRED_EVENT } from '@/utils/accessToken'

beforeEach(() => {
  localStorage.clear()
})

afterEach(cleanup)

describe('AccessTokenGate', () => {
  it('opens on a 401 signal and saves the entered token', async () => {
    render(<AccessTokenGate />)

    fireEvent(window, new Event(AUTH_REQUIRED_EVENT))

    const dialog = screen.getByRole('alertdialog', { name: '需要访问令牌' })
    expect(dialog.textContent).toContain('需要访问令牌')

    const input = screen.getByLabelText('访问令牌') as HTMLInputElement
    const user = userEvent.setup()
    await user.type(input, 'phone-token')

    const save = screen.getByRole('button', { name: '保存并重试' })
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    })
    await user.click(save)

    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe('phone-token')
  })
})
