// @vitest-environment jsdom

import { Activity, type ComponentType } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationConfig } from '@/services/api'

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
  parseJsonResponse: vi.fn(async (response: unknown) => response),
  resetNotificationCache: vi.fn(),
}))

// The component talks to the notification service; the service's own request
// shaping lives in services/api.ts. Keep the real clone/message helpers and
// route the service calls through the fetch spies so the Activity lifecycle
// assertions still see the actual request options and abort signals.
vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  const base = 'http://la-pluma.test/api'
  type NotificationResult = { success: boolean; data?: NotificationConfig; message?: string }
  let cached: ReturnType<typeof actual.cloneNotificationConfig> | null = null
  let pending: Promise<NotificationResult> | null = null
  mocks.resetNotificationCache.mockImplementation(() => {
    cached = null
    pending = null
  })

  return {
    ...actual,
    API_BASE_URL: base,
    fetchWithAuth: mocks.fetchWithAuth,
    parseJsonResponse: mocks.parseJsonResponse,
    notificationsApi: {
      async getConfig(force = false) {
        if (!force && cached) return { success: true, data: cached }
        if (pending) return pending
        pending = (async () => {
          const data = (await mocks.parseJsonResponse(
            await mocks.fetchWithAuth(`${base}/agent/notifications/config`),
          )) as NotificationResult
          if (data.success) cached = actual.cloneNotificationConfig(data.data)
          return data
        })().finally(() => {
          pending = null
        })
        return pending
      },
      async saveConfig(config: Parameters<typeof actual.notificationsApi.saveConfig>[0], signal?: AbortSignal) {
        const data = (await mocks.parseJsonResponse(
          await mocks.fetchWithAuth(`${base}/agent/notifications/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config),
            signal,
          }),
        )) as NotificationResult
        if (data.success) cached = actual.cloneNotificationConfig(config)
        return data
      },
      async testChannel(channel: string, config: Parameters<typeof actual.notificationsApi.testChannel>[1], signal?: AbortSignal) {
        return (await mocks.parseJsonResponse(
          await mocks.fetchWithAuth(`${base}/agent/actions/test-notification-channel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel, config }),
            signal,
          }),
        )) as NotificationResult
      },
    },
  }
})

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

let NotificationSettings: ComponentType
let view: ReturnType<typeof render>

afterEach(cleanup)

const renderVisible = async () => {
  view = render(
    <Activity mode="visible">
      <NotificationSettings />
    </Activity>,
  )
  await waitFor(() => expect(mocks.fetchWithAuth).toHaveBeenCalled())
}

const renderMode = async (mode: 'visible' | 'hidden') => {
  view.rerender(
    <Activity mode={mode}>
      <NotificationSettings />
    </Activity>,
  )
}

describe('NotificationSettings Activity lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules()
    mocks.fetchWithAuth.mockReset().mockResolvedValue({ success: true, data: loadedConfig })
    mocks.parseJsonResponse.mockClear()
    mocks.resetNotificationCache()
    NotificationSettings = (await import('./NotificationSettings')).default
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('deduplicates an initial request while Activity hides and restores the effect', async () => {
    const initialRequest = deferred<{ success: boolean; data: NotificationConfigFixture }>()
    mocks.fetchWithAuth.mockReturnValue(initialRequest.promise)

    await renderVisible()
    expect(mocks.fetchWithAuth).toHaveBeenCalledOnce()

    await renderMode('hidden')
    await renderMode('visible')
    expect(mocks.fetchWithAuth).toHaveBeenCalledOnce()

    await act(async () => initialRequest.resolve({ success: true, data: loadedConfig }))

    await waitFor(() => {
      expect((screen.getByPlaceholderText('Telegram Bot Token') as HTMLInputElement).value).toBe('server-token')
    })
  })

  it('uses the same section switch treatment for notification controls', async () => {
    await renderVisible()
    await screen.findByRole('switch', { name: '任务通知' })

    const notificationSwitch = screen.getByRole('switch', { name: '任务通知' })
    const telegramSwitch = screen.getByRole('switch', { name: 'Telegram 通知' })

    expect(notificationSwitch.closest('.automation-notification-heading')).not.toBeNull()
    expect(telegramSwitch.closest('.automation-notification-channel-heading')).not.toBeNull()
    expect(notificationSwitch.closest('.app-switch')?.classList.contains('automation-section-switch')).toBe(true)
    expect(telegramSwitch.closest('.app-switch')?.classList.contains('automation-section-switch')).toBe(true)
  })

  it('does not replace an unsaved draft when Activity restores the loading effect', async () => {
    const user = userEvent.setup()
    await renderVisible()

    const tokenInput = screen.getByPlaceholderText('Telegram Bot Token') as HTMLInputElement
    await waitFor(() => expect(tokenInput.value).toBe('server-token'))

    await user.clear(tokenInput)
    await user.type(tokenInput, 'draft-token')
    expect(tokenInput.value).toBe('draft-token')

    await renderMode('hidden')
    await renderMode('visible')

    expect(mocks.fetchWithAuth).toHaveBeenCalledOnce()
    expect((screen.getByPlaceholderText('Telegram Bot Token') as HTMLInputElement).value).toBe('draft-token')
  })

  it('shows a retryable load error and blocks saving an empty fallback config', async () => {
    const user = userEvent.setup()
    mocks.fetchWithAuth
      .mockResolvedValueOnce({ success: false, message: '通知配置暂不可用' })
      .mockResolvedValueOnce({ success: true, data: loadedConfig })

    await renderVisible()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('通知配置暂不可用')
    expect(screen.getByRole('button', { name: '保存' })).toHaveProperty('disabled', true)
    const retryButton = screen.getByRole('button', { name: '重新加载' })
    expect(retryButton).toBeDefined()

    await user.click(retryButton)

    await waitFor(() => expect(mocks.fetchWithAuth).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect((screen.getByPlaceholderText('Telegram Bot Token') as HTMLInputElement).value).toBe('server-token')
    expect(screen.getByRole('button', { name: '保存' })).toHaveProperty('disabled', false)
  })

  it('keeps a pending save alive through Activity cleanup', async () => {
    const user = userEvent.setup()
    const saveRequest = deferred<{ success: boolean; message: string }>()
    mocks.fetchWithAuth.mockImplementation((_url: string, init?: RequestInit) => (
      init?.method === 'POST' ? saveRequest.promise : Promise.resolve({ success: true, data: loadedConfig })
    ))

    await renderVisible()
    const saveButton = await screen.findByRole('button', { name: '保存' })
    await waitFor(() => expect(saveButton).toHaveProperty('disabled', false))
    await user.click(saveButton)

    await waitFor(() => {
      expect(mocks.fetchWithAuth.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(true)
    })
    const saveCall = mocks.fetchWithAuth.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    const saveInit = saveCall?.[1] as RequestInit | undefined
    expect(saveInit?.signal?.aborted).toBe(false)

    await renderMode('hidden')
    expect(saveInit?.signal?.aborted).toBe(false)

    await act(async () => saveRequest.resolve({ success: true, message: '已保存' }))
  })

  it('aborts a pending notification test when the component effects are removed', async () => {
    const user = userEvent.setup()
    const testRequest = deferred<{ success: boolean; message: string }>()
    mocks.fetchWithAuth.mockImplementation((url: string, init?: RequestInit) => (
      url.includes('test-notification-channel') && init?.method === 'POST'
        ? testRequest.promise
        : Promise.resolve({ success: true, data: loadedConfig })
    ))

    await renderVisible()
    const testButton = await screen.findByRole('button', { name: '测试' })
    await waitFor(() => expect(testButton).toHaveProperty('disabled', false))
    await user.click(testButton)

    await waitFor(() => {
      const testCall = mocks.fetchWithAuth.mock.calls.find(([url]) => String(url).includes('test-notification-channel'))
      expect(testCall).toBeDefined()
    })
    const testCall = mocks.fetchWithAuth.mock.calls.find(([url]) => String(url).includes('test-notification-channel'))
    const testInit = testCall?.[1] as RequestInit | undefined
    expect(testInit?.signal?.aborted).toBe(false)

    view.unmount()
    expect(testInit?.signal?.aborted).toBe(true)

    await act(async () => testRequest.resolve({ success: true, message: '已发送' }))
  })
})
