// @vitest-environment jsdom

import { Activity, act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/query'
import { AppToaster } from '@/shared/components'
import type { TrainingOperator, TrainingPlan, TrainingQueueItem, TrainingSettings } from '@/features/training/types'
import { trainingQueueCommandOwner } from '@/features/training/model/queueCommands'
import { trainingSettingsOwner } from '@/features/training/model/settingsCommands'
import { trainingPlanOwner } from '@/features/training/model/planCommands'
import { publishResourceInvalidation, subscribeResourceInvalidation } from '@/features/resource-invalidation'
import {
  USER_CONFIG_KEYS,
  userConfigCoordinator,
  type ConfigCommitResult,
  type ConfigPersistenceAdapter,
} from '@/features/user-config'
import OperatorTraining from './OperatorTraining'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const optionInTriggerPopup = (trigger: HTMLElement, optionLabel: string) => {
  const popupId = trigger.getAttribute('aria-controls')
  const popup = popupId ? document.getElementById(popupId) : null
  return popup
    ? [...popup.querySelectorAll('[role="option"]')].find(node => node.textContent?.trim() === optionLabel)
    : undefined
}

const mocks = vi.hoisted(() => ({
  getOperatorList: vi.fn(),
  getAllOperators: vi.fn(),
  getOperBoxData: vi.fn(),
  getTrainingQueue: vi.fn(),
  addToTrainingQueue: vi.fn(),
  removeFromTrainingQueue: vi.fn(),
  updateTrainingQueueOrder: vi.fn(),
  updateTrainingSettings: vi.fn(),
  generateTrainingPlan: vi.fn(),
  applyTrainingPlan: vi.fn(),
  retryTrainingSync: vi.fn(),
  setMessage: vi.fn(),
}))

vi.mock('@/features/device-mirror', () => ({
  DeviceMonitorLayout: ({ children }: { children: ReactNode }) => children,
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

vi.mock('@/features/training/api', () => ({
  getOperatorList: mocks.getOperatorList,
  getTrainingQueue: mocks.getTrainingQueue,
  addToTrainingQueue: mocks.addToTrainingQueue,
  removeFromTrainingQueue: mocks.removeFromTrainingQueue,
  updateTrainingQueueOrder: mocks.updateTrainingQueueOrder,
  updateTrainingSettings: mocks.updateTrainingSettings,
  generateTrainingPlan: mocks.generateTrainingPlan,
  applyTrainingPlan: mocks.applyTrainingPlan,
  retryTrainingSync: mocks.retryTrainingSync,
}))

vi.mock('@/features/game-data/api', () => ({
  getAllOperators: mocks.getAllOperators,
  getDepotData: vi.fn(),
  getOperBoxData: mocks.getOperBoxData,
  getItemIconUrl: (id: string | number) => `/items/${id}.png`,
  getOperatorAvatarUrl: (id: string) => `/avatars/${id}.png`,
}))

vi.mock('@/features/runtime-status', () => ({
  useStatusStore: (selector?: (state: { setMessage: typeof mocks.setMessage }) => unknown) => {
    if (!selector) throw new Error('useStatusStore must be called with a selector')
    return selector({ setMessage: mocks.setMessage })
  },
  FloatingStatusIndicator: () => null,
}))

let client: ReturnType<typeof createQueryClient>
let container: HTMLDivElement
let root: Root
let toasterContainer: HTMLDivElement
let toasterRoot: Root

const settings: TrainingSettings = {
  useMedicine: 0,
  useStone: 0,
  autoSwitch: true,
  notifyOnComplete: true,
}

const operator = (id: string, name: string): TrainingOperator => ({
  id,
  name,
  rarity: 6,
  profession: 'SNIPER',
  currentElite: 1,
  currentLevel: 80,
  targetElite: 2,
  owned: true,
  hasMaterialData: true,
  canTrain: true,
  disabledReason: null,
  trainingStatus: 'trainable',
})

const queueItem = (operatorId: string, name: string): TrainingQueueItem => ({
  operatorId,
  operator: { name, rarity: 6, profession: 'SNIPER' },
  currentElite: 1,
  targetElite: 2,
  materials: [],
  progress: 25,
})

interface DeferredResult<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

const deferred = <T,>(): DeferredResult<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const plan = (): TrainingPlan & { queueRevision: string } => ({
  mode: 'current',
  queueRevision: 'queue-1',
  focusOperator: { id: 'char_current', name: '阿米娅', rarity: 6 },
  stages: [{ stage: '1-7', totalTimes: 5, sanityPerRun: 6, isOpen: true }],
  openStages: [{ stage: '1-7', totalTimes: 5, isOpen: true }],
  totalSanity: 30,
})

const queueResponse = (
  queue: TrainingQueueItem[],
  revision = 'queue-1',
  settingsValue: TrainingSettings = settings,
) => ({
  success: true,
  data: {
    queue: [...queue],
    settings: settingsValue,
    revision,
    flowSync: { status: 'not_applied', flowName: '自动任务', taskName: 'Fight' },
  },
})

const mockMutableQueue = (initialQueue: TrainingQueueItem[]) => {
  let queue = [...initialQueue]
  mocks.getTrainingQueue.mockImplementation(async () => queueResponse(queue))
  mocks.removeFromTrainingQueue.mockImplementation(async (operatorId: string) => {
    queue = queue.filter(item => item.operatorId !== operatorId)
    return { success: true, data: { queueUpdated: true, queueRevision: 'queue-2' } }
  })
  mocks.addToTrainingQueue.mockImplementation(async (data: { operatorId: string; position?: number }) => {
    const item = initialQueue.find(candidate => candidate.operatorId === data.operatorId)
      ?? queueItem(data.operatorId, data.operatorId === 'char_added' ? '能天使' : data.operatorId)
    queue.splice(data.position ?? queue.length, 0, item)
    return { success: true, data: { queueUpdated: true, queueRevision: 'queue-2' } }
  })
  mocks.updateTrainingQueueOrder.mockImplementation(async (operatorIds: string[]) => {
    queue = operatorIds.map(operatorId => queue.find(item => item.operatorId === operatorId)!)
    return { success: true, data: { queueUpdated: true, queueRevision: 'queue-2' } }
  })
  return () => queue
}

const flush = async () => {
  await act(async () => {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(0)
      return
    }
    // Query 的观察者通知走 setTimeout(0)，需要多个宏任务轮次才能稳定。
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flush()
}

const renderComponent = async () => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <OperatorTraining />
      </QueryClientProvider>,
    )
  })
  await flush()
}

const renderWithActivity = async (mode: 'visible' | 'hidden') => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Activity mode={mode}>
          <OperatorTraining />
        </Activity>
      </QueryClientProvider>,
    )
  })
  await flush()
}

const switchByLabel = (label: string) =>
  container.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`)

const isSwitchChecked = (control: HTMLElement | null) => control?.getAttribute('aria-checked') === 'true'

const buttonWithText = (text: string, scope: ParentNode = document) => {
  const button = Array.from(scope.querySelectorAll<HTMLButtonElement>('button'))
    .find(candidate => candidate.textContent?.trim() === text)
  expect(button, `button with text "${text}"`).toBeDefined()
  return button!
}

const queueButton = (label: string) => {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(button, `queue button "${label}"`).not.toBeNull()
  return button!
}

const queueOrder = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label^="移除"]'))
  .map(button => button.getAttribute('aria-label')?.replace(/^移除/, ''))

const statusSegment = (label: string, scope: ParentNode = document) => {
  const segment = Array.from(scope.querySelectorAll<HTMLButtonElement>('[role="toolbar"][aria-label="干员范围"] button'))
    .find(button => button.textContent?.includes(label))
  expect(segment, `status segment "${label}"`).toBeDefined()
  return segment!
}

const statusCount = (label: string) =>
  statusSegment(label).querySelector<HTMLElement>('span[aria-label$=" 名"]')?.textContent

const planPanel = () => {
  const section = container.querySelector<HTMLElement>('[aria-labelledby="training-plan-title"]')
  expect(section, 'training plan section').not.toBeNull()
  return section!
}

const planPanelText = () => planPanel().textContent ?? ''

const undoToast = () => document.querySelector<HTMLElement>('[data-sonner-toast]')

const undoToastClose = () => document.querySelector('[data-sonner-toast] [aria-label="关闭移除提示"]')

const settleToastRemoval = async () => {
  for (let attempt = 0; attempt < 20 && undoToast(); attempt += 1) {
    await act(async () => {
      if (vi.isFakeTimers()) {
        await vi.advanceTimersByTimeAsync(100)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    })
  }
}

const selectRarity = async (dialog: HTMLElement, label: string) => {
  const trigger = dialog.querySelector<HTMLElement>('[aria-label="稀有度"]')
  expect(trigger).not.toBeNull()
  await act(async () => trigger!.click())
  const option = optionInTriggerPopup(trigger!, label)
  expect(option, `rarity option ${label}`).toBeTruthy()
  await act(async () => (option as HTMLElement).click())
  await flush()
}

const chooseSelectOption = async (name: string, label: string) => {
  const trigger = container.querySelector<HTMLElement>(`[aria-label="${name}"]`)
  expect(trigger, `select trigger ${name}`).not.toBeNull()
  await act(async () => trigger!.click())
  const option = optionInTriggerPopup(trigger!, label)
  expect(option, `select option ${label}`).toBeTruthy()
  await act(async () => (option as HTMLElement).click())
  await flush()
}

const openPicker = async () => {
  const opener = buttonWithText('添加干员', container)
  opener.focus()
  await click(opener)
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  expect(dialog).not.toBeNull()
  return { opener, dialog: dialog! }
}

describe('OperatorTraining queue workspace', () => {
  beforeEach(async () => {
    trainingQueueCommandOwner.reset()
    trainingSettingsOwner.reset()
    trainingPlanOwner.reset()
    userConfigCoordinator.dispose()
    localStorage.removeItem('trainingPlanBarrierPending')
    localStorage.removeItem('automationConfigSyncPending')
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
    mocks.getOperatorList.mockReset().mockResolvedValue({ success: true, data: { operators: [] } })
    mocks.getAllOperators.mockReset().mockResolvedValue({ success: true, data: [] })
    mocks.getOperBoxData.mockReset().mockResolvedValue({ success: true, data: { data: [] } })
    mocks.getTrainingQueue.mockReset().mockResolvedValue(queueResponse([]))
    mocks.addToTrainingQueue.mockReset()
    mocks.removeFromTrainingQueue.mockReset()
    mocks.updateTrainingQueueOrder.mockReset().mockResolvedValue({ success: true })
    mocks.updateTrainingSettings.mockReset()
    mocks.generateTrainingPlan.mockReset().mockResolvedValue({ success: true, data: plan() })
    mocks.applyTrainingPlan.mockReset().mockResolvedValue({ success: true, data: { stageCount: 1 } })
    mocks.retryTrainingSync.mockReset()
    mocks.setMessage.mockReset()
    client = createQueryClient()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    toasterContainer = document.createElement('div')
    document.body.appendChild(toasterContainer)
    toasterRoot = createRoot(toasterContainer)
    await act(async () => toasterRoot.render(<AppToaster />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    await act(async () => toasterRoot.unmount())
    client.clear()
    container.remove()
    toasterContainer.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('opens the operator picker on demand and returns keyboard focus to its opener', async () => {
    mocks.getTrainingQueue.mockResolvedValue(queueResponse([queueItem('char_current', '阿米娅')]))

    await renderComponent()

    expect(container.querySelector('[aria-labelledby="training-queue-title"]')).not.toBeNull()
    expect(queueOrder()).toEqual(['阿米娅'])
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('input[aria-label="搜索干员名称"]')).toBeNull()
    expect(container.textContent).toContain('材料筹备进度')

    const { opener, dialog } = await openPicker()
    expect(dialog.querySelector('input[aria-label="搜索干员名称"]')).not.toBeNull()
    expect(dialog.contains(document.activeElement)).toBe(true)

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(queueOrder()).toEqual(['阿米娅'])
  })

  it('shows retryable candidate and queue errors instead of empty states', async () => {
    mocks.getOperatorList.mockImplementation(async (filters: { status?: string } = {}) => {
      if (filters.status === 'trainable') throw new Error('干员服务暂不可用')
      return { success: true, data: { operators: [] } }
    })
    mocks.getTrainingQueue
      .mockRejectedValueOnce(new Error('队列服务暂不可用'))
      .mockResolvedValueOnce(queueResponse([]))

    await renderComponent()
    await openPicker()

    expect(document.body.textContent).toContain('干员列表加载失败')
    expect(document.body.textContent).toContain('干员服务暂不可用')
    expect(document.body.textContent).toContain('养成队列加载失败')
    expect(document.body.textContent).toContain('队列服务暂不可用')
    expect(document.body.textContent).not.toContain('没有可养成干员')
    expect(document.body.textContent).not.toContain('养成队列还是空的')

    mocks.getOperatorList.mockResolvedValue({ success: true, data: { operators: [] } })
    const listAlert = Array.from(document.querySelectorAll<HTMLElement>('[role="alert"]'))
      .find(alert => alert.textContent?.includes('干员服务暂不可用'))
    const listRetry = listAlert?.querySelector<HTMLButtonElement>('button')
    expect(listRetry).not.toBeNull()
    await click(listRetry!)
    expect(document.body.textContent).not.toContain('干员服务暂不可用')
    expect(document.body.textContent).toContain('没有可养成干员')

    const queueAlert = Array.from(container.querySelectorAll<HTMLElement>('[role="alert"]'))
      .find(alert => alert.textContent?.includes('队列服务暂不可用'))
    const queueRetry = queueAlert?.querySelector<HTMLButtonElement>('button')
    expect(queueRetry).not.toBeNull()
    await click(queueRetry!)

    expect(mocks.getTrainingQueue).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).not.toContain('队列服务暂不可用')
    expect(document.body.textContent).toContain('养成队列还是空的')
  })

  it('keeps the picker, plan, and automation controls accessible', async () => {
    mocks.getTrainingQueue.mockResolvedValue(queueResponse([queueItem('char_current', '阿米娅')]))

    await renderComponent()
    const { dialog } = await openPicker()
    const search = dialog.querySelector<HTMLInputElement>('input[aria-label="搜索干员名称"]')
    const rarity = dialog.querySelector('[aria-label="稀有度"]')
    const planModeSelect = container.querySelector('[aria-label="计划范围"]')
    expect(search).not.toBeNull()
    expect(rarity).not.toBeNull()
    expect(planModeSelect).not.toBeNull()
    expect(switchByLabel('自动切换')).not.toBeNull()
    expect(switchByLabel('完成通知')).not.toBeNull()
  })

  it('supports keyboard navigation of the operator scope inside the picker', async () => {
    await renderComponent()
    const { dialog } = await openPicker()

    const toolbar = dialog.querySelector<HTMLElement>('[role="toolbar"][aria-label="干员范围"]')
    expect(toolbar).not.toBeNull()
    const buttons = Array.from(toolbar?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    expect(buttons).toHaveLength(3)
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true')

    const allButton = buttons.find(button => button.textContent?.includes('全部'))
    expect(allButton).toBeDefined()
    await click(allButton!)
    expect(allButton?.getAttribute('aria-pressed')).toBe('true')
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('false')

    await act(async () => {
      allButton?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    await flush()

    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(buttons[0])
  })

  it('serializes settings writes so an older response cannot overwrite the latest value on disk', async () => {
    const firstRequest = deferred<{ success: boolean; data: TrainingSettings }>()
    mocks.updateTrainingSettings
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce({ success: true, data: settings })

    await renderComponent()
    const autoSwitch = switchByLabel('自动切换')
    expect(isSwitchChecked(autoSwitch)).toBe(true)

    await click(autoSwitch!)
    expect(isSwitchChecked(autoSwitch)).toBe(false)
    await click(autoSwitch!)
    expect(mocks.updateTrainingSettings).toHaveBeenCalledOnce()
    expect(isSwitchChecked(autoSwitch)).toBe(true)

    await act(async () => firstRequest.resolve({
      success: true,
      data: { ...settings, autoSwitch: false },
    }))
    await flush()

    expect(mocks.updateTrainingSettings).toHaveBeenCalledTimes(2)
    expect(mocks.updateTrainingSettings).toHaveBeenLastCalledWith(settings)
    expect(isSwitchChecked(autoSwitch)).toBe(true)
  })

  it('serializes duplicate queue additions while a request is pending and recovers from failure', async () => {
    const addRequest = deferred<{ success: boolean }>()
    mocks.getOperatorList.mockResolvedValue({
      success: true,
      data: { operators: [operator('char_added', '能天使')] },
    })
    mocks.addToTrainingQueue.mockReturnValueOnce(addRequest.promise)

    await renderComponent()
    const { dialog } = await openPicker()
    const addButton = buttonWithText('添加', dialog)

    await act(async () => {
      addButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      addButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mocks.addToTrainingQueue).toHaveBeenCalledOnce()
    expect(addButton.disabled).toBe(true)
    await act(async () => addRequest.resolve({ success: false }))
    await flush()

    expect(queueOrder()).toEqual([])
    expect(buttonWithText('添加', dialog).disabled).toBe(false)
    expect(mocks.setMessage).toHaveBeenCalledWith(expect.stringContaining('添加失败'), 'error')
  })

  it('adds the first target without applying a task flow and requires an explicit preview and apply', async () => {
    mockMutableQueue([])
    mocks.getOperatorList.mockResolvedValue({
      success: true,
      data: { operators: [operator('char_added', '能天使')] },
    })

    await renderComponent()
    const { dialog } = await openPicker()
    await click(buttonWithText('添加', dialog))

    expect(queueOrder()).toEqual(['能天使'])
    expect(mocks.applyTrainingPlan).not.toHaveBeenCalled()
    expect(buttonWithText('已添加', dialog).disabled).toBe(true)

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()
    await click(buttonWithText('预览刷图计划', container))
    expect(mocks.applyTrainingPlan).not.toHaveBeenCalled()
    await click(buttonWithText('应用到自动任务', container))
    expect(mocks.applyTrainingPlan).toHaveBeenCalledOnce()
    expect(mocks.applyTrainingPlan).toHaveBeenCalledWith({
      plan: expect.objectContaining({ queueRevision: 'queue-1', stages: plan().openStages }),
      settings,
    })
  })

  it('refreshes shared reads on resource invalidation without reloading unrelated data', async () => {
    await renderComponent()

    mocks.getOperatorList.mockClear()
    mocks.getAllOperators.mockClear()
    mocks.getOperBoxData.mockClear()
    mocks.getTrainingQueue.mockClear()

    await act(async () => {
      publishResourceInvalidation({ resources: ['catalog'], cause: 'resource-update' })
    })
    await flush()

    expect(mocks.getAllOperators).toHaveBeenCalledTimes(1)
    expect(mocks.getOperBoxData).not.toHaveBeenCalled()
    expect(mocks.getOperatorList).toHaveBeenCalledTimes(3)
    expect(mocks.getTrainingQueue).not.toHaveBeenCalled()

    await act(async () => {
      publishResourceInvalidation({ resources: ['depot'], cause: 'recognition' })
    })
    await flush()

    expect(mocks.getTrainingQueue).toHaveBeenCalledTimes(1)
    expect(mocks.getAllOperators).toHaveBeenCalledTimes(1)
  })

  it('refreshes only the queue for a queue invalidation while candidate queries stay cached', async () => {
    mocks.getTrainingQueue.mockResolvedValue(queueResponse([queueItem('char_current', '阿米娅')]))
    await renderComponent()

    mocks.getOperatorList.mockClear()
    mocks.getAllOperators.mockClear()
    mocks.getOperBoxData.mockClear()
    mocks.getTrainingQueue.mockClear()

    await act(async () => {
      publishResourceInvalidation({ resources: ['training-queue'], cause: 'training-queue' })
    })
    await flush()

    expect(mocks.getTrainingQueue).toHaveBeenCalledTimes(1)
    expect(mocks.getOperatorList).not.toHaveBeenCalled()
    expect(mocks.getAllOperators).not.toHaveBeenCalled()
    expect(mocks.getOperBoxData).not.toHaveBeenCalled()
  })

  it('reflects an externally changed queue in candidate actions without refetching candidates', async () => {
    mocks.getOperatorList.mockResolvedValue({
      success: true,
      data: { operators: [operator('char_current', '阿米娅')] },
    })
    mocks.getTrainingQueue
      .mockResolvedValueOnce(queueResponse([]))
      .mockResolvedValueOnce(queueResponse([queueItem('char_current', '阿米娅')]))

    await renderComponent()
    const { dialog } = await openPicker()
    expect(buttonWithText('添加', dialog).disabled).toBe(false)

    mocks.getOperatorList.mockClear()
    await act(async () => {
      publishResourceInvalidation({ resources: ['training-queue'], cause: 'training-queue' })
    })
    await flush()

    expect(mocks.getOperatorList).not.toHaveBeenCalled()
    expect(buttonWithText('已添加', dialog).disabled).toBe(true)
  })

  it('shows trainable, owned, and full counts from the training queries', async () => {
    mocks.getOperatorList.mockImplementation(async (filters: { status?: string } = {}) => {
      if (filters.status === 'trainable') {
        return {
          success: true,
          data: { operators: [operator('char_a', '能天使'), operator('char_b', '艾雅法拉')] },
        }
      }
      if (filters.status === 'owned') {
        return { success: true, data: { operators: [operator('char_a', '能天使')] } }
      }
      return { success: true, data: { operators: [] } }
    })
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [
        { id: 'char_a', name: '能天使', rarity: 6, profession: 'SNIPER', level: 0, elite: 0, potential: 0 },
        { id: 'char_b', name: '艾雅法拉', rarity: 6, profession: 'CASTER', level: 0, elite: 0, potential: 0 },
      ],
    })

    await renderComponent()
    await openPicker()

    expect(statusCount('可养成')).toBe('2')
    expect(statusCount('已拥有')).toBe('1')
    expect(statusCount('全部')).toBe('2')
  })

  it('clears the candidate list on failure while keeping the last status counts', async () => {
    let fail = false
    mocks.getOperatorList.mockImplementation(async (filters: { status?: string } = {}) => {
      if (fail) throw new Error('干员服务暂不可用')
      if (filters.status === 'trainable') {
        return { success: true, data: { operators: [operator('char_a', '阿米娅')] } }
      }
      if (filters.status === 'owned') {
        return { success: true, data: { operators: [operator('char_a', '阿米娅')] } }
      }
      return { success: true, data: { operators: [] } }
    })
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [
        { id: 'char_a', name: '阿米娅', rarity: 6, profession: 'CASTER', level: 0, elite: 0, potential: 0 },
        { id: 'char_b', name: '能天使', rarity: 6, profession: 'SNIPER', level: 0, elite: 0, potential: 0 },
      ],
    })

    await renderComponent()
    const { dialog } = await openPicker()
    expect(dialog.textContent).toContain('阿米娅')
    expect(statusCount('可养成')).toBe('1')
    expect(statusCount('已拥有')).toBe('1')
    expect(statusCount('全部')).toBe('2')

    fail = true
    await act(async () => {
      publishResourceInvalidation({ resources: ['catalog'], cause: 'resource-update' })
    })
    await flush()

    expect(dialog.textContent).toContain('干员列表加载失败')
    expect(dialog.textContent).toContain('干员服务暂不可用')
    expect(dialog.textContent).not.toContain('阿米娅')
    expect(statusCount('可养成')).toBe('1')
    expect(statusCount('已拥有')).toBe('1')
    expect(statusCount('全部')).toBe('2')
  })

  it('does not let a late candidate response overwrite a newer rarity filter', async () => {
    const sixStarRequest = deferred<{ success: boolean; data: { operators: TrainingOperator[] } }>()
    const fiveStarRequest = deferred<{ success: boolean; data: { operators: TrainingOperator[] } }>()
    mocks.getOperatorList.mockImplementation(async (filters: { status?: string; rarity?: number } = {}) => {
      if (filters.status === 'trainable' && filters.rarity === 6) return sixStarRequest.promise
      if (filters.status === 'trainable' && filters.rarity === 5) return fiveStarRequest.promise
      return { success: true, data: { operators: [] } }
    })

    await renderComponent()
    const { dialog } = await openPicker()
    await selectRarity(dialog, '6 星')
    expect(dialog.textContent).toContain('正在读取干员')

    await selectRarity(dialog, '5 星')
    await act(async () => sixStarRequest.resolve({
      success: true,
      data: { operators: [operator('char_six', '六星干员')] },
    }))
    await flush()

    expect(dialog.textContent).not.toContain('六星干员')

    await act(async () => fiveStarRequest.resolve({
      success: true,
      data: { operators: [operator('char_five', '五星干员')] },
    }))
    await flush()

    expect(dialog.textContent).toContain('五星干员')
    expect(dialog.textContent).not.toContain('六星干员')
  })

  it('does not show stale candidate data across an Activity hide and restore cycle', async () => {
    const operatorRequests: Array<DeferredResult<{ success: boolean; data: { operators: TrainingOperator[] } }>> = []
    const catalogRequests: Array<DeferredResult<{ success: boolean; data: unknown[] }>> = []
    const operBoxRequests: Array<DeferredResult<{ success: boolean; data: { data: unknown[] } }>> = []

    mocks.getOperatorList.mockImplementation(async () => {
      const request = deferred<{ success: boolean; data: { operators: TrainingOperator[] } }>()
      operatorRequests.push(request)
      return request.promise
    })
    mocks.getAllOperators.mockImplementation(async () => {
      const request = deferred<{ success: boolean; data: unknown[] }>()
      catalogRequests.push(request)
      return request.promise
    })
    mocks.getOperBoxData.mockImplementation(async () => {
      const request = deferred<{ success: boolean; data: { data: unknown[] } }>()
      operBoxRequests.push(request)
      return request.promise
    })

    await renderWithActivity('visible')
    const initialOperatorCount = operatorRequests.length
    const initialCatalogCount = catalogRequests.length
    const initialOperBoxCount = operBoxRequests.length
    expect(initialOperatorCount).toBeGreaterThan(0)

    await renderWithActivity('hidden')
    await renderWithActivity('visible')
    expect(operatorRequests.length).toBeGreaterThan(initialOperatorCount)

    await act(async () => {
      operatorRequests.slice(0, initialOperatorCount).forEach(request => request.resolve({
        success: true,
        data: { operators: [operator('char_old', '旧干员')] },
      }))
      catalogRequests.slice(0, initialCatalogCount).forEach(request => request.resolve({
        success: true,
        data: [],
      }))
      operBoxRequests.slice(0, initialOperBoxCount).forEach(request => request.resolve({
        success: true,
        data: { data: [] },
      }))
    })
    await flush()

    const { dialog } = await openPicker()
    expect(dialog.textContent).not.toContain('旧干员')

    await act(async () => {
      operatorRequests.slice(initialOperatorCount).forEach(request => request.resolve({
        success: true,
        data: { operators: [operator('char_new', '新干员')] },
      }))
      catalogRequests.slice(initialCatalogCount).forEach(request => request.resolve({
        success: true,
        data: [],
      }))
      operBoxRequests.slice(initialOperBoxCount).forEach(request => request.resolve({
        success: true,
        data: { data: [] },
      }))
    })
    await flush()

    expect(dialog.textContent).toContain('新干员')
    expect(dialog.textContent).not.toContain('旧干员')
  })

  it('invalidates a previewed plan when resource invalidation reports a new plan basis', async () => {
    mockMutableQueue([queueItem('char_current', '阿米娅')])
    await renderComponent()
    await click(buttonWithText('预览刷图计划', container))
    expect(container.textContent).toContain('应用到自动任务')

    mocks.getTrainingQueue.mockClear()
    await act(async () => {
      publishResourceInvalidation({ resources: ['training-plan'], cause: 'resource-update' })
    })
    await flush()

    expect(container.textContent).toContain('队列变更后需重新预览')
    expect(buttonWithText('预览刷图计划', container)).toBeDefined()
    expect(mocks.getTrainingQueue).not.toHaveBeenCalled()
  })

  it('removes the only target to the empty state and restores it at the original position', async () => {    const getQueue = mockMutableQueue([queueItem('char_current', '阿米娅')])

    await renderComponent()
    await click(queueButton('移除阿米娅'))

    expect(queueOrder()).toEqual([])
    expect(container.textContent).toContain('养成队列还是空的')
    expect(document.body.textContent).toContain('已移除 阿米娅')
    await click(buttonWithText('撤销'))

    expect(mocks.addToTrainingQueue).toHaveBeenCalledWith({
      operatorId: 'char_current',
      currentElite: 1,
      targetElite: 2,
      position: 0,
    })
    expect(mocks.updateTrainingQueueOrder).not.toHaveBeenCalled()
    expect(getQueue().map(item => item.operatorId)).toEqual(['char_current'])
    expect(queueOrder()).toEqual(['阿米娅'])
    await settleToastRemoval()
    expect(document.body.textContent).not.toContain('已移除 阿米娅')
  })

  it('keeps undo in a dismissible toast outside the queue workspace', async () => {
    mockMutableQueue([queueItem('char_current', '阿米娅')])

    await renderComponent()
    await click(queueButton('移除阿米娅'))

    const toast = undoToast()
    expect(toast).not.toBeNull()
    expect(container.contains(toast)).toBe(false)
    expect(buttonWithText('撤销', toast!)).toBeDefined()
    const close = toast?.querySelector<HTMLButtonElement>('button[aria-label="关闭移除提示"]')
    expect(close).not.toBeNull()
    await click(close!)

    await settleToastRemoval()
    expect(undoToast()).toBeNull()
    expect(undoToastClose()).toBeNull()
    expect(queueOrder()).toEqual([])
    expect(mocks.addToTrainingQueue).not.toHaveBeenCalled()
  })

  it('expires the undo toast after eight seconds and pauses expiry while it has keyboard focus', async () => {
    mockMutableQueue([queueItem('char_current', '阿米娅')])

    await renderComponent()
    vi.useFakeTimers()
    await click(queueButton('移除阿米娅'))
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(undoToast()).not.toBeNull()

    const undoButton = buttonWithText('撤销')
    await act(async () => undoButton.focus())
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(undoToast()).not.toBeNull()

    await act(async () => undoButton.blur())
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    await settleToastRemoval()
    expect(undoToast()).toBeNull()
    expect(undoToastClose()).toBeNull()
    expect(queueOrder()).toEqual([])
  })

  it('promotes the next target when the current target is removed', async () => {
    mockMutableQueue([
      queueItem('char_current', '阿米娅'),
      queueItem('char_next', '能天使'),
      queueItem('char_last', '艾雅法拉'),
    ])

    await renderComponent()
    expect(container.querySelector('button[aria-label="将阿米娅设为当前"]')).toBeNull()
    await click(queueButton('移除阿米娅'))

    expect(queueOrder()).toEqual(['能天使', '艾雅法拉'])
    expect(container.querySelector('button[aria-label="将能天使设为当前"]')).toBeNull()
    expect(queueButton('将艾雅法拉设为当前')).not.toBeNull()
  })

  it('restores a removed middle target at its original index with one atomic add', async () => {
    const getQueue = mockMutableQueue([
      queueItem('char_current', '阿米娅'),
      queueItem('char_removed', '能天使'),
      queueItem('char_last', '艾雅法拉'),
    ])

    await renderComponent()
    await click(queueButton('移除能天使'))
    expect(queueOrder()).toEqual(['阿米娅', '艾雅法拉'])
    await click(buttonWithText('撤销'))

    expect(mocks.addToTrainingQueue).toHaveBeenCalledWith({
      operatorId: 'char_removed',
      currentElite: 1,
      targetElite: 2,
      position: 1,
    })
    expect(mocks.updateTrainingQueueOrder).not.toHaveBeenCalled()
    expect(getQueue().map(item => item.operatorId)).toEqual(['char_current', 'char_removed', 'char_last'])
    expect(queueOrder()).toEqual(['阿米娅', '能天使', '艾雅法拉'])
  })

  it('sets a later target as current without dropping any other target', async () => {
    mockMutableQueue([
      queueItem('char_current', '阿米娅'),
      queueItem('char_middle', '能天使'),
      queueItem('char_last', '艾雅法拉'),
    ])

    await renderComponent()
    const setCurrentButton = queueButton('将艾雅法拉设为当前')
    setCurrentButton.focus()
    await click(setCurrentButton)

    expect(mocks.updateTrainingQueueOrder).toHaveBeenCalledWith(['char_last', 'char_current', 'char_middle'])
    expect(queueOrder()).toEqual(['艾雅法拉', '阿米娅', '能天使'])
    expect(container.querySelector('button[aria-label="将艾雅法拉设为当前"]')).toBeNull()
    expect(document.activeElement).toBe(container.querySelector('#training-queue-title'))
  })

  it('keeps keyboard-accessible move controls at both queue boundaries', async () => {
    mockMutableQueue([
      queueItem('char_current', '阿米娅'),
      queueItem('char_middle', '能天使'),
      queueItem('char_last', '艾雅法拉'),
    ])

    await renderComponent()
    expect(queueButton('上移阿米娅').disabled).toBe(true)
    expect(queueButton('下移艾雅法拉').disabled).toBe(true)
    expect(queueButton('上移能天使').disabled).toBe(false)
    expect(queueButton('下移能天使').disabled).toBe(false)
    await click(queueButton('上移能天使'))

    expect(mocks.updateTrainingQueueOrder).toHaveBeenLastCalledWith(['char_middle', 'char_current', 'char_last'])
    expect(queueOrder()).toEqual(['能天使', '阿米娅', '艾雅法拉'])
    await click(queueButton('下移能天使'))
    expect(mocks.updateTrainingQueueOrder).toHaveBeenLastCalledWith(['char_current', 'char_middle', 'char_last'])
    expect(queueOrder()).toEqual(['阿米娅', '能天使', '艾雅法拉'])
  })

  it('keeps the queue unchanged and allows retry when a removal fails', async () => {
    mockMutableQueue([queueItem('char_current', '阿米娅')])
    mocks.removeFromTrainingQueue.mockResolvedValueOnce({ success: false })

    await renderComponent()
    await click(queueButton('移除阿米娅'))

    expect(queueOrder()).toEqual(['阿米娅'])
    expect(queueButton('移除阿米娅').disabled).toBe(false)
    expect(mocks.setMessage).toHaveBeenCalledWith(expect.stringContaining('删除失败'), 'error')
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === '撤销')).toBe(false)
    await click(queueButton('移除阿米娅'))
    expect(queueOrder()).toEqual([])
  })

  it('invalidates an old preview as soon as a queue change starts', async () => {
    const removeRequest = deferred<{ success: boolean }>()
    mockMutableQueue([queueItem('char_current', '阿米娅'), queueItem('char_next', '能天使')])
    mocks.removeFromTrainingQueue.mockReturnValueOnce(removeRequest.promise)

    await renderComponent()
    await click(buttonWithText('预览刷图计划', container))
    const oldApplyButton = buttonWithText('应用到自动任务', container)
    await click(queueButton('移除阿米娅'))

    expect(container.contains(oldApplyButton) && !oldApplyButton.disabled).toBe(false)
    await click(oldApplyButton)
    expect(mocks.applyTrainingPlan).not.toHaveBeenCalled()
    await act(async () => removeRequest.resolve({ success: false }))
    await flush()
    expect(queueOrder()).toEqual(['阿米娅', '能天使'])
    expect(container.textContent).not.toContain('1-7')
  })

  it('invalidates an old preview when its scope changes', async () => {
    mockMutableQueue([queueItem('char_current', '阿米娅')])

    await renderComponent()
    await click(buttonWithText('预览刷图计划', container))
    expect(buttonWithText('应用到自动任务', container)).toBeDefined()
    await chooseSelectOption('计划范围', '全部队列')
    await flush()

    expect(container.textContent).not.toContain('1-7')
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent?.trim() === '应用到自动任务')).toBe(false)
    expect(mocks.applyTrainingPlan).not.toHaveBeenCalled()
  })

  it('refreshes an externally advanced queue before generating a preview for its current target', async () => {
    const current = queueItem('char_current', '阿米娅')
    const next = queueItem('char_next', '能天使')
    const refreshRequest = deferred<ReturnType<typeof queueResponse>>()
    mocks.getTrainingQueue.mockResolvedValue(queueResponse([current, next]))

    await renderComponent()
    mocks.getTrainingQueue.mockReturnValueOnce(refreshRequest.promise)
    mocks.generateTrainingPlan.mockResolvedValue({
      success: true,
      data: { ...plan(), queueRevision: 'queue-2', focusOperator: { id: 'char_next', name: '能天使', rarity: 6 } },
    })
    await click(buttonWithText('预览刷图计划', container))

    expect(mocks.generateTrainingPlan).not.toHaveBeenCalled()
    expect(queueButton('移除阿米娅').disabled).toBe(true)
    await act(async () => refreshRequest.resolve(queueResponse([next], 'queue-2')))
    await flush()

    expect(mocks.generateTrainingPlan).toHaveBeenCalledOnce()
    expect(queueOrder()).toEqual(['能天使'])
    expect(container.querySelector('#training-materials-title')?.textContent).toBe('能天使的材料')
    expect(planPanelText()).toContain('能天使')
    expect(planPanelText()).toContain('今日可刷')
    expect(buttonWithText('应用到自动任务', container).disabled).toBe(false)
  })

  it('rejects a preview generated across queue revisions and refreshes the queue before retry', async () => {
    const current = queueItem('char_current', '阿米娅')
    const next = queueItem('char_next', '能天使')
    const previewRequest = deferred<{ success: boolean; data: TrainingPlan }>()
    const newerPlan = { ...plan(), queueRevision: 'queue-2', focusOperator: { id: 'char_next', name: '能天使', rarity: 6 } }
    mocks.getTrainingQueue.mockResolvedValue(queueResponse([current, next]))
    mocks.generateTrainingPlan.mockReturnValueOnce(previewRequest.promise)

    await renderComponent()
    await click(buttonWithText('预览刷图计划', container))
    expect(mocks.generateTrainingPlan).toHaveBeenCalledOnce()
    mocks.getTrainingQueue.mockResolvedValue(queueResponse([next], 'queue-2'))
    await act(async () => previewRequest.resolve({ success: true, data: newerPlan }))
    await flush()

    expect(mocks.getTrainingQueue).toHaveBeenCalledTimes(3)
    expect(queueOrder()).toEqual(['能天使'])
    expect(container.textContent).toContain('养成队列已变化，请重新预览计划')
    expect(planPanelText()).not.toContain('今日可刷')
    expect(mocks.applyTrainingPlan).not.toHaveBeenCalled()
    mocks.generateTrainingPlan.mockResolvedValueOnce({ success: true, data: newerPlan })
    await click(buttonWithText('预览刷图计划', container))

    expect(mocks.generateTrainingPlan).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(buttonWithText('应用到自动任务', container).disabled).toBe(false)
  })

  it('invalidates an existing preview when sync retry discovers an external queue revision', async () => {
    const current = queueItem('char_current', '阿米娅')
    const next = queueItem('char_next', '能天使')
    const failedQueue = queueResponse([current, next])
    mocks.getTrainingQueue.mockResolvedValue({
      ...failedQueue,
      data: {
        ...failedQueue.data,
        flowSync: { status: 'failed', flowName: '自动任务', taskName: 'Fight', error: '同步尚未完成' },
      },
    })
    mocks.retryTrainingSync.mockResolvedValue({
      success: true,
      data: { flowSync: { status: 'synced', flowName: '自动任务', taskName: 'Fight', syncedRevision: 'queue-2' } },
    })

    await renderComponent()
    await click(buttonWithText('预览刷图计划', container))
    const oldApplyButton = buttonWithText('应用到自动任务', container)
    mocks.getTrainingQueue.mockResolvedValue(queueResponse([next], 'queue-2'))
    await click(buttonWithText('重试同步', container))

    expect(mocks.getTrainingQueue).toHaveBeenCalledTimes(3)
    expect(queueOrder()).toEqual(['能天使'])
    expect(container.contains(oldApplyButton)).toBe(false)
    expect(planPanelText()).not.toContain('今日可刷')
    await click(oldApplyButton)
    expect(mocks.applyTrainingPlan).not.toHaveBeenCalled()
    expect(container.textContent).toContain('已同步到自动任务')
  })

  it('prevents duplicate previews and blocks queue changes while generating', async () => {
    const previewRequest = deferred<{ success: boolean; data: TrainingPlan }>()
    mockMutableQueue([queueItem('char_current', '阿米娅')])
    mocks.getOperatorList.mockResolvedValue({
      success: true,
      data: { operators: [operator('char_added', '能天使'), operator('char_other', '艾雅法拉')] },
    })
    mocks.generateTrainingPlan.mockReturnValueOnce(previewRequest.promise)

    await renderComponent()
    const previewButton = buttonWithText('预览刷图计划', container)
    await act(async () => {
      previewButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      previewButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    expect(mocks.generateTrainingPlan).toHaveBeenCalledOnce()
    expect(queueButton('移除阿米娅').disabled).toBe(true)
    const { dialog } = await openPicker()
    const addButtons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button[aria-label^="添加"]'))
    expect(addButtons).toHaveLength(2)
    expect(addButtons.every(button => button.disabled)).toBe(true)
    await act(async () => previewRequest.resolve({ success: true, data: plan() }))
    await flush()
    expect(queueButton('移除阿米娅').disabled).toBe(false)
    expect(addButtons.every(button => !button.disabled)).toBe(true)
    expect(buttonWithText('应用到自动任务', container)).toBeDefined()
  })

  it('prevents duplicate applies and unlocks queue operations after a failed apply', async () => {
    const applyRequest = deferred<{ success: boolean }>()
    mockMutableQueue([queueItem('char_current', '阿米娅')])
    mocks.applyTrainingPlan.mockReturnValueOnce(applyRequest.promise)

    await renderComponent()
    await click(buttonWithText('预览刷图计划', container))
    const applyButton = buttonWithText('应用到自动任务', container)
    await act(async () => {
      applyButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      applyButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()

    expect(mocks.applyTrainingPlan).toHaveBeenCalledOnce()
    expect(queueButton('移除阿米娅').disabled).toBe(true)
    await act(async () => applyRequest.resolve({ success: false }))
    await flush()
    expect(queueButton('移除阿米娅').disabled).toBe(false)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('应用失败')
    expect(buttonWithText('预览刷图计划', container).disabled).toBe(false)
    await click(buttonWithText('预览刷图计划', container))
    expect(buttonWithText('应用到自动任务', container).disabled).toBe(false)
  })

  it('shows a persistent sync failure separately from the updated queue and retries it', async () => {
    const syncedFlow = { status: 'synced', flowName: '日常刷图', taskName: 'Fight', syncedRevision: 'queue-1' }
    mocks.getTrainingQueue.mockResolvedValue({
      ...queueResponse([queueItem('char_current', '阿米娅')]),
      data: {
        ...queueResponse([queueItem('char_current', '阿米娅')]).data,
        flowSync: { status: 'failed', flowName: '日常刷图', taskName: 'Fight', error: '配置文件暂时不可写' },
      },
    })
    mocks.retryTrainingSync.mockResolvedValue({ success: true, data: { flowSync: syncedFlow } })

    await renderComponent()

    const status = Array.from(container.querySelectorAll<HTMLElement>('[role="status"]'))
      .find(element => element.textContent?.includes('配置文件暂时不可写'))
    expect(status).toBeDefined()
    expect(queueOrder()).toEqual(['阿米娅'])
    await click(buttonWithText('重试同步', status))

    expect(mocks.retryTrainingSync).toHaveBeenCalledOnce()
    expect(container.textContent).not.toContain('配置文件暂时不可写')
    expect(queueOrder()).toEqual(['阿米娅'])
  })

  it('distinguishes collected materials from a target that still has a material gap', async () => {
    const target = { ...queueItem('char_current', '阿米娅'), progress: 100 }
    mocks.getTrainingQueue.mockResolvedValue(queueResponse([target]))

    await renderComponent()

    expect(container.textContent).toContain('当前目标材料已集齐，可在游戏内完成养成。')
    expect(container.querySelector('[role="table"][aria-label="材料筹备明细"]')).toBeNull()
    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100')
  })

  it('shows a remaining LMD gap even when the target needs no other materials', async () => {
    const target = {
      ...queueItem('char_current', '阿米娅'),
      materials: [],
      lmd: { needed: 100000, have: 1234, stillNeeded: 98766 },
    }
    mocks.getTrainingQueue.mockResolvedValue(queueResponse([target]))

    await renderComponent()

    const table = container.querySelector('[role="table"][aria-label="材料筹备明细"]')
    const quantities = Array.from(table?.querySelectorAll('[role="cell"]') ?? []).map(cell => cell.textContent)
    expect(quantities).toEqual(['龙门币', '1234', '100000', '98766'])
    expect(container.textContent).toContain('还缺 1 种材料')
    expect(container.textContent).not.toContain('材料已集齐')
  })

  it('keeps material quantities, closed-stage plans, and degraded data warnings distinct', async () => {
    const target = {
      ...queueItem('char_current', '阿米娅'),
      materials: [{ id: '30012', name: '固源岩', count: 3, have: 1, needed: 3, stillNeeded: 2 }],
    }
    mocks.getTrainingQueue.mockResolvedValue(queueResponse([target]))
    mocks.generateTrainingPlan.mockResolvedValue({
      success: true,
      data: {
        ...plan(),
        stages: [{ stage: 'CA-5', totalTimes: 2, isOpen: false }],
        openStages: [],
        closedStages: [{ stage: 'CA-5', totalTimes: 2, isOpen: false }],
        warnings: ['掉落数据暂不可用，当前使用保守估算'],
      },
    })

    await renderComponent()
    const table = container.querySelector('[role="table"][aria-label="材料筹备明细"]')
    const quantities = Array.from(table?.querySelectorAll('[role="cell"]') ?? []).map(cell => cell.textContent)
    expect(quantities).toEqual(['固源岩', '1', '3', '2'])
    expect(container.textContent).not.toContain('当前目标材料已集齐')

    await click(buttonWithText('预览刷图计划', container))

    expect(container.textContent).toContain('今天没有可直接推进的开放关卡')
    expect(container.querySelector('[role="note"]')?.textContent).toContain('当前使用保守估算')
    expect(container.textContent).toContain('CA-5')
    expect(buttonWithText('应用到自动任务', container).disabled).toBe(true)
    expect(mocks.applyTrainingPlan).not.toHaveBeenCalled()
  })

  it('shows a failed preview as an error and lets the user retry it', async () => {
    mocks.getTrainingQueue.mockResolvedValue(queueResponse([queueItem('char_current', '阿米娅')]))
    mocks.generateTrainingPlan.mockResolvedValueOnce({ success: false, message: '掉落服务暂不可用' })

    await renderComponent()
    await click(buttonWithText('预览刷图计划', container))

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('掉落服务暂不可用')
    expect(container.textContent).not.toContain('1-7')
    expect(buttonWithText('预览刷图计划', container).disabled).toBe(false)
    await click(buttonWithText('预览刷图计划', container))

    expect(mocks.generateTrainingPlan).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(buttonWithText('应用到自动任务', container).disabled).toBe(false)
  })

  it('ignores a slow initial queue response after a newer post-add refresh', async () => {
    const initialRequest = deferred<ReturnType<typeof queueResponse>>()
    mocks.getOperatorList.mockResolvedValue({
      success: true,
      data: { operators: [operator('char_added', '能天使')] },
    })
    mocks.getTrainingQueue
      .mockReturnValueOnce(initialRequest.promise)
      .mockResolvedValueOnce(queueResponse([queueItem('char_current', '阿米娅'), queueItem('char_added', '能天使')]))
    mocks.addToTrainingQueue.mockResolvedValue({ success: true })

    await renderComponent()
    const { dialog } = await openPicker()
    await click(buttonWithText('添加', dialog))
    expect(queueOrder()).toEqual(['阿米娅', '能天使'])
    await act(async () => initialRequest.resolve({
      ...queueResponse([]),
      data: { ...queueResponse([]).data, settings: { ...settings, autoSwitch: false } },
    }))
    await flush()

    expect(queueOrder()).toEqual(['阿米娅', '能天使'])
    expect(isSwitchChecked(switchByLabel('自动切换'))).toBe(true)
  })

  it('keeps the local queue truthful and warns when a successful add cannot be refreshed', async () => {
    mocks.getOperatorList.mockResolvedValue({
      success: true,
      data: { operators: [operator('char_added', '能天使')] },
    })
    mocks.getTrainingQueue
      .mockResolvedValueOnce(queueResponse([]))
      .mockResolvedValueOnce({ success: false })
    mocks.addToTrainingQueue.mockResolvedValue({ success: true })

    await renderComponent()
    const { dialog } = await openPicker()
    await click(buttonWithText('添加', dialog))

    expect(queueOrder()).toEqual(['能天使'])
    expect(mocks.setMessage).toHaveBeenCalledWith(expect.stringContaining('队列刷新失败'), 'warning')
  })

  it('removes the local item and warns when a successful delete cannot be refreshed', async () => {
    mocks.getTrainingQueue
      .mockResolvedValueOnce(queueResponse([queueItem('char_current', '阿米娅'), queueItem('char_removed', '能天使')]))
      .mockResolvedValueOnce({ success: false })
    mocks.removeFromTrainingQueue.mockResolvedValue({ success: true })

    await renderComponent()
    await click(queueButton('移除能天使'))

    expect(queueOrder()).toEqual(['阿米娅'])
    expect(document.body.textContent).toContain('已移除 能天使')
    expect(mocks.setMessage).toHaveBeenCalledWith(expect.stringContaining('队列刷新失败'), 'warning')
  })

  it('publishes automation and dashboard invalidation after a synced plan application', async () => {
    mockMutableQueue([queueItem('char_current', '阿米娅')])
    mocks.applyTrainingPlan.mockResolvedValue({
      success: true,
      data: {
        stageCount: 1,
        flowName: '日常刷图',
        taskName: 'Fight',
        flowSync: { status: 'synced', flowName: '日常刷图', taskName: 'Fight' },
      },
    })
    const invalidations: Array<{
      resources: readonly string[]
      cause: string
      detail?: unknown
    }> = []
    const onPlanApplied = vi.fn()
    const unsubscribe = subscribeResourceInvalidation(event => {
      invalidations.push(event)
    })
    window.addEventListener('training-plan-applied', onPlanApplied)

    try {
      await renderComponent()
      await click(buttonWithText('预览刷图计划', container))
      await click(buttonWithText('应用到自动任务', container))

      expect(mocks.applyTrainingPlan).toHaveBeenCalledOnce()
      expect(invalidations).toContainEqual({
        resources: ['automation-config', 'automation-schedule', 'dashboard-snapshot'],
        cause: 'plan-applied',
        detail: {
          stageCount: 1,
          flowName: '日常刷图',
          taskName: 'Fight',
          source: 'training-plan-owner',
        },
      })
      expect(onPlanApplied).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
      window.removeEventListener('training-plan-applied', onPlanApplied)
    }
  })

  it('serializes a queued reorder against the queue produced by an in-flight removal', async () => {
    let server = [
      queueItem('char_current', '阿米娅'),
      queueItem('char_middle', '能天使'),
      queueItem('char_last', '艾雅法拉'),
    ]
    mocks.getTrainingQueue.mockImplementation(async () => queueResponse([...server]))
    const removeRequest = deferred<{ success: boolean }>()
    mocks.removeFromTrainingQueue.mockImplementationOnce(async (operatorId: string) => {
      await removeRequest.promise
      server = server.filter(item => item.operatorId !== operatorId)
      return { success: true, data: { queueUpdated: true, queueRevision: 'queue-2' } }
    })
    mocks.updateTrainingQueueOrder.mockImplementation(async (operatorIds: string[]) => {
      server = operatorIds.map(operatorId => server.find(item => item.operatorId === operatorId)!)
      return { success: true, data: { queueUpdated: true, queueRevision: 'queue-2' } }
    })

    await renderComponent()
    const removeButton = queueButton('移除阿米娅')
    const setCurrentButton = queueButton('将艾雅法拉设为当前')
    await act(async () => {
      removeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      setCurrentButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    await flush()

    // 第二条命令不基于点击时的旧队列提交；它排在移除之后，等最新快照。
    expect(mocks.updateTrainingQueueOrder).not.toHaveBeenCalled()

    await act(async () => removeRequest.resolve({ success: true }))
    await flush()

    expect(mocks.removeFromTrainingQueue).toHaveBeenCalledOnce()
    expect(mocks.updateTrainingQueueOrder).toHaveBeenCalledWith(['char_last', 'char_middle'])
    expect(queueOrder()).toEqual(['艾雅法拉', '能天使'])
  })

  it('keeps a local fallback, exposes the uncertain queue, and clears it after reload', async () => {
    mocks.getOperatorList.mockResolvedValue({
      success: true,
      data: { operators: [operator('char_added', '能天使')] },
    })
    mocks.getTrainingQueue
      .mockResolvedValueOnce(queueResponse([]))
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce(queueResponse([queueItem('char_added', '能天使')]))
    mocks.addToTrainingQueue.mockResolvedValue({
      success: true,
      data: { queueUpdated: true, queueRevision: 'queue-2' },
    })

    await renderComponent()
    const { dialog } = await openPicker()
    await click(buttonWithText('添加', dialog))

    expect(queueOrder()).toEqual(['能天使'])
    const warning = Array.from(container.querySelectorAll<HTMLElement>('[role="alert"]'))
      .find(alert => alert.textContent?.includes('读取最新状态失败'))
    expect(warning).toBeDefined()
    expect(buttonWithText('预览刷图计划', container).disabled).toBe(true)

    await click(buttonWithText('重新加载', warning!))

    expect(container.textContent).not.toContain('读取最新状态失败')
    expect(buttonWithText('预览刷图计划', container).disabled).toBe(false)
    expect(queueOrder()).toEqual(['能天使'])
  })

  it('publishes cross-page queue invalidation without refetching from its own event', async () => {
    mockMutableQueue([queueItem('char_current', '阿米娅')])
    mocks.getOperatorList.mockResolvedValue({
      success: true,
      data: { operators: [operator('char_added', '能天使')] },
    })
    const events: Array<{
      resources: readonly string[]
      cause: string
      detail?: unknown
    }> = []
    const unsubscribe = subscribeResourceInvalidation(event => {
      events.push(event)
    })

    try {
      await renderComponent()
      mocks.getTrainingQueue.mockClear()
      mocks.getOperatorList.mockClear()
      mocks.getAllOperators.mockClear()
      mocks.getOperBoxData.mockClear()

      const { dialog } = await openPicker()
      await click(buttonWithText('添加', dialog))

      const queueEvent = events.find(event => (
        event.cause === 'training-queue' && event.resources.includes('training-queue')
      ))
      expect(queueEvent).toBeDefined()
      expect(queueEvent?.resources).toEqual(expect.arrayContaining([
        'training-queue',
        'materials',
        'training-plan',
        'dashboard-snapshot',
      ]))
      expect(queueEvent?.detail).toEqual({ source: 'training-queue-command' })
      // 本页已写入权威快照；自己的发布不应再触发队列重读或候选/计数重取。
      expect(mocks.getTrainingQueue).toHaveBeenCalledTimes(1)
      expect(mocks.getOperatorList).not.toHaveBeenCalled()
      expect(mocks.getAllOperators).not.toHaveBeenCalled()
      expect(mocks.getOperBoxData).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
    }
  })

  it('invalidates an existing preview when training settings change and re-previews with the latest settings', async () => {
    const queued = [queueItem('char_current', '阿米娅')]
    const serverSettings = { ...settings }
    mocks.getTrainingQueue.mockImplementation(async () => queueResponse(queued, 'queue-1', serverSettings))
    mocks.updateTrainingSettings.mockImplementation(async (next: TrainingSettings) => {
      Object.assign(serverSettings, next)
      return { success: true, data: { ...serverSettings } }
    })

    await renderComponent()
    await click(buttonWithText('预览刷图计划', container))
    expect(buttonWithText('应用到自动任务', container)).toBeDefined()

    await click(switchByLabel('自动切换')!)

    expect(isSwitchChecked(switchByLabel('自动切换'))).toBe(false)
    expect(Array.from(container.querySelectorAll('button'))
      .some(button => button.textContent?.trim() === '应用到自动任务')).toBe(false)

    await click(buttonWithText('预览刷图计划', container))
    await click(buttonWithText('应用到自动任务', container))

    expect(mocks.applyTrainingPlan).toHaveBeenCalledWith({
      plan: expect.objectContaining({ queueRevision: 'queue-1' }),
      settings: { ...settings, autoSwitch: false },
    })
  })

  it('keeps a preview generated while its settings write is still in flight', async () => {
    const queued = [queueItem('char_current', '阿米娅')]
    const serverSettings = { ...settings }
    const writeRequest = deferred<{ success: boolean; data: TrainingSettings }>()
    mocks.getTrainingQueue.mockImplementation(async () => queueResponse(queued, 'queue-1', serverSettings))
    mocks.updateTrainingSettings.mockReturnValueOnce(writeRequest.promise)

    await renderComponent()
    await click(switchByLabel('自动切换')!)
    expect(isSwitchChecked(switchByLabel('自动切换'))).toBe(false)

    // 写入在途时重读到的服务端设置仍是旧值；所有者忽略它，并按本地 revision 生成预览。
    await click(buttonWithText('预览刷图计划', container))
    expect(buttonWithText('应用到自动任务', container)).toBeDefined()

    Object.assign(serverSettings, { autoSwitch: false })
    await act(async () => writeRequest.resolve({
      success: true,
      data: { ...settings, autoSwitch: false },
    }))
    await flush()

    // 自己的设置发布不清掉期间重新生成的预览；应用提交已确认的设置。
    expect(buttonWithText('应用到自动任务', container).disabled).toBe(false)
    await click(buttonWithText('应用到自动任务', container))
    expect(mocks.applyTrainingPlan).toHaveBeenCalledWith(expect.objectContaining({
      settings: { ...settings, autoSwitch: false },
    }))
  })

  it('restores the last saved settings and reports a failed write', async () => {
    mocks.updateTrainingSettings
      .mockResolvedValueOnce({ success: false, message: '设置服务不可用' })
      .mockResolvedValueOnce({ success: true, data: { ...settings, autoSwitch: false } })

    await renderComponent()
    const autoSwitch = switchByLabel('自动切换')
    expect(isSwitchChecked(autoSwitch)).toBe(true)

    await click(autoSwitch!)
    expect(isSwitchChecked(autoSwitch)).toBe(true)
    expect(mocks.setMessage).toHaveBeenCalledWith('设置保存失败，已恢复原设置', 'error')

    await click(switchByLabel('自动切换')!)
    expect(isSwitchChecked(switchByLabel('自动切换'))).toBe(false)
    expect(mocks.updateTrainingSettings).toHaveBeenCalledTimes(2)
  })

  it('keeps settings writes serialized across a page remount and ignores the older response', async () => {
    const firstRequest = deferred<{ success: boolean; data: TrainingSettings }>()
    mocks.updateTrainingSettings
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce({ success: true, data: settings })

    await renderComponent()
    await click(switchByLabel('自动切换')!)
    expect(isSwitchChecked(switchByLabel('自动切换'))).toBe(false)
    expect(mocks.updateTrainingSettings).toHaveBeenCalledOnce()

    await act(async () => root.unmount())
    root = createRoot(container)
    await renderComponent()
    expect(isSwitchChecked(switchByLabel('自动切换'))).toBe(false)

    await click(switchByLabel('自动切换')!)
    expect(isSwitchChecked(switchByLabel('自动切换'))).toBe(true)
    // 旧写入仍在途，新编辑必须排队而不是并发提交。
    expect(mocks.updateTrainingSettings).toHaveBeenCalledOnce()

    await act(async () => firstRequest.resolve({
      success: true,
      data: { ...settings, autoSwitch: false },
    }))
    await flush()

    expect(mocks.updateTrainingSettings).toHaveBeenCalledTimes(2)
    expect(mocks.updateTrainingSettings).toHaveBeenLastCalledWith(settings)
    expect(isSwitchChecked(switchByLabel('自动切换'))).toBe(true)
  })

  it('adopts settings from an authoritative reload and invalidates the preview', async () => {
    const queued = [queueItem('char_current', '阿米娅')]
    const serverSettings = { ...settings }
    mocks.getTrainingQueue.mockImplementation(async () => queueResponse(queued, 'queue-1', serverSettings))

    await renderComponent()
    await click(buttonWithText('预览刷图计划', container))
    expect(buttonWithText('应用到自动任务', container)).toBeDefined()

    serverSettings.notifyOnComplete = false
    await act(async () => {
      publishResourceInvalidation({ resources: ['training-queue'], cause: 'training-queue' })
    })
    await flush()

    expect(isSwitchChecked(switchByLabel('完成通知'))).toBe(false)
    expect(container.textContent).toContain('队列变更后需重新预览')
    expect(Array.from(container.querySelectorAll('button'))
      .some(button => button.textContent?.trim() === '应用到自动任务')).toBe(false)
  })

  it('blocks preview and apply while the queue refresh failed and recovers after reload', async () => {
    mockMutableQueue([queueItem('char_current', '阿米娅')])

    await renderComponent()
    await click(buttonWithText('预览刷图计划', container))
    expect(buttonWithText('应用到自动任务', container).disabled).toBe(false)

    mocks.getTrainingQueue.mockRejectedValueOnce(new Error('队列服务暂不可用'))
    await act(async () => {
      publishResourceInvalidation({ resources: ['training-queue'], cause: 'training-queue' })
    })
    await flush()

    expect(buttonWithText('预览刷图计划', container).disabled).toBe(true)
    expect(buttonWithText('应用到自动任务', container).disabled).toBe(true)
    const generateCalls = mocks.generateTrainingPlan.mock.calls.length
    await click(buttonWithText('预览刷图计划', container))
    await click(buttonWithText('应用到自动任务', container))
    expect(mocks.generateTrainingPlan).toHaveBeenCalledTimes(generateCalls)
    expect(mocks.applyTrainingPlan).not.toHaveBeenCalled()

    await click(buttonWithText('重新加载', container))

    expect(buttonWithText('预览刷图计划', container).disabled).toBe(false)
    expect(Array.from(container.querySelectorAll('button'))
      .some(button => button.textContent?.trim() === '应用到自动任务')).toBe(false)
    await click(buttonWithText('预览刷图计划', container))
    expect(buttonWithText('应用到自动任务', container).disabled).toBe(false)
    await click(buttonWithText('应用到自动任务', container))
    expect(mocks.applyTrainingPlan).toHaveBeenCalledOnce()
  })

  it('clears the candidate list on a shared catalogue failure while keeping the last counts', async () => {
    let catalogFails = false
    mocks.getOperatorList.mockImplementation(async (filters: { status?: string } = {}) => {
      if (filters.status === 'trainable') {
        return { success: true, data: { operators: [operator('char_a', '阿米娅')] } }
      }
      if (filters.status === 'owned') {
        return { success: true, data: { operators: [operator('char_a', '阿米娅')] } }
      }
      return { success: true, data: { operators: [] } }
    })
    mocks.getAllOperators.mockImplementation(async () => {
      if (catalogFails) return { success: false, message: '目录服务不可用' }
      return {
        success: true,
        data: [
          { id: 'char_a', name: '阿米娅', rarity: 6, profession: 'CASTER', level: 0, elite: 0, potential: 0 },
          { id: 'char_b', name: '能天使', rarity: 6, profession: 'SNIPER', level: 0, elite: 0, potential: 0 },
        ],
      }
    })

    await renderComponent()
    const { dialog } = await openPicker()
    const allButton = statusSegment('全部', dialog)
    await click(allButton)

    expect(dialog.textContent).toContain('能天使')
    expect(statusCount('可养成')).toBe('1')
    expect(statusCount('已拥有')).toBe('1')
    expect(statusCount('全部')).toBe('2')

    catalogFails = true
    await act(async () => {
      publishResourceInvalidation({ resources: ['catalog'], cause: 'resource-update' })
    })
    await flush()

    expect(dialog.textContent).toContain('干员列表加载失败')
    expect(dialog.textContent).toContain('目录服务不可用')
    expect(dialog.textContent).not.toContain('能天使')
    expect(statusCount('可养成')).toBe('1')
    expect(statusCount('已拥有')).toBe('1')
    expect(statusCount('全部')).toBe('2')
  })

  it('keeps candidates and the last counts when only the counts reads fail', async () => {
    let countsFail = false
    mocks.getOperatorList.mockImplementation(async (filters: { status?: string } = {}) => {
      if (countsFail && filters.status === 'owned') throw new Error('计数服务不可用')
      return { success: true, data: { operators: [operator('char_a', '阿米娅')] } }
    })
    mocks.getAllOperators.mockResolvedValue({
      success: true,
      data: [
        { id: 'char_a', name: '阿米娅', rarity: 6, profession: 'CASTER', level: 0, elite: 0, potential: 0 },
        { id: 'char_b', name: '能天使', rarity: 6, profession: 'SNIPER', level: 0, elite: 0, potential: 0 },
      ],
    })

    await renderComponent()
    const { dialog } = await openPicker()
    expect(dialog.textContent).toContain('阿米娅')
    expect(statusCount('可养成')).toBe('1')
    expect(statusCount('已拥有')).toBe('1')
    expect(statusCount('全部')).toBe('2')

    countsFail = true
    await act(async () => {
      publishResourceInvalidation({ resources: ['operbox'], cause: 'recognition' })
    })
    await flush()

    expect(dialog.textContent).toContain('阿米娅')
    expect(dialog.textContent).not.toContain('干员列表加载失败')
    expect(statusCount('可养成')).toBe('1')
    expect(statusCount('已拥有')).toBe('1')
    expect(statusCount('全部')).toBe('2')
  })

  it('waits for an in-flight automation config save before applying the plan', async () => {
    mockMutableQueue([queueItem('char_current', '阿米娅')])
    const commit = deferred<ConfigCommitResult>()
    const adapter: ConfigPersistenceAdapter<{ value: string }, { value: string }> = {
      key: USER_CONFIG_KEYS.automationTasks,
      pendingKey: 'trainingPlanBarrierPending',
      encodeDraft: draft => ({ ...draft }),
      decodeDraft: payload => (
        payload && typeof payload === 'object' ? payload as { value: string } : null
      ),
      readLocalDraft: () => null,
      writeLocalDraft: () => undefined,
      commit: () => commit.promise,
      fetch: async () => ({ ok: true, payload: null }),
    }
    const channel = userConfigCoordinator.channel(adapter)
    channel.setDraft({ value: 'draft' })
    await flush()
    expect(channel.getState().syncState).toBe('saving')

    await renderComponent()
    await click(buttonWithText('预览刷图计划', container))
    await click(buttonWithText('应用到自动任务', container))

    // 同一配置协议要求旧保存在应用计划前落盘，避免旧保存后到覆盖新计划。
    expect(mocks.applyTrainingPlan).not.toHaveBeenCalled()
    expect(channel.getState().pending).toBe(true)

    await act(async () => commit.resolve({ ok: true }))
    await flush()

    expect(mocks.applyTrainingPlan).toHaveBeenCalledOnce()
    expect(channel.getState().pending).toBe(false)
  })

  it('blocks applying when an unmounted automation page left a persistent pending draft', async () => {
    localStorage.setItem('automationConfigSyncPending', 'pending-from-a-previous-session')
    mockMutableQueue([queueItem('char_current', '阿米娅')])

    await renderComponent()
    await click(buttonWithText('预览刷图计划', container))
    await click(buttonWithText('应用到自动任务', container))

    // automation 页面未挂载、没有协调器通道，但持久化 pending token 仍表示有未确认保存。
    expect(mocks.applyTrainingPlan).not.toHaveBeenCalled()
    expect(container.textContent).toContain('自动化配置仍有未同步的本地编辑')
    localStorage.removeItem('automationConfigSyncPending')
  })

  it('keeps the applied plan and exposes a retry when the follow-up queue read fails', async () => {
    mockMutableQueue([queueItem('char_current', '阿米娅')])
    mocks.applyTrainingPlan.mockResolvedValue({
      success: true,
      data: {
        stageCount: 1,
        flowName: '日常刷图',
        taskName: 'Fight',
        flowSync: { status: 'synced', flowName: '日常刷图', taskName: 'Fight' },
      },
    })

    await renderComponent()
    await click(buttonWithText('预览刷图计划', container))
    mocks.getTrainingQueue.mockRejectedValueOnce(new Error('队列服务暂不可用'))
    await click(buttonWithText('应用到自动任务', container))

    const planSection = container.querySelector<HTMLElement>('[aria-labelledby="training-plan-title"]')
    expect(planSection).not.toBeNull()
    expect(mocks.applyTrainingPlan).toHaveBeenCalledOnce()
    expect(planSection!.textContent).toContain('计划已应用，但读取最新队列失败')
    expect(planSection!.textContent).toContain('1-7')

    mocks.getTrainingQueue.mockResolvedValue(queueResponse([queueItem('char_current', '阿米娅')]))
    await click(buttonWithText('重新加载', planSection!))

    expect(planSection!.textContent).not.toContain('读取最新队列失败')
    expect(mocks.applyTrainingPlan).toHaveBeenCalledOnce()
  })

  it('shows a retryable warning when the applied plan could not refresh the schedule', async () => {
    mockMutableQueue([queueItem('char_current', '阿米娅')])
    mocks.applyTrainingPlan.mockResolvedValueOnce({
      success: true,
      data: {
        stageCount: 1,
        flowName: '日常刷图',
        taskName: 'Fight',
        flowSync: { status: 'synced', flowName: '日常刷图', taskName: 'Fight' },
        scheduleSync: { attempted: true, success: false, message: '定时任务设置失败' },
      },
    })

    await renderComponent()
    await click(buttonWithText('预览刷图计划', container))
    await click(buttonWithText('应用到自动任务', container))

    const planSection = container.querySelector<HTMLElement>('[aria-labelledby="training-plan-title"]')
    expect(planSection).not.toBeNull()
    expect(planSection!.textContent).toContain('定时任务刷新失败')
    expect(planSection!.textContent).toContain('定时任务设置失败')

    const retryApply = buttonWithText('应用到日常刷图', planSection!)
    expect(retryApply.disabled).toBe(false)
    await click(retryApply)

    expect(mocks.applyTrainingPlan).toHaveBeenCalledTimes(2)
    expect(planSection!.textContent).not.toContain('定时任务刷新失败')
  })

  it('does not show a plan whose settings changed while it was generating', async () => {
    mockMutableQueue([queueItem('char_current', '阿米娅')])
    const generateRequest = deferred<{ success: boolean; data: TrainingPlan }>()
    mocks.generateTrainingPlan.mockReturnValueOnce(generateRequest.promise)
    mocks.updateTrainingSettings.mockResolvedValue({
      success: true,
      data: { ...settings, autoSwitch: false },
    })

    await renderComponent()
    await click(buttonWithText('预览刷图计划', container))
    expect(mocks.generateTrainingPlan).toHaveBeenCalledOnce()

    await click(switchByLabel('自动切换')!)
    await act(async () => generateRequest.resolve({ success: true, data: plan() }))
    await flush()

    expect(planPanelText()).not.toContain('今日可刷')
    expect(container.textContent).toContain('计划前提已变化，请重新预览计划')
    expect(mocks.applyTrainingPlan).not.toHaveBeenCalled()
  })

  it('invalidates the current preview as soon as an undo request starts', async () => {
    mockMutableQueue([queueItem('char_a', '阿米娅'), queueItem('char_b', '能天使')])

    await renderComponent()
    await click(queueButton('移除能天使'))
    expect(document.body.textContent).toContain('已移除 能天使')

    await click(buttonWithText('预览刷图计划', container))
    expect(planPanelText()).toContain('今日可刷')

    const undoRequest = deferred<{ success: boolean }>()
    mocks.addToTrainingQueue.mockReturnValueOnce(undoRequest.promise)
    await click(buttonWithText('撤销', document.body))

    // 撤销与增删/排序一样在命令开始时作废旧预览，不等待写后 revision。
    expect(planPanelText()).toContain('队列变更后需重新预览')
    expect(planPanelText()).not.toContain('今日可刷')
    await act(async () => undoRequest.resolve({ success: false }))
    await flush()
  })
})
