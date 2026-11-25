// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigSaveOutcome } from '../model/configDraftOwner'
import { useConfigDraftPanel, type ConfigDraftPanelOptions } from './useConfigDraftPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const notifications = vi.hoisted(() => ({
  notify: vi.fn(),
  dismissNotice: vi.fn(),
}))

vi.mock('@/shared/notifications', () => ({
  notify: notifications.notify,
  dismissNotice: notifications.dismissNotice,
}))

type Panel = ReturnType<typeof useConfigDraftPanel<Record<string, unknown>>>

let root: Root
let container: HTMLDivElement
let latest: Panel | null = null

function Harness(props: ConfigDraftPanelOptions<Record<string, unknown>>) {
  const panel = useConfigDraftPanel(props)
  useEffect(() => {
    latest = panel
  }, [panel])
  return null
}

const baseOptions = (
  overrides: Partial<ConfigDraftPanelOptions<Record<string, unknown>>> = {},
): ConfigDraftPanelOptions<Record<string, unknown>> => ({
  label: '连接配置',
  noticeId: 'settings-config:connection',
  loadError: null,
  syncState: 'idle',
  error: null,
  save: async () => ({ status: 'saved', config: {}, superseded: false }),
  ...overrides,
})

const renderPanel = async (options: ConfigDraftPanelOptions<Record<string, unknown>>) => {
  await act(async () => root.render(<Harness {...options} />))
  await act(async () => {
    await Promise.resolve()
  })
}

const runSave = async () => {
  await act(async () => {
    await latest?.save()
  })
}

describe('useConfigDraftPanel notices', () => {
  beforeEach(() => {
    notifications.notify.mockReset()
    notifications.dismissNotice.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    latest = null
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps automatic save success silent', async () => {
    const save = vi.fn(async (): Promise<ConfigSaveOutcome<Record<string, unknown>>> => ({
      status: 'saved',
      config: {},
      superseded: false,
    }))
    await renderPanel(baseOptions({ save }))

    await runSave()

    expect(notifications.dismissNotice).toHaveBeenCalledWith('settings-config:connection')
    expect(notifications.notify).not.toHaveBeenCalled()
    expect(latest?.feedback).toBeNull()
  })

  it('ignores an in-flight save without clearing other notices', async () => {
    const save = vi.fn(async (): Promise<ConfigSaveOutcome<Record<string, unknown>>> => ({
      status: 'ignored',
      config: {},
      superseded: false,
    }))
    await renderPanel(baseOptions({ save }))

    await runSave()

    expect(notifications.notify).not.toHaveBeenCalled()
    expect(notifications.dismissNotice).not.toHaveBeenCalled()
  })

  it('reports a failed save with a retry action', async () => {
    const save = vi.fn(async (): Promise<ConfigSaveOutcome<Record<string, unknown>>> => ({
      status: 'failed',
      config: {},
      superseded: false,
      message: '磁盘只读',
    }))
    await renderPanel(baseOptions({ save }))

    await runSave()

    const action = notifications.notify.mock.calls[0]?.[2]?.action
    expect(notifications.notify).toHaveBeenCalledWith(
      '连接配置保存失败: 磁盘只读',
      'error',
      { id: 'settings-config:connection', action },
    )
    expect(action?.label).toBe('重试保存')

    save.mockClear()
    await act(async () => action.onClick())
    expect(save).toHaveBeenCalledOnce()
  })

  it('reports a thrown save without an outcome', async () => {
    await renderPanel(baseOptions({
      save: async () => {
        throw new Error('disk offline')
      },
    }))

    await runSave()

    expect(notifications.notify).toHaveBeenCalledWith(
      '连接配置保存失败: disk offline',
      'error',
      expect.objectContaining({ id: 'settings-config:connection' }),
    )
    expect(latest?.feedback).toBeNull()
  })

  it('derives load and save feedback for the card', async () => {
    await renderPanel(baseOptions({
      loadError: 'offline',
      syncState: 'failed',
      error: '磁盘只读',
    }))

    expect(latest?.feedback).toEqual({
      type: 'error',
      message: '连接配置读取失败: offline',
      retry: 'load',
    })
    expect(notifications.notify).toHaveBeenCalledWith('连接配置读取失败: offline', 'error')

    await act(async () => {
      root.render(<Harness {...baseOptions({ syncState: 'failed', error: '磁盘只读' })} />)
    })

    expect(latest?.feedback).toEqual({
      type: 'error',
      message: '连接配置保存失败: 磁盘只读',
      retry: 'save',
    })
  })
})
