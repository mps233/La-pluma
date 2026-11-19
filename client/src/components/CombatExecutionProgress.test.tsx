// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import CombatExecutionProgress from './CombatExecutionProgress'
import type { AgentRun } from '../types/run'

afterEach(cleanup)

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
    render(<CombatExecutionProgress run={activeRun} visible />)

    const section = screen.getByRole('region', { name: '本次执行进度' })
    expect(section.textContent).toContain('本次执行进度')
    expect(section.textContent).toContain('正在执行 第 3 / 10 项')
    expect(section.textContent).toContain('关卡 TL-3')
    expect(section.textContent).toContain('已用时 1 分')
  })

  it('hides when the run is not active or the set is not current', () => {
    const { container, rerender } = render(
      <CombatExecutionProgress run={{ ...activeRun, state: 'succeeded' }} visible />,
    )
    expect(container.textContent).toBe('')

    rerender(<CombatExecutionProgress run={activeRun} visible={false} />)
    expect(container.textContent).toBe('')

    rerender(<CombatExecutionProgress run={null} visible />)
    expect(container.textContent).toBe('')
  })
})
