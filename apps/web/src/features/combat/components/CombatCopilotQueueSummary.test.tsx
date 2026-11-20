// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentRun, RunTaskResult } from '@/features/task-execution'
import { readCopilotSetRunProjection } from '../model/copilotSetRun'
import { deriveCopilotSetView, type CopilotSetView } from '../model/copilotSetView'
import type { CopilotSetInfo, CopilotSetItem } from '../types'
import CombatCopilotQueueSummary from './CombatCopilotQueueSummary'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const items: CopilotSetItem[] = [
  { id: 101, name: '第一关', stage: 'MAIN-1', apCost: 21 },
  { id: 102, name: '第二关', stage: 'MAIN-2', apCost: 21 },
  { id: 103, name: '第三关', stage: 'MAIN-3', apCost: 21 },
  { id: 104, name: '第四关', stage: 'MAIN-4', apCost: 21 },
]

const basePreview: CopilotSetInfo = {
  type: 'set',
  id: '48990',
  name: '主线作业集',
  copilots: items,
}

type ItemStatus = NonNullable<RunTaskResult['status']>

function entry(itemIndex: number, status: ItemStatus, error?: string): RunTaskResult {
  return {
    key: `${itemIndex}:${101 + itemIndex}:normal`,
    itemIndex,
    copilotId: 101 + itemIndex,
    displayStage: `MAIN-${itemIndex + 1}`,
    mode: 'normal',
    status,
    ...(error ? { error } : {}),
  }
}

interface ViewOptions {
  selected?: ReadonlySet<number>
  copilots?: CopilotSetItem[]
  raid?: 'normal' | 'raid' | 'both'
  waitingEntryIndex?: number
  isAutoStopping?: boolean
}

interface ViewFixture {
  preview: CopilotSetInfo
  view: CopilotSetView
}

function createView(
  statuses: Array<[number, ItemStatus]> | null,
  options: ViewOptions = {},
): ViewFixture {
  const copilots = options.copilots ?? items
  const preview: CopilotSetInfo = { ...basePreview, copilots }
  const waiting = options.waitingEntryIndex !== undefined
  let setRun = null
  if (statuses) {
    const run: AgentRun = {
      runId: 'run-1',
      operationId: 'run_copilot_set',
      state: waiting ? 'waiting' : 'running',
      links: { self: '/agent/runs/run-1' },
      progress: {
        setId: preview.id,
        phase: waiting ? 'waiting_for_next' : 'running',
        currentEntry: null,
        nextEntry: waiting ? entry(options.waitingEntryIndex!, 'pending') : null,
        taskResults: statuses.map(([itemIndex, status]) => entry(itemIndex, status)),
      },
    }
    setRun = readCopilotSetRunProjection(run)
    if (!setRun) throw new Error('run_copilot_set 投影不应为空')
  }

  return {
    preview,
    view: deriveCopilotSetView({
      preview,
      selected: options.selected ?? new Set(copilots.map((_, index) => index)),
      setRun,
      dismissedRunId: null,
      raid: options.raid ?? 'normal',
      isWaitingForNext: waiting,
      isAutoStopping: options.isAutoStopping ?? false,
    }),
  }
}

describe('CombatCopilotQueueSummary', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const renderSummary = async (fixture: ViewFixture) => {
    await act(async () => {
      root.render(
        <CombatCopilotQueueSummary
          preview={fixture.preview}
          view={fixture.view}
        />,
      )
    })
  }

  it('reports each progress class without double counting', async () => {
    const fixture = createView(
      [[0, 'success'], [1, 'failed'], [2, 'stopped'], [3, 'skipped']],
    )

    await renderSummary(fixture)

    expect(container.textContent).toContain('待 3')
    expect(container.textContent).toContain('本次成功 1')
    expect(container.textContent).toContain('历史已通关 0')
    expect(container.textContent).toContain('失败 1')
    expect(container.textContent).toContain('已终止 1')
    expect(container.textContent).toContain('跳过 1')
    expect(container.textContent).toContain('本次已执行 3 个')
  })

  it('exposes the completed ratio through an accessible progressbar', async () => {
    await renderSummary(createView(
      [[0, 'success'], [1, 'failed'], [2, 'stopped'], [3, 'skipped']],
    ))

    const progressbar = container.querySelector<HTMLElement>('[role="progressbar"]')
    expect(progressbar).not.toBeNull()
    expect(progressbar?.getAttribute('aria-label')).toBe('作业集进度')
    expect(progressbar?.getAttribute('aria-valuemin')).toBe('0')
    expect(progressbar?.getAttribute('aria-valuemax')).toBe('100')
    expect(progressbar?.getAttribute('aria-valuenow')).toBe('25')
  })

  it('reports zero progress when no stage is complete', async () => {
    await renderSummary(createView(null, { selected: new Set([1, 2]) }))

    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0')
  })

  it('reports full progress when every stage is complete', async () => {
    await renderSummary(createView(null, {
      selected: new Set(),
      copilots: [
        { id: 101, name: '第一关', stage: 'MAIN-1', completedModes: ['normal'] },
        { id: 102, name: '第二关', stage: 'MAIN-2', completedModes: ['normal'] },
      ],
    }))

    expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100')
  })

  it('hides the stopped and skipped chips when their counts are zero', async () => {
    await renderSummary(createView(null, { selected: new Set([1, 2]) }))

    expect(container.textContent).toContain('待 2')
    expect(container.textContent).toContain('已通关 0')
    expect(container.textContent).toContain('失败 0')
    expect(container.textContent).not.toContain('已终止')
    expect(container.textContent).not.toContain('跳过')
  })

  it('names the next stage and URI to resume from', async () => {
    await renderSummary(createView(null, { selected: new Set([1, 2]) }))

    expect(container.textContent).toContain('下次从第 2 关继续')
    expect(container.textContent).toContain('续跑目标')
    expect(container.textContent).toContain('prts://102')
    expect(container.textContent).toContain('MAIN-2')
    expect(container.textContent).toContain('共 4 个作业（含历史通关）')
  })

  it('splits the current successes from historical clears', async () => {
    const fixture = createView(
      [[1, 'success']],
      {
        selected: new Set([1, 2, 3]),
        copilots: [
          { id: 101, name: '第一关', stage: 'MAIN-1', completedModes: ['normal'] },
          { id: 102, name: '第二关', stage: 'MAIN-2' },
          { id: 103, name: '第三关', stage: 'MAIN-3' },
          { id: 104, name: '第四关', stage: 'MAIN-4' },
        ],
      },
    )

    await renderSummary(fixture)

    expect(container.textContent).toContain('本次成功 1')
    expect(container.textContent).toContain('历史已通关 1')
  })

  it('lists failure stages and full reasons from the current run', async () => {
    const run: AgentRun = {
      runId: 'run-1',
      operationId: 'run_copilot_set',
      state: 'running',
      links: { self: '/agent/runs/run-1' },
      progress: {
        setId: basePreview.id,
        phase: 'running',
        taskResults: [entry(0, 'failed', '缺少干员：桃金娘\n请检查 box 后重试')],
      },
    }
    const setRun = readCopilotSetRunProjection(run)
    if (!setRun) throw new Error('run_copilot_set 投影不应为空')
    const view = deriveCopilotSetView({
      preview: basePreview,
      selected: new Set([0]),
      setRun,
      dismissedRunId: null,
      raid: 'normal',
      isWaitingForNext: false,
      isAutoStopping: false,
    })

    await renderSummary({ preview: basePreview, view })

    expect(container.textContent).toContain('失败原因')
    expect(container.textContent).toContain('MAIN-1')
    expect(container.textContent).toContain('缺少干员：桃金娘')
    expect(container.textContent).toContain('请检查 box 后重试')
  })

  it('prefers the terminal summary errors over an unknown task-result reason', async () => {
    const run: AgentRun = {
      runId: 'run-1',
      operationId: 'run_copilot_set',
      state: 'succeeded',
      links: { self: '/agent/runs/run-1' },
      result: {
        summary: {
          setId: basePreview.id,
          mode: 'continuous',
          taskResults: [entry(0, 'failed')],
          errors: [{ key: '0:101:normal', stage: 'MAIN-1', error: '终态失败原因' }],
        },
      },
    }
    const setRun = readCopilotSetRunProjection(run)
    if (!setRun) throw new Error('run_copilot_set 投影不应为空')
    const view = deriveCopilotSetView({
      preview: basePreview,
      selected: new Set([0]),
      setRun,
      dismissedRunId: null,
      raid: 'normal',
      isWaitingForNext: false,
      isAutoStopping: false,
    })

    await renderSummary({ preview: basePreview, view })

    expect(container.textContent).toContain('终态失败原因')
    expect(container.textContent).not.toContain('未知错误')
  })

  it('asks for a progress reset when every stage is complete', async () => {
    const fixture = createView(null, {
      selected: new Set(),
      copilots: [
        { id: 101, name: '第一关', stage: 'MAIN-1', completedModes: ['normal'] },
        { id: 102, name: '第二关', stage: 'MAIN-2', completedModes: ['normal'] },
      ],
    })

    await renderSummary(fixture)

    expect(container.textContent).toContain('没有待续跑的作业')
    expect(container.textContent).toContain('需要重打时点击“重置进度”。')
    expect(container.textContent).not.toContain('续跑目标')
    expect(container.textContent).toContain('待 0')
    expect(container.textContent).toContain('已通关 2')
  })

  it('counts a stage completed both historically and in this run only once', async () => {
    const fixture = createView(
      [[0, 'success'], [1, 'pending'], [2, 'pending']],
      {
        selected: new Set([1, 2]),
        copilots: [
          { id: 101, name: '第一关', stage: 'MAIN-1', completedModes: ['normal'] },
          { id: 102, name: '第二关', stage: 'MAIN-2' },
          { id: 103, name: '第三关', stage: 'MAIN-3' },
        ],
      },
    )

    await renderSummary(fixture)

    expect(container.textContent).toContain('已通关 1')
    expect(container.textContent).toContain('待 2')
  })

  it('describes the waiting entry', async () => {
    const fixture = createView(
      [[0, 'success'], [1, 'pending'], [2, 'pending']],
      { waitingEntryIndex: 1, selected: new Set([1, 2]) },
    )

    await renderSummary(fixture)

    expect(container.textContent).toContain('下一关')
    expect(container.textContent).toContain('第 2 / 4 关')
    expect(container.textContent).toContain('prts://102')
    expect(container.textContent).toContain('第二关')
    expect(container.textContent).toContain('MAIN-2')
    expect(container.textContent).toContain('请在游戏中进入下一关界面后点击「开始下一关」。')

  })
})
