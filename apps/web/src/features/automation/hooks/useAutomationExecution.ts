import { useCallback, useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@/shared/api'
import {
  EXECUTION_NOTICE_ID,
  notifyProgress,
  type NoticeType,
  type Notify,
} from '@/shared/notifications'
import {
  executionController as defaultExecutionController,
  isActiveRunState,
  isTerminalRunState,
  readSubmittedRun,
  readSubmittedRunId,
  useExecutionSnapshot,
  type AgentRun,
  type ExecutionController,
} from '@/features/task-execution'
import { executeScheduleNow } from '../api'
import type { TaskFlowItem, TaskFlowWireItem } from '../types'
import {
  describeAutomationRunTerminal,
  readAutomationExecutionSummary,
  readAutomationFlowProgress,
  readAutomationScheduleSummary,
  type AutomationExecutionSummary,
  type AutomationFlowProgress,
} from '../model/automationRun'
import {
  migrateLegacyFlowCheckpoint,
  type LegacyFlowCheckpointStorage,
} from '../model/flowCheckpoint'

export const AUTOMATION_EXECUTION_SCOPE = 'automation'

/**
 * 今日流程的服务端操作标识。概览快捷入口与本页提交的是同一个操作，
 * 因此谁先发起都能被本页接管（进度、逐项状态与停止）。
 */
export const AUTOMATION_FLOW_OPERATION_ID = 'run_daily_flow'

/** 停止请求成功但 run 长期没有离开 running 时，解锁按钮允许重试。 */
export const AUTOMATION_STOP_CONFIRM_TIMEOUT_MS = 15_000

export interface AutomationExecution {
  /** 本页接管且仍处于活动状态的 run，或身份已持久化但快照尚未解析出来。 */
  isRunning: boolean
  /** 停止确认中：服务端已进入 stopping，或停止请求已成功等待终态。 */
  isStopping: boolean
  /** 启动请求在途；按钮保持禁用，重复点击不会产生第二个提交。 */
  isSubmitting: boolean
  run: AgentRun | null
  progress: AutomationFlowProgress | null
  summary: AutomationExecutionSummary | null
  /** 服务端流程投影的最近执行结果，仅用于空闲时展示，不代表本页身份。 */
  scheduleSummary: AutomationExecutionSummary | null
  submitFlow: (flow: TaskFlowItem[]) => Promise<boolean>
  stop: () => Promise<void>
}

interface UseAutomationExecutionOptions {
  notify: Notify
  controller?: ExecutionController
  storage?: LegacyFlowCheckpointStorage | null
}

function cleanFlow(flow: TaskFlowItem[]): TaskFlowWireItem[] {
  return flow.map(task => ({
    id: task.id,
    name: task.name,
    commandId: task.commandId,
    taskType: task.taskType,
    params: task.params,
    enabled: task.enabled,
  }))
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}

function legacyCheckpointMessage(
  result: ReturnType<typeof migrateLegacyFlowCheckpoint>,
): { message: string; type: NoticeType } | null {
  if (result.status === 'adopted') {
    if (result.run && isTerminalRunState(result.run.state)) {
      const notice = describeAutomationRunTerminal(
        result.run,
        readAutomationExecutionSummary(result.run),
      )
      return { message: notice.message, type: notice.type }
    }
    return { message: '已恢复上次任务流程，继续观察运行进度', type: 'info' }
  }
  if (result.status === 'invalid') {
    if (result.reason === 'expired') {
      return { message: '上次任务流程断点已过期，未重新提交，请重新开始', type: 'warning' }
    }
    if (result.reason === 'unsupported') {
      return { message: '上次任务流程断点版本不受支持，已清理，请重新开始', type: 'warning' }
    }
    return { message: '上次任务流程断点无法识别，已清理，请重新开始', type: 'warning' }
  }
  if (result.status === 'conflict') {
    if (result.reason === 'unmanaged-flow') {
      return { message: '流程正被未纳管的调用方占用，已清理上次任务流程断点，未重新提交', type: 'warning' }
    }
    return { message: '检测到其他执行或本页已有运行身份，已清理上次任务流程断点', type: 'warning' }
  }
  if (result.status === 'unmatched') {
    return { message: '上次任务流程已结束或无法确认，断点已清理，未重新提交', type: 'warning' }
  }
  return null
}

export function useAutomationExecution({
  notify,
  controller = defaultExecutionController,
  storage,
}: UseAutomationExecutionOptions): AutomationExecution {
  const execution = useExecutionSnapshot(controller)
  const owned = execution.trackedOperationId === AUTOMATION_FLOW_OPERATION_ID
  const ownedRunId = owned ? execution.trackedRunId : null
  const trackedRun = owned ? execution.trackedRun : null
  const activeRun = trackedRun && isActiveRunState(trackedRun.state) ? trackedRun : null
  // 身份已持久化但快照还没返回：保守地按运行中处理，刷新后不能因此重复提交。
  const unresolved = owned && Boolean(ownedRunId) && execution.identity === 'tracked' && !trackedRun
  const isRunning = Boolean(activeRun) || unresolved
  const isSubmitting = execution.submission === 'pending'
  const progress = activeRun ? readAutomationFlowProgress(activeRun, execution.snapshot) : null
  const summary = readAutomationExecutionSummary(trackedRun)
  const scheduleSummary = readAutomationScheduleSummary(execution.snapshot)

  const [stopRequestPending, setStopRequestPending] = useState(false)
  const [stopAcknowledged, setStopAcknowledged] = useState(false)
  const stopRequestRef = useRef(false)
  const lastOwnedRunIdRef = useRef<string | null>(null)
  const observedActiveRunRef = useRef<string | null>(null)
  const announcedRunRef = useRef<string | null>(null)
  const stepMessageRef = useRef<string | null>(null)
  const checkpointHandledRef = useRef(false)

  // 新 run 身份出现或解除时，停止确认状态属于上一个 run，不能沿用到新一次执行。
  useEffect(() => {
    if (lastOwnedRunIdRef.current === ownedRunId) return
    lastOwnedRunIdRef.current = ownedRunId
    setStopRequestPending(false)
    setStopAcknowledged(false)
    stopRequestRef.current = false
  }, [ownedRunId])

  const announceTerminal = useCallback((run: AgentRun) => {
    announcedRunRef.current = run.runId
    const notice = describeAutomationRunTerminal(run, readAutomationExecutionSummary(run))
    notify(notice.message, notice.type, { id: EXECUTION_NOTICE_ID })
  }, [notify])

  useEffect(() => {
    if (!ownedRunId) return
    if (activeRun) {
      observedActiveRunRef.current = activeRun.runId
      return
    }
    if (!trackedRun || !isTerminalRunState(trackedRun.state)) return
    // 只宣告本次页面实际观察过活动的 run；刷新后直接看到终态时不重复提示。
    if (observedActiveRunRef.current !== trackedRun.runId) return
    if (announcedRunRef.current === trackedRun.runId) return

    observedActiveRunRef.current = null
    announceTerminal(trackedRun)
  }, [activeRun, announceTerminal, ownedRunId, trackedRun])

  // 旧断点只处理一次：快照到手后才能判断它对应哪个 Run。
  useEffect(() => {
    if (checkpointHandledRef.current) return
    if (!execution.snapshot) return
    checkpointHandledRef.current = true

    const result = migrateLegacyFlowCheckpoint({
      storage: storage === undefined
        ? (typeof localStorage === 'undefined' ? null : localStorage)
        : storage,
      snapshot: execution.snapshot,
      trackedRunId: execution.trackedRunId,
    })

    if (result.status === 'adopted' && result.run) {
      controller.observeRun(
        result.run.runId,
        AUTOMATION_FLOW_OPERATION_ID,
        execution.trackedScope ?? AUTOMATION_EXECUTION_SCOPE,
      )
    }
    const notice = legacyCheckpointMessage(result)
    if (notice) {
      if (result.status === 'adopted' && result.run && isTerminalRunState(result.run.state)) {
        notify(notice.message, notice.type, { id: EXECUTION_NOTICE_ID })
      } else {
        notify(notice.message, notice.type)
      }
    }
  }, [controller, execution.snapshot, execution.trackedRunId, execution.trackedScope, notify, storage])

  useEffect(() => {
    if (!activeRun) {
      stepMessageRef.current = null
      return
    }
    if (!progress?.currentTask) return
    const key = `${activeRun.runId}:${progress.currentTaskId ?? progress.currentStep}:${progress.currentTask}`
    if (stepMessageRef.current === key) return
    stepMessageRef.current = key
    notifyProgress(progress.message || `正在执行: ${progress.currentTask}`, EXECUTION_NOTICE_ID)
  }, [activeRun, notify, progress])

  useEffect(() => {
    if (!stopAcknowledged || !isRunning) return
    // 服务端已经进入 stopping 时继续等待终态；只有仍显示 running 或状态未知才解锁。
    if (trackedRun?.state === 'stopping') return

    const timer = window.setTimeout(() => {
      setStopAcknowledged(false)
      notify('终止失败: 终止请求已发送，但尚未确认任务停止', 'error', { id: EXECUTION_NOTICE_ID })
    }, AUTOMATION_STOP_CONFIRM_TIMEOUT_MS)

    return () => window.clearTimeout(timer)
  }, [isRunning, notify, stopAcknowledged, trackedRun?.state])

  const submitFlow = useCallback(async (flow: TaskFlowItem[]) => {
    if (isRunning || controller.getState().submission === 'pending') return false

    notifyProgress('开始执行任务流程...', EXECUTION_NOTICE_ID)
    try {
      const result = await controller.submitExecution(
        AUTOMATION_FLOW_OPERATION_ID,
        ({ idempotencyKey, signal }) => executeScheduleNow('manual', cleanFlow(flow), {
          waitForCompletion: false,
          idempotencyKey,
          signal,
        }),
        { scope: AUTOMATION_EXECUTION_SCOPE },
      )

      if (!result.success) {
        notify(`任务流程执行失败: ${getErrorMessage(result)}`, 'error', { id: EXECUTION_NOTICE_ID })
        return false
      }

      const runId = readSubmittedRunId(result.data)
      const submittedRun = runId ? readSubmittedRun(result.data, runId) : null
      if (runId) observedActiveRunRef.current = runId
      if (submittedRun && isTerminalRunState(submittedRun.state)) announceTerminal(submittedRun)
      if (!runId) {
        // 旧服务端不会返回身份：此时无法观察或停止，不能伪造运行状态。
        notify('服务端未返回运行身份，无法确认本次执行状态', 'warning', { id: EXECUTION_NOTICE_ID })
        return false
      }
      return true
    } catch (error) {
      // 传输失败时服务端可能已经接受执行，不能宣称失败或自动重提。
      notify(`无法确认执行状态: ${readErrorMessage(error)}`, 'warning', { id: EXECUTION_NOTICE_ID })
      return false
    }
  }, [announceTerminal, controller, isRunning, notify])

  const stop = useCallback(async () => {
    if (stopRequestRef.current) return
    const trackedRunId = controller.getState().trackedRunId
    if (!trackedRunId) return

    observedActiveRunRef.current = trackedRunId
    stopRequestRef.current = true
    setStopRequestPending(true)
    notifyProgress('正在终止任务流程...', EXECUTION_NOTICE_ID)

    try {
      const result = await controller.stopTrackedRun()
      if (!result) {
        notify('未找到可终止的任务流程', 'warning', { id: EXECUTION_NOTICE_ID })
        setStopAcknowledged(false)
        return
      }
      if (!result.success) {
        notify(`终止失败: ${getErrorMessage(result)}`, 'error', { id: EXECUTION_NOTICE_ID })
        setStopAcknowledged(false)
        return
      }
      setStopAcknowledged(!result.data?.alreadyTerminal)
    } catch (error) {
      notify(`终止失败: ${readErrorMessage(error)}`, 'error', { id: EXECUTION_NOTICE_ID })
      setStopAcknowledged(false)
    } finally {
      stopRequestRef.current = false
      setStopRequestPending(false)
    }
  }, [controller, notify])

  const isStopping = isRunning
    && (trackedRun?.state === 'stopping' || stopRequestPending || stopAcknowledged)

  return {
    isRunning,
    isStopping,
    isSubmitting,
    run: trackedRun,
    progress,
    summary,
    scheduleSummary,
    submitFlow,
    stop,
  }
}
