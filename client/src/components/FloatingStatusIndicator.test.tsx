// @vitest-environment jsdom

import { Activity, forwardRef, type HTMLAttributes } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FloatingStatusIndicator from './FloatingStatusIndicator'

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
  parseJsonResponse: vi.fn(),
  status: {
    message: '保存失败，请重试',
    messageType: 'error' as string | null,
    isActive: false,
    runStatus: {
      phase: 'idle' as 'idle' | 'running' | 'stopping' | 'unknown',
      isRunning: false,
      runId: null as string | null,
      label: null as string | null,
      detail: null as string | null,
    },
    backendStatus: 'available' as const,
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

vi.mock('../services/api', () => ({
  API_BASE_URL: '/api',
  fetchWithAuth: mocks.fetchWithAuth,
  parseJsonResponse: mocks.parseJsonResponse,
}))

vi.mock('@/state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/state')>()),
  useStatusStore: (selector?: (value: typeof mocks.status) => unknown) =>
    selector ? selector(mocks.status) : mocks.status,
}))

vi.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../utils/statusMessage', () => ({
  detectStatusMessageType: () => 'error',
  getStatusVisualConfig: () => ({ className: 'status-danger', dotColor: '#f00', pulseRgb: '255, 0, 0' }),
}))

let host: HTMLDivElement
let container: HTMLDivElement

afterEach(cleanup)

describe('FloatingStatusIndicator', () => {
  beforeEach(() => {
    mocks.fetchWithAuth.mockClear()
    mocks.parseJsonResponse.mockClear()
    mocks.fetchWithAuth.mockResolvedValue({ ok: true })
    mocks.parseJsonResponse.mockResolvedValue({ operator: '阿米娅', quote: '准备完成' })
    mocks.status.message = '保存失败，请重试'
    mocks.status.messageType = 'error'
    mocks.status.isActive = false
    mocks.status.runStatus = { phase: 'idle', isRunning: false, runId: null, label: null, detail: null }
    mocks.status.backendStatus = 'available'
    mocks.status.backendMessage = ''
    host = document.createElement('div')
    host.className = 'la-pluma-scroll-host'
    container = document.createElement('div')
    host.appendChild(container)
    document.body.appendChild(host)
  })

  afterEach(() => {
    cleanup()
    host.remove()
    vi.restoreAllMocks()
  })

  it('reuses the anchored status pill without creating a dismissible overlay', async () => {
    render(
      <>
        <FloatingStatusIndicator />
        <FloatingStatusIndicator />
      </>,
      { container },
    )
    await waitFor(() => expect(mocks.fetchWithAuth).toHaveBeenCalledTimes(1))
    await act(async () => { await Promise.resolve() })

    const indicator = container.querySelector<HTMLElement>('.floating-status-indicator')
    const visibleText = container.querySelector<HTMLElement>('.floating-status-text')
    const liveText = container.querySelector<HTMLElement>('[role="status"]')
    expect(indicator?.classList.contains('sm:max-w-sm')).toBe(true)
    expect(indicator?.classList.contains('gap-2')).toBe(true)
    expect(indicator?.classList.contains('py-1.5')).toBe(true)
    expect(indicator?.classList.contains('sm:py-2')).toBe(true)
    expect(indicator?.classList.contains('sm:text-sm')).toBe(true)
    expect(visibleText?.classList.contains('truncate')).toBe(true)
    expect(visibleText?.classList.contains('break-words')).toBe(false)
    expect(visibleText?.classList.contains('whitespace-normal')).toBe(false)
    expect(visibleText?.title).toBe('保存失败，请重试')
    expect(liveText?.textContent).toBe('保存失败，请重试')
    expect(container.querySelector('.floating-status-dismiss')).toBeNull()
    expect(container.querySelector('.floating-status-anchor .floating-status-indicator')).not.toBeNull()
    expect(container.querySelector('.floating-status-overlay')).toBeNull()
    expect(container.querySelector('.floating-status-dot')?.classList.contains('is-pulsing')).toBe(true)
  })

  it('keeps the idle dot static so the glass surfaces stop repainting', async () => {
    mocks.status.message = ''
    mocks.status.messageType = null

    render(<FloatingStatusIndicator />, { container })
    await act(async () => { await Promise.resolve() })

    const dot = container.querySelector<HTMLElement>('.floating-status-dot')
    expect(dot?.classList.contains('is-pulsing')).toBe(false)
  })

  it('shows the global run status when there is no transient message', async () => {
    mocks.status.message = ''
    mocks.status.messageType = null
    mocks.status.runStatus = {
      phase: 'running',
      isRunning: true,
      runId: 'run-1',
      label: '正在执行: 理智作战',
      detail: '正在执行: 理智作战',
    }

    render(<FloatingStatusIndicator />, { container })
    await act(async () => { await Promise.resolve() })

    expect(container.querySelector<HTMLElement>('.floating-status-text')?.textContent).toBe('正在执行: 理智作战')
    expect(container.querySelector<HTMLElement>('[role="status"]')?.textContent).toBe('正在执行: 理智作战')
  })

  it('floats a non-ready status after its docked slot scrolls under the navbar', async () => {
    render(<FloatingStatusIndicator />, { container })
    await act(async () => { await Promise.resolve() })

    const anchor = container.querySelector<HTMLElement>('.floating-status-anchor')
    expect(anchor).not.toBeNull()

    // Still inside the scroll host, even though it sits under the navbar.
    vi.spyOn(anchor!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 14,
      width: 120,
      height: 32,
      top: 14,
      right: 120,
      bottom: 46,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect)
    fireEvent.scroll(host)
    await act(async () => { await Promise.resolve() })
    expect(container.querySelector('.floating-status-overlay')).toBeNull()

    vi.mocked(anchor!.getBoundingClientRect).mockReturnValue({
      x: 0,
      y: -42,
      width: 120,
      height: 32,
      top: -42,
      right: 120,
      bottom: -10,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.scroll(host)
    await act(async () => { await Promise.resolve() })

    const overlay = container.querySelector<HTMLElement>('.floating-status-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay?.getAttribute('aria-hidden')).toBe('true')
    expect(overlay?.querySelector<HTMLElement>('.floating-status-text')?.textContent).toBe('保存失败，请重试')
    expect(container.querySelectorAll('.floating-status-indicator')).toHaveLength(2)

    vi.mocked(anchor!.getBoundingClientRect).mockReturnValue({
      x: 0,
      y: 96,
      width: 120,
      height: 32,
      top: 96,
      right: 120,
      bottom: 128,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect)
    fireEvent.scroll(host)
    await act(async () => { await Promise.resolve() })

    expect(container.querySelector('.floating-status-overlay')).toBeNull()
  })

  it('keeps the idle quote docked when its slot scrolls out of view', async () => {
    mocks.status.message = ''
    mocks.status.messageType = null

    render(<FloatingStatusIndicator />, { container })
    await act(async () => { await Promise.resolve() })

    const anchor = container.querySelector<HTMLElement>('.floating-status-anchor')!
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: -42,
      width: 120,
      height: 32,
      top: -42,
      right: 120,
      bottom: -10,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.scroll(host)
    await act(async () => { await Promise.resolve() })

    expect(container.querySelector('.floating-status-overlay')).toBeNull()
  })

  it('does not float from a zero-sized anchor in an inactive workspace', async () => {
    render(<FloatingStatusIndicator />, { container })
    await act(async () => { await Promise.resolve() })

    fireEvent.scroll(host)
    await act(async () => { await Promise.resolve() })

    expect(container.querySelector('.floating-status-overlay')).toBeNull()
  })

  it('clears a stale floating copy when a hidden workspace is shown again', async () => {
    const { rerender } = render(
      <Activity mode="visible"><FloatingStatusIndicator /></Activity>,
      { container },
    )
    await act(async () => { await Promise.resolve() })

    const anchor = container.querySelector<HTMLElement>('.floating-status-anchor')!
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: -42,
      width: 120,
      height: 32,
      top: -42,
      right: 120,
      bottom: -10,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect)
    fireEvent.scroll(host)
    await act(async () => { await Promise.resolve() })
    expect(container.querySelector('.floating-status-overlay')).not.toBeNull()

    rerender(<Activity mode="hidden"><FloatingStatusIndicator /></Activity>)
    vi.mocked(anchor.getBoundingClientRect).mockReturnValue({
      x: 0,
      y: 96,
      width: 120,
      height: 32,
      top: 96,
      right: 120,
      bottom: 128,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect)
    rerender(<Activity mode="visible"><FloatingStatusIndicator /></Activity>)
    fireEvent.scroll(host)
    await act(async () => { await Promise.resolve() })

    expect(container.querySelector('.floating-status-overlay')).toBeNull()
  })
})
