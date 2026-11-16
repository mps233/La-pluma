// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/query'
import DropPanel from './DropPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getDropStatistics: vi.fn(),
}))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const MotionDiv = React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, transition: _transition, ...props }, ref) =>
      React.createElement('div', { ...props, ref }, children as ReactNode),
  )

  return { motion: { div: MotionDiv }, useReducedMotion: () => true }
})

vi.mock('@/features/game-data/api', () => ({
  getAllOperators: vi.fn(),
  getDepotData: vi.fn(),
  getOperBoxData: vi.fn(),
  getItemIconUrl: (iconId: string) => `/items/${iconId}.png`,
}))

vi.mock('../api', () => ({
  getDropStatistics: mocks.getDropStatistics,
}))

let client: ReturnType<typeof createQueryClient>
let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

const render = async (isActive: boolean) => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <DropPanel isActive={isActive} />
      </QueryClientProvider>,
    )
  })
}

const click = async (element: HTMLElement) => {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await flush()
}

const periodButton = (days: number) => container
  .querySelector<HTMLButtonElement>(`button[aria-label="统计最近 ${days} 天"]`)

const statisticsFixture = (days: number) => ({
  success: true,
  data: {
    total: { sanity: 42, battles: 3, medicine: 1, stone: 0 },
    items: {
      固源岩: { count: 6, iconId: 'rock' },
      装置: { count: 9, iconId: 'device' },
    },
    stages: {
      '1-7': { battles: 3, sanity: 42, items: { 固源岩: 6 } },
    },
    dateRange: { start: '2026-10-18', end: '2026-10-25', days },
  },
})

describe('DropPanel state lifecycle', () => {
  beforeEach(() => {
    mocks.getDropStatistics.mockReset()
    mocks.getDropStatistics.mockImplementation((days: number) => Promise.resolve(statisticsFixture(days)))
    client = createQueryClient()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    client.clear()
    container.remove()
  })

  it('reads on page mount even while inactive and keeps the chosen period across tab switches', async () => {
    await render(false)
    await flush()

    expect(mocks.getDropStatistics).toHaveBeenCalledTimes(1)
    expect(mocks.getDropStatistics).toHaveBeenCalledWith(7, expect.any(AbortSignal))
    expect(container.textContent).not.toContain('总理智消耗')

    await render(true)
    await flush()

    expect(container.textContent).toContain('总理智消耗')
    expect(container.textContent).toContain('装置')
    expect(periodButton(7)?.getAttribute('aria-pressed')).toBe('true')

    await click(periodButton(14)!)
    expect(mocks.getDropStatistics).toHaveBeenCalledTimes(2)
    expect(mocks.getDropStatistics).toHaveBeenLastCalledWith(14, expect.any(AbortSignal))
    expect(periodButton(14)?.getAttribute('aria-pressed')).toBe('true')

    await render(false)
    expect(container.textContent).not.toContain('总理智消耗')
    await render(true)
    await flush()

    expect(periodButton(14)?.getAttribute('aria-pressed')).toBe('true')
    expect(mocks.getDropStatistics).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('装置')
  })

  it('keeps the previous period visible while the new one loads', async () => {
    let resolveFourteen: (value: unknown) => void = () => {}
    mocks.getDropStatistics
      .mockImplementationOnce(() => Promise.resolve(statisticsFixture(7)))
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveFourteen = resolve
      }))

    await render(true)
    await flush()
    expect(container.textContent).toContain('装置')

    await click(periodButton(14)!)
    expect(container.textContent).toContain('装置')
    expect(container.textContent).toContain('正在刷新')

    await act(async () => resolveFourteen(statisticsFixture(14)))
    await flush()
    expect(container.textContent).toContain('装置')
  })

  it('shows a recoverable drop read error and retries through the same query key', async () => {
    mocks.getDropStatistics
      .mockReset()
      .mockResolvedValueOnce({ success: false, message: 'Internal Server Error' })
      .mockResolvedValueOnce(statisticsFixture(7))

    await render(true)
    await flush()

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('掉落记录读取失败')
    expect(alert?.textContent).not.toContain('Internal Server Error')

    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('重新加载'))
    await click(retry!)

    expect(mocks.getDropStatistics).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('装置')
  })
})
