// @vitest-environment jsdom

import { Activity, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/query'
import NotificationSettings from './NotificationSettings'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getNotificationConfig: vi.fn(),
  saveNotificationConfig: vi.fn(),
  testNotificationChannel: vi.fn(),
  notify: vi.fn(),
  dismissNotice: vi.fn(),
}))

vi.mock('../api', () => ({
  getActivity: vi.fn(),
  getScheduleExecutionStatus: vi.fn(),
  getNotificationConfig: mocks.getNotificationConfig,
  saveNotificationConfig: mocks.saveNotificationConfig,
  testNotificationChannel: mocks.testNotificationChannel,
}))

vi.mock('@/shared/notifications', () => ({
  notify: mocks.notify,
  dismissNotice: mocks.dismissNotice,
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

const configWith = (
  enabled: boolean,
  telegram: Partial<NotificationConfigFixture['channels']['telegram']>,
): NotificationConfigFixture => ({
  enabled,
  channels: {
    telegram: {
      enabled: true,
      botToken: 'server-token',
      chatId: 'server-chat',
      ...telegram,
    },
  },
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

let container: HTMLDivElement
let root: Root
let queryClient: ReturnType<typeof createQueryClient>

const flush = async () => {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

const renderMode = async (mode: 'visible' | 'hidden') => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Activity mode={mode}>
          <NotificationSettings />
        </Activity>
      </QueryClientProvider>,
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

const tokenInput = () => container.querySelector<HTMLInputElement>('input[placeholder="Telegram Bot Token"]')
const testButton = () => buttonByText('发送测试消息')
const saveButton = () => buttonByText('保存')

const statusTexts = () => Array.from(container.querySelectorAll<HTMLElement>('[role="status"]'))
  .map(node => node.textContent)

describe('NotificationSettings Query lifecycle', () => {
  beforeEach(() => {
    mocks.getNotificationConfig.mockReset().mockResolvedValue({ success: true, data: loadedConfig })
    mocks.saveNotificationConfig.mockReset().mockResolvedValue({ success: true, message: '通知配置已保存' })
    mocks.testNotificationChannel.mockReset().mockResolvedValue({ success: true, message: '测试通知已发送' })
    mocks.notify.mockReset()
    mocks.dismissNotice.mockReset()
    queryClient = createQueryClient()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    queryClient.clear()
    vi.restoreAllMocks()
  })

  it('loads once and reuses the cached config when Activity hides and restores', async () => {
    await renderMode('visible')
    expect(mocks.getNotificationConfig).toHaveBeenCalledOnce()

    await renderMode('hidden')
    await renderMode('visible')
    expect(mocks.getNotificationConfig).toHaveBeenCalledOnce()

    expect(tokenInput()?.value).toBe('server-token')
  })

  it('does not replace an unsaved draft when Activity restores the loading effect', async () => {
    await renderMode('visible')
    expect(tokenInput()?.value).toBe('server-token')

    await setInputValue(tokenInput()!, 'draft-token')
    expect(tokenInput()?.value).toBe('draft-token')

    await renderMode('hidden')
    await renderMode('visible')

    expect(mocks.getNotificationConfig).toHaveBeenCalledOnce()
    expect(tokenInput()?.value).toBe('draft-token')
    expect(saveButton()?.disabled).toBe(false)
  })

  it('routes a load error to a toast and keeps a fixed-height unavailable placeholder', async () => {
    mocks.getNotificationConfig
      .mockResolvedValueOnce({ success: false, message: '通知配置暂不可用' })
      .mockResolvedValueOnce({ success: true, data: loadedConfig })

    await renderMode('visible')

    expect(mocks.notify).toHaveBeenCalledWith(
      '通知配置暂不可用',
      'error',
      {
        id: 'automation-notification-load',
        action: { label: '重新加载', onClick: expect.any(Function) },
      },
    )
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('通知配置暂不可用')
    expect(container.querySelector('.automation-notification-loading')?.textContent).toBe('通知配置暂不可用')
    expect(tokenInput()).toBeNull()
    expect(saveButton()).toBeUndefined()

    const { action } = mocks.notify.mock.calls[0]![2]
    await act(async () => action.onClick())
    await flush()

    expect(mocks.getNotificationConfig).toHaveBeenCalledTimes(2)
    expect(mocks.dismissNotice).toHaveBeenCalledWith('automation-notification-load')
    expect(tokenInput()?.value).toBe('server-token')
    expect(saveButton()?.disabled).toBe(true)

    await setInputValue(tokenInput()!, 'draft-token')
    expect(saveButton()?.disabled).toBe(false)
  })

  it('disables saving until the draft changes and disables it again after a successful save', async () => {
    mocks.saveNotificationConfig.mockResolvedValue({ success: true, message: '保存完成' })

    await renderMode('visible')
    expect(saveButton()?.disabled).toBe(true)
    expect(container.textContent).toContain('已保存')

    await setInputValue(tokenInput()!, 'draft-token')
    expect(saveButton()?.disabled).toBe(false)
    expect(container.textContent).toContain('有未保存的更改')

    await act(async () => saveButton()?.click())
    await flush()

    expect(mocks.saveNotificationConfig).toHaveBeenCalledOnce()
    expect(saveButton()?.disabled).toBe(true)
    expect(mocks.notify).toHaveBeenCalledWith(
      '保存完成',
      'success',
      { id: 'automation-notification-save' },
    )
    expect(container.textContent).not.toContain('保存完成')
    expect(container.textContent).not.toContain('有未保存的更改')
  })

  it('disables the Telegram channel and test button when notifications are off', async () => {
    mocks.getNotificationConfig.mockResolvedValue({
      success: true,
      data: configWith(false, {}),
    })

    await renderMode('visible')

    expect(container.querySelector('[aria-label="启用通知"]')?.getAttribute('aria-checked')).toBe('false')
    expect(container.querySelector('[aria-label="启用 Telegram"]')?.getAttribute('aria-disabled')).toBe('true')
    expect(tokenInput()?.disabled).toBe(true)
    expect(testButton()?.disabled).toBe(true)
    expect(container.textContent).toContain('先启用通知')
  })

  it('disables testing and explains why when credentials are incomplete', async () => {
    mocks.getNotificationConfig.mockResolvedValue({
      success: true,
      data: configWith(true, { botToken: '', chatId: '' }),
    })

    await renderMode('visible')

    expect(container.querySelector('[aria-label="启用 Telegram"]')?.getAttribute('aria-disabled')).toBeNull()
    expect(testButton()?.disabled).toBe(true)
    expect(container.textContent).toContain('填写 Bot Token 与 Chat ID 后可测试')
    expect(container.textContent).toContain('凭据不完整，不会发送')
  })

  it('routes test and save feedback to separate fixed toast ids', async () => {
    mocks.testNotificationChannel.mockResolvedValue({ success: true, message: '测试消息已送达' })
    mocks.saveNotificationConfig.mockResolvedValue({ success: true, message: '通知配置已保存' })

    await renderMode('visible')
    await act(async () => testButton()?.click())
    await flush()

    expect(mocks.notify).toHaveBeenCalledWith(
      '测试消息已送达',
      'success',
      { id: 'automation-notification-test' },
    )
    expect(statusTexts()).toEqual([])
    expect(container.textContent).not.toContain('测试消息已送达')

    await setInputValue(tokenInput()!, 'draft-token')
    await act(async () => saveButton()?.click())
    await flush()

    expect(mocks.notify).toHaveBeenCalledWith(
      '通知配置已保存',
      'success',
      { id: 'automation-notification-save' },
    )
    expect(statusTexts()).toEqual([])
    expect(container.textContent).not.toContain('通知配置已保存')
  })

  it('routes failed test and save results to error toasts', async () => {
    mocks.testNotificationChannel.mockResolvedValue({ success: false, message: '测试通知失败' })
    mocks.saveNotificationConfig.mockResolvedValue({ success: false, message: '通知配置保存失败' })

    await renderMode('visible')
    await act(async () => testButton()?.click())
    await flush()
    expect(mocks.notify).toHaveBeenCalledWith(
      '测试通知失败',
      'error',
      { id: 'automation-notification-test' },
    )

    await setInputValue(tokenInput()!, 'draft-token')
    await act(async () => saveButton()?.click())
    await flush()
    expect(mocks.notify).toHaveBeenCalledWith(
      '通知配置保存失败',
      'error',
      { id: 'automation-notification-save' },
    )
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('finishes a pending save after Activity cleanup and writes the Query cache', async () => {
    const saveRequest = deferred<{ success: boolean; message: string }>()
    mocks.saveNotificationConfig.mockReturnValue(saveRequest.promise)

    await renderMode('visible')
    await setInputValue(tokenInput()!, 'draft-token')
    await act(async () => saveButton()?.click())
    expect(mocks.saveNotificationConfig).toHaveBeenCalledOnce()
    expect(mocks.saveNotificationConfig.mock.calls[0]?.[1]).toBeUndefined()

    await renderMode('hidden')
    await act(async () => saveRequest.resolve({ success: true, message: '已保存' }))
    await flush()

    expect(queryClient.getQueryData(['automation', 'notification-config'])).toEqual({
      enabled: true,
      channels: {
        telegram: {
          enabled: true,
          botToken: 'draft-token',
          chatId: 'server-chat',
        },
      },
    })
  })

  it('reuses cached notification config after a real remount', async () => {
    await renderMode('visible')
    expect(tokenInput()?.value).toBe('server-token')

    await act(async () => root.unmount())
    root = createRoot(container)
    await renderMode('visible')

    expect(mocks.getNotificationConfig).toHaveBeenCalledOnce()
  })

  it('aborts a pending notification test when the component effects are removed', async () => {
    const testRequest = deferred<{ success: boolean; message: string }>()
    mocks.testNotificationChannel.mockReturnValue(testRequest.promise)

    await renderMode('visible')
    await act(async () => testButton()?.click())
    const testCall = mocks.testNotificationChannel.mock.calls[0]
    const testSignal = testCall?.[2] as AbortSignal | undefined
    expect(testSignal?.aborted).toBe(false)

    await act(async () => root.unmount())
    expect(testSignal?.aborted).toBe(true)

    await act(async () => testRequest.resolve({ success: true, message: '已发送' }))
    await flush()
  })

  it('renders only the loading state while the notification config is pending', async () => {
    mocks.getNotificationConfig.mockReturnValue(new Promise(() => {}))

    await renderMode('visible')

    expect(container.textContent).toContain('读取通知配置…')
    expect(container.textContent).not.toContain('已保存')
    expect(container.textContent).not.toContain('有未保存的更改')
    expect(tokenInput()).toBeNull()
    expect(saveButton()).toBeUndefined()
    expect(container.querySelector('[aria-label="启用通知"]')?.getAttribute('aria-disabled')).toBe('true')
  })

  it('keeps saving available while a notification test is pending', async () => {
    const testRequest = deferred<{ success: boolean; message: string }>()
    mocks.testNotificationChannel.mockReturnValue(testRequest.promise)

    await renderMode('visible')
    await setInputValue(tokenInput()!, 'draft-token')
    await act(async () => testButton()?.click())

    expect(saveButton()?.disabled).toBe(false)

    await act(async () => testRequest.resolve({ success: true, message: '已发送' }))
    await flush()
  })

  it('keeps testing available while a save is pending', async () => {
    const saveRequest = deferred<{ success: boolean; message: string }>()
    mocks.saveNotificationConfig.mockReturnValue(saveRequest.promise)

    await renderMode('visible')
    await setInputValue(tokenInput()!, 'draft-token')
    await act(async () => saveButton()?.click())

    expect(testButton()?.disabled).toBe(false)

    await act(async () => saveRequest.resolve({ success: true, message: '已保存' }))
    await flush()
  })
})
