// @vitest-environment jsdom

import { Activity, act, type ComponentType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
  parseJsonResponse: vi.fn(async (response: unknown) => response),
}))

vi.mock('@/services/api', () => ({
  API_BASE_URL: 'http://la-pluma.test/api',
  fetchWithAuth: mocks.fetchWithAuth,
  parseJsonResponse: mocks.parseJsonResponse,
}))

interface NotificationConfigFixture {
  enabled: boolean
  channels: {
    telegram: {
      enabled: boolean
      botToken: string
      chatId: string
    }
  }
}

const loadedConfig: NotificationConfigFixture = {
  enabled: true,
  channels: {
    telegram: {
      enabled: true,
      botToken: 'server-token',
      chatId: 'server-chat',
    },
  },
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

let container: HTMLDivElement
let root: Root
let rootMounted: boolean
let NotificationSettings: ComponentType

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const renderMode = async (mode: 'visible' | 'hidden') => {
  await act(async () => {
    root.render(
      <Activity mode={mode}>
        <NotificationSettings />
      </Activity>,
    )
  })
  await flush()
}

const setInputValue = async (input: HTMLInputElement, value: string) => {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

const buttonByText = (text: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
  .find(button => button.textContent?.trim() === text)

describe('NotificationSettings Activity lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules()
    mocks.fetchWithAuth.mockReset().mockResolvedValue({ success: true, data: loadedConfig })
    mocks.parseJsonResponse.mockClear()
    NotificationSettings = (await import('./NotificationSettings')).default
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    rootMounted = true
  })

  afterEach(async () => {
    if (rootMounted) await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('deduplicates an initial request while Activity hides and restores the effect', async () => {
    const initialRequest = deferred<{ success: boolean; data: NotificationConfigFixture }>()
    mocks.fetchWithAuth.mockReturnValue(initialRequest.promise)

    await renderMode('visible')
    expect(mocks.fetchWithAuth).toHaveBeenCalledOnce()

    await renderMode('hidden')
    await renderMode('visible')
    expect(mocks.fetchWithAuth).toHaveBeenCalledOnce()

    await act(async () => initialRequest.resolve({ success: true, data: loadedConfig }))
    await flush()

    expect(container.querySelector<HTMLInputElement>('input[placeholder="Telegram Bot Token"]')?.value).toBe('server-token')
  })

  it('uses the same section switch treatment for notification controls', async () => {
    await renderMode('visible')

    const notificationSwitch = container.querySelector<HTMLInputElement>('[aria-label="任务通知"]')
    const telegramSwitch = container.querySelector<HTMLInputElement>('[aria-label="Telegram 通知"]')

    expect(notificationSwitch?.closest('.automation-notification-heading')).not.toBeNull()
    expect(telegramSwitch?.closest('.automation-notification-channel-heading')).not.toBeNull()
    expect(notificationSwitch?.closest('.app-switch')?.classList.contains('automation-section-switch')).toBe(true)
    expect(telegramSwitch?.closest('.app-switch')?.classList.contains('automation-section-switch')).toBe(true)
  })

  it('does not replace an unsaved draft when Activity restores the loading effect', async () => {
    await renderMode('visible')
    const tokenInput = container.querySelector<HTMLInputElement>('input[placeholder="Telegram Bot Token"]')
    expect(tokenInput?.value).toBe('server-token')

    await setInputValue(tokenInput!, 'draft-token')
    expect(tokenInput?.value).toBe('draft-token')

    await renderMode('hidden')
    await renderMode('visible')

    expect(mocks.fetchWithAuth).toHaveBeenCalledOnce()
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Telegram Bot Token"]')?.value).toBe('draft-token')
  })

  it('shows a retryable load error and blocks saving an empty fallback config', async () => {
    mocks.fetchWithAuth
      .mockResolvedValueOnce({ success: false, message: '通知配置暂不可用' })
      .mockResolvedValueOnce({ success: true, data: loadedConfig })

    await renderMode('visible')

    const alert = container.querySelector<HTMLElement>('[role="alert"]')
    expect(alert?.textContent).toContain('通知配置暂不可用')
    expect(buttonByText('保存')?.disabled).toBe(true)
    const retryButton = buttonByText('重新加载')
    expect(retryButton).toBeDefined()

    await act(async () => retryButton?.click())
    await flush()

    expect(mocks.fetchWithAuth).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Telegram Bot Token"]')?.value).toBe('server-token')
    expect(buttonByText('保存')?.disabled).toBe(false)
  })

  it('aborts a pending save before an Activity cleanup can receive its response', async () => {
    const saveRequest = deferred<{ success: boolean; message: string }>()
    mocks.fetchWithAuth.mockImplementation((_url: string, init?: RequestInit) => (
      init?.method === 'POST' ? saveRequest.promise : Promise.resolve({ success: true, data: loadedConfig })
    ))

    await renderMode('visible')
    await act(async () => buttonByText('保存')?.click())
    const saveCall = mocks.fetchWithAuth.mock.calls[mocks.fetchWithAuth.mock.calls.length - 1]
    const saveInit = saveCall?.[1] as RequestInit | undefined
    expect(saveInit?.signal?.aborted).toBe(false)

    await renderMode('hidden')
    expect(saveInit?.signal?.aborted).toBe(true)

    await act(async () => saveRequest.resolve({ success: true, message: '已保存' }))
    await flush()
  })

  it('aborts a pending notification test when the component effects are removed', async () => {
    const testRequest = deferred<{ success: boolean; message: string }>()
    mocks.fetchWithAuth.mockImplementation((url: string, init?: RequestInit) => (
      url.includes('test-notification-channel') && init?.method === 'POST'
        ? testRequest.promise
        : Promise.resolve({ success: true, data: loadedConfig })
    ))

    await renderMode('visible')
    await act(async () => buttonByText('测试')?.click())
    const testCall = mocks.fetchWithAuth.mock.calls[mocks.fetchWithAuth.mock.calls.length - 1]
    const testInit = testCall?.[1] as RequestInit | undefined
    expect(testInit?.signal?.aborted).toBe(false)

    await act(async () => root.unmount())
    rootMounted = false
    expect(testInit?.signal?.aborted).toBe(true)

    await act(async () => testRequest.resolve({ success: true, message: '已发送' }))
    await flush()
  })
})
