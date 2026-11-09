// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccessTokenSettings from './AccessTokenSettings'
import { ACCESS_TOKEN_STORAGE_KEY } from '@/utils/accessToken'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const renderPanel = async () => {
  await act(async () => root.render(<AccessTokenSettings />))
  await flush()
}

const setInputValue = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

const button = (label: string) => Array.from(container.querySelectorAll('button'))
  .find(item => item.textContent?.trim() === label)

describe('AccessTokenSettings', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    desktopMock.desktop = false
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('saves and clears a token in local storage', async () => {
    await renderPanel()
    const input = container.querySelector<HTMLInputElement>('input[placeholder="请输入访问令牌"]')!
    await setInputValue(input, 'phone-token')
    await act(async () => button('保存令牌')?.click())

    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe('phone-token')
    expect(container.textContent).toContain('已设置')

    await act(async () => button('清除令牌')?.click())
    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBeNull()
    expect(container.textContent).toContain('未设置')
  })

  it('loads and updates the desktop token through the bridge', async () => {
    desktopMock.desktop = true
    desktopMock.getAccessToken.mockResolvedValue({ token: 'existing-token', source: 'settings' })
    desktopMock.setAccessToken.mockResolvedValue('new-token-123')
    await renderPanel()

    const input = container.querySelector<HTMLInputElement>('input[type="password"]')!
    expect(input.value).toBe('existing-token')
    expect(container.textContent).toContain('已设置')

    await setInputValue(input, 'new-token-123')
    await act(async () => button('保存令牌')?.click())
    await flush()

    expect(desktopMock.setAccessToken).toHaveBeenCalledWith('new-token-123')
    expect(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe('new-token-123')
    expect(container.textContent).toContain('令牌已更新')
  })

  it('locks the desktop token when the environment sets it', async () => {
    desktopMock.desktop = true
    desktopMock.getAccessToken.mockResolvedValue({ token: 'env-token-123', source: 'env' })
    await renderPanel()

    expect(container.textContent).toContain('环境变量')
    const input = container.querySelector<HTMLInputElement>('input[type="password"]')!
    expect(input.disabled).toBe(true)
  })
})
