// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/query'
import { useStatisticsCommands, type StatisticsCommands } from './useStatisticsCommands'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const idleState = {
    kind: null as 'depot' | 'operbox' | 'materials' | null,
    phase: 'idle' as 'idle' | 'running' | 'waiting' | 'parsing' | 'succeeded' | 'failed' | 'timed-out' | 'cancelled',
    resumeMode: null as 'parse' | 'command' | null,
  }
  return {
    run: vi.fn(),
    resume: vi.fn(),
    idleState,
    running: false,
  }
})

const notifications = vi.hoisted(() => ({
  notify: vi.fn(),
  notifyProgress: vi.fn(),
  dismissNotice: vi.fn(),
}))

vi.mock('@/shared/notifications', () => ({
  notify: notifications.notify,
  notifyProgress: notifications.notifyProgress,
  dismissNotice: notifications.dismissNotice,
  STATISTICS_NOTICE_ID: 'statistics',
}))

vi.mock('../model/commandOwner', () => ({
  statisticsCommandOwner: {
    run: mocks.run,
    resume: mocks.resume,
    getState: () => mocks.idleState,
    subscribe: () => () => {},
  },
  isStatisticsCommandRunning: () => mocks.running,
}))

const depot = {
  itemCount: 2,
  items: [],
  path: '/data/depot.json',
  timestamp: '2026-10-30T00:00:00.000Z',
}

let root: Root
let container: HTMLDivElement
let commands: StatisticsCommands | null = null
let queryClient: ReturnType<typeof createQueryClient>

function Harness() {
  const current = useStatisticsCommands()
  useEffect(() => {
    commands = current
  }, [current])
  return null
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderHarness() {
  await act(async () => root.render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  ))
}

describe('useStatisticsCommands action labels', () => {
  beforeEach(async () => {
    queryClient = createQueryClient()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    commands = null
    mocks.running = false
    mocks.idleState.kind = null
    mocks.idleState.phase = 'idle'
    mocks.idleState.resumeMode = null
    await renderHarness()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    queryClient.clear()
  })

  it('labels every recognition button as 识别, 重新识别 or 继续解析', async () => {
    expect(commands!.actionLabel('operbox')).toBe('识别')
    expect(commands!.actionLabel('depot')).toBe('识别')

    mocks.idleState.kind = 'operbox'
    mocks.idleState.resumeMode = 'command'
    await renderHarness()
    expect(commands!.actionLabel('operbox')).toBe('重新识别')
    expect(commands!.actionLabel('depot')).toBe('识别')

    mocks.idleState.resumeMode = 'parse'
    await renderHarness()
    expect(commands!.actionLabel('operbox')).toBe('继续解析')

    mocks.running = true
    await renderHarness()
    expect(commands!.actionLabel('operbox')).toBe('识别')
  })

  it('labels a resumable depot recognition the same way as an operator one', async () => {
    mocks.idleState.kind = 'depot'
    mocks.idleState.resumeMode = 'command'
    await renderHarness()
    expect(commands!.actionLabel('depot')).toBe('重新识别')
    expect(commands!.actionLabel('operbox')).toBe('识别')

    mocks.idleState.resumeMode = 'parse'
    await renderHarness()
    expect(commands!.actionLabel('depot')).toBe('继续解析')
  })
})

describe('useStatisticsCommands snapshot writes', () => {
  beforeEach(async () => {
    queryClient = createQueryClient()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    commands = null
    mocks.running = false
    mocks.idleState.kind = null
    mocks.idleState.phase = 'idle'
    mocks.idleState.resumeMode = null
    mocks.run.mockReset()
    mocks.resume.mockReset()
    notifications.notify.mockReset()
    notifications.notifyProgress.mockReset()
    notifications.dismissNotice.mockReset()
    await renderHarness()
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    queryClient.clear()
    vi.restoreAllMocks()
  })

  it('cancels in-flight reads before writing the authoritative recognition snapshot', async () => {
    const order: string[] = []
    vi.spyOn(queryClient, 'cancelQueries').mockImplementation(async () => {
      order.push('cancel')
    })
    vi.spyOn(queryClient, 'setQueryData').mockImplementation((_key, data) => {
      order.push('set')
      return data
    })
    mocks.run.mockImplementation(async (_kind, options) => {
      await options.applyRecognitionSnapshot?.({ kind: 'depot', depot })
      return { status: 'succeeded', kind: 'depot', message: '识别完成', depot }
    })

    await act(async () => {
      commands!.startRecognition('depot')
    })
    await flush()

    expect(order).toEqual(['cancel', 'set'])
    expect(queryClient.cancelQueries).toHaveBeenCalledWith({
      queryKey: ['game-data', 'depot'],
    })
    expect(queryClient.setQueryData).toHaveBeenCalledWith(['game-data', 'depot'], depot)
    expect(notifications.notify).toHaveBeenCalledWith('识别完成', 'success', { id: 'statistics' })
  })

  it('writes the operbox snapshot through the same cancel-then-write path', async () => {
    const operBox = { operCount: 1, data: [], path: '/data/operbox.json', timestamp: depot.timestamp }
    const order: string[] = []
    vi.spyOn(queryClient, 'cancelQueries').mockImplementation(async () => {
      order.push('cancel')
    })
    vi.spyOn(queryClient, 'setQueryData').mockImplementation((_key, data) => {
      order.push('set')
      return data
    })
    mocks.run.mockImplementation(async (_kind, options) => {
      await options.applyRecognitionSnapshot?.({ kind: 'operbox', operBox })
      return { status: 'succeeded', kind: 'operbox', message: '识别完成', operBox }
    })

    await act(async () => {
      commands!.startRecognition('operbox')
    })
    await flush()

    expect(order).toEqual(['cancel', 'set'])
    expect(queryClient.setQueryData).toHaveBeenCalledWith(['game-data', 'operbox'], operBox)
  })

  it('reports command progress under the statistics notice id', async () => {
    mocks.run.mockImplementation(async (_kind, options) => {
      options.onProgress?.('正在识别仓库物品...')
      return { status: 'succeeded', kind: 'depot', message: '识别完成', depot }
    })

    await act(async () => {
      commands!.startRecognition('depot')
    })
    await flush()

    expect(notifications.notifyProgress).toHaveBeenCalledWith('正在识别仓库物品...', 'statistics')
  })

  it('dismisses the progress notice when a terminal result has no message', async () => {
    mocks.run.mockResolvedValue({ status: 'failed', kind: 'depot', message: '' })

    await act(async () => {
      commands!.startRecognition('depot')
    })
    await flush()

    expect(notifications.dismissNotice).toHaveBeenCalledWith('statistics')
    expect(notifications.notify).not.toHaveBeenCalled()
  })
})
