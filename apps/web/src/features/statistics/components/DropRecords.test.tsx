// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateItemIconCache } from '@/features/game-data'
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

vi.mock('@/features/game-data/api', () => ({
  getAllOperators: vi.fn(),
  getDepotData: vi.fn(),
  getOperBoxData: vi.fn(),
  getItemIconUrl: (iconId: string) => `/items/${iconId}.png`,
}))

let container: HTMLDivElement
let root: Root

const click = async (element: HTMLElement) => {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

describe('DropRecords read states', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
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

  it('shows the empty state and its reload entry when no statistics exist', async () => {
    const onRefresh = vi.fn()
    await act(async () => root.render(
      <DropRecords
        dropStatistics={null}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={onRefresh}
      />,
    ))

    expect(container.textContent).toContain('暂无掉落记录')
    expect(container.textContent).toContain('执行作战任务后会自动记录掉落数据')

    const reload = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('重新加载'))
    expect(reload).toBeDefined()
    await click(reload!)
    expect(onRefresh).toHaveBeenCalledTimes(1)
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

  it('disables the retry entry while the failed read is refreshing', async () => {
    await act(async () => root.render(
      <DropRecords
        dropStatistics={null}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
        isLoading
        error="暂时无法读取掉落记录，请检查服务连接后重试。"
      />,
    ))

    const retry = container.querySelector<HTMLButtonElement>('[role="alert"] button')
    expect(retry?.disabled).toBe(true)
    expect(retry?.getAttribute('aria-busy')).toBe('true')
    expect(retry?.textContent).toContain('正在重试')
  })

  it('heads the drop records section with an h2 above both h3 subsections', async () => {
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

    const h2 = container.querySelector('h2')
    expect(h2?.textContent).toBe('掉落记录')
    const h3s = Array.from(container.querySelectorAll('h3')).map(heading => heading.textContent)
    expect(h3s[0]).toBe('材料掉落统计')
    expect(h3s[1]).toBe('关卡统计')
    expect(h2?.compareDocumentPosition(container.querySelectorAll('h3')[0]!))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('formats every metric total with thousands separators', async () => {
    await act(async () => root.render(
      <DropRecords
        dropStatistics={{
          total: { sanity: 12345, battles: 6789, medicine: 2345, stone: 5678 },
          items: { '固源岩': { count: 6, iconId: 'rock' } },
          stages: { '1-7': { battles: 3, sanity: 42, items: { '固源岩': 6 } } },
          dateRange: { start: '2026-07-14', end: '2026-07-20', days: 7 },
        }}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
      />,
    ))

    expect(container.textContent).toContain('12,345')
    expect(container.textContent).toContain('6,789')
    expect(container.textContent).toContain('2,345')
    expect(container.textContent).toContain('5,678')
  })

  it('shows both card empty states for a payload without items or stages', async () => {
    await act(async () => root.render(
      <DropRecords
        dropStatistics={{
          total: { sanity: 0, battles: 0, medicine: 0, stone: 0 },
          items: {},
          stages: {},
          dateRange: { start: '', end: '', days: 7 },
        }}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
      />,
    ))

    const h3s = Array.from(container.querySelectorAll('h3')).map(heading => heading.textContent)
    expect(h3s[0]).toBe('材料掉落统计')
    expect(h3s[1]).toBe('关卡统计')
    expect(container.textContent).toContain('本周期没有材料掉落')
    expect(container.textContent).toContain('本周期没有关卡记录')
  })

  it('prefers the payload item id when building item icon urls', async () => {
    await act(async () => root.render(
      <DropRecords
        dropStatistics={{
          total: { sanity: 42, battles: 3, medicine: 0, stone: 0 },
          items: { '固源岩': { count: 6, id: '30011', iconId: 'MTL_SL_G1' } },
          stages: { '1-7': { battles: 3, sanity: 42, items: { '固源岩': 6 } } },
          dateRange: { start: '2026-07-14', end: '2026-07-20', days: 7 },
        }}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
      />,
    ))

    const image = container.querySelector<HTMLImageElement>('img[alt="固源岩"]')
    expect(image?.getAttribute('src')).toBe('/items/30011.png')
  })

  it('falls back to the payload icon id for older statistics payloads', async () => {
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

    const image = container.querySelector<HTMLImageElement>('img[alt="固源岩"]')
    expect(image?.getAttribute('src')).toBe('/items/rock.png')
  })

  it('hides the item icon safely when the payload has no icon key', async () => {
    await act(async () => root.render(
      <DropRecords
        dropStatistics={{
          total: { sanity: 42, battles: 3, medicine: 0, stone: 0 },
          items: { '固源岩': { count: 6 } },
          stages: { '1-7': { battles: 3, sanity: 42, items: { '固源岩': 6 } } },
          dateRange: { start: '2026-07-14', end: '2026-07-20', days: 7 },
        }}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
      />,
    ))

    expect(container.querySelector('img[alt="固源岩"]')).toBeNull()
    expect(container.querySelector('[role="img"][aria-label="固源岩图标不可用"]')).toBeNull()
  })

  it('renders the icon placeholder when an item image fails', async () => {
    await act(async () => root.render(
      <DropRecords
        dropStatistics={{
          total: { sanity: 42, battles: 3, medicine: 0, stone: 0 },
          items: { '固源岩': { count: 6, id: '30011' } },
          stages: { '1-7': { battles: 3, sanity: 42, items: { '固源岩': 6 } } },
          dateRange: { start: '2026-07-14', end: '2026-07-20', days: 7 },
        }}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
      />,
    ))

    const image = container.querySelector<HTMLImageElement>('img[alt="固源岩"]')
    await act(async () => image?.dispatchEvent(new Event('error', { bubbles: true })))

    expect(container.querySelector('img[alt="固源岩"]')).toBeNull()
    expect(container.querySelector('[role="img"][aria-label="固源岩图标不可用"]')).not.toBeNull()
  })

  it('retries a failed item image after the icon cache version advances', async () => {
    await act(async () => root.render(
      <DropRecords
        dropStatistics={{
          total: { sanity: 42, battles: 3, medicine: 0, stone: 0 },
          items: { '固源岩': { count: 6, id: '30011' } },
          stages: { '1-7': { battles: 3, sanity: 42, items: { '固源岩': 6 } } },
          dateRange: { start: '2026-07-14', end: '2026-07-20', days: 7 },
        }}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
      />,
    ))

    const image = container.querySelector<HTMLImageElement>('img[alt="固源岩"]')
    await act(async () => image?.dispatchEvent(new Event('error', { bubbles: true })))
    expect(container.querySelector('img[alt="固源岩"]')).toBeNull()

    await act(async () => {
      invalidateItemIconCache()
    })

    expect(container.querySelector('img[alt="固源岩"]')).not.toBeNull()
    expect(container.querySelector('[role="img"][aria-label="固源岩图标不可用"]')).toBeNull()
  })

  it('tracks a repeated image failure after the icon cache version advances', async () => {
    await act(async () => root.render(
      <DropRecords
        dropStatistics={{
          total: { sanity: 42, battles: 3, medicine: 0, stone: 0 },
          items: { '固源岩': { count: 6, id: '30011' } },
          stages: { '1-7': { battles: 3, sanity: 42, items: { '固源岩': 6 } } },
          dateRange: { start: '2026-07-14', end: '2026-07-20', days: 7 },
        }}
        dropDays={7}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
      />,
    ))

    await act(async () => container.querySelector('img[alt="固源岩"]')
      ?.dispatchEvent(new Event('error', { bubbles: true })))
    expect(container.querySelector('img[alt="固源岩"]')).toBeNull()

    await act(async () => {
      invalidateItemIconCache()
    })
    expect(container.querySelector('img[alt="固源岩"]')).not.toBeNull()

    await act(async () => container.querySelector('img[alt="固源岩"]')
      ?.dispatchEvent(new Event('error', { bubbles: true })))

    expect(container.querySelector('img[alt="固源岩"]')).toBeNull()
    expect(container.querySelector('[role="img"][aria-label="固源岩图标不可用"]')).not.toBeNull()
  })

  it('renders stage drop chips as static text without an interactive affordance', async () => {
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

    const chip = Array.from(container.querySelectorAll('span'))
      .find(element => element.textContent === '固源岩 ×6')
    expect(chip).toBeDefined()
    expect(chip?.closest('button, a, [role="button"]')).toBeNull()
    expect(chip?.getAttribute('role')).toBeNull()
    expect(chip?.hasAttribute('tabindex')).toBe(false)
  })

  it('reports a paused new-period read instead of a spinning status', async () => {
    await act(async () => root.render(
      <DropRecords
        dropStatistics={{
          total: { sanity: 42, battles: 3, medicine: 0, stone: 0 },
          items: { '固源岩': { count: 6, iconId: 'rock' } },
          stages: { '1-7': { battles: 3, sanity: 42, items: { '固源岩': 6 } } },
          dateRange: { start: '2026-07-14', end: '2026-07-20', days: 7 },
        }}
        dropDays={14}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
        isPlaceholderData
        fetchStatus="paused"
      />,
    ))

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('等待网络恢复')
    expect(status?.textContent).not.toContain('正在读取新周期')
  })

  it('reports a paused refresh on an already displayed period', async () => {
    await act(async () => root.render(
      <DropRecords
        dropStatistics={{
          total: { sanity: 42, battles: 3, medicine: 0, stone: 0 },
          items: { '固源岩': { count: 6, iconId: 'rock' } },
          stages: { '1-7': { battles: 3, sanity: 42, items: { '固源岩': 6 } } },
          dateRange: { start: '2026-07-14', end: '2026-07-20', days: 14 },
        }}
        dropDays={14}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
        fetchStatus="paused"
      />,
    ))

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toContain('等待网络恢复')
    expect(container.textContent).not.toContain('正在读取新周期')
  })

  it('marks the period switch status icon decorative and keeps the refresh button idle', async () => {
    await act(async () => root.render(
      <DropRecords
        dropStatistics={{
          total: { sanity: 42, battles: 3, medicine: 0, stone: 0 },
          items: { '固源岩': { count: 6, iconId: 'rock' } },
          stages: { '1-7': { battles: 3, sanity: 42, items: { '固源岩': 6 } } },
          dateRange: { start: '2026-07-14', end: '2026-07-20', days: 7 },
        }}
        dropDays={14}
        setDropDays={vi.fn()}
        onRefresh={vi.fn()}
        isLoading
        isPlaceholderData
        fetchStatus="fetching"
      />,
    ))

    const statusIcon = container.querySelector('[role="status"] svg')
    expect(statusIcon).not.toBeNull()
    expect(statusIcon?.getAttribute('aria-hidden')).toBe('true')
    expect(container.textContent).toContain('正在读取新周期')
    expect(container.textContent).not.toContain('正在刷新')
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
