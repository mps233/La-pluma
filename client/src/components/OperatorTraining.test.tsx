// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrainingOperator, TrainingQueueItem, TrainingSettings } from '@/types/components'
import OperatorTraining from './OperatorTraining'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
  setMessage: vi.fn(),
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
  getOperatorList: mocks.getOperatorList,
  getAllOperators: mocks.getAllOperators,
  getOperBoxData: mocks.getOperBoxData,
  getTrainingQueue: mocks.getTrainingQueue,
  addToTrainingQueue: mocks.addToTrainingQueue,
  removeFromTrainingQueue: mocks.removeFromTrainingQueue,
  updateTrainingQueueOrder: mocks.updateTrainingQueueOrder,
  updateTrainingSettings: mocks.updateTrainingSettings,
  generateTrainingPlan: mocks.generateTrainingPlan,
  applyTrainingPlan: mocks.applyTrainingPlan,
  getItemIconUrl: (id: string | number) => `/items/${id}.png`,
}))

vi.mock('../store/statusStore', () => ({
  useStatusStore: () => ({ setMessage: mocks.setMessage }),
}))

vi.mock('./FloatingStatusIndicator', () => ({ default: () => null }))

let container: HTMLDivElement
let root: Root

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

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
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
    root.render(<OperatorTraining />)
  })
  await flush()
}

const checkboxByLabel = (label: string) => {
  const labelElement = Array.from(document.querySelectorAll('label'))
    .find(candidate => candidate.textContent?.includes(label))
  return labelElement?.querySelector<HTMLInputElement>('input[type="checkbox"]')
}

describe('OperatorTraining async interactions', () => {
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
    mocks.getOperatorList.mockReset().mockResolvedValue({ success: true, data: { operators: [] } })
    mocks.getAllOperators.mockReset().mockResolvedValue({ success: true, data: { operators: [] } })
    mocks.getOperBoxData.mockReset().mockResolvedValue({ success: true, data: { data: [] } })
    mocks.getTrainingQueue.mockReset().mockResolvedValue({ success: true, data: { queue: [], settings } })
    mocks.addToTrainingQueue.mockReset()
    mocks.removeFromTrainingQueue.mockReset()
    mocks.updateTrainingQueueOrder.mockReset().mockResolvedValue({ success: true })
    mocks.updateTrainingSettings.mockReset()
    mocks.generateTrainingPlan.mockReset()
    mocks.applyTrainingPlan.mockReset()
    mocks.setMessage.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('uses the dashboard workspace layout and smooth primary surfaces', async () => {
    mocks.getTrainingQueue.mockResolvedValue({
      success: true,
      data: { queue: [queueItem('char_current', '阿米娅')], settings },
    })

    await renderComponent()

    expect(container.querySelector('.ios-workspace-page[data-page="training"]')).not.toBeNull()
    expect(container.querySelector('.app-page-header.is-mobile-inline')).not.toBeNull()
    expect(container.querySelector('.training-current-card[data-smooth-corners="true"]')).not.toBeNull()
    expect(container.querySelector('.training-settings-panel[data-smooth-corners="true"]')).not.toBeNull()
  })

  it('shows retryable errors instead of empty states when initial reads fail', async () => {
    mocks.getOperatorList.mockRejectedValueOnce(new Error('干员服务暂不可用'))
    mocks.getTrainingQueue
      .mockRejectedValueOnce(new Error('队列服务暂不可用'))
      .mockResolvedValueOnce({ success: true, data: { queue: [], settings } })

    await renderComponent()

    expect(document.body.textContent).toContain('干员列表加载失败')
    expect(document.body.textContent).toContain('干员服务暂不可用')
    expect(document.body.textContent).toContain('养成队列加载失败')
    expect(document.body.textContent).toContain('队列服务暂不可用')
    expect(document.body.textContent).not.toContain('没有可养成干员')
    expect(document.body.textContent).not.toContain('养成队列还是空的')

    const queueAlert = Array.from(container.querySelectorAll<HTMLElement>('[role="alert"]'))
      .find(alert => alert.textContent?.includes('队列服务暂不可用'))
    const queueRetry = queueAlert?.querySelector<HTMLButtonElement>('button')
    expect(queueRetry).not.toBeNull()
    await click(queueRetry!)

    expect(mocks.getTrainingQueue).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).not.toContain('队列服务暂不可用')
    expect(document.body.textContent).toContain('养成队列还是空的')
  })

  it('keeps the rarity menu keyboard-operable and labels the plan selector', async () => {
    mocks.getTrainingQueue.mockResolvedValue({
      success: true,
      data: { queue: [queueItem('char_current', '阿米娅')], settings },
    })

    await renderComponent()
    const trigger = container.querySelector<HTMLButtonElement>('[aria-controls="training-rarity-menu"]')!
    expect(trigger.className).toContain('min-h-11')
    await click(trigger)
    await act(async () => {
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
    })

    const menu = container.querySelector<HTMLElement>('#training-rarity-menu')!
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    expect(menu.getAttribute('role')).toBe('menu')
    expect(items).toHaveLength(4)
    expect(items.every(item => item.className.includes('min-h-11'))).toBe(true)
    expect(document.activeElement).toBe(items[0])

    await act(async () => {
      items[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(items[1])

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(container.querySelector('#training-rarity-menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(container.querySelector('select[aria-label="计划范围"]')).not.toBeNull()
    expect(container.querySelector('.training-settings-panel summary')?.className).toContain('min-h-11')
  })

  it('serializes settings writes so an older response cannot overwrite the latest value on disk', async () => {
    const firstRequest = deferred<{ success: boolean; data: TrainingSettings }>()
    mocks.updateTrainingSettings
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce({ success: true, data: settings })

    await renderComponent()
    const autoSwitch = checkboxByLabel('自动切换')
    expect(autoSwitch?.checked).toBe(true)

    await click(autoSwitch!)
    expect(autoSwitch?.checked).toBe(false)
    await click(autoSwitch!)
    expect(mocks.updateTrainingSettings).toHaveBeenCalledOnce()
    expect(autoSwitch?.checked).toBe(true)

    await act(async () => firstRequest.resolve({
      success: true,
      data: { ...settings, autoSwitch: false },
    }))
    await flush()

    expect(mocks.updateTrainingSettings).toHaveBeenCalledTimes(2)
    expect(mocks.updateTrainingSettings).toHaveBeenLastCalledWith(settings)
    expect(autoSwitch?.checked).toBe(true)
  })

  it('serializes duplicate queue additions while a request is pending', async () => {
    const addRequest = deferred<{ success: boolean }>()
    mocks.getOperatorList.mockResolvedValue({
      success: true,
      data: { operators: [operator('char_1', '能天使'), operator('char_2', '艾雅法拉')] },
    })
    mocks.addToTrainingQueue.mockReturnValueOnce(addRequest.promise)

    await renderComponent()
    const addButton = Array.from(document.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === '添加') as HTMLButtonElement | undefined
    expect(addButton).toBeDefined()

    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mocks.addToTrainingQueue).toHaveBeenCalledOnce()
    expect(mocks.setMessage).toHaveBeenCalledWith('养成队列正在更新，请稍候')
    await act(async () => addRequest.resolve({ success: false }))
  })

  it('restores a removed middle queue item at its original index through the undo action', async () => {
    const current = queueItem('char_current', '阿米娅')
    const removed = queueItem('char_removed', '能天使')
    const last = queueItem('char_last', '艾雅法拉')
    let queue = [current, removed, last]
    mocks.getTrainingQueue.mockImplementation(async () => ({
      success: true,
      data: { queue: [...queue], settings },
    }))
    mocks.removeFromTrainingQueue.mockImplementation(async (operatorId: string) => {
      queue = queue.filter(item => item.operatorId !== operatorId)
      return { success: true }
    })
    mocks.addToTrainingQueue.mockImplementation(async () => {
      queue = [...queue, removed]
      return { success: true }
    })
    mocks.updateTrainingQueueOrder.mockImplementation(async (operatorIds: string[]) => {
      queue = operatorIds.map(operatorId => queue.find(item => item.operatorId === operatorId)!)
      return { success: true }
    })

    await renderComponent()
    const removeButton = document.querySelector<HTMLButtonElement>('button[aria-label="移除能天使"]')
    expect(removeButton).not.toBeNull()
    await click(removeButton!)

    expect(mocks.removeFromTrainingQueue).toHaveBeenCalledWith('char_removed')
    expect(document.body.textContent).toContain('已移除 能天使')
    const undoButton = Array.from(document.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === '撤销') as HTMLButtonElement | undefined
    expect(undoButton).toBeDefined()
    await click(undoButton!)

    expect(mocks.addToTrainingQueue).toHaveBeenCalledWith({
      operatorId: 'char_removed',
      currentElite: 1,
      targetElite: 2,
    })
    expect(mocks.updateTrainingQueueOrder).toHaveBeenCalledWith([
      'char_current',
      'char_removed',
      'char_last',
    ])
    expect(queue.map(item => item.operatorId)).toEqual([
      'char_current',
      'char_removed',
      'char_last',
    ])
    expect(document.body.textContent).not.toContain('已移除 能天使')
    expect(document.body.textContent).toContain('能天使')
  })

  it('ignores a slow initial queue response after a newer post-add refresh', async () => {
    const initialRequest = deferred<{
      success: boolean
      data: { queue: TrainingQueueItem[]; settings: TrainingSettings }
    }>()
    const current = queueItem('char_current', '阿米娅')
    const added = queueItem('char_added', '能天使')
    mocks.getOperatorList.mockResolvedValue({
      success: true,
      data: { operators: [operator('char_added', '能天使')] },
    })
    mocks.getTrainingQueue
      .mockReturnValueOnce(initialRequest.promise)
      .mockResolvedValueOnce({ success: true, data: { queue: [current, added], settings } })
    mocks.addToTrainingQueue.mockResolvedValue({ success: true })

    await renderComponent()
    const addButton = Array.from(document.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === '添加') as HTMLButtonElement | undefined
    await click(addButton!)

    expect(document.querySelector('button[aria-label="移除能天使"]')).not.toBeNull()
    await act(async () => initialRequest.resolve({
      success: true,
      data: { queue: [], settings: { ...settings, autoSwitch: false } },
    }))
    await flush()

    expect(document.querySelector('button[aria-label="移除能天使"]')).not.toBeNull()
    expect(checkboxByLabel('自动切换')?.checked).toBe(true)
  })

  it('keeps the local queue truthful and warns when a successful add cannot be refreshed', async () => {
    mocks.getOperatorList.mockResolvedValue({
      success: true,
      data: { operators: [operator('char_added', '能天使')] },
    })
    mocks.getTrainingQueue
      .mockResolvedValueOnce({ success: true, data: { queue: [], settings } })
      .mockResolvedValueOnce({ success: false })
    mocks.addToTrainingQueue.mockResolvedValue({ success: true })

    await renderComponent()
    const addButton = Array.from(document.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === '添加') as HTMLButtonElement | undefined
    await click(addButton!)

    expect(document.body.textContent).toContain('能天使')
    expect(mocks.setMessage).toHaveBeenCalledWith(
      '能天使 已添加，但队列刷新失败，请稍后重试',
      'warning',
    )
  })

  it('removes the local item and warns when a successful delete cannot be refreshed', async () => {
    const current = queueItem('char_current', '阿米娅')
    const removed = queueItem('char_removed', '能天使')
    mocks.getTrainingQueue
      .mockResolvedValueOnce({ success: true, data: { queue: [current, removed], settings } })
      .mockResolvedValueOnce({ success: false })
    mocks.removeFromTrainingQueue.mockResolvedValue({ success: true })

    await renderComponent()
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="移除能天使"]')!)

    expect(document.querySelector('button[aria-label="移除能天使"]')).toBeNull()
    expect(document.body.textContent).toContain('已移除 能天使')
    expect(mocks.setMessage).toHaveBeenCalledWith(
      '已移除，但队列刷新失败，请稍后重试',
      'warning',
    )
  })
})
