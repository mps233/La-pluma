// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DropRecords from './DropRecords'

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

afterEach(cleanup)

const populatedStatistics = {
  total: { sanity: 42, battles: 3, medicine: 0, stone: 0 },
  items: { '固源岩': { count: 6, iconId: 'rock' } },
  stages: { '1-7': { battles: 3, sanity: 42, items: { '固源岩': 6 } } },
  dateRange: { start: '2026-07-14', end: '2026-07-20', days: 7 },
}

describe('DropRecords layout surfaces', () => {
  it('uses smooth corners for the summary and the two record panels', () => {
    const { container } = render(
      <DropRecords
        dropStatistics={populatedStatistics}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )

    const panels = Array.from(container.querySelectorAll('.drop-records-panel'))
    expect(panels).toHaveLength(2)
    panels.forEach((panel) => {
      expect(panel.getAttribute('data-smooth-corners')).toBe('true')
      expect(panel.querySelector(':scope > .app-card-smooth-surface')).not.toBeNull()
    })
    expect(container.querySelectorAll('[data-smooth-corners="true"]')).toHaveLength(3)

    const summary = container.querySelector('.data-readout')
    expect(summary?.classList.contains('surface-soft')).toBe(false)
    expect(summary?.querySelectorAll('.data-readout-stat')).toHaveLength(3)
    expect(container.textContent).toContain('统计最近 7 天')
    expect(container.textContent).toContain('2026-07-14 至 2026-07-20')

    const chart = screen.getByRole('figure', { name: '材料掉落数量前 10 名' })
    expect(within(chart).getByText('材料掉落数量前 10 名').tagName).toBe('FIGCAPTION')
  })

  it('keeps the empty state on the same continuous outer surface', () => {
    const { container } = render(
      <DropRecords
        dropStatistics={null}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )

    const panel = container.querySelector('.drop-records-panel')
    expect(panel?.getAttribute('data-smooth-corners')).toBe('true')
    expect(panel?.textContent).toContain('暂无掉落记录')
    expect(screen.queryByRole('figure')).toBeNull()
  })

  it('shows loading instead of an empty state during the initial read', () => {
    const { container } = render(
      <DropRecords
        dropStatistics={null}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
        isLoading
      />,
    )

    expect(container.querySelector('[role="status"]')?.textContent).toContain('正在读取掉落记录')
    expect(container.textContent).not.toContain('暂无掉落记录')
  })

  it('shows a recoverable error in place and invokes retry', async () => {
    const onRefresh = vi.fn()
    const { container } = render(
      <DropRecords
        dropStatistics={null}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={onRefresh}
        error="暂时无法读取掉落记录，请检查服务连接后重试。"
      />,
    )

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('掉落记录读取失败')
    expect(container.textContent).not.toContain('暂无掉落记录')

    const retry = screen.getByRole('button', { name: '重新加载' })
    await userEvent.setup().click(retry)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('keeps the last successful statistics visible when a refresh fails', () => {
    const { container } = render(
      <DropRecords
        dropStatistics={populatedStatistics}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
        error="刷新失败，请稍后重试。"
      />,
    )

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('掉落记录刷新失败')
    expect(container.textContent).toContain('总理智消耗')
    expect(container.textContent).toContain('固源岩')
  })
})
