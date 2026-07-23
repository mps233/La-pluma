// @vitest-environment jsdom

import { act, forwardRef, type HTMLAttributes } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FloatingStatusIndicator from './FloatingStatusIndicator'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
  parseJsonResponse: vi.fn(),
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

vi.mock('../store/statusStore', () => ({
  useStatusStore: () => ({
    message: '保存失败，请重试',
    messageType: 'error',
    isActive: false,
    backendStatus: 'available',
    backendMessage: '',
  }),
}))

vi.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../utils/statusMessage', () => ({
  detectStatusMessageType: () => 'error',
  getStatusVisualConfig: () => ({ className: 'status-danger', dotColor: '#f00', pulseRgb: '255, 0, 0' }),
}))
vi.mock('./common', () => ({
  SmoothSurface: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}))

let host: HTMLDivElement
let container: HTMLDivElement
let root: Root

describe('FloatingStatusIndicator', () => {
  beforeEach(() => {
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

  it('reuses the anchored status pill without creating a dismissible overlay', async () => {
    await act(async () => root.render(
      <>
        <FloatingStatusIndicator />
        <FloatingStatusIndicator />
      </>,
    ))
    await act(async () => { await Promise.resolve() })
    expect(mocks.fetchWithAuth).toHaveBeenCalledTimes(1)

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
  })
})
