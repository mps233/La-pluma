// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/query'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'
import { settingsAutoUpdateOwner } from '@/features/settings/model/autoUpdateConfig'
import { settingsConnectionOwner } from '@/features/settings/model/connectionConfig'
import { settingsDeviceConnectionOwner } from '@/features/settings/model/deviceConnection'
import { settingsKeys } from '@/features/settings/model/queryKeys'
import { settingsUpdateOwner } from '@/features/settings/model/updateCommands'
import ConfigManager from './ConfigManager'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * 每个领域 hook 被调用的次数就是面板渲染次数的代理：hook 只在自己所在的
 * 面板组件渲染时执行，因此可以用它验证设备/更新状态不会推动连接表单重渲染。
 */
const renderCounts = vi.hoisted(() => ({
  connection: 0,
  device: 0,
  updates: 0,
  autoUpdate: 0,
  version: 0,
  directory: 0,
}))

const mocks = vi.hoisted(() => ({
  discoverDevices: vi.fn(),
  getConfig: vi.fn(),
  getConfigDir: vi.fn(),
  getVersion: vi.fn(),
  loadUserConfig: vi.fn(),
  openConfigDir: vi.fn(),
  saveConfig: vi.fn(),
  saveUserConfig: vi.fn(),
  setupAutoUpdate: vi.fn(),
  testConnection: vi.fn(),
  updateMaaCore: vi.fn(),
  updateMaaCli: vi.fn(),
  hotUpdateResources: vi.fn(),
}))

vi.mock('@/features/settings/hooks/useSettingsConnectionConfig', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/settings/hooks/useSettingsConnectionConfig')>()
  return {
    ...actual,
    useSettingsConnectionConfig: (...args: Parameters<typeof actual.useSettingsConnectionConfig>) => {
      renderCounts.connection += 1
      return actual.useSettingsConnectionConfig(...args)
    },
  }
})

vi.mock('@/features/settings/hooks/useSettingsDeviceConnection', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/settings/hooks/useSettingsDeviceConnection')>()
  return {
    ...actual,
    useSettingsDeviceConnection: (...args: Parameters<typeof actual.useSettingsDeviceConnection>) => {
      renderCounts.device += 1
      return actual.useSettingsDeviceConnection(...args)
    },
  }
})

vi.mock('@/features/settings/hooks/useSettingsUpdates', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/settings/hooks/useSettingsUpdates')>()
  return {
    ...actual,
    useSettingsUpdates: (...args: Parameters<typeof actual.useSettingsUpdates>) => {
      renderCounts.updates += 1
      return actual.useSettingsUpdates(...args)
    },
  }
})

vi.mock('@/features/settings/hooks/useSettingsAutoUpdate', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/settings/hooks/useSettingsAutoUpdate')>()
  return {
    ...actual,
    useSettingsAutoUpdate: (...args: Parameters<typeof actual.useSettingsAutoUpdate>) => {
      renderCounts.autoUpdate += 1
      return actual.useSettingsAutoUpdate(...args)
    },
  }
})

vi.mock('@/features/settings/hooks/useSettingsVersion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/settings/hooks/useSettingsVersion')>()
  return {
    ...actual,
    useSettingsVersion: (...args: Parameters<typeof actual.useSettingsVersion>) => {
      renderCounts.version += 1
      return actual.useSettingsVersion(...args)
    },
  }
})

vi.mock('@/features/settings/hooks/useSettingsConfigDirectory', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/settings/hooks/useSettingsConfigDirectory')>()
  return {
    ...actual,
    useSettingsConfigDirectory: (...args: Parameters<typeof actual.useSettingsConfigDirectory>) => {
      renderCounts.directory += 1
      return actual.useSettingsConfigDirectory(...args)
    },
  }
})

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

vi.mock('@/features/settings/api', () => ({
  discoverDevices: mocks.discoverDevices,
  getConfig: mocks.getConfig,
  getConfigDir: mocks.getConfigDir,
  getVersion: mocks.getVersion,
  hotUpdateResources: mocks.hotUpdateResources,
  openConfigDir: mocks.openConfigDir,
  saveConfig: mocks.saveConfig,
  setupAutoUpdate: mocks.setupAutoUpdate,
  testConnection: mocks.testConnection,
  updateMaaCli: mocks.updateMaaCli,
  updateMaaCore: mocks.updateMaaCore,
}))

vi.mock('@/features/user-config', () => ({
  loadUserConfig: mocks.loadUserConfig,
  saveUserConfig: mocks.saveUserConfig,
}))

vi.mock('@/shared/notifications', () => ({
  notify: vi.fn(),
  notifyProgress: vi.fn(),
  dismissNotice: vi.fn(),
  detectNoticeType: () => 'default',
  EXECUTION_NOTICE_ID: 'execution',
  STATISTICS_NOTICE_ID: 'statistics',
  SETTINGS_UPDATE_NOTICE_ID: 'settings-update',
  SETTINGS_UPDATE_CHANNEL_NOTICE_ID: 'settings-update-channel',
  SETTINGS_AUTO_UPDATE_NOTICE_ID: 'settings-auto-update',
  SETTINGS_CONFIG_CONNECTION_NOTICE_ID: 'settings-config:connection',
  SETTINGS_CONFIG_INSTANCE_NOTICE_ID: 'settings-config:instance',
  SETTINGS_CONFIG_RESOURCE_SOURCE_NOTICE_ID: 'settings-config:resource-source',
}))

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient

const flush = async () => {
  await act(async () => {
    for (let index = 0; index < 3; index += 1) {
      await Promise.resolve()
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  })
}

const settle = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  await flush()
}

const page = () => (
  <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <ConfigManager />
    </QueryClientProvider>
  </ThemeProvider>
)

const buttonByText = (text: string) => (
  Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => button.textContent?.trim() === text)
)

const addressInput = () => (
  Array.from(container.querySelectorAll<HTMLInputElement>('input'))
    .find(input => input.value === '127.0.0.1:16384')
)

const setInputValue = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const snapshot = () => ({ ...renderCounts })

describe('ConfigManager panel subscriptions', () => {
  beforeEach(() => {
    localStorage.clear()
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    mocks.getConfig.mockReset().mockResolvedValue({
      success: true,
      data: {
        adb_path: '/opt/homebrew/bin/adb',
        address: '127.0.0.1:16384',
        config: 'CompatMac',
        auto_reconnect: true,
      },
    })
    mocks.getConfigDir.mockReset().mockResolvedValue({ success: true, data: '/tmp/la-pluma' })
    mocks.getVersion.mockReset().mockResolvedValue({
      success: true,
      data: { cli: '0.7.3', core: 'v5.0.0', raw: 'v5.0.0' },
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
      data: { enabled: true, time: '04:00', updateCore: true, updateCli: true },
    })
    mocks.openConfigDir.mockReset().mockResolvedValue({ success: true })
    mocks.saveConfig.mockReset().mockResolvedValue({ success: true })
    mocks.saveUserConfig.mockReset().mockResolvedValue({ success: true })
    mocks.setupAutoUpdate.mockReset().mockResolvedValue({ success: true })
    mocks.updateMaaCore.mockReset().mockResolvedValue({ success: true })
    mocks.updateMaaCli.mockReset().mockResolvedValue({ success: true })
    mocks.hotUpdateResources.mockReset().mockResolvedValue({ success: true })
    Object.keys(renderCounts).forEach(key => {
      renderCounts[key as keyof typeof renderCounts] = 0
    })
    settingsConnectionOwner.reset()
    settingsDeviceConnectionOwner.reset()
    settingsAutoUpdateOwner.reset()
    settingsUpdateOwner.reset()
    queryClient = createQueryClient()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    queryClient.clear()
    container.remove()
    vi.restoreAllMocks()
  })

  it('does not re-render the connection form when device or update state changes', async () => {
    await act(async () => root.render(page()))
    await flush()

    const initial = snapshot()
    expect(initial.connection).toBeGreaterThan(0)
    expect(initial.device).toBeGreaterThan(0)
    expect(initial.updates).toBeGreaterThan(0)
    expect(initial.autoUpdate).toBeGreaterThan(0)

    await act(async () => buttonByText('查找设备')?.click())
    await flush()

    const afterDevice = snapshot()
    expect(afterDevice.device).toBeGreaterThan(initial.device)
    expect(afterDevice.connection).toBe(initial.connection)
    expect(afterDevice.updates).toBe(initial.updates)
    expect(afterDevice.autoUpdate).toBe(initial.autoUpdate)
    expect(afterDevice.version).toBe(initial.version)
    expect(afterDevice.directory).toBe(initial.directory)

    await setInputValue(
      container.querySelector<HTMLInputElement>('input[placeholder="HH:MM"]')!,
      '05:30',
    )
    const afterAutoUpdate = snapshot()
    expect(afterAutoUpdate.autoUpdate).toBeGreaterThan(afterDevice.autoUpdate)
    expect(afterAutoUpdate.updates).toBe(afterDevice.updates)
    expect(afterAutoUpdate.version).toBe(afterDevice.version)
    expect(afterAutoUpdate.connection).toBe(afterDevice.connection)
    expect(afterAutoUpdate.device).toBe(afterDevice.device)
    expect(afterAutoUpdate.directory).toBe(afterDevice.directory)

    await act(async () => buttonByText('更新 MAA CLI')?.click())
    await settle()

    const afterUpdate = snapshot()
    expect(afterUpdate.updates).toBeGreaterThan(afterAutoUpdate.updates)
    expect(afterUpdate.connection).toBe(afterAutoUpdate.connection)
    expect(afterUpdate.device).toBe(afterAutoUpdate.device)
    expect(afterUpdate.autoUpdate).toBe(afterAutoUpdate.autoUpdate)
    expect(afterUpdate.directory).toBe(afterAutoUpdate.directory)
  })

  it('does not re-render update and directory panels when the connection draft changes', async () => {
    await act(async () => root.render(page()))
    await flush()

    const initial = snapshot()
    await setInputValue(addressInput()!, '127.0.0.1:5555')
    await settle()

    const afterEdit = snapshot()
    expect(afterEdit.connection).toBeGreaterThan(initial.connection)
    expect(afterEdit.device).toBeGreaterThan(initial.device)
    expect(afterEdit.updates).toBe(initial.updates)
    expect(afterEdit.autoUpdate).toBe(initial.autoUpdate)
    expect(afterEdit.version).toBe(initial.version)
    expect(afterEdit.directory).toBe(initial.directory)
  })

  it('does not re-render connection or update panels when the directory cache changes', async () => {
    await act(async () => root.render(page()))
    await flush()

    const initial = snapshot()
    await act(async () => {
      queryClient.setQueryData(settingsKeys.query('config-directory'), '/tmp/other-config')
    })
    await settle()

    const afterDirectory = snapshot()
    expect(afterDirectory.directory).toBeGreaterThan(initial.directory)
    expect(afterDirectory.connection).toBe(initial.connection)
    expect(afterDirectory.updates).toBe(initial.updates)
    expect(afterDirectory.autoUpdate).toBe(initial.autoUpdate)
    expect(afterDirectory.version).toBe(initial.version)
  })
})
