import { create } from 'zustand'
import type { AgentRun } from '../types/run'

const runSignature = (run: AgentRun | null): string => {
  if (!run) return ''
  const results = run.taskResults ?? run.progress?.taskResults ?? []
  return [
    run.runId,
    run.state,
    run.progress?.setId ?? '',
    run.progress?.currentStage ?? '',
    run.progress?.currentStep ?? '',
    run.progress?.totalSteps ?? '',
    run.progress?.currentTask ?? '',
    run.progress?.message ?? '',
    run.progress?.battle ? `${run.progress.battle.kills}/${run.progress.battle.total}` : '',
    results
      .map(result => [
        result.itemIndex ?? '',
        result.status ?? '',
        result.state ?? '',
        result.name ?? '',
      ].join(':'))
      .join(','),
  ].join('|')
}

interface RunStore {
  run: AgentRun | null
  /** 最近一次结束的 Run，供岛在任务结束时展示最终状态。 */
  lastRun: AgentRun | null
  applyRun: (run: AgentRun | null) => void
  applyLastRun: (run: AgentRun | null) => void
}

/**
 * 当前 Run 的完整快照，供需要任务级进度的页面读取。
 * 全局运行状态仍由 statusStore.runStatus 提供；这里只保留服务端事实。
 */
export const useRunStore = create<RunStore>((set, get) => ({
  run: null,
  lastRun: null,
  applyRun: (run) => {
    if (runSignature(get().run) === runSignature(run)) return
    set({ run })
  },
  applyLastRun: (run) => {
    if (runSignature(get().lastRun) === runSignature(run)) return
    set({ lastRun: run })
  },
}))
