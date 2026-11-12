// @vitest-environment jsdom

import { Activity, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CombatTasks from './CombatTasks'
import { useRunStore } from '../store/runStore'
import { useUIStore } from '../stores/uiStore'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getTaskStatus: vi.fn(),
  loadUserConfig: vi.fn(),
  saveUserConfig: vi.fn(),
  stopTask: vi.fn(),
  executePredefinedTaskArgs: vi.fn(),
  executeCopilotSetPlan: vi.fn(),
  runActivitySet: vi.fn(),
  runActivityFallback: vi.fn(),
  getCopilotInfo: vi.fn(),
  getCopilotSet: vi.fn(),
  getCopilotSetPlan: vi.fn(),
  resetCopilotSetProgress: vi.fn(),
  searchCopilot: vi.fn(),
  searchParadoxCopilot: vi.fn(),
  setMessage: vi.fn(),
  clearMessage: vi.fn(),
  setActive: vi.fn(),
}))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const motionComponent = (tag: 'button' | 'div' | 'span') => React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, whileHover: _whileHover, whileTap: _whileTap, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children as ReactNode),
  )
  const motionValue = (initial: number) => ({
    get: () => initial,
    set: () => undefined,
    jump: () => undefined,
    on: () => () => undefined,
    stop: () => undefined,
  })

  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: {
      button: motionComponent('button'),
      div: motionComponent('div'),
      span: motionComponent('span'),
    },
    useMotionValue: (initial: number) => motionValue(initial),
    animate: () => ({
      then: (callback: () => void) => {
        callback()
        return Promise.resolve()
      },
    }),
    useReducedMotion: () => true,
  }
})

vi.mock('../services/api', () => ({
  maaApi: {
    getTaskStatus: mocks.getTaskStatus,
    loadUserConfig: mocks.loadUserConfig,
    saveUserConfig: mocks.saveUserConfig,
    stopTask: mocks.stopTask,
    executePredefinedTaskArgs: mocks.executePredefinedTaskArgs,
    executeCopilotSetPlan: mocks.executeCopilotSetPlan,
    runActivitySet: mocks.runActivitySet,
    runActivityFallback: mocks.runActivityFallback,
    getCopilotInfo: mocks.getCopilotInfo,
    getCopilotSet: mocks.getCopilotSet,
    getCopilotSetPlan: mocks.getCopilotSetPlan,
    resetCopilotSetProgress: mocks.resetCopilotSetProgress,
    getErrorMessage: (result: { message?: string; error?: string }) => result.message || result.error || '未知错误',
  },
  searchCopilot: mocks.searchCopilot,
  searchParadoxCopilot: mocks.searchParadoxCopilot,
}))

vi.mock('../store/statusStore', () => {
  const state = { setMessage: mocks.setMessage, clearMessage: mocks.clearMessage, setActive: mocks.setActive }
  return {
    useStatusStore: (selector?: (value: typeof state) => unknown) =>
      selector ? selector(state) : state,
  }
})

vi.mock('../hooks/useBackendStatusMonitor', () => ({
  useAutomationAvailability: () => ({ isAvailable: true, unavailableMessage: '' }),
}))

vi.mock('./FloatingStatusIndicator', () => ({ default: () => null }))
vi.mock('./ScreenMonitor', () => ({ default: () => <div data-testid="screen-monitor" /> }))

let container: HTMLDivElement
let root: Root

interface CopilotSearchResponse {
  success: boolean
  data: {
    copilots: Array<{ id: number; uri: string; title: string }>
  }
}

interface CopilotPreviewResponse {
  success: boolean
  data: {
    status_code: number
    data: { content: string }
  }
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const buttonsByText = (text: string) => Array.from(document.querySelectorAll('button'))
  .filter(button => button.textContent?.trim() === text) as HTMLButtonElement[]

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const keyDown = async (element: HTMLElement, key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  await act(async () => {
    element.dispatchEvent(event)
  })
  return event
}

const renderComponent = async () => {
  await act(async () => {
    root.render(<CombatTasks />)
  })
  await flush()
}

const renderActivityMode = async (mode: 'visible' | 'hidden') => {
  await act(async () => {
    root.render(
      <Activity mode={mode}>
        <CombatTasks />
      </Activity>,
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('CombatTasks execution recovery', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    localStorage.clear()
    mocks.getTaskStatus.mockReset().mockResolvedValue({ success: true, data: { isRunning: false } })
    mocks.loadUserConfig.mockReset().mockResolvedValue({ success: false })
    mocks.saveUserConfig.mockReset().mockResolvedValue({ success: true })
    mocks.stopTask.mockReset().mockResolvedValue({ success: true, data: { task: { success: true } } })
    mocks.executePredefinedTaskArgs.mockReset().mockResolvedValue({ success: true })
    mocks.executeCopilotSetPlan.mockReset().mockResolvedValue({ success: true, data: { pending: [] } })
    mocks.runActivitySet.mockReset().mockResolvedValue({ success: true, data: { pending: [] } })
    mocks.runActivityFallback.mockReset().mockResolvedValue({ success: true, data: { executed: true, pending: [] } })
    mocks.getCopilotInfo.mockReset()
    mocks.getCopilotSet.mockReset()
    mocks.getCopilotSetPlan.mockReset()
    mocks.resetCopilotSetProgress.mockReset()
    mocks.searchCopilot.mockReset()
    mocks.searchParadoxCopilot.mockReset()
    mocks.setMessage.mockReset()
    mocks.setActive.mockReset()
    useRunStore.getState().applyRun(null)
    useUIStore.getState().setCombatCopilotPrefill(null)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    document.body.style.overflow = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps each active task in the shared continuous-corner card', async () => {
    await renderComponent()

    const page = container.querySelector('.combat-page')
    expect(page?.classList.contains('ios-workspace-page')).toBe(true)
    expect(page?.querySelector('.app-page-header')?.classList.contains('is-mobile-inline')).toBe(true)

    const modeShell = page?.querySelector('.combat-mode-shell')
    const modeTrack = modeShell?.querySelector('.lg-track[role="tablist"]')
    expect(modeTrack?.getAttribute('aria-label')).toBe('作业类型')
    const modeButtons = modeTrack?.querySelectorAll(':scope > .lg-track__item') ?? []
    expect(modeButtons).toHaveLength(3)
    expect(Array.from(modeButtons).map(button => button.textContent)).toEqual([
      expect.stringContaining('普通作业'),
      expect.stringContaining('保全派驻'),
      expect.stringContaining('悖论模拟'),
    ])
    expect(modeTrack?.querySelectorAll(':scope > .lg-track__item[aria-selected="true"]')).toHaveLength(1)
    expect(Array.from(modeButtons).map(button => button.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])

    const firstModeButton = modeButtons[0] as HTMLButtonElement
    const secondModeButton = modeButtons[1] as HTMLButtonElement
    firstModeButton.focus()
    await keyDown(firstModeButton, 'ArrowRight')
    expect(secondModeButton.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(secondModeButton)

    await keyDown(secondModeButton, 'Home')
    expect(firstModeButton.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(firstModeButton)

    const arrowDownEvent = await keyDown(firstModeButton, 'ArrowDown')
    expect(arrowDownEvent.defaultPrevented).toBe(false)
    expect(firstModeButton.getAttribute('aria-selected')).toBe('true')

    const copilotCard = page?.querySelector('.combat-task-card')
    expect(copilotCard?.getAttribute('data-smooth-corners')).toBe('true')
    expect(copilotCard?.querySelector(':scope > .app-card-smooth-surface')).not.toBeNull()

    expect(Array.from(copilotCard?.querySelectorAll('summary') ?? [])
      .some(summary => summary.textContent?.trim() === '说明')).toBe(false)

    const sssModeButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.lg-track > .lg-track__item'))
      .find(button => button.textContent?.includes('保全派驻'))
    expect(sssModeButton).toBeDefined()
    await click(sssModeButton!)

    const sssCard = page?.querySelector('.combat-task-card')
    expect(sssCard?.getAttribute('data-smooth-corners')).toBe('true')
    expect(sssCard?.querySelector(':scope > .app-card-smooth-surface')).not.toBeNull()

    const monitor = page?.querySelector('.combat-monitor-panel')
    expect(monitor?.getAttribute('data-smooth-corners')).toBe('true')
    expect(monitor?.querySelector('.task-monitor-panel.is-compact')).not.toBeNull()
  })

  it('keeps an unsynced local draft across remounts and retries the save', async () => {
    vi.useFakeTimers()
    mocks.saveUserConfig.mockResolvedValueOnce({ success: false, message: '配置存储暂不可用' })
    await renderComponent()

    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'maa://24680')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(300)
    })
    await flush()

    expect(localStorage.getItem('combatConfigSyncPending')).not.toBeNull()
    expect(JSON.parse(localStorage.getItem('combatTaskInputs') || '{}')).toMatchObject({ copilot: 'maa://24680' })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('配置存储暂不可用')

    await act(async () => root.unmount())
    root = createRoot(container)
    mocks.loadUserConfig.mockClear()
    await renderComponent()

    expect(mocks.loadUserConfig).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')?.value).toBe('maa://24680')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('尚未同步到服务器')

    await click(buttonsByText('重新同步')[0]!)
    await flush()

    expect(mocks.saveUserConfig).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('combatConfigSyncPending')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(mocks.setMessage).toHaveBeenCalledWith('自动战斗配置已同步', 'success')
  })

  it('does not let an older save response clear a newer remounted draft', async () => {
    vi.useFakeTimers()
    const olderSave = deferred<{ success: boolean }>()
    const newerSave = deferred<{ success: boolean }>()
    mocks.saveUserConfig
      .mockReturnValueOnce(olderSave.promise)
      .mockReturnValueOnce(newerSave.promise)
    await renderComponent()

    let input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'maa://10001')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(300)
    })

    await act(async () => root.unmount())
    root = createRoot(container)
    await renderComponent()
    input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'maa://10002')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(300)
    })
    const newerSyncToken = localStorage.getItem('combatConfigSyncPending')
    expect(mocks.saveUserConfig).toHaveBeenCalledTimes(1)

    await act(async () => olderSave.resolve({ success: true }))
    await flush()
    expect(mocks.saveUserConfig).toHaveBeenCalledTimes(2)
    expect(mocks.saveUserConfig.mock.calls[1]?.[1]).toMatchObject({
      taskInputs: { copilot: 'maa://10002' },
    })
    expect(localStorage.getItem('combatConfigSyncPending')).toBe(newerSyncToken)
    expect(JSON.parse(localStorage.getItem('combatTaskInputs') || '{}')).toMatchObject({ copilot: 'maa://10002' })

    await act(async () => newerSave.resolve({ success: true }))
    await flush()
    expect(localStorage.getItem('combatConfigSyncPending')).toBeNull()
  })

  it('keeps the hydrated draft and does not reload config after Activity restore', async () => {
    vi.useFakeTimers()
    mocks.loadUserConfig.mockResolvedValueOnce({
      success: true,
      data: { taskInputs: { copilot: 'maa://server' } },
    })

    await renderActivityMode('visible')
    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'maa://draft')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await renderActivityMode('hidden')
    await renderActivityMode('visible')
    await act(async () => vi.advanceTimersByTimeAsync(300))
    await flush()

    expect(mocks.loadUserConfig).toHaveBeenCalledOnce()
    expect(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')?.value).toBe('maa://draft')
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()

    await renderActivityMode('hidden')
    await renderActivityMode('visible')
    await act(async () => vi.advanceTimersByTimeAsync(300))
    await flush()
    expect(mocks.saveUserConfig).toHaveBeenCalledOnce()
  })

  it('clears retained request loading when Activity restores the combat workspace', async () => {
    mocks.getCopilotInfo.mockReturnValueOnce(deferred<CopilotPreviewResponse>().promise)
    mocks.searchCopilot.mockReturnValueOnce(deferred<CopilotSearchResponse>().promise)
    mocks.searchParadoxCopilot.mockReturnValueOnce(deferred<CopilotSearchResponse>().promise)

    await renderActivityMode('visible')

    const previewInput = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(previewInput, 'maa://1234')
      previewInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const previewButton = previewInput.parentElement?.querySelector<HTMLButtonElement>('button')
    await click(previewButton!)
    expect(previewButton?.disabled).toBe(true)
    expect(mocks.getCopilotInfo).toHaveBeenCalledOnce()

    await renderActivityMode('hidden')
    await renderActivityMode('visible')
    expect(previewButton?.disabled).toBe(false)
    expect(previewButton?.textContent).toContain('预览')

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(previewInput, '1-7')
      previewInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const stageSearchButton = previewInput.parentElement?.querySelector<HTMLButtonElement>('button')
    await click(stageSearchButton!)
    expect(stageSearchButton?.disabled).toBe(true)
    expect(mocks.searchCopilot).toHaveBeenCalledOnce()

    await renderActivityMode('hidden')
    await renderActivityMode('visible')
    expect(stageSearchButton?.disabled).toBe(false)
    expect(stageSearchButton?.textContent).toContain('搜索')

    const paradoxModeButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.lg-track > .lg-track__item'))
      .find(button => button.textContent?.includes('悖论模拟'))
    await click(paradoxModeButton!)
    const paradoxInput = container.querySelector<HTMLInputElement>('input[name="maa-paradox-operator"]')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(paradoxInput, '能天使')
      paradoxInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const paradoxSearchButton = paradoxInput.parentElement?.querySelector<HTMLButtonElement>('button')
    await click(paradoxSearchButton!)
    expect(paradoxSearchButton?.disabled).toBe(true)
    expect(mocks.searchParadoxCopilot).toHaveBeenCalledOnce()

    await renderActivityMode('hidden')
    await renderActivityMode('visible')
    expect(paradoxSearchButton?.disabled).toBe(false)
    expect(paradoxSearchButton?.textContent).toContain('搜索')
  })

  it('keeps global activity true when another task type is running', async () => {
    mocks.getTaskStatus.mockResolvedValueOnce({
      success: true,
      data: { isRunning: true, taskType: 'roguelike', taskName: '集成战略', startTime: Date.now() },
    })

    await renderComponent()

    expect(mocks.setActive).toHaveBeenCalledWith(true)
    expect(mocks.setActive).not.toHaveBeenCalledWith(false)
    expect(buttonsByText('立即执行').length).toBeGreaterThan(0)
  })

  it('shows search results without auto-selecting the recommended job', async () => {
    mocks.searchCopilot.mockResolvedValueOnce({
      success: true,
      data: {
        stage: 'TL-1',
        copilots: [{ id: '108821', uri: 'prts://108821', title: '推荐作业', views: 1, hotScore: 1 }],
        recommended: { uri: 'prts://108821' },
      },
    })
    await renderComponent()
    const searchInput = container.querySelector<HTMLInputElement>('#combat-copilot-uri')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(searchInput, 'TL-1')
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonsByText('搜索')[0]!)
    await flush()

    expect(container.textContent).toContain('推荐作业')
    expect(mocks.getCopilotInfo).not.toHaveBeenCalled()
    expect(container.querySelector<HTMLInputElement>('#combat-copilot-uri')?.value).toBe('TL-1')
    expect(container.querySelector('#combat-copilot-search-heading')?.textContent).toContain('搜索结果')
    expect(container.querySelector('#combat-copilot-search-count')?.textContent).toContain('1 个作业')
    expect(container.querySelector('.combat-search-results-scroll')?.getAttribute('aria-labelledby')).toBe('combat-copilot-search-heading')

    const resultButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('推荐作业'))
    expect(resultButton).toBeDefined()
    await click(resultButton!)
    await flush()
    expect(mocks.getCopilotInfo).toHaveBeenCalledWith('108821')
    expect(document.activeElement).toBe(searchInput)
  })

  it('marks the recommended result and does not expose internal stage names', async () => {
    mocks.searchCopilot.mockResolvedValueOnce({
      success: true,
      data: {
        stage: 'TL-1',
        copilots: [
          { id: '1', uri: 'prts://1', title: '', stageName: 'act50side_01', views: 1, hotScore: 1 },
          { id: '2', uri: 'prts://2', title: '推荐作业', stageName: 'act50side_02', views: 1, hotScore: 1 },
        ],
        recommended: { uri: 'prts://2' },
      },
    })
    await renderComponent()
    const searchInput = container.querySelector<HTMLInputElement>('#combat-copilot-uri')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(searchInput, 'TL-1')
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="搜索关卡作业"]')!)
    await flush()

    const resultButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('.combat-search-results-scroll button'))
    expect(resultButtons).toHaveLength(2)
    expect(resultButtons[0]?.textContent).toContain('prts://1')
    expect(resultButtons[0]?.textContent).not.toContain('act50side_01')
    expect(resultButtons[0]?.textContent).not.toContain('推荐')
    expect(resultButtons[1]?.textContent).toContain('推荐作业')
    expect(resultButtons[1]?.textContent).toContain('推荐')
  })

  it('clears search results and status when the input changes', async () => {
    mocks.searchCopilot.mockResolvedValueOnce({
      success: true,
      data: {
        stage: 'TL-1',
        copilots: [{ id: '108821', uri: 'prts://108821', title: '推荐作业', views: 1, hotScore: 1 }],
      },
    })
    await renderComponent()
    const searchInput = container.querySelector<HTMLInputElement>('#combat-copilot-uri')!
    const setInput = async (value: string) => {
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        valueSetter?.call(searchInput, value)
        searchInput.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await setInput('TL-1')
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="搜索关卡作业"]')!)
    await flush()
    const activeSlide = () => container.querySelector<HTMLElement>('.swipe-mode-slide:not([aria-hidden="true"])')
    expect(activeSlide()?.textContent).toContain('推荐作业')

    await setInput('prts://108821')
    expect(activeSlide()?.textContent).not.toContain('推荐作业')
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="预览作业"]')).not.toBeNull()
  })

  it('ignores an older search response after the query changes', async () => {
    const olderSearch = deferred<CopilotSearchResponse>()
    const newerSearch = deferred<CopilotSearchResponse>()
    mocks.searchCopilot
      .mockReturnValueOnce(olderSearch.promise)
      .mockReturnValueOnce(newerSearch.promise)
    await renderComponent()

    const searchInput = container.querySelector<HTMLInputElement>('#combat-copilot-uri')!
    const setQuery = async (value: string) => {
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        valueSetter?.call(searchInput, value)
        searchInput.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await setQuery('旧关卡')
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="搜索关卡作业"]')!)
    await setQuery('新关卡')
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="搜索关卡作业"]')!)

    await act(async () => newerSearch.resolve({
      success: true,
      data: { copilots: [{ id: 2, uri: 'maa://2', title: '新作业' }] },
    }))
    await flush()
    expect(container.textContent).toContain('新作业')

    await act(async () => olderSearch.resolve({
      success: true,
      data: { copilots: [{ id: 1, uri: 'maa://1', title: '旧作业' }] },
    }))
    await flush()
    expect(container.textContent).toContain('新作业')
    expect(container.textContent).not.toContain('旧作业')
  })

  it('ignores an older copilot preview after the URI changes', async () => {
    const olderPreview = deferred<CopilotPreviewResponse>()
    const newerPreview = deferred<CopilotPreviewResponse>()
    mocks.getCopilotInfo
      .mockReturnValueOnce(olderPreview.promise)
      .mockReturnValueOnce(newerPreview.promise)
    await renderComponent()

    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    const setUri = async (value: string) => {
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        valueSetter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await setUri('maa://1')
    await click(buttonsByText('预览')[0]!)
    await setUri('maa://2')
    await click(buttonsByText('预览')[0]!)

    const previewResponse = (title: string, stage: string) => ({
      success: true,
      data: {
        status_code: 200,
        data: { content: JSON.stringify({ doc: { title }, stage_name: stage }) },
      },
    })
    await act(async () => newerPreview.resolve(previewResponse('新预览', 'NEW-2')))
    await flush()
    expect(container.textContent).toContain('新预览')

    await act(async () => olderPreview.resolve(previewResponse('旧预览', 'OLD-1')))
    await flush()
    expect(container.textContent).toContain('新预览')
    expect(container.textContent).not.toContain('旧预览')
  })

  it('previews a prts:// URI without requiring the legacy prefix', async () => {
    mocks.getCopilotInfo.mockResolvedValue({
      success: true,
      data: {
        status_code: 200,
        data: { content: JSON.stringify({ doc: { title: 'PRTS 预览' }, stage_name: 'TEST-1', opers: [] }) },
      },
    })

    await renderComponent()
    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'prts://1234')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonsByText('预览')[0]!)
    await flush()

    expect(mocks.getCopilotInfo).toHaveBeenCalledWith('1234')
    expect(container.textContent).toContain('PRTS 预览')
  })

  it('shows the public stage code instead of the internal stage id for a single job', async () => {
    mocks.getCopilotInfo.mockResolvedValue({
      success: true,
      data: {
        status_code: 200,
        data: {
          content: JSON.stringify({
            doc: { title: '时间啊，向前！ - TL-10 - 活着的重量' },
            stage_name: 'act55side_10',
            opers: [{ name: '乌尔比安' }],
          }),
        },
      },
    })

    await renderComponent()
    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'prts://108821')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonsByText('预览')[0]!)
    await flush()

    expect(container.textContent).toContain('TL-10')
    expect(container.textContent).not.toContain('act55side_10')
    expect(container.textContent).toContain('单个作业')
    expect(container.textContent).toContain('作业编号')
    expect(container.textContent).toContain('已加载')
  })

  it('previews the canonical prts://s<id> set form', async () => {
    mocks.getCopilotSetPlan.mockResolvedValue({
      success: true,
      data: {
        items: [{ id: 101, stage: 'TEST-1', stageId: 'test_1', supportsRaid: true }],
        entries: [],
      },
    })

    await renderComponent()
    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'prts://s56593')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonsByText('预览')[0]!)
    await flush()

    expect(mocks.getCopilotSetPlan).toHaveBeenCalledWith('56593', 'normal')
    expect(container.textContent).toContain('作业集')
    expect(container.textContent).toContain('作业数')
    expect(container.textContent).toContain('已选')
    expect(container.textContent).toContain('已完成')
    expect(container.textContent).toContain('当前关卡')
    expect(container.textContent).toContain('下一作业')
    expect(container.textContent).toContain('定位')
  })

  it('normalizes the legacy prts://<id>s set form before preview', async () => {
    mocks.getCopilotSetPlan.mockResolvedValue({
      success: true,
      data: {
        items: [{ id: 101, stage: 'TEST-1', stageId: 'test_1', supportsRaid: true }],
        entries: [],
      },
    })

    await renderComponent()
    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'prts://56593s')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonsByText('预览')[0]!)
    await flush()

    expect(mocks.getCopilotSetPlan).toHaveBeenCalledWith('56593', 'normal')
    expect(container.textContent).toContain('作业集')
    expect(container.textContent).toContain('作业数')
    expect(container.textContent).toContain('已选')
    expect(container.textContent).toContain('已完成')
    expect(container.textContent).toContain('当前关卡')
    expect(container.textContent).toContain('下一作业')
    expect(container.textContent).toContain('定位')
  })

  it('associates visible form controls with labels and keeps touch targets at least 44px', async () => {
    await renderComponent()

    const controls = Array.from(container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'))
    expect(controls.length).toBeGreaterThan(0)
    controls.forEach(control => {
      expect(control.id).not.toBe('')
      const label = Array.from(container.querySelectorAll<HTMLLabelElement>('label'))
        .find(candidate => candidate.htmlFor === control.id)
      expect(label).toBeDefined()
      if (control instanceof HTMLInputElement && control.type === 'checkbox') {
        expect(label?.classList.contains('min-h-11')).toBe(true)
      } else if (!(control instanceof HTMLTextAreaElement)) {
        expect(control.classList.contains('min-h-11')).toBe(true)
      }
    })
  })

  it('deduplicates stop requests and exposes the stopping state', async () => {
    const stopRequest = deferred<{ success: boolean; data: { task: { success: boolean } } }>()
    mocks.getTaskStatus.mockResolvedValueOnce({
      success: true,
      data: { isRunning: true, taskType: 'combat', taskName: '自动战斗', startTime: Date.now() },
    })
    mocks.stopTask.mockReturnValueOnce(stopRequest.promise)

    await renderComponent()
    const stopButton = buttonsByText('终止执行')[0]
    expect(stopButton).toBeDefined()

    await click(stopButton!)
    stopButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(mocks.stopTask).toHaveBeenCalledOnce()
    expect(buttonsByText('正在终止')[0]?.disabled).toBe(true)
    expect(mocks.setMessage).toHaveBeenCalledWith('正在终止自动战斗...', 'warning')

    await act(async () => stopRequest.resolve({ success: true, data: { task: { success: true } } }))
    expect(mocks.setMessage).toHaveBeenCalledWith('自动战斗已终止', 'warning')
    expect(buttonsByText('立即执行').length).toBeGreaterThan(0)
  })

  it('keeps the reset dialog open when resetting progress fails', async () => {
    mocks.getCopilotSetPlan.mockResolvedValue({
      success: true,
      data: {
        items: [{ id: 101, stage: 'TEST-1', stageId: 'test_1', supportsRaid: true }],
        entries: [],
      },
    })
    mocks.resetCopilotSetProgress.mockResolvedValue({ success: false, message: '进度存储不可用' })

    await renderComponent()

    const input = document.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    expect(input).not.toBeNull()
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'maa://48990s')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonsByText('预览')[0]!)
    await flush()

    await click(buttonsByText('重置进度')[0]!)
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    await click(buttonsByText('确认重置')[0]!)
    await flush()

    expect(mocks.resetCopilotSetProgress).toHaveBeenCalledWith('48990')
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(buttonsByText('确认重置')[0]?.disabled).toBe(false)
    expect(mocks.setMessage).toHaveBeenCalledWith('重置失败: 进度存储不可用', 'error')
  })

  it('keeps a normal task running until the wait-for-completion request settles', async () => {
    const execution = deferred<{ success: boolean }>()
    mocks.executePredefinedTaskArgs.mockReturnValueOnce(execution.promise)
    await renderComponent()

    const input = document.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'maa://1234')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonsByText('立即执行')[0]!)

    expect(mocks.executePredefinedTaskArgs).toHaveBeenCalledWith(
      'copilot',
      expect.arrayContaining(['prts://1234']),
      null,
      null,
      '自动战斗作业',
      'combat',
      true,
    )
    expect(buttonsByText('终止执行')[0]).toBeDefined()

    await act(async () => execution.resolve({ success: true }))
    expect(buttonsByText('立即执行').length).toBeGreaterThan(0)
  })

  it('keeps only continuous and manual set modes and migrates the legacy sequential choice', async () => {
    localStorage.setItem('combatCopilotSetExecutionMode', 'app')

    await renderComponent()

    const modeSelect = Array.from(document.querySelectorAll<HTMLSelectElement>('select'))
      .find(select => Array.from(select.options).some(option => option.value === 'cli'))
    expect(modeSelect).toBeDefined()
    expect(Array.from(modeSelect!.options).map(option => option.value)).toEqual(['cli', 'manual'])
    expect(modeSelect!.value).toBe('cli')
    expect(localStorage.getItem('combatCopilotSetExecutionMode')).toBe('cli')
  })

  it('migrates a legacy sequential mode from the server config', async () => {
    mocks.loadUserConfig.mockResolvedValueOnce({
      success: true,
      data: { copilotSetExecutionMode: 'app' },
    })

    await renderComponent()

    const modeSelect = Array.from(document.querySelectorAll<HTMLSelectElement>('select'))
      .find(select => Array.from(select.options).some(option => option.value === 'cli'))
    expect(modeSelect).toBeDefined()
    expect(modeSelect!.value).toBe('cli')
    expect(localStorage.getItem('combatCopilotSetExecutionMode')).toBe('cli')
  })

  it('runs a copilot set through the server plan in continuous mode', async () => {
    mocks.getCopilotSetPlan.mockResolvedValue({
      success: true,
      data: {
        items: [
          { id: 101, stage: 'TEST-1', stageId: 'test_1', supportsRaid: true },
          { id: 102, stage: 'TEST-2', stageId: 'test_2', supportsRaid: true },
        ],
        entries: [],
      },
    })

    await renderComponent()
    const input = document.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'prts://s48990')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonsByText('预览')[0]!)
    await flush()

    await click(buttonsByText('立即执行')[0]!)
    await flush()

    expect(mocks.executeCopilotSetPlan).toHaveBeenCalledWith('48990', expect.objectContaining({
      selectedIndexes: [0, 1],
    }))
    expect(mocks.setMessage).toHaveBeenCalledWith('作业集执行完成')
  })

  it('moves the running status to the stage reported by the native set', async () => {
    vi.useFakeTimers()
    const setExecution = deferred<{ success: boolean; data: { pending: never[] } }>()
    mocks.getCopilotSetPlan.mockResolvedValue({
      success: true,
      data: {
        items: [
          { id: 101, stage: 'TEST-1', stageId: 'test_1', supportsRaid: true },
          { id: 102, stage: 'TEST-2', stageId: 'test_2', supportsRaid: true },
        ],
        entries: [],
      },
    })
    mocks.executeCopilotSetPlan.mockReturnValueOnce(setExecution.promise)
    mocks.getTaskStatus.mockResolvedValue({
      success: true,
      data: { isRunning: true, currentStage: 'TEST-2' },
    })

    await renderComponent()
    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'prts://s48990')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonsByText('预览')[0]!)
    await flush()

    await click(buttonsByText('立即执行')[0]!)
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })
    await flush()

    const firstRow = container.querySelector('[data-copilot-index="0"]')
    const secondRow = container.querySelector('[data-copilot-index="1"]')
    expect(firstRow?.querySelector('[data-status="done"]')).not.toBeNull()
    expect(secondRow?.querySelector('[data-status="running"]')).not.toBeNull()
    expect(firstRow?.textContent).toContain('已完成')
    expect(secondRow?.textContent).toContain('执行中')

    await act(async () => setExecution.resolve({ success: true, data: { pending: [] } }))
    await flush()
  })

  it('renders row status from the active Run taskResults', async () => {
    mocks.getCopilotSetPlan.mockResolvedValue({
      success: true,
      data: {
        items: [
          { id: 101, stage: 'TEST-1', stageId: 'test_1', supportsRaid: true },
          { id: 102, stage: 'TEST-2', stageId: 'test_2', supportsRaid: true },
        ],
        entries: [],
      },
    })

    await renderComponent()
    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'prts://s48990')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonsByText('预览')[0]!)
    await flush()

    await act(async () => {
      useRunStore.getState().applyRun({
        runId: 'run-1',
        operationId: 'run_copilot_set',
        state: 'running',
        progress: {
          setId: '48990',
          phase: 'running',
          battle: { kills: 17, total: 41 },
        },
        taskResults: [
          { itemIndex: 0, status: 'success' },
          { itemIndex: 1, status: 'running' },
        ],
      })
    })
    await flush()

    const firstRow = container.querySelector('[data-copilot-index="0"]')
    const secondRow = container.querySelector('[data-copilot-index="1"]')
    expect(firstRow?.querySelector('[data-status="done"]')).not.toBeNull()
    expect(secondRow?.querySelector('[data-status="running"]')).not.toBeNull()
    expect(firstRow?.textContent).toContain('已完成')
    expect(secondRow?.textContent).toContain('执行中')
    expect(secondRow?.textContent).toContain('17/41')

    await act(async () => useRunStore.getState().applyRun(null))
  })

  it('loads a dashboard activity set without executing and enables sanity potions on execute', async () => {
    mocks.getCopilotSetPlan.mockResolvedValue({
      success: true,
      data: {
        items: [
          { id: 101, stage: 'TL-1', stageId: 'act55side_01', supportsRaid: true },
          { id: 102, stage: 'TL-2', stageId: 'act55side_02', supportsRaid: true },
        ],
        entries: [],
      },
    })
    useUIStore.getState().setActiveTab('combat')
    useUIStore.getState().setCombatCopilotPrefill({
      setId: '56877',
      name: '时间啊，向前！全关卡作业',
      activityName: '时间啊，向前！',
    })

    await renderComponent()
    await flush()

    const input = container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    expect(input?.value).toBe('prts://s56877')
    expect(container.textContent).toContain('共 2\u00A0个作业')
    expect(mocks.runActivitySet).not.toHaveBeenCalled()
    expect(mocks.executeCopilotSetPlan).not.toHaveBeenCalled()

    await click(buttonsByText('立即执行')[0]!)
    await flush()

    expect(mocks.runActivitySet).toHaveBeenCalledWith('56877', expect.objectContaining({
      options: expect.objectContaining({
        useSanityPotion: true,
        nativeDelegation: false,
      }),
    }))
    useUIStore.getState().setCombatCopilotPrefill(null)
    useUIStore.getState().setActiveTab('dashboard')
  })

  it('runs the activity fallback from the manual execute button when no set exists', async () => {
    useUIStore.getState().setActiveTab('combat')
    useUIStore.getState().setCombatCopilotPrefill({
      setId: '',
      name: null,
      activityName: '时间啊，向前！',
      fallback: true,
    })

    await renderComponent()
    await flush()

    expect(container.textContent).toContain('当前活动没有匹配的作业集')
    expect(container.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')?.value).toBe('')

    await click(buttonsByText('立即执行')[0]!)
    await flush()

    expect(mocks.runActivityFallback).toHaveBeenCalledTimes(1)
    expect(mocks.runActivitySet).not.toHaveBeenCalled()
    expect(mocks.executeCopilotSetPlan).not.toHaveBeenCalled()

    useUIStore.getState().setCombatCopilotPrefill(null)
    useUIStore.getState().setActiveTab('dashboard')
  })

  it('allows the stop request to be retried when idle confirmation times out', async () => {
    vi.useFakeTimers()
    mocks.getTaskStatus
      .mockResolvedValueOnce({
        success: true,
        data: { isRunning: true, taskType: 'combat', taskName: '自动战斗', startTime: Date.now() },
      })
      .mockResolvedValue({ success: true, data: { isRunning: true } })

    await renderComponent()
    await click(buttonsByText('终止执行')[0]!)
    await act(async () => vi.advanceTimersByTimeAsync(15_000))

    expect(mocks.setMessage).toHaveBeenCalledWith(
      '终止失败: 终止请求已发送，但尚未确认任务停止',
      'error',
    )
    expect(buttonsByText('终止执行')[0]?.disabled).toBe(false)

    await click(buttonsByText('终止执行')[0]!)
    expect(mocks.stopTask).toHaveBeenCalledTimes(2)
  })
})
