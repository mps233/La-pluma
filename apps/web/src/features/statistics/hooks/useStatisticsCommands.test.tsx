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
    kind: null,
    phase: 'idle',
    message: null,
    runId: null,
    resumeMode: null,
  }
  return {
    run: vi.fn(),
    resume: vi.fn(),
    idleState,
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
  isStatisticsCommandRunning: () => false,
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

describe('useStatisticsCommands snapshot writes', () => {
  beforeEach(async () => {
    queryClient = createQueryClient()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    commands = null
    mocks.run.mockReset()
    mocks.resume.mockReset()
    notifications.notify.mockReset()
    notifications.notifyProgress.mockReset()
    notifications.dismissNotice.mockReset()
    await act(async () => root.render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    ))
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
