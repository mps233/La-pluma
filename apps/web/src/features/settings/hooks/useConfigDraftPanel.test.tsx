// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigSaveOutcome } from '../model/configDraftOwner'
import { useConfigDraftPanel, type ConfigDraftPanelOptions } from './useConfigDraftPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const notifications = vi.hoisted(() => ({
  notify: vi.fn(),
  notifyProgress: vi.fn(),
  dismissNotice: vi.fn(),
}))

vi.mock('@/shared/notifications', () => ({
  notify: notifications.notify,
  notifyProgress: notifications.notifyProgress,
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
  savingMessage: '正在保存配置...',
  loadError: null,
  loaded: true,
  saving: false,
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
    notifications.notifyProgress.mockReset()
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

  it('dismisses the progress notice when the save is ignored', async () => {
    const save = vi.fn(async (): Promise<ConfigSaveOutcome<Record<string, unknown>>> => ({
      status: 'ignored',
      config: {},
      superseded: false,
    }))
    await renderPanel(baseOptions({ save }))

    await runSave()

    expect(notifications.notifyProgress).toHaveBeenCalledWith(
      '正在保存配置...',
      'settings-config:connection',
    )
    expect(notifications.dismissNotice).toHaveBeenCalledWith('settings-config:connection')
    expect(notifications.notify).not.toHaveBeenCalled()
  })

  it('replaces the progress notice when the save throws', async () => {
    await renderPanel(baseOptions({
      save: async () => {
        throw new Error('disk offline')
      },
    }))

    await runSave()

    expect(notifications.notify).toHaveBeenCalledWith(
      '连接配置保存失败: disk offline',
      'error',
      { id: 'settings-config:connection' },
    )
  })

  it('uses a non-progress notice for load failures and blocks save without starting progress', async () => {
    const save = vi.fn()
    await renderPanel(baseOptions({ loadError: 'offline', loaded: false, save }))

    expect(notifications.notify).toHaveBeenCalledWith(
      '连接配置读取失败: offline（保存已禁用，请重试读取）',
      'error',
    )

    notifications.notify.mockClear()
    notifications.notifyProgress.mockClear()
    await runSave()

    expect(notifications.notify).toHaveBeenCalledWith(
      '连接配置读取失败，暂时无法保存',
      'warning',
      { id: 'settings-config:connection' },
    )
    expect(notifications.notifyProgress).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })
})
