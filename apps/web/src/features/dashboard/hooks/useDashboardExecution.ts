import { useCallback, useEffect, useRef } from 'react'
import { getErrorMessage } from '@/shared/api'
import { executeScheduleNow, type TaskFlowWireItem } from '@/features/automation'
import {
  executionController as defaultExecutionController,
  isActiveRunState,
  isTerminalRunState,
  readSubmittedRun,
  readSubmittedRunId,
  summarizeRunStatus,
  useExecutionSnapshot,
  type AgentRun,
  type ExecutionController,
  type GlobalRunStatus,
} from '@/features/task-execution'
import { EXECUTION_NOTICE_ID, type Notify, type NoticeType } from '@/shared/notifications'
import { isRunStatusBusy } from '@/features/runtime-status'
import { describeDashboardRunTerminal } from '../model/runNotice'

export const DASHBOARD_EXECUTION_SCOPE = 'dashboard'

export interface DashboardFlowStartOutcome {
  /** 服务端是否接受了本次提交；传输失败时不能当作失败或完成。 */
  ok: boolean
  message: string
  type: NoticeType
}

export interface DashboardExecution {
  /** 唯一快照的运行状态投影，与执行控制器同源。 */
  status: GlobalRunStatus
  /** 设备忙：有活动 run（含等待继续）或被未纳管执行占用。 */
  isBusy: boolean
  /** 本页发起的 run（scope=dashboard）；其它域或外部占用为 null。 */
  ownedRun: AgentRun | null
  /** 观察最后失败的原因，仅用于“无法确认”时的说明。 */
  observationError: string | null
  startFlow: (flow: TaskFlowWireItem[]) => Promise<DashboardFlowStartOutcome>
}

interface UseDashboardExecutionOptions {
  notify: Notify
  controller?: ExecutionController
}

export function useDashboardExecution({
  notify,
  controller = defaultExecutionController,
}: UseDashboardExecutionOptions): DashboardExecution {
  const execution = useExecutionSnapshot(controller)
  const status = summarizeRunStatus(execution)
  const owned = execution.trackedScope === DASHBOARD_EXECUTION_SCOPE
  const ownedRun = owned ? execution.trackedRun : null
  const isBusy = isRunStatusBusy(status)

  const observedActiveRunRef = useRef<string | null>(null)
  const announcedRunRef = useRef<string | null>(null)

  useEffect(() => {
    if (!ownedRun) {
      observedActiveRunRef.current = null
      return
    }
    if (isActiveRunState(ownedRun.state)) {
      observedActiveRunRef.current = ownedRun.runId
      return
    }
    // 只宣告本页实际观察过活动的 run；刷新后直接看到终态时不重复提示。
    if (!isTerminalRunState(ownedRun.state)) return
    if (observedActiveRunRef.current !== ownedRun.runId) return
    if (announcedRunRef.current === ownedRun.runId) return

    observedActiveRunRef.current = null
    announcedRunRef.current = ownedRun.runId
    const notice = describeDashboardRunTerminal(ownedRun)
    if (notice) notify(notice.message, notice.type, { id: EXECUTION_NOTICE_ID })
  }, [notify, ownedRun])

  const startFlow = useCallback(async (flow: TaskFlowWireItem[]): Promise<DashboardFlowStartOutcome> => {
    if (controller.getState().submission === 'pending') {
      return { ok: false, message: '正在提交上一次执行，请稍候。', type: 'info' }
    }
    if (isBusy) {
      return { ok: false, message: '设备正在执行其它任务，请等待结束或先停止。', type: 'warning' }
    }

    try {
      const result = await controller.submitExecution(
        'run_daily_flow',
        ({ idempotencyKey, signal }) => executeScheduleNow('dashboard-quick-start', flow, {
          waitForCompletion: false,
          idempotencyKey,
          signal,
        }),
        { scope: DASHBOARD_EXECUTION_SCOPE },
      )

      if (!result.success) {
        return {
          ok: false,
          message: `今日流程启动失败: ${getErrorMessage(result)}`,
          type: 'error',
        }
      }

      const runId = readSubmittedRunId(result.data)
      if (!runId) {
        // 旧服务端不会返回身份：此时无法观察或停止，不能伪造运行状态。
        return {
          ok: false,
          message: '服务端未返回运行身份，无法确认本次执行状态',
          type: 'warning',
        }
      }

      observedActiveRunRef.current = runId
      const submittedRun = readSubmittedRun(result.data, runId)
      const notice = describeDashboardRunTerminal(submittedRun)
      if (notice) {
        observedActiveRunRef.current = null
        announcedRunRef.current = submittedRun?.runId ?? null
        notify(notice.message, notice.type, { id: EXECUTION_NOTICE_ID })
      }
      return { ok: true, message: '今日流程已开始执行', type: 'success' }
    } catch (error) {
      // 传输失败时服务端可能已经接受执行，不能宣称失败或自动重提。
      return {
        ok: false,
        message: `无法确认执行状态: ${(error as Error).message}`,
        type: 'warning',
      }
    }
  }, [controller, isBusy, notify])

  return {
    status,
    isBusy,
    ownedRun,
    observationError: execution.lastError,
    startFlow,
  }
}
