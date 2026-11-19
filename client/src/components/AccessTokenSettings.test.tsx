// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccessTokenSettings from './AccessTokenSettings'
import { ACCESS_TOKEN_STORAGE_KEY } from '@/utils/accessToken'

const desktopMock = vi.hoisted(() => ({
  desktop: false,
  getAccessToken: vi.fn(),
  setAccessToken: vi.fn(),
}))

vi.mock('@/desktop/bridge', () => ({
  isDesktopRuntime: () => desktopMock.desktop,
  desktopBridge: {
    getAccessToken: desktopMock.getAccessToken,
    setAccessToken: desktopMock.setAccessToken,
  },
}))

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  desktopMock.desktop = false
})

afterEach(cleanup)

describe('AccessTokenSettings', () => {
  it('saves and clears a token in local storage', async () => {
    render(<AccessTokenSettings />)
    const user = userEvent.setup()

    const input = screen.getByLabelText('访问令牌') as HTMLInputElement
    await user.type(input, 'phone-token')
    await user.click(screen.getByRole('button', { name: '保存令牌' }))

    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe('phone-token')
    expect(screen.getByText('已设置')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '清除令牌' }))
    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBeNull()
    expect(screen.getByText('未设置')).toBeTruthy()
  })

  it('loads and updates the desktop token through the bridge', async () => {
    desktopMock.desktop = true
    desktopMock.getAccessToken.mockResolvedValue({ token: 'existing-token', source: 'settings' })
    desktopMock.setAccessToken.mockResolvedValue('new-token-123')
    render(<AccessTokenSettings />)

    const input = await screen.findByDisplayValue('existing-token') as HTMLInputElement
    expect(input.value).toBe('existing-token')
    expect(screen.getByText('已设置')).toBeTruthy()

    const user = userEvent.setup()
    await user.clear(input)
    await user.type(input, 'new-token-123')
    await user.click(screen.getByRole('button', { name: '保存令牌' }))
    await waitFor(() => expect(desktopMock.setAccessToken).toHaveBeenCalledWith('new-token-123'))

    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe('new-token-123')
    expect(await screen.findByText(/令牌已更新/)).toBeTruthy()
  })

  it('locks the desktop token when the environment sets it', async () => {
    desktopMock.desktop = true
    desktopMock.getAccessToken.mockResolvedValue({ token: 'env-token-123', source: 'env' })
    render(<AccessTokenSettings />)

    await screen.findByDisplayValue('env-token-123')
    expect(screen.getByText('环境变量')).toBeTruthy()
    const input = screen.getByLabelText('访问令牌') as HTMLInputElement
    expect(input.disabled).toBe(true)
  })
})
