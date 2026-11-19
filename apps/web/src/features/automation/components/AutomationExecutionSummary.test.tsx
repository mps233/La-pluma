// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AutomationExecutionSummary from './AutomationExecutionSummary'
import type { AutomationExecutionSummary as AutomationExecutionSummaryData } from '../model/automationRun'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('framer-motion', async () => {
  const React = await import('react')
  type MotionTestProps = Record<string, unknown> & { children?: ReactNode }
  const motionComponent = (tag: 'div') => React.forwardRef<HTMLElement, MotionTestProps>(
    ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }, ref) =>
      React.createElement(tag, { ...props, ref }, children as ReactNode),
  )

  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: { div: motionComponent('div') },
    useReducedMotion: () => true,
  }
})

const summary = (
  overrides: Partial<AutomationExecutionSummaryData> = {},
): AutomationExecutionSummaryData => ({
  successCount: 3,
  failedCount: 0,
  skippedCount: 0,
  durationMs: 65_000,
  summaries: [],
  reports: [],
  actions: [],
  errors: [],
  warnings: [],
  ...overrides,
})

const failedSummary = () => summary({
  successCount: 2,
  failedCount: 1,
  errors: [{ task: '理智作战', error: '关卡不可用' }],
})

let container: HTMLDivElement
let root: Root

const render = async (node: ReactNode) => {
  await act(async () => root.render(node))
}

const detailsButton = () => container.querySelector<HTMLButtonElement>('[aria-label="展开执行详情"], [aria-label="收起执行详情"]')

describe('AutomationExecutionSummary', () => {
  it('shows missing game callbacks as an unconfirmed game result', async () => {
    await render(<AutomationExecutionSummary summary={summary({
      successCount: 1,
      actions: [{ action: 'operprogress', task: '游戏内培养', status: 'success', observed: false, message: '培养进程已结束，游戏结果未确认' }],
    })} runId="run-game" />)
    expect(container.textContent).toContain('培养进程已结束，游戏结果未确认')
    expect(container.querySelector('[aria-label="游戏结果未确认"]')).toBeNull()
    await act(async () => detailsButton()?.click())
    expect(container.textContent).not.toContain('培养目标已完成')
  })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('renders nothing until the first summary arrives', async () => {
    await render(<AutomationExecutionSummary summary={null} runId={null} />)

    expect(container.querySelector('[aria-label="最近执行结果"]')).toBeNull()
  })

  it('keeps the last summary while a new submission clears the projection', async () => {
    await render(<AutomationExecutionSummary summary={summary()} runId="run-1" />)
    expect(container.textContent).toContain('最近执行')
    expect(container.textContent).toContain('用时 65 秒')
    expect(container.textContent).not.toContain('成功 3')

    await render(<AutomationExecutionSummary summary={null} runId="run-1" />)

    expect(container.textContent).toContain('最近执行')
    expect(container.textContent).toContain('用时 65 秒')
  })

  it('opens failures, preserves a manual collapse, and reopens for a new run', async () => {
    await render(<AutomationExecutionSummary summary={failedSummary()} runId="run-1" />)

    expect(detailsButton()?.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('理智作战：关卡不可用')

    await act(async () => detailsButton()?.click())
    expect(detailsButton()?.getAttribute('aria-expanded')).toBe('false')

    await render(<AutomationExecutionSummary summary={failedSummary()} runId="run-1" />)
    expect(detailsButton()?.getAttribute('aria-expanded')).toBe('false')

    await render(<AutomationExecutionSummary summary={failedSummary()} runId="run-2" />)
    expect(detailsButton()?.getAttribute('aria-expanded')).toBe('true')
  })

  it('renders stage reports and warnings in the expanded details', async () => {
    await render(
      <AutomationExecutionSummary
        summary={summary({
          summaries: [{ task: '理智作战', stage: '1-7', times: '3', drops: '源岩 2' }],
          reports: [{ provider: 'penguin', stage: '1-7', status: 'success', message: '已上传' }],
          warnings: ['当前活动已结束'],
        })}
        runId="run-1"
      />,
    )
    await act(async () => detailsButton()?.click())

    expect(container.textContent).toContain('1-7')
    expect(container.textContent).toContain('3 次')
    expect(container.textContent).toContain('源岩 2')
    expect(container.textContent).toContain('已上传')
    expect(container.textContent).toContain('当前活动已结束')
  })

  it('renders per-operator operprogress details in the expanded actions', async () => {
    await render(<AutomationExecutionSummary summary={summary({
      successCount: 1,
      failedCount: 1,
      actions: [{
        task: '游戏内培养',
        action: 'operprogress',
        status: 'failed',
        observed: true,
        message: '游戏内培养执行失败：成功 1，失败 1，跳过 0',
        details: [
          { name: '阿米娅', role: 'Caster', result: 'Success', resultDetail: 'Completed' },
          { name: '陈', role: 'Warrior', result: 'Failed', resultDetail: 'ResourceInsufficient' },
        ],
      }],
    })} runId="run-operprogress" />)

    expect(detailsButton()?.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('阿米娅（术师）：培养成功 · 已完成')
    expect(container.textContent).toContain('陈（近卫）：培养失败 · 材料不足')
  })

  it('renders deferred mastery targets as a pending group', async () => {
    await render(<AutomationExecutionSummary summary={summary({
      successCount: 2,
      actions: [{
        task: '游戏内培养',
        action: 'operprogress',
        status: 'success',
        observed: true,
        message: '游戏内培养流程结束：成功 2，失败 0，跳过 0',
        deferredMastery: [{ name: '白面鸮', role: 'Medic', skillMastery: [0, 0, 2] }],
        deferredCount: 1,
      }],
    })} runId="run-deferred" />)

    expect(detailsButton()?.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).toContain('1 项专精待处理')
    expect(container.textContent).not.toContain('培养失败')
    await act(async () => detailsButton()?.click())
    expect(container.textContent).toContain('待处理')
    expect(container.textContent).toContain('白面鸮（医疗）：专精目标待处理，训练室占用，需后续运行 · 专精 S3 Lv2')
    expect(container.textContent).not.toContain('执行失败')
  })

  it('filters routine completion actions while keeping failures, skips, and unconfirmed results', async () => {
    await render(<AutomationExecutionSummary summary={summary({
      successCount: 3,
      failedCount: 1,
      actions: [
        { task: '启动游戏', action: 'startup', status: 'success', message: '游戏已启动' },
        { task: '关闭游戏', action: 'closedown', status: 'success', message: '游戏客户端已关闭' },
        { task: '理智作战', action: 'fight', status: 'success', message: '理智作战已完成' },
        { task: '自动公招', action: 'recruit', status: 'success', message: '自动公招流程已完成' },
        { task: '基建换班', action: 'infrast', status: 'success', message: '基建流程已完成，按配置处理 2 类设施' },
        { task: '信用收支', action: 'mall', status: 'success', message: '信用收支流程已完成' },
        { task: '理智作战', action: 'fight', status: 'failed', message: '关卡 1-7 未解锁' },
        { task: '自动公招', action: 'recruit', status: 'skipped', message: '招聘许可不足，未开始新的公招' },
        { task: '游戏内培养', action: 'operprogress', status: 'success', observed: false, message: '培养进程已结束，游戏结果未确认' },
      ],
    })} runId="run-filtered" />)

    expect(detailsButton()?.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('关卡 1-7 未解锁')
    expect(container.textContent).toContain('招聘许可不足，未开始新的公招')
    expect(container.textContent).toContain('培养进程已结束，游戏结果未确认')
    expect(container.textContent).not.toContain('游戏已启动')
    expect(container.textContent).not.toContain('游戏客户端已关闭')
    expect(container.textContent).not.toContain('理智作战已完成')
    expect(container.textContent).not.toContain('自动公招流程已完成')
    expect(container.textContent).not.toContain('基建流程已完成')
    expect(container.textContent).not.toContain('信用收支流程已完成')
  })

  it('keeps successful actions that carry concrete details', async () => {
    await render(<AutomationExecutionSummary summary={summary({
      successCount: 9,
      actions: [
        { task: '关闭前识别', action: 'depot', status: 'success', message: '关闭前仓库识别完成，共 120 项' },
        { task: '关闭前识别', action: 'operbox', status: 'success', message: '关闭前干员识别完成，共 80 名干员' },
        { task: '领取奖励', action: 'award', status: 'success', message: '每日任务已领取' },
        { task: '理智作战', action: 'fight', status: 'success', stage: '1-7', times: 3, dropCount: 2, drops: '固源岩 2', message: '作战完成：1-7 × 3' },
        { task: '自动公招', action: 'recruit', status: 'success', startedCount: 2, collectedCount: 1, message: '公招处理完成' },
        { task: '基建换班', action: 'infrast', status: 'success', rewardCollected: true, message: '基建流程完成：收取产物' },
        { task: '信用收支', action: 'mall', status: 'success', visitedCount: 3, message: '信用收支完成：访问 3 位好友' },
        {
          task: '游戏内培养',
          action: 'operprogress',
          status: 'success',
          observed: true,
          message: '游戏内培养流程结束',
          details: [{ name: '阿米娅', role: 'Caster', result: 'Success', resultDetail: 'Completed' }],
        },
        { task: '更换游戏主题', action: 'switchtheme', status: 'success', message: '主题已设置为 新主题' },
      ],
    })} runId="run-detailed" />)

    await act(async () => detailsButton()?.click())

    expect(container.textContent).toContain('关闭前仓库识别完成，共 120 项')
    expect(container.textContent).toContain('关闭前干员识别完成，共 80 名干员')
    expect(container.textContent).toContain('每日任务已领取')
    expect(container.textContent).toContain('作战完成：1-7 × 3')
    expect(container.textContent).toContain('公招处理完成')
    expect(container.textContent).toContain('基建流程完成：收取产物')
    expect(container.textContent).toContain('信用收支完成：访问 3 位好友')
    expect(container.textContent).toContain('阿米娅（术师）：培养成功 · 已完成')
    expect(container.textContent).toContain('主题已设置为 新主题')
  })

  it('hides the expansion affordance when all actions are routine and no detail payload remains', async () => {
    await render(<AutomationExecutionSummary summary={summary({
      successCount: 6,
      actions: [
        { task: '启动游戏', action: 'startup', status: 'success', message: '游戏已启动' },
        { task: '关闭游戏', action: 'closedown', status: 'success', message: '游戏客户端已关闭' },
        { task: '理智作战', action: 'fight', status: 'success', message: '理智作战已完成' },
        { task: '自动公招', action: 'recruit', status: 'success', message: '自动公招流程已完成' },
        { task: '基建换班', action: 'infrast', status: 'success', message: '基建流程已完成' },
        { task: '信用收支', action: 'mall', status: 'success', message: '信用收支流程已完成' },
      ],
    })} runId="run-routine-only" />)

    expect(detailsButton()).toBeNull()
  })

  it('keeps expansion available when warnings outlive the filtered actions', async () => {
    await render(<AutomationExecutionSummary summary={summary({
      successCount: 2,
      actions: [
        { task: '启动游戏', action: 'startup', status: 'success', message: '游戏已启动' },
        { task: '理智作战', action: 'fight', status: 'success', message: '理智作战已完成' },
      ],
      warnings: ['当前活动已结束'],
    })} runId="run-warning" />)

    expect(detailsButton()).not.toBeNull()
    await act(async () => detailsButton()?.click())
    expect(container.textContent).toContain('当前活动已结束')
    expect(container.textContent).not.toContain('游戏已启动')
  })
})
