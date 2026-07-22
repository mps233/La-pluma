// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DropRecords from './DropRecords'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const MotionDiv = React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, transition: _transition, ...props }, ref) =>
      React.createElement('div', { ...props, ref }, children as ReactNode),
  )

  return { motion: { div: MotionDiv } }
})

vi.mock('../services/api', () => ({
  getItemIconUrl: (iconId: string) => `/items/${iconId}.png`,
}))

let container: HTMLDivElement
let root: Root

const click = async (element: HTMLElement) => {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

describe('DropRecords layout surfaces', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('uses smooth corners only for the two outer record panels', async () => {
    await act(async () => root.render(
      <DropRecords
        dropStatistics={{
          total: { sanity: 42, battles: 3, medicine: 0, stone: 0 },
          items: { '固源岩': { count: 6, iconId: 'rock' } },
          stages: { '1-7': { battles: 3, sanity: 42, items: { '固源岩': 6 } } },
          dateRange: { start: '2026-07-14', end: '2026-07-20', days: 7 },
        }}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
      />,
    ))

    const panels = Array.from(container.querySelectorAll('.drop-records-panel'))
    expect(panels).toHaveLength(2)
    panels.forEach((panel) => {
      expect(panel.getAttribute('data-smooth-corners')).toBe('true')
      expect(panel.querySelector(':scope > .app-card-smooth-surface')).not.toBeNull()
    })
    expect(container.querySelectorAll('[data-smooth-corners="true"]')).toHaveLength(2)
  })

  it('keeps the empty state on the same continuous outer surface', async () => {
    await act(async () => root.render(
      <DropRecords
        dropStatistics={null}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
      />,
    ))

    const panel = container.querySelector('.drop-records-panel')
    expect(panel?.getAttribute('data-smooth-corners')).toBe('true')
    expect(panel?.textContent).toContain('暂无掉落记录')
  })

  it('shows loading instead of an empty state during the initial read', async () => {
    await act(async () => root.render(
      <DropRecords
        dropStatistics={null}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
        isLoading
      />,
    ))

    expect(container.querySelector('[role="status"]')?.textContent).toContain('正在读取掉落记录')
    expect(container.textContent).not.toContain('暂无掉落记录')
  })

  it('shows a recoverable error in place and invokes retry', async () => {
    const onRefresh = vi.fn()
    await act(async () => root.render(
      <DropRecords
        dropStatistics={null}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={onRefresh}
        error="暂时无法读取掉落记录，请检查服务连接后重试。"
      />,
    ))

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('掉落记录读取失败')
    expect(container.textContent).not.toContain('暂无掉落记录')

    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('重新加载'))
    expect(retry).toBeDefined()
    await click(retry!)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('keeps the last successful statistics visible when a refresh fails', async () => {
    await act(async () => root.render(
      <DropRecords
        dropStatistics={{
          total: { sanity: 42, battles: 3, medicine: 0, stone: 0 },
          items: { '固源岩': { count: 6, iconId: 'rock' } },
          stages: { '1-7': { battles: 3, sanity: 42, items: { '固源岩': 6 } } },
          dateRange: { start: '2026-07-14', end: '2026-07-20', days: 7 },
        }}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
        error="刷新失败，请稍后重试。"
      />,
    ))

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('掉落记录刷新失败')
    expect(container.textContent).toContain('总理智消耗')
    expect(container.textContent).toContain('固源岩')
  })
})
