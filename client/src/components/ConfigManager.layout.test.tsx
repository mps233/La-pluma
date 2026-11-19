// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConfigManager from './ConfigManager'
import { installMobileMatchMedia, swipe } from '../test/swipe'

afterEach(cleanup)

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getConfigDir: vi.fn(),
  getVersion: vi.fn(),
  loadUserConfig: vi.fn(),
  openConfigDir: vi.fn(),
  saveConfig: vi.fn(),
  saveUserConfig: vi.fn(),
  setupAutoUpdate: vi.fn(),
  updateMaaCore: vi.fn(),
  updateMaaCli: vi.fn(),
  hotUpdateResources: vi.fn(),
  setMessage: vi.fn(),
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

vi.mock('../services/api', () => ({
  maaApi: {
    getConfig: mocks.getConfig,
    getConfigDir: mocks.getConfigDir,
    getVersion: mocks.getVersion,
    loadUserConfig: mocks.loadUserConfig,
    openConfigDir: mocks.openConfigDir,
    saveConfig: mocks.saveConfig,
    saveUserConfig: mocks.saveUserConfig,
    setupAutoUpdate: mocks.setupAutoUpdate,
    updateMaaCore: mocks.updateMaaCore,
    updateMaaCli: mocks.updateMaaCli,
    hotUpdateResources: mocks.hotUpdateResources,
    getErrorMessage: (result: { message?: string; error?: string }) => result.message || result.error || '未知错误',
  },
}))

vi.mock('../store/statusStore', () => {
  const state = { setMessage: mocks.setMessage }
  return {
    useStatusStore: (selector?: (value: typeof state) => unknown) =>
      selector ? selector(state) : state,
  }
})

vi.mock('./FloatingStatusIndicator', () => ({ default: () => null }))

let user: ReturnType<typeof userEvent.setup>

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('ConfigManager layout surfaces', () => {
  beforeEach(() => {
    localStorage.clear()
    user = userEvent.setup()
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
    mocks.loadUserConfig.mockReset().mockResolvedValue({
      success: true,
      data: { enabled: false, time: '04:00', updateCore: true, updateCli: true },
    })
    mocks.openConfigDir.mockReset().mockResolvedValue({ success: true })
    mocks.saveConfig.mockReset().mockResolvedValue({ success: true })
    mocks.saveUserConfig.mockReset().mockResolvedValue({ success: true })
    mocks.setupAutoUpdate.mockReset().mockResolvedValue({ success: true })
    mocks.updateMaaCore.mockReset().mockResolvedValue({ success: true })
    mocks.updateMaaCli.mockReset().mockResolvedValue({ success: true })
    mocks.hotUpdateResources.mockReset().mockResolvedValue({ success: true })
    mocks.setMessage.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the shared liquid segments and continuous corners for the configuration workspace', async () => {
    const { container } = render(<ConfigManager />)
    await flush()

    const page = container.querySelector('.ios-workspace-page')
    expect(page).not.toBeNull()
    expect(page?.classList.contains('ios-borderless-cards')).toBe(true)
    expect(page?.querySelector('.app-page-header')?.classList.contains('is-mobile-inline')).toBe(true)
    expect(page?.querySelector('.app-page-header-icon')).toBeNull()

    const cards = page?.querySelectorAll('.app-card[data-smooth-corners="true"]') ?? []
    expect(cards).toHaveLength(6)
    cards.forEach((card) => {
      expect(card.classList.contains('!p-0')).toBe(true)
      expect(card.querySelector(':scope > .app-card-smooth-surface')).not.toBeNull()
    })
    const workspace = page?.querySelector(':scope > .config-workspace-grid')
    const primaryColumn = workspace?.querySelector(':scope > .config-workspace-primary')
    const secondaryColumn = workspace?.querySelector(':scope > .config-workspace-secondary')
    expect(workspace).not.toBeNull()
    expect(workspace?.children).toHaveLength(2)
    expect(primaryColumn?.classList.contains('min-w-0')).toBe(true)
    expect(secondaryColumn?.classList.contains('min-w-0')).toBe(true)
    expect(Array.from(primaryColumn?.querySelectorAll(':scope > .app-card') ?? [])).toEqual([cards[3]])
    expect(Array.from(secondaryColumn?.querySelectorAll(':scope > .app-card') ?? [])).toEqual([cards[4]])
    expect(cards[0]?.classList.contains('config-editor-card')).toBe(true)
    expect(cards[3]?.classList.contains('config-directory-card')).toBe(true)
    expect(cards[4]?.classList.contains('config-update-card')).toBe(true)
    expect(page?.querySelectorAll(':scope > .app-card')).toHaveLength(0)
    expect(cards[0]?.querySelector(':scope > .app-card-smooth-surface > .app-card-content')).not.toBeNull()

    const navigation = page?.querySelector('[data-config-sections]')
    const navigationTrack = navigation?.querySelector('.lg-track[role="tablist"]')
    expect(navigationTrack?.getAttribute('aria-label')).toBe('配置类型')
    const navigationItems = Array.from(
      navigationTrack?.querySelectorAll<HTMLButtonElement>(':scope > .lg-track__item') ?? [],
    )
    expect(navigationItems).toHaveLength(3)
    expect(navigationItems[0]?.getAttribute('aria-selected')).toBe('true')
    expect(navigationItems[0]?.textContent).toContain('连接')
    expect(page?.querySelector('.smooth-panel-shell')).toBeNull()
    expect(page?.querySelector('.app-card .app-info-card')).toBeNull()

    const autoUpdateToggle = screen.getByRole('switch', { name: '启用自动更新' }) as HTMLButtonElement
    expect(autoUpdateToggle.getAttribute('role')).toBe('switch')
    expect(autoUpdateToggle.classList.contains('lg-switch')).toBe(true)
    expect(autoUpdateToggle.querySelector('.lg-switch__track')).not.toBeNull()
    const reconnectRow = page?.querySelector('.config-reconnect-row')
    expect(reconnectRow).not.toBeNull()
    expect(reconnectRow?.classList.contains('surface-soft')).toBe(false)

    const configPath = Array.from(page?.querySelectorAll('p') ?? []).find(element => element.textContent === '/tmp/la-pluma')
    expect(configPath?.classList.contains('break-all')).toBe(false)
    expect(configPath?.classList.contains('break-words')).toBe(true)
  })

  it('switches configuration sections with a horizontal swipe', async () => {
    installMobileMatchMedia()
    const { container } = render(<ConfigManager />)
    await flush()

    const navigationTrack = container.querySelector('[data-config-sections] .lg-track[role="tablist"]')
    const navigationItems = Array.from(
      navigationTrack?.querySelectorAll<HTMLButtonElement>(':scope > .lg-track__item') ?? [],
    )
    expect(navigationItems[0]?.getAttribute('aria-selected')).toBe('true')

    await swipe(container.querySelector<HTMLElement>('.ios-workspace-page')!, 240, 200, 120, 204)
    await flush()

    expect(navigationItems[1]?.getAttribute('aria-selected')).toBe('true')
    expect(localStorage.getItem('laPlumaConfigSection')).toBe('resource')
  })

  it('shows a retryable config-directory error instead of an endless loading label', async () => {
    mocks.getConfigDir.mockResolvedValueOnce({ success: false, message: '目录服务暂不可用' })

    const { container } = render(<ConfigManager />)
    await flush()

    expect(container.textContent).not.toContain('正在读取目录...')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('配置目录读取失败: 目录服务暂不可用')
    const openButton = screen.getByRole('button', { name: '打开目录' }) as HTMLButtonElement
    const retryButton = screen.getByRole('button', { name: '重试' }) as HTMLButtonElement
    expect(openButton.disabled).toBe(true)
    expect(retryButton).toBeDefined()

    mocks.getConfigDir.mockResolvedValueOnce({ success: true, data: '/tmp/recovered-config' })
    await user.click(retryButton)
    await flush()

    expect(container.textContent).toContain('/tmp/recovered-config')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(openButton.disabled).toBe(false)
  })

  it('keeps auto-update edits local until the user explicitly saves them', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { enabled: true, time: '04:00', updateCore: true, updateCli: false },
    })

    const { container } = render(<ConfigManager />)
    await flush()

    expect(mocks.setupAutoUpdate).not.toHaveBeenCalled()

    const timeInput = screen.getByPlaceholderText<HTMLInputElement>('HH:MM')
    expect(timeInput).not.toBeNull()

    await user.clear(timeInput)
    await user.type(timeInput, '05:30')

    expect(mocks.saveUserConfig).not.toHaveBeenCalled()
    expect(mocks.setupAutoUpdate).not.toHaveBeenCalled()
    expect(container.textContent).toContain('有尚未保存的更改')

    const saveButton = screen.getByRole('button', { name: '保存自动更新' }) as HTMLButtonElement
    expect(saveButton.disabled).toBe(false)

    await user.click(saveButton)
    await flush()

    const expectedConfig = { enabled: true, time: '05:30', updateCore: true, updateCli: false }
    expect(mocks.saveUserConfig).toHaveBeenCalledWith('auto-update', expectedConfig)
    expect(mocks.setupAutoUpdate).toHaveBeenCalledWith(expectedConfig)
    expect(mocks.saveUserConfig.mock.invocationCallOrder[0]!).toBeLessThan(mocks.setupAutoUpdate.mock.invocationCallOrder[0]!)
    expect(localStorage.getItem('autoUpdateConfig')).toBe(JSON.stringify(expectedConfig))
  })

  it('shows connection save failures in place and in the global status', async () => {
    mocks.saveConfig.mockResolvedValue({ success: false, message: '磁盘只读' })

    const { container } = render(<ConfigManager />)
    await flush()

    const saveButton = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    await user.click(saveButton)
    await flush()

    const inlineError = container.querySelector('[role="alert"]')
    expect(inlineError?.textContent).toContain('连接配置保存失败: 磁盘只读')
    expect(mocks.setMessage).toHaveBeenCalledWith('连接配置保存失败: 磁盘只读', 'error')
  })

  it('keeps an auto-update draft editable when persistence fails', async () => {
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { enabled: true, time: '04:00', updateCore: true, updateCli: true },
    })
    mocks.saveUserConfig.mockResolvedValue({ success: false, message: '配置目录不可写' })

    const { container } = render(<ConfigManager />)
    await flush()

    const timeInput = screen.getByPlaceholderText<HTMLInputElement>('HH:MM')
    await user.clear(timeInput)
    await user.type(timeInput, '06:15')

    const saveButton = screen.getByRole('button', { name: '保存自动更新' }) as HTMLButtonElement
    await user.click(saveButton)
    await flush()

    expect(mocks.setupAutoUpdate).not.toHaveBeenCalled()
    expect(timeInput.value).toBe('06:15')
    expect(saveButton.disabled).toBe(false)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('自动更新设置保存失败: 配置目录不可写')
    expect(mocks.setMessage).toHaveBeenCalledWith('自动更新设置保存失败: 配置目录不可写', 'error')
  })

  it('does not mark edits made during an auto-update save as persisted', async () => {
    const pendingSave = deferred<{ success: boolean }>()
    mocks.loadUserConfig.mockResolvedValue({
      success: true,
      data: { enabled: true, time: '04:00', updateCore: true, updateCli: true },
    })
    mocks.saveUserConfig.mockReturnValueOnce(pendingSave.promise)

    const { container } = render(<ConfigManager />)
    await flush()

    const timeInput = screen.getByPlaceholderText<HTMLInputElement>('HH:MM')!
    const setTime = async (value: string) => {
      await user.clear(timeInput)
      await user.type(timeInput, value)
    }
    await setTime('05:30')
    const saveButton = screen.getByRole('button', { name: '保存自动更新' }) as HTMLButtonElement
    await user.click(saveButton)
    await setTime('06:45')

    await act(async () => pendingSave.resolve({ success: true }))
    await flush()

    expect(mocks.setupAutoUpdate).toHaveBeenCalledWith({ enabled: true, time: '05:30', updateCore: true, updateCli: true })
    expect(timeInput.value).toBe('06:45')
    expect(localStorage.getItem('autoUpdateConfig')).toContain('06:45')
    expect(container.textContent).toContain('当前更改尚未保存')
    expect(saveButton.disabled).toBe(false)
  })

  it('does not let the initial connection response replace an edited draft', async () => {
    const pendingConfig = deferred<{
      success: boolean
      data: { adb_path: string; address: string; config: string; auto_reconnect: boolean }
    }>()
    mocks.getConfig.mockReturnValueOnce(pendingConfig.promise)

    render(<ConfigManager />)
    await flush()

    const addressInput = screen.getByLabelText<HTMLInputElement>('连接地址')
    expect(addressInput.value).toBe('127.0.0.1:16384')
    await user.clear(addressInput)
    await user.type(addressInput, '127.0.0.1:5555')

    await act(async () => pendingConfig.resolve({
      success: true,
      data: { adb_path: '/server/adb', address: '10.0.0.2:5555', config: 'General', auto_reconnect: false },
    }))
    await flush()

    expect(addressInput.value).toBe('127.0.0.1:5555')
  })

  it('serializes component updates behind one shared busy state', async () => {
    const pendingCoreUpdate = deferred<{ success: boolean; message: string }>()
    mocks.updateMaaCore.mockReturnValueOnce(pendingCoreUpdate.promise)
    render(<ConfigManager />)
    await flush()

    const coreButton = screen.getByRole('button', { name: '更新 MaaCore' }) as HTMLButtonElement
    const cliButton = screen.getByRole('button', { name: '更新 MAA CLI' }) as HTMLButtonElement
    await user.click(coreButton)
    await user.click(cliButton)

    expect(mocks.updateMaaCore).toHaveBeenCalledOnce()
    expect(mocks.updateMaaCli).not.toHaveBeenCalled()
    expect(cliButton.disabled).toBe(true)

    await act(async () => pendingCoreUpdate.resolve({ success: true, message: '已更新' }))
    await flush()
    expect(cliButton.disabled).toBe(false)
  })

  it('keeps the resource retry action at a 44px touch target', async () => {
    mocks.updateMaaCore.mockResolvedValue({
      success: false,
      message: '资源同步失败',
      error: { details: { failedStep: 'resources', coreUpdated: true } },
    })
    render(<ConfigManager />)
    await flush()

    const coreButton = screen.getByRole('button', { name: '更新 MaaCore' }) as HTMLButtonElement
    await user.click(coreButton)
    await flush()

    const retryButton = screen.getByRole('button', { name: '重试资源同步' }) as HTMLButtonElement
    expect(retryButton.classList.contains('!min-h-11')).toBe(true)
    expect(retryButton.classList.contains('lg:!min-h-0')).toBe(true)
    expect(retryButton.classList.contains('!min-h-0')).toBe(false)
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

    const { container } = render(<ConfigManager />)
    await flush()

    const coreCheckbox = screen.getByRole('checkbox', { name: '更新 MaaCore' }) as HTMLInputElement
    await user.click(coreCheckbox)

    const saveButton = screen.getByRole('button', { name: '保存自动更新' }) as HTMLButtonElement
    await user.click(saveButton)
    await flush()

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('自动更新设置应用失败: 无法创建定时任务')
    expect(saveButton.disabled).toBe(false)
    expect(mocks.setMessage).toHaveBeenCalledWith('自动更新设置应用失败: 无法创建定时任务', 'error')
  })

  it('renders unsupported resource and instance settings as honest read-only guidance', async () => {
    localStorage.setItem('laPlumaConfigSection', 'resource')

    const { container } = render(<ConfigManager />)
    await flush()

    const activeEditor = () => container.querySelector('.swipe-mode-slide:not([aria-hidden="true"]) .config-editor-card')
    const editor = activeEditor()
    expect(editor?.textContent).toContain('当前资源来源保持不变')
    expect(editor?.querySelector('select')).toBeNull()
    expect(Array.from(editor?.querySelectorAll('button') ?? []).some(button => button.textContent?.trim() === '保存')).toBe(false)

    const instanceButton = screen.getByRole('tab', { name: '实例' })
    // GlassSegmented derives the pointer-up index from layout geometry, which is
    // zero-sized in jsdom; a direct click exercises the same onChange path.
    fireEvent.click(instanceButton)
    await flush()

    const instanceEditor = activeEditor()
    expect(instanceEditor?.textContent).toContain('触摸模式等实例选项保持当前设置')
    expect(instanceEditor?.querySelector('select')).toBeNull()
  })
})
