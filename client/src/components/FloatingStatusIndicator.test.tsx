// @vitest-environment jsdom

import { act, forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FloatingStatusIndicator from './FloatingStatusIndicator'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
  parseJsonResponse: vi.fn(),
  clearMessage: vi.fn(),
}))

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
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
    clearMessage: mocks.clearMessage,
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

  it('floats after its anchor leaves the actual page scroll container', async () => {
    await act(async () => root.render(
      <>
        <FloatingStatusIndicator />
        <FloatingStatusIndicator />
      </>,
    ))
    await act(async () => { await Promise.resolve() })
    expect(mocks.fetchWithAuth).toHaveBeenCalledTimes(1)

    const anchor = container.querySelector<HTMLElement>('.floating-status-anchor')!
    let anchorBottom = 120
    anchor.getBoundingClientRect = () => ({
      x: 0, y: anchorBottom - 20, top: anchorBottom - 20, right: 100,
      bottom: anchorBottom, left: 0, width: 100, height: 20,
      toJSON: () => ({}),
    })
    host.getBoundingClientRect = () => ({
      x: 0, y: 50, top: 50, right: 390, bottom: 844,
      left: 0, width: 390, height: 794, toJSON: () => ({}),
    })

    await act(async () => host.dispatchEvent(new Event('scroll')))
    expect(container.querySelector('.floating-status-overlay')).toBeNull()

    anchorBottom = 20
    await act(async () => host.dispatchEvent(new Event('scroll')))
    expect(container.querySelector('.floating-status-overlay')).not.toBeNull()
  })
})
