// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CombatExecutionStatusPanel, {
  type CombatExecutionStatusPanelProps,
} from './CombatExecutionStatusPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function createProps(overrides: Partial<CombatExecutionStatusPanelProps> = {}): CombatExecutionStatusPanelProps {
  return {
    waiting: null,
    showWaiting: false,
    isAutoStopping: false,
    terminalResult: null,
    isRunning: false,
    isContinuing: false,
    isSkipping: false,
    isStopping: false,
    automationAvailable: true,
    unavailableMessage: '',
    onStartNext: vi.fn(),
    onContinueQueue: vi.fn(),
    onSkipQueueEntry: vi.fn(),
    ...overrides,
  }
}

describe('CombatExecutionStatusPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  const render = async (node: ReactNode) => {
    await act(async () => root.render(node))
  }

  const click = async (element: HTMLElement) => {
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  }

  const buttonByText = (text: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => button.textContent?.trim() === text)

  const waitingPanel = () => container.querySelector('[aria-label="等待继续"]')

  it('offers the next set entry while a set waits on a special tab', async () => {
    const props = createProps({
      waiting: { kind: 'set', label: 'TEST-2' },
      showWaiting: true,
    })
    await render(<CombatExecutionStatusPanel {...props} />)

    expect(waitingPanel()?.querySelector('h2')?.textContent).toBe('等待继续下一关')
    expect(waitingPanel()?.textContent).toContain('TEST-2')

    const start = buttonByText('开始下一关')
    expect(start?.disabled).toBe(false)
    await click(start!)
    expect(props.onStartNext).toHaveBeenCalledOnce()
    expect(buttonByText('终止执行')).toBeUndefined()
  })

  it('offers continue and skip while a queue waits on a special tab', async () => {
    const props = createProps({
      waiting: { kind: 'queue', label: 'QUEUE-2', canSkip: true },
      showWaiting: true,
    })
    await render(<CombatExecutionStatusPanel {...props} />)

    expect(waitingPanel()?.textContent).toContain('等待继续下一项')
    expect(waitingPanel()?.textContent).toContain('QUEUE-2')

    await click(buttonByText('开始下一项')!)
    expect(props.onContinueQueue).toHaveBeenCalledOnce()

    await click(buttonByText('跳过此项')!)
    expect(props.onSkipQueueEntry).toHaveBeenCalledOnce()
    expect(buttonByText('终止执行')).toBeUndefined()
  })

  it('omits skip when the waiting queue cannot skip', async () => {
    await render(
      <CombatExecutionStatusPanel
        {...createProps({
          waiting: { kind: 'queue', label: 'QUEUE-2', canSkip: false },
          showWaiting: true,
        })}
      />,
    )

    expect(buttonByText('跳过此项')).toBeUndefined()
  })

  it('replaces the waiting actions with a static stopping state', async () => {
    await render(
      <CombatExecutionStatusPanel
        {...createProps({
          waiting: { kind: 'set', label: 'TEST-2' },
          showWaiting: true,
          isAutoStopping: true,
        })}
      />,
    )

    expect(waitingPanel()?.textContent).toContain('正在停止')
    expect(buttonByText('开始下一关')).toBeUndefined()
    expect(buttonByText('终止执行')).toBeUndefined()
  })

  it('keeps waiting actions busy and disabled while continuing, skipping or stopping', async () => {
    await render(
      <CombatExecutionStatusPanel
        {...createProps({
          waiting: { kind: 'queue', label: 'QUEUE-2', canSkip: true },
          showWaiting: true,
          isContinuing: true,
          isStopping: true,
        })}
      />,
    )
    expect(buttonByText('正在开始')?.disabled).toBe(true)
    expect(buttonByText('正在开始')?.getAttribute('aria-busy')).toBe('true')

    await render(
      <CombatExecutionStatusPanel
        {...createProps({
          waiting: { kind: 'queue', label: 'QUEUE-2', canSkip: true },
          showWaiting: true,
          isSkipping: true,
        })}
      />,
    )
    expect(buttonByText('正在跳过')?.disabled).toBe(true)

    await render(
      <CombatExecutionStatusPanel
        {...createProps({
          waiting: { kind: 'set', label: 'TEST-2' },
          showWaiting: true,
          isStopping: true,
        })}
      />,
    )
    expect(buttonByText('开始下一关')?.disabled).toBe(true)
    expect(buttonByText('终止执行')).toBeUndefined()
  })

  it('disables waiting actions with the unavailable message when automation is unavailable', async () => {
    await render(
      <CombatExecutionStatusPanel
        {...createProps({
          waiting: { kind: 'set', label: 'TEST-2' },
          showWaiting: true,
          automationAvailable: false,
          unavailableMessage: '自动化暂不可用',
        })}
      />,
    )

    const start = buttonByText('开始下一关')
    expect(start?.disabled).toBe(true)
    expect(start?.title).toBe('自动化暂不可用')
  })

  it('shows a terminal result as a page-level status without actions', async () => {
    await render(
      <CombatExecutionStatusPanel
        {...createProps({
          terminalResult: {
            runId: 'run-1',
            state: 'succeeded',
            message: '作业集执行完成 (2/2 成功)',
            type: 'success',
          },
        })}
      />,
    )

    const result = container.querySelector('[aria-label="本次执行结果"]')
    expect(result?.getAttribute('role')).toBe('status')
    expect(result?.textContent).toContain('执行成功')
    expect(result?.textContent).toContain('作业集执行完成 (2/2 成功)')
    expect(result?.querySelectorAll('button')).toHaveLength(0)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('labels a failed terminal result without using alert semantics', async () => {
    await render(
      <CombatExecutionStatusPanel
        {...createProps({
          terminalResult: {
            runId: 'run-1',
            state: 'failed',
            message: '作业集执行失败: 作战失败',
            type: 'error',
          },
        })}
      />,
    )

    const result = container.querySelector('[aria-label="本次执行结果"]')
    expect(result?.textContent).toContain('执行失败')
    expect(result?.textContent).toContain('作业集执行失败: 作战失败')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('hides an old terminal result while the run is active or waiting', async () => {
    const terminalResult = {
      runId: 'run-1',
      state: 'succeeded' as const,
      message: '作业集执行完成',
      type: 'success' as const,
    }

    await render(
      <CombatExecutionStatusPanel
        {...createProps({ terminalResult, isRunning: true })}
      />,
    )
    expect(container.querySelector('[aria-label="本次执行结果"]')).toBeNull()

    await render(
      <CombatExecutionStatusPanel
        {...createProps({
          terminalResult,
          waiting: { kind: 'set', label: 'TEST-2' },
          showWaiting: true,
        })}
      />,
    )
    expect(container.querySelector('[aria-label="本次执行结果"]')).toBeNull()
    expect(waitingPanel()).not.toBeNull()

    await render(
      <CombatExecutionStatusPanel
        {...createProps({
          terminalResult,
          waiting: { kind: 'set', label: 'TEST-2' },
          showWaiting: false,
        })}
      />,
    )
    expect(container.querySelector('[aria-label="本次执行结果"]')).toBeNull()
    expect(waitingPanel()).toBeNull()
  })

  it('does not render the waiting area outside special tabs', async () => {
    await render(
      <CombatExecutionStatusPanel
        {...createProps({
          waiting: { kind: 'set', label: 'TEST-2' },
          showWaiting: false,
        })}
      />,
    )

    expect(waitingPanel()).toBeNull()
  })
})
