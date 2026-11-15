// @vitest-environment jsdom

import { act, forwardRef, type HTMLAttributes } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FloatingStatusIndicator from './FloatingStatusIndicator'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
  parseJsonResponse: vi.fn(),
  online: true,
  store: {
    message: '',
    messageType: null as 'success' | 'error' | 'warning' | 'info' | 'default' | null,
    runStatus: {
      phase: 'idle' as 'idle' | 'running' | 'waiting' | 'occupied' | 'unknown',
      isRunning: false,
      runId: null as string | null,
      label: null as string | null,
      detail: null as string | null,
    },
    backendStatus: 'available' as 'unknown' | 'checking' | 'available' | 'unavailable',
    backendMessage: '',
  },
}))

vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
  motion: {
    div: forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
      initial?: unknown
      animate?: unknown
      exit?: unknown
      transition?: unknown
    }>(function MockMotionDiv({ initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }, ref) {
      return <div ref={ref} {...props} />
    }),
  },
}))

vi.mock('@/shared/api', () => ({
  API_BASE_URL: '/api',
  fetchWithAuth: mocks.fetchWithAuth,
  parseJsonResponse: mocks.parseJsonResponse,
}))

vi.mock('../store/statusStore', () => ({
  useStatusStore: (selector?: (state: typeof mocks.store) => unknown) => {
    if (!selector) throw new Error('useStatusStore must be called with a selector')
    return selector(mocks.store)
  },
}))

vi.mock('@/shared/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mocks.online }))
vi.mock('../utils/statusMessage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/statusMessage')>()
  return { ...actual, detectStatusMessageType: () => 'error' }
})

let host: HTMLDivElement
let container: HTMLDivElement
let root: Root

function resetStore() {
  mocks.online = true
  mocks.store.message = ''
  mocks.store.messageType = null
  mocks.store.runStatus = { phase: 'idle', isRunning: false, runId: null, label: null, detail: null }
  mocks.store.backendStatus = 'available'
  mocks.store.backendMessage = ''
}

async function renderIndicator() {
  await act(async () => root.render(<FloatingStatusIndicator />))
  await act(async () => { await Promise.resolve() })
}

function statusText() {
  return container.querySelector<HTMLElement>('[role="status"]')?.textContent
}

describe('FloatingStatusIndicator', () => {
  beforeEach(() => {
    resetStore()
    mocks.fetchWithAuth.mockClear()
    mocks.parseJsonResponse.mockClear()
    mocks.fetchWithAuth.mockResolvedValue({ ok: true })
    mocks.parseJsonResponse.mockResolvedValue({ operator: '阿米娅', quote: '准备完成' })
    host = document.createElement('div')
    host.className = 'la-pluma-scroll-host'
    container = document.createElement('div')
    host.appendChild(container)
    document.body.appendChild(host)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  it('reuses one anchored status pill without a dismissible control', async () => {
    mocks.store.message = '保存失败，请重试'
    mocks.store.messageType = 'error'

    await act(async () => root.render(
      <>
        <FloatingStatusIndicator />
        <FloatingStatusIndicator />
      </>,
    ))
    await act(async () => { await Promise.resolve() })
    expect(mocks.fetchWithAuth).toHaveBeenCalledTimes(1)

    const liveRegion = container.querySelector<HTMLElement>('[role="status"]')
    expect(liveRegion?.textContent).toBe('保存失败，请重试')
    expect(liveRegion?.getAttribute('aria-live')).toBe('polite')
    expect(container.querySelector('[title="保存失败，请重试"]')).not.toBeNull()
    expect(container.querySelector('button')).toBeNull()
  })

  it('shows the run label projected from the unique snapshot', async () => {
    mocks.store.runStatus = {
      phase: 'running',
      isRunning: true,
      runId: 'run-1',
      label: '正在执行: 收取信用',
      detail: null,
    }

    await renderIndicator()

    expect(statusText()).toBe('正在执行: 收取信用')
  })

  it('keeps a waiting run visible without claiming completion', async () => {
    mocks.store.runStatus = {
      phase: 'waiting',
      isRunning: true,
      runId: 'run-1',
      label: '等待继续',
      detail: null,
    }

    await renderIndicator()

    expect(statusText()).toBe('等待继续')
  })

  it('shows unmanaged device occupancy from the unique snapshot', async () => {
    mocks.store.runStatus = {
      phase: 'occupied',
      isRunning: false,
      runId: null,
      label: '设备被其他任务占用',
      detail: null,
    }

    await renderIndicator()

    expect(statusText()).toBe('设备被其他任务占用')
  })

  it('labels a disconnected observation as unknown instead of idle or complete', async () => {
    mocks.store.runStatus = {
      phase: 'unknown',
      isRunning: true,
      runId: 'run-1',
      label: '执行状态未知',
      detail: null,
    }

    await renderIndicator()

    expect(statusText()).toBe('执行状态未知')
  })

  it('keeps connection health ahead of messages and run state', async () => {
    mocks.online = false
    mocks.store.message = '正在执行任务'
    mocks.store.messageType = 'info'
    mocks.store.runStatus = {
      phase: 'running',
      isRunning: true,
      runId: 'run-1',
      label: '正在执行: 收取信用',
      detail: null,
    }

    await renderIndicator()

    expect(statusText()).toBe('网络连接已断开，页面控制暂不可用')
  })

  it('keeps a temporary message ahead of the run label', async () => {
    mocks.store.message = '正在检查当前活动是否可以执行…'
    mocks.store.messageType = 'info'
    mocks.store.runStatus = {
      phase: 'running',
      isRunning: true,
      runId: 'run-1',
      label: '正在执行: 收取信用',
      detail: null,
    }

    await renderIndicator()

    expect(statusText()).toBe('正在检查当前活动是否可以执行…')
  })
})
