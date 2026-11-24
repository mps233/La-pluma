// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/query'
import { statisticsKeys } from '../model/queryKeys'
import DropPanel from './DropPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getDropStatistics: vi.fn(),
  notify: vi.fn(),
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

vi.mock('@/shared/notifications', () => ({
  notify: mocks.notify,
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

const periodButton = (days: number) => Array
  .from(container.querySelectorAll<HTMLButtonElement>('button'))
  .find(button => button.textContent === `${days}天`)

const refreshButton = () => Array
  .from(container.querySelectorAll<HTMLButtonElement>('button'))
  .find(button => button.textContent === '刷新')

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
    mocks.notify.mockReset()
    mocks.getDropStatistics.mockImplementation((days: number) => Promise.resolve(statisticsFixture(days)))
    onlineManager.setOnline(true)
    client = createQueryClient()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    onlineManager.setOnline(true)
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
    expect(container.textContent).toContain('正在读取新周期')
    expect(container.textContent).not.toContain('正在刷新')

    await act(async () => resolveFourteen(statisticsFixture(14)))
    await flush()
    expect(container.textContent).not.toContain('正在读取新周期')
    expect(container.textContent).toContain('装置')
  })

  it('falls back to the last successful period and notifies when a new period request fails', async () => {
    mocks.getDropStatistics
      .mockImplementationOnce(() => Promise.resolve(statisticsFixture(7)))
      .mockImplementationOnce(() => Promise.resolve({ success: false, message: 'Internal Server Error' }))
      .mockImplementation((days: number) => Promise.resolve(statisticsFixture(days)))

    await render(true)
    await flush()
    expect(periodButton(7)?.getAttribute('aria-pressed')).toBe('true')

    await click(periodButton(14)!)
    await flush()

    expect(periodButton(7)?.getAttribute('aria-pressed')).toBe('true')
    expect(periodButton(14)?.getAttribute('aria-pressed')).not.toBe('true')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('装置')
    expect(container.textContent).toContain('(共 7 天)')
    expect(mocks.notify).toHaveBeenCalledWith('统计周期读取失败，已回退到最近成功的周期', 'warning')
  })

  it('never paints an error surface between a failed period switch and its fallback', async () => {
    mocks.getDropStatistics
      .mockImplementationOnce(() => Promise.resolve(statisticsFixture(7)))
      .mockImplementationOnce(() => Promise.resolve({ success: false, message: 'Internal Server Error' }))
      .mockImplementation((days: number) => Promise.resolve(statisticsFixture(days)))

    await render(true)
    await flush()

    const alertFrames: string[] = []
    const bannerFrames: string[] = []
    const observer = new MutationObserver(() => {
      const alert = container.querySelector('[role="alert"]')
      if (alert) alertFrames.push(alert.textContent ?? '')
      if (container.textContent?.includes('掉落记录刷新失败')) bannerFrames.push(container.textContent)
    })

    observer.observe(container, { childList: true, subtree: true, characterData: true })
    await click(periodButton(14)!)
    await flush()
    observer.disconnect()

    expect(alertFrames).toEqual([])
    expect(bannerFrames).toEqual([])
    expect(periodButton(7)?.getAttribute('aria-pressed')).toBe('true')
  })

  it('falls back to the last successful period when a cached period turns stale and its refetch fails', async () => {
    const failingDays = new Set<number>()
    mocks.getDropStatistics.mockImplementation((days: number) => (
      failingDays.has(days)
        ? Promise.resolve({ success: false, message: 'Internal Server Error' })
        : Promise.resolve(statisticsFixture(days))
    ))

    await render(true)
    await flush()
    await click(periodButton(14)!)
    await flush()
    await click(periodButton(30)!)
    await flush()
    expect(periodButton(30)?.getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      await client.invalidateQueries({ queryKey: statisticsKeys.query('drops', 14), refetchType: 'none' })
    })
    failingDays.add(14)

    const alertFrames: string[] = []
    const bannerFrames: string[] = []
    const observer = new MutationObserver(() => {
      const alert = container.querySelector('[role="alert"]')
      if (alert) alertFrames.push(alert.textContent ?? '')
      if (container.textContent?.includes('掉落记录刷新失败')) bannerFrames.push(container.textContent)
    })

    observer.observe(container, { childList: true, subtree: true, characterData: true })
    await click(periodButton(14)!)
    await flush()
    observer.disconnect()

    expect(alertFrames).toEqual([])
    expect(bannerFrames).toEqual([])
    expect(periodButton(30)?.getAttribute('aria-pressed')).toBe('true')
    expect(periodButton(14)?.getAttribute('aria-pressed')).not.toBe('true')
    expect(container.textContent).toContain('(共 30 天)')
    expect(mocks.notify).toHaveBeenCalledTimes(1)
    expect(mocks.notify).toHaveBeenCalledWith('统计周期读取失败，已回退到最近成功的周期', 'warning')
    expect(mocks.getDropStatistics).toHaveBeenCalledTimes(4)
  })

  it('refetches a cached period again after selecting it once its earlier read failed', async () => {
    const attempts = new Map<number, number>()
    mocks.getDropStatistics.mockImplementation((days: number) => {
      const attempt = (attempts.get(days) ?? 0) + 1
      attempts.set(days, attempt)
      return days === 14 && attempt === 2
        ? Promise.resolve({ success: false, message: 'Internal Server Error' })
        : Promise.resolve(statisticsFixture(days))
    })

    await render(true)
    await flush()
    await click(periodButton(14)!)
    await flush()
    expect(container.textContent).toContain('(共 14 天)')

    await click(refreshButton()!)
    await flush()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('掉落记录刷新失败')

    await click(periodButton(30)!)
    await flush()
    expect(periodButton(30)?.getAttribute('aria-pressed')).toBe('true')

    const alertFrames: string[] = []
    const observer = new MutationObserver(() => {
      const alert = container.querySelector('[role="alert"]')
      if (alert) alertFrames.push(alert.textContent ?? '')
    })
    observer.observe(container, { childList: true, subtree: true, characterData: true })

    await click(periodButton(14)!)
    await flush()
    observer.disconnect()

    expect(alertFrames).toEqual([])
    expect(mocks.getDropStatistics.mock.calls.map(call => call[0])).toEqual([7, 14, 14, 30, 14])
    expect(periodButton(14)?.getAttribute('aria-pressed')).toBe('true')
    expect(periodButton(30)?.getAttribute('aria-pressed')).not.toBe('true')
    expect(container.textContent).toContain('(共 14 天)')
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('falls back after an offline period switch fails on reconnect', async () => {
    mocks.getDropStatistics
      .mockImplementationOnce(() => Promise.resolve(statisticsFixture(7)))
      .mockImplementationOnce(() => Promise.resolve({ success: false, message: 'Internal Server Error' }))
      .mockImplementation((days: number) => Promise.resolve(statisticsFixture(days)))

    await render(true)
    await flush()
    expect(periodButton(7)?.getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      onlineManager.setOnline(false)
    })
    await click(periodButton(30)!)
    expect(mocks.getDropStatistics).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('等待网络恢复')

    await act(async () => {
      onlineManager.setOnline(true)
    })
    await flush()

    expect(mocks.getDropStatistics).toHaveBeenCalledTimes(2)
    expect(periodButton(7)?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('(共 7 天)')
    expect(mocks.notify).toHaveBeenCalledWith('统计周期读取失败，已回退到最近成功的周期', 'warning')
  })

  it('reports a paused status when an expired cached period is selected offline', async () => {
    mocks.getDropStatistics
      .mockImplementationOnce(() => Promise.resolve(statisticsFixture(7)))
      .mockImplementationOnce(() => Promise.resolve(statisticsFixture(14)))
      .mockImplementation((days: number) => Promise.resolve(statisticsFixture(days)))

    await render(true)
    await flush()
    await click(periodButton(14)!)
    await flush()
    await click(periodButton(30)!)
    await flush()

    await act(async () => {
      await client.invalidateQueries({ queryKey: statisticsKeys.query('drops', 14), refetchType: 'none' })
      onlineManager.setOnline(false)
    })
    await click(periodButton(14)!)

    expect(mocks.getDropStatistics).toHaveBeenCalledTimes(3)
    expect(container.textContent).toContain('等待网络恢复')
    expect(container.textContent).not.toContain('正在读取新周期')
  })

  it('keeps the error card for a failed first read without falling back or notifying', async () => {
    mocks.getDropStatistics.mockResolvedValue({ success: false, message: 'Internal Server Error' })

    await render(true)
    await flush()

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('掉落记录读取失败')
    expect(container.textContent).not.toContain('总理智消耗')
    expect(mocks.notify).not.toHaveBeenCalled()
    expect(mocks.getDropStatistics).toHaveBeenCalledTimes(1)
  })

  it('does not fall back again once the fallback period is the current period', async () => {
    mocks.getDropStatistics
      .mockImplementationOnce(() => Promise.resolve(statisticsFixture(7)))
      .mockImplementationOnce(() => Promise.resolve({ success: false, message: 'Internal Server Error' }))
      .mockImplementation((days: number) => Promise.resolve(statisticsFixture(days)))

    await render(true)
    await flush()

    await click(periodButton(14)!)
    await flush()
    expect(mocks.notify).toHaveBeenCalledTimes(1)

    await flush()
    await flush()

    expect(mocks.notify).toHaveBeenCalledTimes(1)
    expect(mocks.getDropStatistics).toHaveBeenCalledTimes(2)
    expect(periodButton(7)?.getAttribute('aria-pressed')).toBe('true')
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
