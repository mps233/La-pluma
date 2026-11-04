// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import CombatExecutionProgress from './CombatExecutionProgress'
import type { AgentRun } from '../types/run'

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(run: AgentRun | null, visible = true) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<CombatExecutionProgress run={run} visible={visible} />))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

const activeRun: AgentRun = {
  runId: 'run-1',
  operationId: 'run_copilot_set',
  state: 'running',
  startedAt: new Date(Date.now() - 65_000).toISOString(),
  progress: {
    currentStep: 3,
    totalSteps: 10,
    currentStage: 'TL-3',
    message: '正在执行 TL-3',
  },
}

describe('CombatExecutionProgress', () => {
  it('shows the queue position, stage and elapsed time for an active run', () => {
    const node = render(activeRun)
    expect(node.textContent).toContain('本次执行进度')
    expect(node.textContent).toContain('正在执行 第 3 / 10 项')
    expect(node.textContent).toContain('关卡 TL-3')
    expect(node.textContent).toContain('已用时 1 分')
  })

  it('hides when the run is not active or the set is not current', () => {
    expect(render({ ...activeRun, state: 'succeeded' }).textContent).toBe('')
    expect(render(activeRun, false).textContent).toBe('')
    expect(render(null).textContent).toBe('')
  })
})
