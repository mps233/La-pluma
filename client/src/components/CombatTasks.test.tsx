// @vitest-environment jsdom

import { Activity, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CombatTasks from './CombatTasks'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getTaskStatus: vi.fn(),
  loadUserConfig: vi.fn(),
  saveUserConfig: vi.fn(),
  stopTask: vi.fn(),
  executePredefinedTaskArgs: vi.fn(),
  getCopilotInfo: vi.fn(),
  getCopilotSet: vi.fn(),
  getCopilotSetPlan: vi.fn(),
  resetCopilotSetProgress: vi.fn(),
  searchCopilot: vi.fn(),
  searchParadoxCopilot: vi.fn(),
  setMessage: vi.fn(),
  setActive: vi.fn(),
}))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const motionComponent = (tag: 'button' | 'div' | 'span') => React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, whileHover: _whileHover, whileTap: _whileTap, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children as ReactNode),
  )
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: {
      button: motionComponent('button'),
      div: motionComponent('div'),
      span: motionComponent('span'),
    },
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
    getCopilotInfo: mocks.getCopilotInfo,
    getCopilotSet: mocks.getCopilotSet,
    getCopilotSetPlan: mocks.getCopilotSetPlan,
    resetCopilotSetProgress: mocks.resetCopilotSetProgress,
    getErrorMessage: (result: { message?: string; error?: string }) => result.message || result.error || '未知错误',
  },
  searchCopilot: mocks.searchCopilot,
  searchParadoxCopilot: mocks.searchParadoxCopilot,
}))

vi.mock('../store/statusStore', () => ({
  useStatusStore: () => ({ setMessage: mocks.setMessage, setActive: mocks.setActive }),
}))

vi.mock('../hooks/useBackendStatusMonitor', () => ({
  useAutomationAvailability: () => ({ isAvailable: true, unavailableMessage: '' }),
}))

vi.mock('./FloatingStatusIndicator', () => ({ default: () => null }))
vi.mock('./ScreenMonitor', () => ({ default: () => <div data-testid="screen-monitor" /> }))

let container: HTMLDivElement
let root: Root

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
    mocks.getCopilotInfo.mockReset()
    mocks.getCopilotSet.mockReset()
    mocks.getCopilotSetPlan.mockReset()
    mocks.resetCopilotSetProgress.mockReset()
    mocks.searchCopilot.mockReset()
    mocks.searchParadoxCopilot.mockReset()
    mocks.setMessage.mockReset()
    mocks.setActive.mockReset()
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
  })

  it('keeps each active task in the shared continuous-corner card', async () => {
    await renderComponent()

    const page = container.querySelector('.combat-page')
    expect(page?.classList.contains('ios-workspace-page')).toBe(true)
    expect(page?.querySelector('.app-page-header')?.classList.contains('is-mobile-inline')).toBe(true)

    const modeShell = page?.querySelector('.combat-mode-shell')
    expect(modeShell?.classList.contains('app-liquid-tab-pill')).toBe(true)
    const modeButtons = page?.querySelectorAll('.combat-mode-button') ?? []
    expect(modeButtons).toHaveLength(3)
    modeButtons.forEach(button => expect(button.classList.contains('min-h-11')).toBe(true))
    expect(modeShell?.querySelector('[role="toolbar"]')).not.toBeNull()
    expect(page?.querySelectorAll('.combat-mode-button[aria-pressed="true"]')).toHaveLength(1)
    expect(Array.from(modeButtons).map(button => button.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])

    const firstModeButton = modeButtons[0] as HTMLButtonElement
    const secondModeButton = modeButtons[1] as HTMLButtonElement
    firstModeButton.focus()
    await keyDown(firstModeButton, 'ArrowRight')
    expect(secondModeButton.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(secondModeButton)

    await keyDown(secondModeButton, 'Home')
    expect(firstModeButton.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(firstModeButton)

    const arrowDownEvent = await keyDown(firstModeButton, 'ArrowDown')
    expect(arrowDownEvent.defaultPrevented).toBe(false)
    expect(firstModeButton.getAttribute('aria-pressed')).toBe('true')

    const copilotCard = page?.querySelector('.combat-task-card')
    expect(copilotCard?.getAttribute('data-smooth-corners')).toBe('true')
    expect(copilotCard?.querySelector(':scope > .app-card-smooth-surface')).not.toBeNull()

    const explanationDetails = Array.from(copilotCard?.querySelectorAll('details') ?? [])
      .find(details => details.querySelector('summary')?.textContent?.trim() === '说明')
    const explanationTrigger = explanationDetails?.querySelector('summary')
    const explanation = explanationDetails?.querySelector(':scope > div')
    expect(explanationTrigger?.classList.contains('min-h-11')).toBe(true)
    expect(explanationTrigger?.classList.contains('min-w-11')).toBe(true)
    expect(explanation?.className).toContain('w-[min(18rem,calc(100vw_-_3rem))]')

    const sssModeButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.combat-mode-button'))
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
    mocks.getCopilotInfo.mockReturnValueOnce(deferred<any>().promise)
    mocks.searchCopilot.mockReturnValueOnce(deferred<any>().promise)
    mocks.searchParadoxCopilot.mockReturnValueOnce(deferred<any>().promise)

    await renderActivityMode('visible')
    await click(buttonsByText('单个作业')[0]!)

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

    const stageInput = container.querySelector<HTMLInputElement>('input[name="maa-copilot-stage-search"]')!
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(stageInput, '1-7')
      stageInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const stageSearchButton = stageInput.parentElement?.querySelector<HTMLButtonElement>('button')
    await click(stageSearchButton!)
    expect(stageSearchButton?.disabled).toBe(true)
    expect(mocks.searchCopilot).toHaveBeenCalledOnce()

    await renderActivityMode('hidden')
    await renderActivityMode('visible')
    expect(stageSearchButton?.disabled).toBe(false)
    expect(stageSearchButton?.textContent).toContain('搜索')

    const paradoxModeButton = Array.from(container.querySelectorAll<HTMLButtonElement>('.combat-mode-button'))
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

  it('ignores an older search response after the query changes', async () => {
    const olderSearch = deferred<any>()
    const newerSearch = deferred<any>()
    mocks.searchCopilot
      .mockReturnValueOnce(olderSearch.promise)
      .mockReturnValueOnce(newerSearch.promise)
    await renderComponent()

    const searchInput = container.querySelector<HTMLInputElement>('input[name="maa-copilot-stage-search"]')!
    const setQuery = async (value: string) => {
      await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        valueSetter?.call(searchInput, value)
        searchInput.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await setQuery('旧关卡')
    await click(buttonsByText('搜索')[0]!)
    await setQuery('新关卡')
    await click(buttonsByText('搜索')[0]!)

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
    const olderPreview = deferred<any>()
    const newerPreview = deferred<any>()
    mocks.getCopilotInfo
      .mockReturnValueOnce(olderPreview.promise)
      .mockReturnValueOnce(newerPreview.promise)
    await renderComponent()
    await click(buttonsByText('单个作业')[0]!)

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
    await click(buttonsByText('作业集')[0]!)

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
      expect.any(Array),
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

  it('does not continue a sequential copilot set after stop is confirmed', async () => {
    const firstCopilot = deferred<{ success: boolean }>()
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
    mocks.executePredefinedTaskArgs.mockReturnValueOnce(firstCopilot.promise)

    await renderComponent()
    await click(buttonsByText('作业集')[0]!)
    const input = document.querySelector<HTMLInputElement>('input[name="maa-copilot-uri"]')
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      valueSetter?.call(input, 'maa://48990s')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttonsByText('预览')[0]!)
    await flush()

    const executionMode = Array.from(document.querySelectorAll('select'))
      .find(select => Array.from(select.options).some(option => option.value === 'app'))
    await act(async () => {
      if (!executionMode) return
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      valueSetter?.call(executionMode, 'app')
      executionMode.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click(buttonsByText('立即执行')[0]!)
    expect(mocks.executePredefinedTaskArgs).toHaveBeenCalledTimes(1)

    await click(buttonsByText('终止执行')[0]!)
    await flush()
    expect(mocks.setMessage).toHaveBeenCalledWith('自动战斗已终止', 'warning')

    await act(async () => firstCopilot.resolve({ success: true }))
    await flush()
    expect(mocks.executePredefinedTaskArgs).toHaveBeenCalledTimes(1)
    expect(mocks.setMessage).not.toHaveBeenCalledWith(expect.stringContaining('作业集执行完成'))
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
