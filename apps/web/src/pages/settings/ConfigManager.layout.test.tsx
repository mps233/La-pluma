// @vitest-environment jsdom

import { Activity, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/query'
import { getItemIconCacheVersion } from '@/features/game-data'
import {
  subscribeResourceInvalidation,
  type ResourceInvalidation,
} from '@/features/resource-invalidation'
import { settingsAutoUpdateOwner } from '@/features/settings/model/autoUpdateConfig'
import { settingsConnectionOwner } from '@/features/settings/model/connectionConfig'
import { settingsInstanceOptionsOwner } from '@/features/settings/model/instanceOptions'
import { settingsResourceSourceOwner } from '@/features/settings/model/resourceSource'
import { CONFIG_SECTION_EVENT, CONFIG_SECTION_STORAGE_KEY } from '@/features/settings/model/configSection'
import { settingsDeviceConnectionOwner } from '@/features/settings/model/deviceConnection'
import { settingsUpdateOwner } from '@/features/settings/model/updateCommands'
import ConfigManager from './ConfigManager'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const optionInTriggerPopup = (trigger: HTMLElement, optionLabel: string) => {
  const popupId = trigger.getAttribute('aria-controls')
  const popup = popupId ? document.getElementById(popupId) : null
  return popup
    ? [...popup.querySelectorAll('[role="option"]')].find(node => node.textContent?.trim() === optionLabel)
    : undefined
}

const mocks = vi.hoisted(() => ({
  discoverDevices: vi.fn(),
  getConfig: vi.fn(),
  getConfigDir: vi.fn(),
  getResourceSource: vi.fn(),
  getVersion: vi.fn(),
  loadUserConfig: vi.fn(),
  openConfigDir: vi.fn(),
  saveConfig: vi.fn(),
  saveResourceSource: vi.fn(),
  saveUpdateChannel: vi.fn(),
  saveUserConfig: vi.fn(),
  setupAutoUpdate: vi.fn(),
  testConnection: vi.fn(),
  updateMaaCore: vi.fn(),
  updateMaaCli: vi.fn(),
  hotUpdateResources: vi.fn(),
  notify: vi.fn(),
  notifyProgress: vi.fn(),
  dismissNotice: vi.fn(),
}))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const motionComponent = (tag: 'button' | 'div') => React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children as ReactNode),
  )

  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    motion: {
      button: motionComponent('button'),
      div: motionComponent('div'),
    },
    useReducedMotion: () => true,
  }
})

vi.mock('@/shared/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/shared/api')>()
  return {
    ...actual,
    getErrorMessage: (result: { message?: string; error?: string }) => result.message || result.error || '未知错误',
  }
})

vi.mock('@/features/settings/api', () => ({
  discoverDevices: mocks.discoverDevices,
  getConfig: mocks.getConfig,
  getConfigDir: mocks.getConfigDir,
  getResourceSource: mocks.getResourceSource,
  getVersion: mocks.getVersion,
  hotUpdateResources: mocks.hotUpdateResources,
  openConfigDir: mocks.openConfigDir,
  saveConfig: mocks.saveConfig,
  saveResourceSource: mocks.saveResourceSource,
  saveUpdateChannel: mocks.saveUpdateChannel,
  setupAutoUpdate: mocks.setupAutoUpdate,
  testConnection: mocks.testConnection,
  updateMaaCli: mocks.updateMaaCli,
  updateMaaCore: mocks.updateMaaCore,
}))

vi.mock('@/features/user-config', () => ({
  loadUserConfig: mocks.loadUserConfig,
  saveUserConfig: mocks.saveUserConfig,
}))

vi.mock('@/shared/notifications', async importOriginal => {
  const actual = await importOriginal<typeof import('@/shared/notifications')>()
  return {
    ...actual,
    notify: mocks.notify,
    notifyProgress: mocks.notifyProgress,
    dismissNotice: mocks.dismissNotice,
  }
})

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient
let invalidationEvents: ResourceInvalidation[]
let stopInvalidations: (() => void) | null = null

const flush = async () => {
  await act(async () => {
    // 页面同时挂载 connection/version/目录 Query 与自动更新读取；Query 的
    // 批量通知与首个 effect 触发都可能排在后续任务里，因此每轮同时让出
    // 微任务与一个定时器，避免只等微任务时结果尚未落到 DOM。
    for (let index = 0; index < 3; index += 1) {
      await Promise.resolve()
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  })
}

/** Query 的批量通知默认走 setTimeout，重取后再给一轮定时器与渲染。 */
const settle = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  await flush()
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const page = (mode?: 'visible' | 'hidden') => (
  <QueryClientProvider client={queryClient}>
    {mode
      ? (
          <Activity mode={mode}>
            <ConfigManager />
          </Activity>
        )
      : <ConfigManager />}
  </QueryClientProvider>
)

const setInputValue = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const buttonByText = (text: string) => (
  Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => button.textContent?.trim() === text)
)

const buttonContaining = (text: string) => (
  Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => button.textContent?.includes(text))
)

const addressInputWithValue = (value: string) => (
  Array.from(container.querySelectorAll<HTMLInputElement>('input'))
    .find(input => input.value === value)
)

describe('ConfigManager layout surfaces', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.getConfig.mockReset().mockResolvedValue({
      success: true,
      data: {
        adb_path: '/opt/homebrew/bin/adb',
        address: '127.0.0.1:16384',
        config: 'CompatMac',
        preset: 'ADB',
        auto_reconnect: true,
      },
    })
    mocks.getConfigDir.mockReset().mockResolvedValue({ success: true, data: '/tmp/la-pluma' })
    mocks.getResourceSource.mockReset().mockResolvedValue({
      success: true,
      data: {
        autoUpdate: false,
        warnOnUpdateFailure: false,
        source: 'git',
        git: {
          backend: 'git',
          url: 'https://github.com/MaaAssistantArknights/MaaResource.git',
          branch: null,
        },
        mirrorchyan: { cdkKind: 'none', checkInterval: 600 },
      },
    })
    mocks.getVersion.mockReset().mockResolvedValue({
      success: true,
      data: {
        cli: '0.7.3',
        core: 'v5.0.0',
        raw: 'v5.0.0',
        updateChannels: { core: 'stable', cli: 'stable' },
      },
    })
    mocks.discoverDevices.mockReset().mockResolvedValue({
      success: true,
      data: {
        success: true,
        message: '找到 1 个设备或可尝试地址',
        devices: [
          { address: 'emulator-5554', state: 'device', details: 'ADB 已识别设备', source: 'adb' },
        ],
        candidates: [],
      },
    })
    mocks.testConnection.mockReset().mockResolvedValue({
      success: true,
      data: { success: true, connected: true, message: '已连接到 emulator-5554' },
    })
    mocks.loadUserConfig.mockReset().mockResolvedValue({
      success: true,
      data: { enabled: false, time: '04:00', updateCore: true, updateCli: true },
    })
    mocks.openConfigDir.mockReset().mockResolvedValue({ success: true })
    mocks.saveConfig.mockReset().mockResolvedValue({ success: true })
    mocks.saveResourceSource.mockReset().mockResolvedValue({ success: true })
    mocks.saveUpdateChannel.mockReset().mockResolvedValue({ success: true, data: { core: 'stable', cli: 'beta' } })
    mocks.saveUserConfig.mockReset().mockResolvedValue({ success: true })
    mocks.setupAutoUpdate.mockReset().mockResolvedValue({ success: true })
    mocks.updateMaaCore.mockReset().mockResolvedValue({ success: true })
    mocks.updateMaaCli.mockReset().mockResolvedValue({ success: true })
    mocks.hotUpdateResources.mockReset().mockResolvedValue({ success: true })
    mocks.notify.mockReset()
    mocks.notifyProgress.mockReset()
    mocks.dismissNotice.mockReset()
    invalidationEvents = []
    stopInvalidations = subscribeResourceInvalidation(event => {
      invalidationEvents.push(event)
    })
    settingsConnectionOwner.reset()
    settingsInstanceOptionsOwner.reset()
    settingsResourceSourceOwner.reset()
    settingsDeviceConnectionOwner.reset()
    settingsAutoUpdateOwner.reset()
    settingsUpdateOwner.reset()
    queryClient = createQueryClient()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    stopInvalidations?.()
    stopInvalidations = null
    await act(async () => root.unmount())
    queryClient.clear()
    container.remove()
    vi.restoreAllMocks()
  })

  it('keeps the config section nav roving and reports switch semantics', async () => {
    await act(async () => root.render(page()))
    await flush()

    const toolbar = container.querySelector('[role="toolbar"][aria-label="配置类型"]')
    expect(toolbar).not.toBeNull()
    const sections = Array.from(toolbar?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    expect(sections).toHaveLength(3)
    expect(sections.filter(button => button.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    expect(sections.find(button => button.getAttribute('aria-pressed') === 'true')?.textContent).toContain('连接')
    sections.forEach(button => {
      expect(button.tabIndex).toBe(button.getAttribute('aria-pressed') === 'true' ? 0 : -1)
    })

    const autoUpdateToggle = container.querySelector('[role="switch"][aria-label="启用自动更新"]')
    expect(autoUpdateToggle).not.toBeNull()
  })

  it('shows a retryable config-directory error instead of an endless loading label', async () => {
    mocks.getConfigDir.mockResolvedValueOnce({ success: false, message: '目录服务暂不可用' })

    await act(async () => root.render(page()))
    await flush()

    expect(container.textContent).not.toContain('正在读取目录...')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('配置目录读取失败: 目录服务暂不可用')
    const openButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('打开目录'))
    const retryButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '重试')
    expect(openButton?.disabled).toBe(true)
    expect(retryButton).toBeDefined()

    mocks.getConfigDir.mockResolvedValueOnce({ success: true, data: '/tmp/recovered-config' })
    await act(async () => retryButton?.click())
    await settle()

    expect(container.textContent).toContain('/tmp/recovered-config')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(openButton?.disabled).toBe(false)
  })

  it('does not retry a failed config-directory read when switching sections', async () => {
    // 每次读取都失败：切换 section 时若产生新的目录观察者，调用次数会继续增加。
    mocks.getConfigDir.mockResolvedValue({ success: false, message: '目录服务暂不可用' })

    await act(async () => root.render(page()))
    await flush()

    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain('配置目录读取失败: 目录服务暂不可用')
    expect(buttonByText('重试')).toBeDefined()
    const callsBeforeSwitch = mocks.getConfigDir.mock.calls.length

    const resourceButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('资源'))
    await act(async () => resourceButton?.click())
    await flush()

    expect(mocks.getConfigDir).toHaveBeenCalledTimes(callsBeforeSwitch)
    expect(container.textContent).toContain('配置目录读取失败: 目录服务暂不可用')
    expect(container.textContent).not.toContain('正在读取目录...')
    expect(buttonByText('重试')).toBeDefined()
    const openButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .filter(button => button.textContent?.trim() === '打开目录')
    expect(openButtons).toHaveLength(1)
    openButtons.forEach(button => expect(button.disabled).toBe(true))
  })

  it('keeps auto-update edits local until the user explicitly saves them', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { enabled: true, time: '04:00', updateCore: true, updateCli: false },
    })

    await act(async () => root.render(page()))
    await flush()

    expect(mocks.setupAutoUpdate).not.toHaveBeenCalled()

    const timeInput = container.querySelector<HTMLInputElement>('input[placeholder="HH:MM"]')
    expect(timeInput).not.toBeNull()

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(timeInput, '05:30')
      timeInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(mocks.saveUserConfig).not.toHaveBeenCalled()
    expect(mocks.setupAutoUpdate).not.toHaveBeenCalled()
    expect(container.textContent).toContain('有尚未保存的更改')

    const saveButton = Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes('保存自动更新')
    )
    expect(saveButton?.disabled).toBe(false)

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    const expectedConfig = { enabled: true, time: '05:30', updateCore: true, updateCli: false }
    expect(mocks.saveUserConfig).toHaveBeenCalledWith('auto-update', expectedConfig)
    expect(mocks.setupAutoUpdate).toHaveBeenCalledWith(expectedConfig)
    expect(mocks.saveUserConfig.mock.invocationCallOrder[0]!).toBeLessThan(mocks.setupAutoUpdate.mock.invocationCallOrder[0]!)
    expect(localStorage.getItem('autoUpdateConfig')).toBe(JSON.stringify(expectedConfig))
  })

  it('shows connection save failures in place and in the global status', async () => {
    mocks.saveConfig.mockResolvedValue({ success: false, message: '磁盘只读' })

    await act(async () => root.render(page()))
    await flush()

    const saveButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === '保存')
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    const inlineError = container.querySelector('[role="alert"]')
    expect(inlineError?.textContent).toContain('连接配置保存失败: 磁盘只读')
    expect(mocks.notifyProgress).toHaveBeenCalledWith('正在保存配置...', 'settings-config:connection')
    expect(mocks.notify).toHaveBeenCalledWith('连接配置保存失败: 磁盘只读', 'error', {
      id: 'settings-config:connection',
    })
  })

  it('keeps an auto-update draft editable when persistence fails', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { enabled: true, time: '04:00', updateCore: true, updateCli: true },
    })
    mocks.saveUserConfig.mockResolvedValue({ success: false, message: '配置目录不可写' })

    await act(async () => root.render(page()))
    await flush()

    const timeInput = container.querySelector<HTMLInputElement>('input[placeholder="HH:MM"]')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(timeInput, '06:15')
      timeInput?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const saveButton = Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes('保存自动更新')
    )
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.setupAutoUpdate).not.toHaveBeenCalled()
    expect(timeInput?.value).toBe('06:15')
    expect(saveButton?.disabled).toBe(false)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('自动更新设置保存失败: 配置目录不可写')
    expect(mocks.notify).toHaveBeenCalledWith('自动更新设置保存失败: 配置目录不可写', 'error', {
      id: 'settings-auto-update',
    })
  })

  it('keeps the connection form read-only until a slow first response is adopted', async () => {
    const pendingConfig = deferred<{
      success: boolean
      data: { adb_path: string; address: string; config: string; auto_reconnect: boolean }
    }>()
    mocks.getConfig.mockReturnValueOnce(pendingConfig.promise)

    await act(async () => root.render(page()))
    await flush()

    const addressInput = addressInputWithValue('127.0.0.1:16384')!
    expect(addressInput.disabled).toBe(true)
    expect(buttonByText('保存')?.disabled).toBe(true)
    expect(buttonByText('重置')?.disabled).toBe(true)

    await setInputValue(addressInput, '127.0.0.1:5555')
    await act(async () => buttonByText('保存')?.click())
    expect(mocks.saveConfig).not.toHaveBeenCalled()

    await act(async () => pendingConfig.resolve({
      success: true,
      data: { adb_path: '/server/adb', address: '10.0.0.2:5555', config: 'General', auto_reconnect: false },
    }))
    await flush()

    expect(addressInput.value).toBe('10.0.0.2:5555')
    expect(addressInput.disabled).toBe(false)
    expect(buttonByText('保存')?.disabled).toBe(false)
    expect(buttonByText('重置')?.disabled).toBe(false)

    await act(async () => buttonByText('保存')?.click())
    await flush()

    expect(mocks.saveConfig).toHaveBeenCalledWith('default', {
      connection: expect.objectContaining({ address: '10.0.0.2:5555' }),
    })
  })

  it('serializes component updates behind one shared busy state', async () => {
    const pendingCoreUpdate = deferred<{ success: boolean; message: string }>()
    mocks.updateMaaCore.mockReturnValueOnce(pendingCoreUpdate.promise)
    await act(async () => root.render(page()))
    await flush()

    const iconVersionBefore = getItemIconCacheVersion()
    const coreButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '更新 MaaCore')!
    const cliButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '更新 MAA CLI')!
    await act(async () => {
      coreButton.click()
      cliButton.click()
    })

    expect(mocks.updateMaaCore).toHaveBeenCalledOnce()
    expect(mocks.updateMaaCli).not.toHaveBeenCalled()
    expect(cliButton.disabled).toBe(true)
    expect(mocks.notifyProgress).toHaveBeenCalledWith('正在更新 MaaCore 并同步最新资源（大包下载最长可能需要约 15 分钟）...', 'settings-update')

    await act(async () => pendingCoreUpdate.resolve({ success: true, message: '已更新' }))
    await settle()
    expect(cliButton.disabled).toBe(false)
    expect(mocks.notify).toHaveBeenCalledWith('已更新', 'success', { id: 'settings-update' })
    expect(mocks.getVersion).toHaveBeenCalledTimes(2)
    expect(getItemIconCacheVersion()).toBeGreaterThan(iconVersionBefore)
    expect(invalidationEvents).toEqual([{
      resources: ['catalog', 'materials', 'training-plan', 'dashboard-snapshot'],
      cause: 'resource-update',
    }])

    const successCall = mocks.notify.mock.calls
      .findIndex(([message]) => message === '已更新')
    expect(successCall).toBeGreaterThanOrEqual(0)
    expect(mocks.notify.mock.invocationCallOrder[successCall]!)
      .toBeLessThan(mocks.getVersion.mock.invocationCallOrder[1]!)
  })

  it('reports success before the version refresh settles', async () => {
    const pendingVersion = deferred<{
      success: boolean
      data: { cli: string; core: string; raw: string }
    }>()

    await act(async () => root.render(page()))
    await flush()

    mocks.updateMaaCore.mockResolvedValueOnce({ success: true, message: '已更新' })
    mocks.getVersion.mockReturnValueOnce(pendingVersion.promise)

    await act(async () => buttonByText('更新 MaaCore')?.click())
    await flush()

    expect(mocks.notify).toHaveBeenCalledWith('已更新', 'success', { id: 'settings-update' })
    expect(buttonByText('更新 MaaCore')?.disabled).toBe(false)
    expect(mocks.getVersion).toHaveBeenCalledTimes(2)

    await act(async () => pendingVersion.resolve({
      success: true,
      data: { cli: '0.7.4', core: 'v5.0.1', raw: 'v5.0.1' },
    }))
    await settle()
  })

  it('offers a resource retry when a core update fails at the resource step', async () => {
    mocks.updateMaaCore.mockResolvedValue({
      success: false,
      message: '资源同步失败',
      error: '资源同步失败',
      errorInfo: { details: { failedStep: 'resources', coreUpdated: true } },
    })
    await act(async () => root.render(page()))
    await flush()

    const coreButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '更新 MaaCore')!
    await act(async () => coreButton.click())
    await flush()

    expect(invalidationEvents).toEqual([])
    expect(mocks.updateMaaCore).toHaveBeenCalledOnce()
    expect(mocks.getVersion).toHaveBeenCalledOnce()

    const retryButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '重试资源同步')
    expect(retryButton).toBeDefined()
    expect(retryButton?.disabled).toBe(false)

    await act(async () => retryButton?.click())
    await flush()
    expect(mocks.hotUpdateResources).toHaveBeenCalledOnce()
    expect(invalidationEvents).toHaveLength(1)
  })

  it('persists a changed update channel through the settings API', async () => {
    await act(async () => root.render(page()))
    await flush()

    const cliSelect = container.querySelector('[aria-label="MAA CLI 更新渠道"]')
    expect(cliSelect).not.toBeNull()
    await act(async () => (cliSelect as HTMLElement).click())
    const betaOption = optionInTriggerPopup(cliSelect as HTMLElement, 'Beta')
    expect(betaOption).toBeTruthy()
    await act(async () => (betaOption as HTMLElement).click())
    await settle()

    expect(mocks.saveUpdateChannel).toHaveBeenCalledWith('cli', 'beta')
    expect(mocks.notifyProgress).toHaveBeenCalledWith('正在保存更新渠道...', 'settings-update-channel')
    expect(mocks.notify).toHaveBeenCalledWith('更新渠道已保存', 'success', {
      id: 'settings-update-channel',
    })
    expect(mocks.getVersion).toHaveBeenCalledTimes(2)
  })

  it('switches the core channel using the current version and publishes resources', async () => {
    await act(async () => root.render(page()))
    await flush()

    await act(async () => buttonByText('切换测试版')?.click())
    await flush()

    expect(mocks.updateMaaCore).toHaveBeenCalledWith('beta')
    expect(mocks.notifyProgress).toHaveBeenCalledWith('正在切换到 Beta 渠道（大包下载最长可能需要约 15 分钟）...', 'settings-update')
    expect(container.textContent).toContain('已切换到 Beta 渠道并同步最新资源')
    expect(mocks.getVersion).toHaveBeenCalledTimes(2)
    expect(invalidationEvents).toHaveLength(1)
  })

  it('refreshes the version without resource invalidation after a CLI update', async () => {
    await act(async () => root.render(page()))
    await flush()

    const iconVersionBefore = getItemIconCacheVersion()
    const cliButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === '更新 MAA CLI')!
    await act(async () => cliButton.click())
    await flush()

    expect(mocks.updateMaaCli).toHaveBeenCalledOnce()
    expect(mocks.notify).toHaveBeenCalledWith('MAA CLI 更新成功', 'success', { id: 'settings-update' })
    expect(mocks.getVersion).toHaveBeenCalledTimes(2)
    expect(invalidationEvents).toEqual([])
    expect(getItemIconCacheVersion()).toBe(iconVersionBefore)
  })

  it('does not retry or publish invalidation when a component update fails', async () => {
    mocks.updateMaaCore.mockResolvedValue({
      success: false,
      message: '下载失败',
      errorInfo: { details: { failedStep: 'core', coreUpdated: false } },
    })
    await act(async () => root.render(page()))
    await flush()

    const iconVersionBefore = getItemIconCacheVersion()
    await act(async () => buttonByText('更新 MaaCore')?.click())
    await flush()

    expect(mocks.updateMaaCore).toHaveBeenCalledOnce()
    expect(mocks.getVersion).toHaveBeenCalledOnce()
    expect(invalidationEvents).toEqual([])
    expect(getItemIconCacheVersion()).toBe(iconVersionBefore)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('下载失败')
    expect(buttonByText('重试资源同步')).toBeUndefined()
  })

  it('keeps a committed core update running across Activity hide and refreshes the version on show', async () => {
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(page(mode))
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    await renderMode('visible')
    await flush()

    const pending = deferred<{ success: boolean; message: string }>()
    mocks.updateMaaCore.mockReturnValueOnce(pending.promise)
    await act(async () => buttonByText('更新 MaaCore')?.click())
    await flush()

    await renderMode('hidden')
    await act(async () => pending.resolve({ success: true, message: '后台更新完成' }))
    await settle()

    expect(invalidationEvents).toHaveLength(1)
    expect(mocks.getVersion).toHaveBeenCalledOnce()

    await renderMode('visible')
    await settle()

    expect(container.textContent).toContain('后台更新完成')
    expect(buttonByText('更新 MaaCore')?.disabled).toBe(false)
    expect(mocks.getVersion).toHaveBeenCalledTimes(2)
  })

  it('keeps an in-flight auto-update save running across Activity hide', async () => {
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(page(mode))
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { enabled: true, time: '04:00', updateCore: true, updateCli: true },
    })
    const pendingSave = deferred<{ success: boolean }>()
    mocks.saveUserConfig.mockReturnValueOnce(pendingSave.promise)

    await renderMode('visible')
    await flush()

    const timeInput = container.querySelector<HTMLInputElement>('input[placeholder="HH:MM"]')!
    await setInputValue(timeInput, '05:30')
    const saveButton = buttonContaining('保存自动更新')!
    await act(async () => saveButton.click())
    await flush()

    await renderMode('hidden')
    await act(async () => pendingSave.resolve({ success: true }))
    await settle()

    expect(mocks.setupAutoUpdate).toHaveBeenCalledOnce()
    expect(mocks.notifyProgress).toHaveBeenCalledWith('正在保存自动更新设置...', 'settings-auto-update')
    expect(mocks.notify).toHaveBeenCalledWith('自动更新已启用，每天 05:30 执行', 'success', {
      id: 'settings-auto-update',
    })

    await renderMode('visible')
    await settle()

    expect(container.textContent).toContain('自动更新已启用，每天 05:30 执行')
    expect(container.textContent).toContain('设置会在保存后生效')
    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()
  })

  it('reports a local auto-update fallback in place and globally when the server read fails', async () => {
    localStorage.setItem('autoUpdateConfig', JSON.stringify({
      enabled: true,
      time: '06:00',
      updateCore: true,
      updateCli: false,
    }))
    mocks.loadUserConfig.mockResolvedValue({ success: false, message: '配置目录不可读' })

    await act(async () => root.render(page()))
    await flush()

    const expected = '自动更新设置读取失败: 配置目录不可读，已显示此设备上次保存的设置，请保存后重试'
    expect(container.textContent).toContain(expected)
    expect(container.querySelector<HTMLInputElement>('input[placeholder="HH:MM"]')?.value).toBe('06:00')
    expect(container.textContent).toContain('有尚未保存的更改')
    expect(mocks.notify).toHaveBeenCalledWith(expected, 'warning')
  })

  it('does not report success when the scheduler rejects an enabled setting', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { enabled: true, time: '04:00', updateCore: true, updateCli: true },
    })
    mocks.setupAutoUpdate.mockResolvedValue({
      success: true,
      data: { success: false, message: '无法创建定时任务' },
    })

    await act(async () => root.render(page()))
    await flush()

    const coreCheckbox = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .find(input => input.labels?.[0]?.textContent?.includes('更新 MaaCore'))
    await act(async () => {
      coreCheckbox?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const saveButton = Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes('保存自动更新')
    )
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('自动更新设置应用失败: 无法创建定时任务')
    expect(saveButton?.disabled).toBe(false)
    expect(mocks.notify).toHaveBeenCalledWith('自动更新设置应用失败: 无法创建定时任务', 'error', {
      id: 'settings-auto-update',
    })
  })

  it('hides the repository address and branch and keeps instance options editable', async () => {
    localStorage.setItem('laPlumaConfigSection', 'resource')

    await act(async () => root.render(page()))
    await flush()

    expect(container.textContent).toContain('资源来源')
    expect(container.textContent).not.toContain('https://github.com/MaaAssistantArknights/MaaResource.git')
    expect(container.textContent).not.toContain('仓库地址')
    expect(container.textContent).not.toContain('Git 从官方仓库同步')
    const fieldLabels = Array.from(container.querySelectorAll('input')).flatMap(input =>
      Array.from(input.labels ?? [], label => label.textContent))
    expect(fieldLabels).not.toContain('分支')
    expect(container.textContent).not.toContain('留空跟随仓库默认分支')
    expect(fieldLabels).not.toContain('SSH 私钥路径')
    expect(fieldLabels).not.toContain('SSH 私钥口令')
    expect(container.textContent).not.toContain('ssh-agent')
    expect(buttonByText('保存')).toBeDefined()
    expect(mocks.getResourceSource).toHaveBeenCalledOnce()
    expect(mocks.getConfigDir).toHaveBeenCalledOnce()

    const instanceButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('实例'))
    await act(async () => {
      instanceButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    expect(container.textContent).toContain('触控模式')
    expect(container.textContent).toContain('部署时暂停')
  })

  it('saves the resource source form and reports success', async () => {
    localStorage.setItem('laPlumaConfigSection', 'resource')
    mocks.getResourceSource.mockResolvedValueOnce({
      success: true,
      data: {
        autoUpdate: true,
        warnOnUpdateFailure: false,
        source: 'mirrorchyan',
        git: { backend: 'git', url: 'https://github.com/MaaAssistantArknights/MaaResource.git', branch: 'saved-resource-branch' },
        mirrorchyan: { cdkKind: 'plain', checkInterval: 600 },
      },
    })

    await act(async () => root.render(page()))
    await flush()

    const cdk = Array.from(container.querySelectorAll<HTMLInputElement>('input'))
      .find(input => input.labels?.[0]?.textContent === 'MirrorChyan CDK')!
    expect(cdk.value).toBe('')
    expect(cdk.type).toBe('password')
    await act(async () => buttonByText('保存')?.click())
    await flush()

    expect(mocks.saveResourceSource).toHaveBeenCalledWith(expect.objectContaining({
      autoUpdate: true,
      warnOnUpdateFailure: false,
      source: 'mirrorchyan',
      git: { backend: 'git' },
      mirrorchyan: expect.objectContaining({ checkInterval: 600 }),
    }))
    expect(container.textContent).toContain('资源源配置保存成功')
    expect(mocks.getResourceSource).toHaveBeenCalledTimes(2)
  })

  it('saves only the instance options section from the instance form', async () => {
    localStorage.setItem('laPlumaConfigSection', 'instance')

    await act(async () => root.render(page()))
    await flush()

    await act(async () => buttonByText('保存')?.click())
    await flush()

    expect(mocks.saveConfig).toHaveBeenCalledWith('default', {
      instance_options: expect.any(Object),
    })
    expect(container.textContent).toContain('实例选项保存成功')
  })

  it('reports an initial connection read failure and recovers through the retry entry', async () => {
    mocks.getConfig.mockResolvedValueOnce({ success: false, message: '配置不可读' })

    await act(async () => root.render(page()))
    await flush()

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('连接配置读取失败: 配置不可读')
    expect(alert?.textContent).toContain('保存已禁用')
    expect(buttonByText('保存')?.disabled).toBe(true)
    expect(addressInputWithValue('127.0.0.1:16384')?.disabled).toBe(true)
    expect(buttonByText('重置')?.disabled).toBe(true)
    expect(mocks.notify).toHaveBeenCalledWith(
      '连接配置读取失败: 配置不可读（保存已禁用，请重试读取）',
      'error',
    )

    await act(async () => buttonByText('重新读取')?.click())
    await flush()

    expect(addressInputWithValue('127.0.0.1:16384')).toBeDefined()
    expect(addressInputWithValue('127.0.0.1:16384')?.disabled).toBe(false)
    expect(buttonByText('保存')?.disabled).toBe(false)
    expect(buttonByText('重置')?.disabled).toBe(false)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('keeps a connection save running across section switches and reports later edits as unsaved', async () => {
    const pendingSave = deferred<{ success: boolean }>()
    mocks.saveConfig.mockReturnValueOnce(pendingSave.promise)

    await act(async () => root.render(page()))
    await flush()

    const addressInput = Array.from(container.querySelectorAll<HTMLInputElement>('input'))
      .find(input => input.value === '127.0.0.1:16384')!
    await setInputValue(addressInput, '127.0.0.1:5555')
    await act(async () => buttonByText('保存')?.click())
    await setInputValue(addressInput, '127.0.0.1:6666')

    const resourceButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('资源'))
    await act(async () => resourceButton?.click())
    await act(async () => pendingSave.resolve({ success: true }))
    await flush()

    const connectionButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('连接'))
    await act(async () => connectionButton?.click())

    expect(mocks.saveConfig).toHaveBeenCalledWith('default', {
      connection: expect.objectContaining({ address: '127.0.0.1:5555' }),
    })
    expect(mocks.saveConfig).toHaveBeenCalledOnce()
    expect(Array.from(container.querySelectorAll<HTMLInputElement>('input'))
      .find(input => input.value === '127.0.0.1:6666')).toBeDefined()
    expect(container.textContent).toContain('当前更改尚未保存')
    expect(buttonByText('保存')?.disabled).toBe(false)
    expect(mocks.notify).toHaveBeenCalledWith('此前连接配置已保存，当前更改尚未保存', 'warning', {
      id: 'settings-config:connection',
    })
  })

  it('resets the connection draft without saving until an explicit save', async () => {
    mocks.getConfig.mockResolvedValue({
      success: true,
      data: { adb_path: '/usr/bin/adb', address: '10.0.0.2:5555', config: 'General', auto_reconnect: false },
    })

    await act(async () => root.render(page()))
    await flush()

    expect(Array.from(container.querySelectorAll<HTMLInputElement>('input'))
      .find(input => input.value === '10.0.0.2:5555')).toBeDefined()

    await act(async () => buttonByText('重置')?.click())

    expect(mocks.saveConfig).not.toHaveBeenCalled()
    expect(Array.from(container.querySelectorAll<HTMLInputElement>('input'))
      .find(input => input.value === '127.0.0.1:16384')).toBeDefined()

    const resourceButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('资源'))
    await act(async () => resourceButton?.click())
    const connectionButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('连接'))
    await act(async () => connectionButton?.click())

    expect(Array.from(container.querySelectorAll<HTMLInputElement>('input'))
      .find(input => input.value === '127.0.0.1:16384')).toBeDefined()

    await act(async () => buttonByText('保存')?.click())
    await flush()

    expect(mocks.saveConfig).toHaveBeenCalledWith('default', {
      connection: {
        adb_path: '/opt/homebrew/bin/adb',
        address: '127.0.0.1:16384',
        config: 'CompatMac',
        preset: 'ADB',
        auto_reconnect: true,
      },
    })
  })

  it('applies external section events, persists them, and removes the listener on unmount', async () => {
    const removeListener = vi.spyOn(window, 'removeEventListener')
    localStorage.setItem(CONFIG_SECTION_STORAGE_KEY, 'instance')

    await act(async () => root.render(page()))
    await flush()

    expect(container.textContent).toContain('触控模式')

    await act(async () => {
      window.dispatchEvent(new CustomEvent(CONFIG_SECTION_EVENT, { detail: 'resource' }))
    })
    expect(localStorage.getItem(CONFIG_SECTION_STORAGE_KEY)).toBe('resource')
    expect(container.textContent).toContain('资源来源')

    await act(async () => {
      window.dispatchEvent(new CustomEvent(CONFIG_SECTION_EVENT, { detail: 'unknown' }))
    })
    expect(localStorage.getItem(CONFIG_SECTION_STORAGE_KEY)).toBe('resource')

    const connectionButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('连接'))
    await act(async () => connectionButton?.click())
    expect(localStorage.getItem(CONFIG_SECTION_STORAGE_KEY)).toBe('connection')
    expect(container.querySelector('#connection-preset')).not.toBeNull()

    await act(async () => {
      root.render(null)
    })
    expect(removeListener.mock.calls.some(([type]) => type === CONFIG_SECTION_EVENT)).toBe(true)

    await act(async () => {
      window.dispatchEvent(new CustomEvent(CONFIG_SECTION_EVENT, { detail: 'instance' }))
    })
    expect(localStorage.getItem(CONFIG_SECTION_STORAGE_KEY)).toBe('connection')
  })

  it('keeps an edited connection draft and re-subscribes to section events after Activity restore', async () => {
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(page(mode))
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    await renderMode('visible')
    await flush()

    const addressInput = Array.from(container.querySelectorAll<HTMLInputElement>('input'))
      .find(input => input.value === '127.0.0.1:16384')!
    await setInputValue(addressInput, '127.0.0.1:5555')

    await renderMode('hidden')
    await renderMode('visible')

    expect(mocks.getConfig).toHaveBeenCalledOnce()
    await act(async () => {
      window.dispatchEvent(new CustomEvent(CONFIG_SECTION_EVENT, { detail: 'resource' }))
    })
    const resourceButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('资源'))
    expect(resourceButton?.getAttribute('aria-pressed')).toBe('true')

    const connectionButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('连接'))
    await act(async () => connectionButton?.click())
    expect(Array.from(container.querySelectorAll<HTMLInputElement>('input'))
      .find(input => input.value === '127.0.0.1:5555')).toBeDefined()
  })

  it('keeps connection and update feedback inside their own panels', async () => {
    mocks.saveConfig.mockResolvedValue({ success: false, message: '磁盘只读' })
    mocks.updateMaaCore.mockResolvedValue({
      success: false,
      message: '下载失败',
      errorInfo: { details: { failedStep: 'core', coreUpdated: false } },
    })

    await act(async () => root.render(page()))
    await flush()

    await act(async () => buttonByText('保存')?.click())
    await flush()
    await act(async () => buttonByText('更新 MaaCore')?.click())
    await flush()

    const alerts = Array.from(container.querySelectorAll<HTMLElement>('[role="alert"]'))
    const editorAlert = alerts.find(alert => alert.textContent?.includes('连接配置保存失败'))
    const updateAlert = alerts.find(alert => alert.textContent?.includes('下载失败'))
    expect(editorAlert?.textContent).toContain('连接配置保存失败: 磁盘只读')
    expect(updateAlert?.textContent).toContain('下载失败')
    expect(editorAlert?.textContent).not.toContain('下载失败')
    expect(updateAlert?.textContent).not.toContain('磁盘只读')
  })

  it('keeps an in-flight discovery running across section switches', async () => {
    const pendingDiscovery = deferred<{ success: boolean; data: unknown }>()
    mocks.discoverDevices.mockReturnValueOnce(pendingDiscovery.promise)

    await act(async () => root.render(page()))
    await flush()

    await act(async () => buttonByText('查找模拟器')?.click())
    await flush()
    const signal = mocks.discoverDevices.mock.calls[0]![1] as AbortSignal

    const resourceButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('资源'))
    await act(async () => resourceButton?.click())
    expect(signal.aborted).toBe(false)

    pendingDiscovery.resolve({
      success: true,
      data: {
        success: true,
        message: '找到 1 个设备或可尝试地址',
        devices: [{ address: 'emulator-5554', state: 'device', source: 'adb' }],
        candidates: [],
      },
    })
    await flush()

    const connectionButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('连接'))
    await act(async () => connectionButton?.click())

    expect(container.textContent).toContain('emulator-5554')
    expect(buttonByText('查找模拟器')).toBeDefined()
    expect(buttonByText('查找中')).toBeUndefined()
  })

  it('discovers devices with the draft adb path and backfills the selected device', async () => {
    await act(async () => root.render(page()))
    await flush()

    await act(async () => buttonByText('查找模拟器')?.click())
    await flush()

    expect(mocks.discoverDevices).toHaveBeenCalledWith(
      '/opt/homebrew/bin/adb',
      expect.any(AbortSignal),
    )
    expect(container.textContent).toContain('找到 1 个设备或可尝试地址')
    expect(container.textContent).toContain('emulator-5554')

    await act(async () => buttonContaining('emulator-5554')?.click())
    await flush()

    expect(mocks.testConnection).toHaveBeenCalledWith(
      '/opt/homebrew/bin/adb',
      'emulator-5554',
      expect.any(AbortSignal),
    )
    expect(addressInputWithValue('emulator-5554')).toBeDefined()
    expect(container.textContent).toContain('已连接到 emulator-5554')
  })

  it('shows a failed connection test without changing discovery results', async () => {
    await act(async () => root.render(page()))
    await flush()
    await act(async () => buttonByText('查找模拟器')?.click())
    await flush()

    mocks.testConnection.mockResolvedValueOnce({
      success: true,
      data: { success: false, message: '设备 emulator-5554 未授权，请在模拟器中允许 USB 调试' },
    })
    await act(async () => buttonByText('测试连接')?.click())
    await flush()

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('设备 emulator-5554 未授权')
    expect(container.textContent).toContain('emulator-5554')
    expect(buttonByText('测试连接')?.disabled).toBe(false)
  })

  it('keeps discovery loading independent from connection testing', async () => {
    const pendingDiscovery = deferred<{ success: boolean; data: unknown }>()
    mocks.discoverDevices.mockReturnValueOnce(pendingDiscovery.promise)

    await act(async () => root.render(page()))
    await flush()

    await act(async () => buttonByText('查找模拟器')?.click())
    await flush()

    expect(buttonByText('查找中')).toBeDefined()
    expect(buttonByText('测试连接')?.disabled).toBe(false)

    await act(async () => buttonByText('测试连接')?.click())
    await flush()

    expect(mocks.testConnection).toHaveBeenCalledWith(
      '/opt/homebrew/bin/adb',
      '127.0.0.1:16384',
      expect.any(AbortSignal),
    )
    expect(buttonByText('查找中')).toBeDefined()
    expect(container.textContent).toContain('已连接到 emulator-5554')

    pendingDiscovery.resolve({
      success: true,
      data: {
        success: true,
        message: '找到 1 个设备或可尝试地址',
        devices: [{ address: 'emulator-5554', state: 'device', source: 'adb' }],
        candidates: [],
      },
    })
    await flush()

    expect(buttonByText('查找模拟器')).toBeDefined()
    expect(container.textContent).toContain('emulator-5554')
  })

  it('reports discovery failures and retries with the same draft adb path', async () => {
    mocks.discoverDevices.mockRejectedValueOnce(new Error('adb 未安装'))

    await act(async () => root.render(page()))
    await flush()

    await act(async () => buttonByText('查找模拟器')?.click())
    await flush()

    expect(container.textContent).toContain('查找设备失败: adb 未安装')
    expect(buttonByText('查找模拟器')?.disabled).toBe(false)

    await act(async () => buttonByText('查找模拟器')?.click())
    await flush()

    expect(mocks.discoverDevices).toHaveBeenCalledTimes(2)
    expect(mocks.discoverDevices).toHaveBeenLastCalledWith(
      '/opt/homebrew/bin/adb',
      expect.any(AbortSignal),
    )
    expect(container.textContent).toContain('emulator-5554')
  })

  it('keeps completed discovery results across Activity hide and cancels an in-flight retry', async () => {
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(page(mode))
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    await renderMode('visible')
    await flush()
    await act(async () => buttonByText('查找模拟器')?.click())
    await flush()
    expect(container.textContent).toContain('emulator-5554')

    await renderMode('hidden')
    await renderMode('visible')
    expect(mocks.discoverDevices).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('emulator-5554')

    const pending = deferred<{ success: boolean; data: unknown }>()
    mocks.discoverDevices.mockReturnValueOnce(pending.promise)
    await act(async () => buttonByText('查找模拟器')?.click())
    await flush()
    const retrySignal = mocks.discoverDevices.mock.calls[1]![1] as AbortSignal

    await renderMode('hidden')
    expect(retrySignal.aborted).toBe(true)
    pending.resolve({
      success: true,
      data: {
        success: true,
        message: '迟到的结果',
        devices: [{ address: 'late-device', state: 'device', source: 'adb' }],
        candidates: [],
      },
    })
    await flush()
    await renderMode('visible')

    expect(container.textContent).toContain('emulator-5554')
    expect(container.textContent).not.toContain('late-device')
    expect(buttonByText('查找模拟器')).toBeDefined()

    await act(async () => buttonByText('查找模拟器')?.click())
    await flush()
    expect(mocks.discoverDevices).toHaveBeenCalledTimes(3)
    expect(container.textContent).toContain('emulator-5554')
  })

  it('cancels an in-flight connection test on hide and restores an actionable panel', async () => {
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(page(mode))
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    await renderMode('visible')
    await flush()
    await act(async () => buttonByText('查找模拟器')?.click())
    await flush()

    const pending = deferred<{ success: boolean; data: unknown }>()
    mocks.testConnection.mockReturnValueOnce(pending.promise)
    await act(async () => buttonContaining('emulator-5554')?.click())
    await flush()
    const signal = mocks.testConnection.mock.calls[0]![2] as AbortSignal

    await renderMode('hidden')
    expect(signal.aborted).toBe(true)

    pending.resolve({
      success: true,
      data: { success: true, message: '迟到的连接结果' },
    })
    await flush()
    await renderMode('visible')

    expect(buttonByText('测试连接')?.disabled).toBe(false)
    expect(container.textContent).not.toContain('迟到的连接结果')
    expect(addressInputWithValue('emulator-5554')).toBeDefined()
  })

  it('does not let a discovered-device test overwrite a newer address edit', async () => {
    await act(async () => root.render(page()))
    await flush()
    await act(async () => buttonByText('查找模拟器')?.click())
    await flush()

    const pending = deferred<{ success: boolean; data: unknown }>()
    mocks.testConnection.mockReturnValueOnce(pending.promise)
    await act(async () => buttonContaining('emulator-5554')?.click())
    await flush()

    await setInputValue(addressInputWithValue('emulator-5554')!, '127.0.0.1:6666')
    pending.resolve({
      success: true,
      data: { success: true, message: '已连接到 emulator-5554' },
    })
    await flush()

    expect(addressInputWithValue('127.0.0.1:6666')).toBeDefined()
    expect(mocks.saveConfig).not.toHaveBeenCalled()
  })

  it('loads version and config directory from their queries and keeps them across Activity hide', async () => {
    const renderMode = async (mode: 'visible' | 'hidden') => {
      await act(async () => {
        root.render(page(mode))
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    await renderMode('visible')
    await flush()

    expect(container.textContent).toContain('v5.0.0')
    expect(container.textContent).toContain('/tmp/la-pluma')

    await renderMode('hidden')
    await renderMode('visible')
    await flush()

    expect(mocks.getVersion).toHaveBeenCalledOnce()
    expect(mocks.getConfigDir).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('v5.0.0')
    expect(container.textContent).toContain('/tmp/la-pluma')
  })

  it('opens the config directory from the directory card', async () => {
    await act(async () => root.render(page()))
    await flush()

    const cardButton = buttonByText('打开目录')
    expect(cardButton).toBeDefined()
    await act(async () => cardButton?.click())
    await flush()

    expect(mocks.openConfigDir).toHaveBeenCalledTimes(1)
    expect(mocks.notify).toHaveBeenCalledWith('已打开配置目录')

    const resourceButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('资源'))
    await act(async () => resourceButton?.click())

    const openButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .filter(button => button.textContent?.trim() === '打开目录')
    expect(openButtons).toHaveLength(1)

    mocks.openConfigDir.mockResolvedValueOnce({ success: false, message: '没有桌面环境' })
    await act(async () => openButtons[0]?.click())
    await flush()

    expect(mocks.notify).toHaveBeenCalledWith('打开失败: 没有桌面环境')
  })
})
