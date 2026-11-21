// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRun } from '@/features/task-execution'
import type {
  RoguelikeBlackFlowProgress,
  RoguelikeCommand,
  RoguelikeProgressSnapshot,
} from '../model/runProgress'
import type { RoguelikeRunSummary } from '../model/runSummary'
import RoguelikeProgressPanel from './RoguelikeProgressPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function snapshot(overrides: Partial<RoguelikeProgressSnapshot> = {}): RoguelikeProgressSnapshot {
  return {
    command: 'roguelike',
    theme: 'Phantom',
    mode: 0,
    phase: 'exploring',
    currentRound: 3,
    roundStartedAt: '2026-11-21T12:00:10.000Z',
    targetRounds: 3,
    roundsStarted: 3,
    roundsEnded: 2,
    roundsSettled: 2,
    roundsPassed: 1,
    settlementSupported: true,
    currentAction: 'StageInfo',
    lastEventKind: 'combat',
    lastEventName: '紧急作战',
    lastEventAt: '2026-11-21T12:00:05.000Z',
    combatCount: 4,
    investment: null,
    recentRounds: [
      {
        index: 2,
        outcome: 'passed',
        settled: true,
        floor: 5,
        score: 1200,
        endedAt: '2026-11-21T12:00:04.000Z',
      },
      {
        index: 1,
        outcome: 'not_passed',
        settled: true,
        floor: 3,
        score: 400,
        endedAt: '2026-11-21T11:50:00.000Z',
      },
    ],
    blackflow: null,
    updatedAt: '2026-11-21T12:00:15.000Z',
    degraded: false,
    observed: true,
    ...overrides,
  }
}

function blackflow(
  overrides: Partial<RoguelikeBlackFlowProgress> = {},
): RoguelikeBlackFlowProgress {
  return {
    floor: 3,
    floorAt: '2026-11-21T12:00:12.000Z',
    currentNode: { id: '281475010265088', name: '不期而遇', type: 'incident' },
    currentNodeAt: '2026-11-21T12:00:12.000Z',
    actionPoints: { before: 7, after: 6, at: '2026-11-21T12:00:12.000Z' },
    lastRoute: {
      at: '2026-11-21T12:00:12.000Z',
      floor: 3,
      target: { id: '281475010265089', name: '安全的角落', type: 'rest' },
      landing: null,
      movement: 'walk',
      actionPointsBefore: 7,
      actionPointsAfter: 6,
      exactCost: 1,
      predictedCost: 1,
      arrived: true,
    },
    lastNodeResolution: null,
    milestones: [
      {
        id: 'milestone-a',
        floor: 3,
        progress: 0,
        status: 'satisfied',
        at: '2026-11-21T12:00:12.000Z',
      },
      {
        id: 'milestone-b',
        floor: 1,
        progress: 2,
        status: 'available',
        at: '2026-11-21T12:00:12.000Z',
      },
    ],
    strategy: {
      at: '2026-11-21T12:00:12.000Z',
      profile: 'burn',
      outcome: null,
      terminationReason: null,
      nextAction: null,
      succeeded: null,
    },
    updatedAt: '2026-11-21T12:00:12.000Z',
    ...overrides,
  }
}

function summary(
  command: RoguelikeCommand = 'roguelike',
  overrides: Partial<RoguelikeRunSummary> = {},
): RoguelikeRunSummary {
  return {
    command,
    theme: command === 'roguelike' ? 'Phantom' : 'Tales',
    status: 'success',
    observed: true,
    message: command === 'roguelike' ? '肉鸽结算：第 5 层 · 得分 1200' : '生息演算执行完成',
    settlement: {
      gamePass: true,
      floor: 5,
      step: 42,
      combat: 12,
      recruit: 8,
      collection: 21,
      boss: 2,
      emergency: 3,
      difficulty: 9,
      score: 1200,
      exp: 320,
      skill: '后勤分队',
    },
    investment: null,
    events: [],
    coppers: [],
    milestones: [],
    warnings: [],
    strategy: null,
    combats: 6,
    taskChain: { started: true, completed: true, failed: false, stopped: false },
    ...overrides,
  }
}

function activeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    runId: 'run-1',
    operationId: 'run_task',
    state: 'running',
    startedAt: '2026-11-21T12:00:00.000Z',
    progress: { roguelike: snapshot() },
    links: { self: '/api/agent/runs/run-1' },
    ...overrides,
  }
}

function terminalRun(
  command: RoguelikeCommand = 'roguelike',
  overrides: Partial<AgentRun> = {},
): AgentRun {
  return {
    runId: 'run-1',
    operationId: 'run_task',
    state: 'succeeded',
    durationMs: 65_000,
    result: {
      summary: {
        ...summary(command),
        progress: snapshot({ command, phase: 'ended', currentRound: null }),
      },
    },
    links: { self: '/api/agent/runs/run-1' },
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

const flush = async () => {
  await act(async () => {
    for (let index = 0; index < 4; index += 1) await Promise.resolve()
  })
}

const renderPanel = async (
  props: Partial<ComponentProps<typeof RoguelikeProgressPanel>> = {},
) => {
  await act(async () => root.render(
    <RoguelikeProgressPanel
      mode="roguelike"
      run={null}
      lastRun={null}
      hasSnapshot
      resolvingIdentity={false}
      {...props}
    />,
  ))
  await flush()
}

const panel = () => container.querySelector<HTMLElement>('[aria-label="执行进度"]')
const panelText = () => panel()?.textContent ?? ''
const badge = () => panel()?.querySelector<HTMLElement>('[data-slot="badge"]') ?? null
const statusText = () => panel()?.querySelector('[role="status"]')?.textContent ?? ''

describe('RoguelikeProgressPanel', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps loading distinct from an idle page and hides the badge', async () => {
    await renderPanel({ hasSnapshot: false })

    expect(panelText()).toContain('正在确认执行状态…')
    expect(panelText()).not.toContain('未开始')
    expect(panelText()).not.toContain('还没有开始探索')
    expect(badge()).toBeNull()
  })

  it('hides the last result while the tracked run identity is being resolved', async () => {
    await renderPanel({
      run: null,
      lastRun: terminalRun(),
      hasSnapshot: true,
      resolvingIdentity: true,
    })

    expect(panelText()).toContain('正在确认执行状态…')
    expect(panelText()).not.toContain('最近一次执行')
    expect(panelText()).not.toContain('还没有开始探索')
    expect(badge()).toBeNull()
  })

  it('renders the mode-specific empty state without an execution entry', async () => {
    await renderPanel()

    expect(panelText()).toContain('集成战略进度')
    expect(panelText()).toContain('还没有开始探索')
    expect(badge()?.textContent).toBe('未开始')
    expect(panel()?.querySelector('h3')).toBeNull()
    expect(panel()?.querySelector('button')).toBeNull()

    await renderPanel({ mode: 'reclamation' })

    expect(panelText()).toContain('生息演算进度')
    expect(panelText()).toContain('还没有开始演算')
    expect(panelText()).not.toContain('还没有开始探索')
  })

  it('shows the active roguelike progress with stats, target and current action', async () => {
    await renderPanel({ run: activeRun() })

    const text = panelText()
    expect(badge()?.textContent).toBe('运行中')
    expect(text).toContain('第 3 局 · 探索中')
    expect(text).toContain('已结束 2 局')
    expect(text).toContain('通关 1 局')
    expect(text).toContain('成功率 50%')
    expect(text).toContain('已结算 2 局')
    expect(text).not.toContain('已开始')
    expect(text).not.toContain('投资轮次')
    expect(text).toContain('目标 3 局 · 还剩 1 局')
    expect(text).toContain('作战：紧急作战')
    expect(text).toContain('第 2 局')
    expect(text).toContain('第 5 层')
    expect(text).toContain('1200 分')
    expect(panel()?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('67')
  })

  it.each([
    ['accepted', '启动中', '正在启动'],
    ['waiting', '启动中', '正在启动'],
    ['running', '运行中', '第 3 局 · 探索中'],
    ['stopping', '正在停止', '正在停止'],
  ] as const)('labels the %s task state as %s', async (state, label, line) => {
    await renderPanel({ run: activeRun({ state }) })

    expect(badge()?.textContent).toBe(label)
    expect(statusText()).toBe(line)
  })

  it.each(['accepted', 'waiting'] as const)(
    'shows the start status for %s reclamation without claiming it is running',
    async (state) => {
      await renderPanel({
        mode: 'reclamation',
        run: activeRun({
          state,
          progress: { roguelike: snapshot({ command: 'reclamation' }) },
        }),
      })

      expect(badge()?.textContent).toBe('启动中')
      expect(statusText()).toBe('正在启动')
      expect(panelText()).not.toContain('本次演算进行中')
    },
  )

  it('shows the stopping status for reclamation', async () => {
    await renderPanel({
      mode: 'reclamation',
      run: activeRun({
        state: 'stopping',
        progress: { roguelike: snapshot({ command: 'reclamation' }) },
      }),
    })

    expect(badge()?.textContent).toBe('正在停止')
    expect(statusText()).toBe('正在停止')
    expect(panelText()).not.toContain('本次演算进行中')
  })

  it('falls back to the waiting status when no round is open yet', async () => {
    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({ currentRound: null, roundsEnded: 2 }),
        },
      }),
    })

    expect(panelText()).toContain('已结束 2 局 · 等待下一局')
    expect(panelText()).not.toContain('第 3 局')
  })

  it('uses the start status for an active run without structured progress', async () => {
    await renderPanel({
      run: activeRun({ progress: { message: '集成战略执行中' } }),
    })

    const text = panelText()
    expect(text).toContain('正在启动')
    expect(text).toContain('集成战略执行中')
    expect(text).not.toContain('已结束')
    expect(text).not.toContain('成功率')
    expect(panel()?.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('shows only task status for active reclamation', async () => {
    await renderPanel({
      mode: 'reclamation',
      run: activeRun({ progress: { roguelike: snapshot({ command: 'reclamation' }) } }),
    })

    const text = panelText()
    expect(text).toContain('本次演算进行中')
    expect(statusText()).toBe('本次演算进行中')
    expect(text).not.toContain('已结束')
    expect(text).not.toContain('通关')
    expect(text).not.toContain('成功率')
    expect(text).not.toContain('已结算')
    expect(text).not.toContain('目标')
  })

  it('renders the terminal roguelike result with its last round and statistics', async () => {
    await renderPanel({ run: terminalRun() })

    const text = panelText()
    expect(badge()?.textContent).toBe('已完成')
    expect(text).toContain('本次探索已结束 · 共 2 局')
    expect(text).toContain('本局结果：通关 · 第 5 层 · 1200 分')
    expect(text).toContain('已结束 2 局')
    expect(text).toContain('目标 3 局 · 还剩 1 局')
  })

  it('marks a refreshed terminal run as the most recent execution', async () => {
    await renderPanel({ lastRun: terminalRun() })

    expect(panelText()).toContain('最近一次执行已结束 · 共 2 局')
    expect(panelText()).not.toContain('本次探索已结束')
  })

  it('keeps the tracked run name on the active panel', async () => {
    await renderPanel({ run: activeRun(), taskName: '集成战略' })

    expect(panelText()).toContain('任务：集成战略')
  })

  it('does not label a lastRun fallback with the tracked run name', async () => {
    await renderPanel({
      run: activeRun({ progress: { roguelike: snapshot({ command: 'reclamation' }) } }),
      lastRun: terminalRun(),
      taskName: '生息演算',
    })

    expect(panelText()).toContain('最近一次执行已结束')
    expect(panelText()).not.toContain('任务：生息演算')
    expect(panelText()).not.toContain('任务：')
  })

  it('ignores a lastRun from another mode or another operation', async () => {
    await renderPanel({ lastRun: terminalRun('reclamation') })
    expect(panelText()).toContain('还没有开始探索')
    expect(panelText()).not.toContain('已完成')

    await renderPanel({ lastRun: terminalRun('roguelike', { operationId: 'run_copilot_set' }) })
    expect(panelText()).toContain('还没有开始探索')
    expect(panelText()).not.toContain('已完成')
  })

  it('does not present an active run of another mode as this mode result', async () => {
    await renderPanel({
      run: activeRun({ progress: { roguelike: snapshot({ command: 'reclamation' }) } }),
    })

    expect(panelText()).toContain('还没有开始探索')
    expect(panelText()).not.toContain('本次演算进行中')
  })

  it('falls back to the summary message and three settlement fields for an old server', async () => {
    await renderPanel({
      run: terminalRun('roguelike', {
        result: { summary: summary('roguelike') },
      }),
    })

    const text = panelText()
    expect(text).toContain('已完成')
    expect(text).toContain('肉鸽结算：第 5 层 · 得分 1200')
    expect(text).toContain('通关 是')
    expect(text).toContain('层数 5')
    expect(text).toContain('得分 1200')
    expect(text).not.toContain('步数')
    expect(text).not.toContain('战斗次数')
    expect(text).not.toContain('投资轮次')
  })

  it('shows the terminal task state without inventing a structured result', async () => {
    await renderPanel({ run: terminalRun('roguelike', { result: undefined }) })

    expect(badge()?.textContent).toBe('已完成')
    expect(panelText()).toContain('本次探索已结束')
    expect(panelText()).not.toContain('还没有开始探索')
    expect(panelText()).toContain('本次执行没有可用的结构化结果')
  })

  it('shows the degraded progress note', async () => {
    await renderPanel({
      run: activeRun({ progress: { roguelike: snapshot({ degraded: true }) } }),
    })

    expect(panelText()).toContain('进度数据可能不完整')
  })

  it('reports settlement availability per the contract', async () => {
    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({ mode: 5, settlementSupported: false, roundsSettled: 0 }),
        },
      }),
    })

    expect(panelText()).toContain('该模式不提供结算数据')
    expect(panelText()).not.toContain('已结算')

    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({ mode: null, settlementSupported: null, roundsSettled: 0 }),
        },
      }),
    })

    expect(panelText()).not.toContain('该模式不提供结算数据')
    expect(panelText()).not.toContain('已结算')
  })

  it.each([0, 30001, 30003])('shows settlement stats for settlement mode %s', async (mode) => {
    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            mode,
            settlementSupported: true,
            roundsStarted: 3,
            roundsEnded: 2,
            roundsSettled: 1,
            roundsPassed: 1,
            investment: null,
            recentRounds: [],
          }),
        },
      }),
    })

    const text = panelText()
    expect(text).toContain('已结束 2 局')
    expect(text).toContain('通关 1 局')
    expect(text).toContain('成功率 50%')
    expect(text).toContain('已结算 1 局')
    expect(text).not.toContain('已开始')
    expect(text).not.toContain('投资轮次')
  })

  it('prefers a settlement mode over a contradictory unsupported flag', async () => {
    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            mode: 0,
            settlementSupported: false,
            roundsStarted: 3,
            roundsEnded: 2,
            roundsSettled: 1,
            roundsPassed: 1,
            recentRounds: [],
          }),
        },
      }),
    })

    const text = panelText()
    expect(text).not.toContain('该模式不提供结算数据')
    expect(text).toContain('已结束 2 局')
    expect(text).toContain('通关 1 局')
    expect(text).toContain('成功率 50%')
    expect(text).toContain('已结算 1 局')
  })

  it('shows started, ended and investment stats for the investment mode', async () => {
    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            mode: 1,
            settlementSupported: false,
            roundsStarted: 3,
            roundsEnded: 2,
            roundsSettled: 0,
            roundsPassed: 0,
            investment: { rounds: 1, count: 10, total: 300, deposit: 100 },
            recentRounds: [],
          }),
        },
      }),
    })

    const text = panelText()
    expect(text).toContain('已开始 3 局')
    expect(text).toContain('已结束 2 局')
    expect(text).toContain('投资轮次 1')
    expect(text).toContain('投资次数 10')
    expect(text).toContain('投资总额 300')
    expect(text).toContain('投资存款 100')
    expect(text).toContain('该模式不提供结算数据')
    expect(text).not.toContain('通关')
    expect(text).not.toContain('成功率')
    expect(text).not.toContain('已结算')
    expect(text).not.toContain('源石锭')
  })

  it('shows pass stats for the investment mode only when a pass was observed', async () => {
    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            mode: 1,
            settlementSupported: false,
            roundsStarted: 3,
            roundsEnded: 2,
            roundsSettled: 0,
            roundsPassed: 1,
            investment: null,
            recentRounds: [],
          }),
        },
      }),
    })

    const text = panelText()
    expect(text).toContain('通关 1 局')
    expect(text).toContain('成功率 50%')
    expect(text).not.toContain('已结算')
    expect(text).not.toContain('投资轮次')
  })

  it('does not fill missing investment amounts with zero', async () => {
    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            mode: 1,
            settlementSupported: false,
            roundsStarted: 1,
            roundsEnded: 1,
            roundsSettled: 0,
            roundsPassed: 0,
            investment: { rounds: 0, count: 4, total: null, deposit: null },
          }),
        },
      }),
    })

    const text = panelText()
    expect(text).toContain('投资轮次 0')
    expect(text).toContain('投资次数 4')
    expect(text).not.toContain('投资总额')
    expect(text).not.toContain('投资存款')
  })

  it('shows started and ended for another known mode without assuming settlement', async () => {
    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            mode: 5,
            settlementSupported: false,
            roundsStarted: 3,
            roundsEnded: 2,
            roundsSettled: 0,
            roundsPassed: 0,
            investment: null,
            recentRounds: [],
          }),
        },
      }),
    })

    const text = panelText()
    expect(text).toContain('已开始 3 局')
    expect(text).toContain('已结束 2 局')
    expect(text).toContain('该模式不提供结算数据')
    expect(text).not.toContain('已结算')
    expect(text).not.toContain('通关')
    expect(text).not.toContain('成功率')
    expect(text).not.toContain('投资轮次')
  })

  it('shows observed settlement, pass and investment data for another known mode', async () => {
    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            mode: 5,
            settlementSupported: false,
            roundsStarted: 3,
            roundsEnded: 2,
            roundsSettled: 1,
            roundsPassed: 1,
            investment: { rounds: 2, count: 8, total: 240, deposit: 60 },
          }),
        },
      }),
    })

    const text = panelText()
    expect(text).toContain('已结算 1 局')
    expect(text).toContain('通关 1 局')
    expect(text).toContain('成功率 50%')
    expect(text).toContain('投资轮次 2')
    expect(text).toContain('投资次数 8')
    expect(text).toContain('投资总额 240')
    expect(text).toContain('投资存款 60')
    expect(text).toContain('该模式不提供结算数据')
  })

  it.each([null, 999])(
    'shows only started and ended for unknown mode %s',
    async (mode) => {
      await renderPanel({
        run: activeRun({
          progress: {
            roguelike: snapshot({
              mode,
              settlementSupported: null,
              roundsStarted: 3,
              roundsEnded: 2,
              roundsSettled: 0,
              roundsPassed: 0,
              investment: null,
              recentRounds: [],
            }),
          },
        }),
      })

      const text = panelText()
      expect(text).toContain('已开始 3 局')
      expect(text).toContain('已结束 2 局')
      expect(text).not.toContain('通关')
      expect(text).not.toContain('成功率')
      expect(text).not.toContain('已结算')
      expect(text).not.toContain('该模式不提供结算数据')
      expect(text).not.toContain('投资轮次')
    },
  )

  it('shows settlement stats for an unknown mode when the server reports support', async () => {
    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            mode: null,
            settlementSupported: true,
            roundsStarted: 3,
            roundsEnded: 2,
            roundsSettled: 0,
            roundsPassed: 0,
            investment: null,
            recentRounds: [],
          }),
        },
      }),
    })

    const text = panelText()
    expect(text).toContain('已开始 3 局')
    expect(text).toContain('已结束 2 局')
    expect(text).toContain('通关 0 局')
    expect(text).toContain('成功率 0%')
    expect(text).toContain('已结算 0 局')
  })

  it('caps recent rounds at five rows and labels unknown fields without inventing them', async () => {
    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            recentRounds: [
              { index: 6, outcome: 'passed', settled: true, floor: 6, score: 1500, endedAt: null },
              { index: 5, outcome: 'not_passed', settled: true, floor: 5, score: 1000, endedAt: null },
              { index: 4, outcome: 'passed', settled: true, floor: 4, score: 800, endedAt: null },
              { index: 3, outcome: 'not_passed', settled: true, floor: 3, score: 600, endedAt: null },
              { index: 2, outcome: 'unknown', settled: false, floor: null, score: null, endedAt: null },
              { index: 1, outcome: 'passed', settled: true, floor: 1, score: 200, endedAt: null },
            ],
          }),
        },
      }),
    })

    const rows = [...(panel()?.querySelectorAll('li') ?? [])]
    expect(rows).toHaveLength(5)
    expect(rows[0]?.textContent).toContain('第 6 局')
    expect(rows[4]?.textContent).toContain('第 2 局')
    expect(rows[4]?.textContent).toContain('未确认')
    expect(rows[4]?.textContent).not.toContain('第 null 层')
    expect(panelText()).not.toContain('第 1 局')

    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            recentRounds: [
              { index: null, outcome: 'unknown', settled: false, floor: null, score: null, endedAt: null },
            ],
          }),
        },
      }),
    })

    expect(panelText()).toContain('未知局')
  })

  it('advances elapsed and relative times every second and clears timers on unmount', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-21T12:00:20.000Z'))

    await renderPanel({ run: activeRun() })

    expect(panelText()).toContain('本次任务 00:20')
    expect(panelText()).toContain('本局 00:10')
    expect(panelText()).toContain('最近事件 15 秒前')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(panelText()).toContain('本次任务 00:21')
    expect(panelText()).toContain('本局 00:11')
    expect(panelText()).toContain('最近事件 16 秒前')

    const status = panel()?.querySelector('[role="status"]')
    expect(status?.textContent).not.toContain('本次任务')
    expect(status?.textContent).not.toContain('00:21')
    expect(status?.textContent).toContain('第 3 局 · 探索中')

    await act(async () => root.unmount())
    root = createRoot(container)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('renders the status as a non-interactive badge', async () => {
    await renderPanel({ run: terminalRun() })

    expect(badge()).not.toBeNull()
    expect(badge()?.tagName).not.toBe('BUTTON')
    expect(badge()?.closest('button')).toBeNull()
  })

  it('cleans the run error message without exposing raw stderr', async () => {
    await renderPanel({
      run: terminalRun('roguelike', {
        state: 'failed',
        result: { summary: summary('roguelike') },
        error: {
          message: '设备连接中断\n请检查 USB 连接',
          details: { stderr: '[raw stderr] core dumped' },
        },
      }),
    })

    const text = panelText()
    expect(text).toContain('执行失败')
    expect(text).toContain('设备连接中断 请检查 USB 连接')
    expect(text).not.toContain('[raw stderr]')
  })

  it.each([
    ['failed', '失败', '执行失败'],
    ['stopped', '已停止', '任务已停止'],
    ['interrupted', '已中断', '任务已中断'],
  ] as const)('labels the %s terminal state', async (state, label, statusText) => {
    await renderPanel({
      run: terminalRun('roguelike', {
        state,
        result: { summary: summary('roguelike') },
      }),
    })

    expect(badge()?.textContent).toBe(label)
    expect(panelText()).toContain(statusText)
  })

  it('renders the reclamation terminal state with its summary message', async () => {
    await renderPanel({ mode: 'reclamation', run: terminalRun('reclamation') })

    const text = panelText()
    expect(text).toContain('生息演算进度')
    expect(text).toContain('上次演算已完成 · 耗时 01:05')
    expect(text).toContain('生息演算执行完成')
    expect(text).not.toContain('已结束')
    expect(text).not.toContain('成功率')
    expect(text).not.toContain('已结算')
  })

  it('shows only the task status for reclamation outside structured progress', async () => {
    await renderPanel({
      mode: 'reclamation',
      run: terminalRun('reclamation', { result: { summary: summary('reclamation') } }),
    })

    expect(panelText()).toContain('上次演算已完成 · 耗时 01:05')
    expect(panelText()).not.toContain('本次执行没有可用的结构化结果')
    expect(panelText()).not.toContain('已结算')
  })

  it('states that reclamation has no structured result without a summary message', async () => {
    await renderPanel({
      mode: 'reclamation',
      run: terminalRun('reclamation', { result: undefined }),
    })

    expect(badge()?.textContent).toBe('已完成')
    expect(panelText()).toContain('上次演算已完成 · 耗时 01:05')
    expect(panelText()).toContain('本次执行没有可用的结构化结果')

    await renderPanel({
      mode: 'reclamation',
      run: terminalRun('reclamation', {
        result: { summary: summary('reclamation', { message: '' }) },
      }),
    })

    expect(panelText()).toContain('本次执行没有可用的结构化结果')
  })

  it('renders the complete active blackflow subtree without replacing phase 1 statistics', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-21T12:00:20.000Z'))

    await renderPanel({
      run: activeRun({
        progress: { roguelike: snapshot({ blackflow: blackflow() }) },
      }),
    })

    const text = panelText()
    expect(panel()?.querySelector('h3')?.textContent).toBe('黑流进度')
    expect(text).toContain('第 3 层')
    expect(text).toContain('当前节点 不期而遇（事件）')
    expect(text).toContain('行动力 7')
    expect(text).toContain('移动：前往 安全的角落（步行）')
    expect(text).toContain('行动力 7→6')
    expect(text).toContain('已到达')
    expect(text).toContain('第 3 层目标 · 已达成')
    expect(text).toContain('第 1 层目标 · 可达成 · 进度 2')
    expect(text).toContain('黑流策略：速通到第三层')
    expect(text).toContain('黑流更新于 8 秒前')
    expect(text).toContain('已结束 2 局')
    expect(text).toContain('通关 1 局')
    expect(text).toContain('成功率 50%')
    expect(text).not.toContain('作战：紧急作战')
    expect(text).not.toContain('281475010265089')
  })

  it('renders partial blackflow data and an explicit empty map state without placeholders', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-21T12:00:20.000Z'))

    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            blackflow: blackflow({
              currentNode: null,
              currentNodeAt: null,
              actionPoints: null,
              lastRoute: null,
              lastNodeResolution: null,
              milestones: [],
              floorAt: null,
              updatedAt: null,
              strategy: {
                at: null,
                profile: 'baby_animal',
                outcome: null,
                terminationReason: null,
                nextAction: null,
                succeeded: null,
              },
            }),
          }),
        },
      }),
    })

    let text = panelText()
    expect(text).toContain('第 3 层')
    expect(text).toContain('黑流策略：培育襁褓动物')
    expect(text).not.toContain('等待黑流地图数据')
    expect(text).not.toContain('null')
    expect(text).not.toContain('undefined')

    const emptyStrategy = {
      at: null,
      profile: 'baby_animal',
      outcome: null,
      terminationReason: null,
      nextAction: null,
      succeeded: null,
    }
    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            blackflow: blackflow({
              floor: null,
              floorAt: null,
              currentNode: null,
              currentNodeAt: null,
              actionPoints: null,
              lastRoute: null,
              lastNodeResolution: null,
              milestones: [],
              updatedAt: null,
              strategy: emptyStrategy,
            }),
          }),
        },
      }),
    })

    text = panelText()
    expect(text).toContain('等待黑流地图数据…')
    expect(text).toContain('黑流策略：培育襁褓动物')
    expect(text).not.toContain('null')
    expect(text).not.toContain('undefined')

    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            blackflow: blackflow({
              currentNode: { id: '281475010265088', name: null, type: null },
              actionPoints: null,
              lastRoute: null,
              lastNodeResolution: null,
              milestones: [],
              strategy: null,
            }),
          }),
        },
      }),
    })

    text = panelText()
    expect(text).toContain('当前节点未知')
    expect(text).not.toContain('281475010265088')
  })

  it('marks stale blackflow values and hides node and action points after the freshness window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-21T12:05:12.000Z'))

    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            blackflow: blackflow({
              lastRoute: null,
              lastNodeResolution: null,
              milestones: [],
              strategy: null,
            }),
          }),
        },
      }),
    })

    let text = panelText()
    expect(text).toContain('可能已过期')
    expect(text).not.toContain('当前')
    expect(text).toContain('第 3 层')
    expect(text).toContain('行动力 7')
    expect(text).toContain('黑流更新于 5 分钟前')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000)
    })

    text = panelText()
    expect(text).toContain('最近已知')
    expect(text).toContain('第 3 层')
    expect(text).not.toContain('当前节点')
    expect(text).not.toContain('不期而遇')
    expect(text).not.toContain('行动力 7')
  })

  it('applies freshness prefixes per field instead of one shared row prefix', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-21T12:04:12.000Z'))

    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            blackflow: blackflow({
              floorAt: '2026-11-21T12:00:12.000Z',
              currentNodeAt: '2026-11-21T12:04:05.000Z',
              actionPoints: null,
              lastRoute: null,
              lastNodeResolution: null,
              milestones: [],
              strategy: null,
              updatedAt: '2026-11-21T12:04:05.000Z',
            }),
          }),
        },
      }),
    })

    const lines = [...(panel()?.querySelectorAll('section.roguelike-progress-blackflow p') ?? [])]
      .map(line => line.textContent)
    expect(lines[0]).toBe('可能已过期第 3 层 · 当前节点 不期而遇（事件）')
    expect(lines[0]).not.toContain('可能已过期：')
    expect(lines[0]).not.toContain('最近已知：')
  })

  it('uses per-field recent wording for floor, node and action points', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-21T12:01:30.000Z'))

    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            blackflow: blackflow({
              lastRoute: null,
              lastNodeResolution: null,
              milestones: [],
              strategy: null,
              updatedAt: '2026-11-21T12:00:12.000Z',
            }),
          }),
        },
      }),
    })

    const lines = [...(panel()?.querySelectorAll('section.roguelike-progress-blackflow p') ?? [])]
      .map(line => line.textContent)
    expect(lines[0]).toBe(
      '最近已知第 3 层 · 最近已知节点 不期而遇（事件） · 最近决策时行动力 7',
    )
  })

  it('shows an expired-record fallback when only the current node is stale', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-21T12:05:20.000Z'))

    await renderPanel({
      run: activeRun({
        progress: {
          roguelike: snapshot({
            blackflow: blackflow({
              floor: null,
              floorAt: null,
              currentNodeAt: '2026-11-21T12:00:12.000Z',
              actionPoints: null,
              lastRoute: null,
              lastNodeResolution: null,
              milestones: [],
              strategy: null,
              updatedAt: null,
            }),
          }),
        },
      }),
    })

    const text = panelText()
    expect(text).toContain('黑流进度')
    expect(text).toContain('节点未知（最近记录已过期）')
    expect(text).not.toContain('不期而遇')
    expect(text).not.toContain('当前节点')
    expect(text).not.toContain('等待黑流地图数据')

    await renderPanel({
      run: terminalRun('roguelike', {
        result: {
          summary: {
            ...summary('roguelike'),
            progress: snapshot({
              phase: 'ended',
              currentRound: null,
              recentRounds: [],
              blackflow: blackflow({
                floor: null,
                floorAt: null,
                currentNode: null,
                currentNodeAt: null,
                actionPoints: null,
                lastRoute: null,
                lastNodeResolution: null,
                milestones: [],
                strategy: null,
                updatedAt: '2026-11-21T12:00:12.000Z',
              }),
            }),
          },
        },
      }),
    })

    expect(panelText()).toContain('未记录到黑流进度')
  })

  it('uses last-record wording for terminal blackflow and keeps it before the last round result', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-21T12:00:20.000Z'))

    await renderPanel({
      run: terminalRun('roguelike', {
        result: {
          summary: {
            ...summary('roguelike'),
            progress: snapshot({
              phase: 'ended',
              currentRound: null,
              blackflow: blackflow(),
            }),
          },
        },
      }),
    })

    const text = panelText()
    expect(text).toContain('黑流进度')
    expect(text).toContain('最后记录')
    expect(text).toContain('第 3 层')
    expect(text).toContain('节点 不期而遇（事件）')
    expect(text).toContain('最后记录于 8 秒前')
    expect(text).not.toContain('当前')

    const children = [...(panel()?.querySelector('.roguelike-progress-body')?.children ?? [])]
    const statusIndex = children.findIndex(
      child => child.classList.contains('roguelike-progress-status'),
    )
    const sectionIndex = children.findIndex(child => child.tagName === 'SECTION')
    const resultIndex = children.findIndex(
      child => child.classList.contains('roguelike-progress-result'),
    )
    expect(sectionIndex).toBeGreaterThan(statusIndex)
    expect(sectionIndex).toBeLessThan(resultIndex)
  })

  it('uses the terminal empty blackflow message while still showing the strategy', async () => {
    await renderPanel({
      run: terminalRun('roguelike', {
        result: {
          summary: {
            ...summary('roguelike'),
            progress: snapshot({
              phase: 'ended',
              currentRound: null,
              recentRounds: [],
              blackflow: blackflow({
                floor: null,
                floorAt: null,
                currentNode: null,
                currentNodeAt: null,
                actionPoints: null,
                lastRoute: null,
                lastNodeResolution: null,
                milestones: [],
                updatedAt: null,
                strategy: {
                  at: null,
                  profile: 'burn',
                  outcome: null,
                  terminationReason: null,
                  nextAction: null,
                  succeeded: true,
                },
              }),
            }),
          },
        },
      }),
    })

    const text = panelText()
    expect(text).toContain('未记录到黑流进度')
    expect(text).toContain('黑流策略：速通到第三层')
    expect(text).not.toContain('等待黑流地图数据')
  })

  it('shows a neutral strategy goal message when only succeeded is reported', async () => {
    await renderPanel({
      run: terminalRun('roguelike', {
        result: {
          summary: {
            ...summary('roguelike'),
            progress: snapshot({
              phase: 'ended',
              currentRound: null,
              recentRounds: [],
              blackflow: blackflow({
                floor: null,
                floorAt: null,
                currentNode: null,
                currentNodeAt: null,
                actionPoints: null,
                lastRoute: null,
                lastNodeResolution: null,
                milestones: [],
                updatedAt: null,
                strategy: {
                  at: null,
                  profile: 'burn',
                  outcome: null,
                  terminationReason: null,
                  nextAction: null,
                  succeeded: true,
                },
              }),
            }),
          },
        },
      }),
    })

    const text = panelText()
    const sectionText = panel()?.querySelector('section.roguelike-progress-blackflow')?.textContent ?? ''
    expect(text).toContain('策略结果：策略目标已达成')
    expect(text).toContain('黑流策略：速通到第三层')
    expect(sectionText).not.toContain('任务成功')
    expect(sectionText).not.toContain('通关')
  })

  it('keeps a failed task badge when the blackflow strategy reports success', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-21T12:00:20.000Z'))

    await renderPanel({
      run: terminalRun('roguelike', {
        state: 'failed',
        result: {
          summary: {
            ...summary('roguelike'),
            progress: snapshot({
              mode: 1,
              settlementSupported: false,
              roundsPassed: 0,
              roundsSettled: 0,
              recentRounds: [],
              phase: 'ended',
              currentRound: null,
              blackflow: blackflow({
                strategy: {
                  at: '2026-11-21T12:00:12.000Z',
                  profile: 'burn',
                  outcome: 'burn_completed',
                  terminationReason: 'third_floor_reached',
                  nextAction: 'restart_current_run',
                  succeeded: true,
                },
              }),
            }),
          },
        },
      }),
    })

    const text = panelText()
    expect(badge()?.textContent).toBe('失败')
    expect(text).toContain('策略结果：速通完成 · 原因：抵达第三层 · 建议：重新开始本局')
    expect(text).toContain('黑流策略：速通到第三层')
    expect(text).not.toContain('任务成功')
    expect(text).not.toContain('通关')
  })

  it('does not render blackflow for null or undefined progress and never for reclamation', async () => {
    await renderPanel({ run: activeRun() })

    expect(panel()?.querySelector('h3')).toBeNull()
    expect(panelText()).not.toContain('黑流')

    await renderPanel({
      run: activeRun({
        progress: { roguelike: snapshot({ blackflow: undefined }) },
      }),
    })

    expect(panel()?.querySelector('h3')).toBeNull()
    expect(panelText()).not.toContain('黑流')

    await renderPanel({
      mode: 'reclamation',
      run: activeRun({
        progress: {
          roguelike: snapshot({ command: 'reclamation', blackflow: blackflow() }),
        },
      }),
    })

    expect(panelText()).toContain('本次演算进行中')
    expect(panel()?.querySelector('h3')).toBeNull()
    expect(panelText()).not.toContain('黑流')
  })

  it('keeps the blackflow subtree under the panel heading with list semantics', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-21T12:00:20.000Z'))

    await renderPanel({
      run: activeRun({
        progress: { roguelike: snapshot({ blackflow: blackflow() }) },
      }),
    })

    const headings = [...(panel()?.querySelectorAll('h2, h3') ?? [])]
      .map(heading => heading.textContent)
    expect(headings).toEqual(['集成战略进度', '黑流进度'])

    const section = panel()?.querySelector('section.roguelike-progress-blackflow')
    expect(section?.getAttribute('role')).toBeNull()
    expect(section?.getAttribute('aria-label')).toBeNull()
    expect(section?.querySelector('h3')?.textContent).toBe('黑流进度')

    const milestones = [...(section?.querySelectorAll('ul > li') ?? [])]
    expect(milestones).toHaveLength(2)
    expect(milestones[0]?.textContent).toContain('第 3 层目标')
    expect(milestones[1]?.textContent).toContain('进度 2')

    expect(statusText()).toBe('第 3 局 · 探索中')
    expect(statusText()).not.toContain('黑流')
    expect(statusText()).not.toContain('本次任务')
  })
})
