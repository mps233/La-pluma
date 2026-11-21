import { useCallback, useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@/shared/api'
import {
  EXECUTION_NOTICE_ID,
  notifyProgress,
  type Notify,
} from '@/shared/notifications'
import {
  executionController as defaultExecutionController,
  executePredefinedTask,
  isActiveRunState,
  isTerminalRunState,
  readSubmittedRunId,
  useExecutionSnapshot,
  type AgentRun,
  type ExecutionController,
  type StopMode,
  type TaskConfig,
} from '@/features/task-execution'
import { describeRoguelikeTerminalRun, projectRoguelikeStopState } from '../model/executionState'
import { readRoguelikeRunProgress, type RoguelikeCommand } from '../model/runProgress'

export const ROGUELIKE_EXECUTION_SCOPE = 'roguelike'

/** 停止请求成功但 run 长期没有离开 running 时，解锁按钮允许重试。 */
export const ROGUELIKE_STOP_CONFIRM_TIMEOUT_MS = 15_000

const STOP_REQUEST_MESSAGES: Record<StopMode, string> = {
  now: '正在终止肉鸽任务...',
  'after-combat': '正在请求战斗结束后停止...',
}

export interface RoguelikeExecutionRequest {
  command: string
  params: string
  taskConfig: TaskConfig | null
  taskName: string
}

export interface RoguelikeExecution {
  /** 本页发起且仍处于活动状态的 run，或身份已持久化但快照尚未解析出来。 */
  isRunning: boolean
  /** 停止确认中：服务端已进入 stopping，或停止请求在途/已成功且等待终态。 */
  isStopping: boolean
  /** 等待战斗结束后停止：run 仍是 running，右侧按钮进入等待态。 */
  isWaitingForCombat: boolean
  /** 已发出但尚未返回的停止请求模式，用于在对应按钮上显示加载态。 */
  pendingStopMode: StopMode | null
  /** 启动请求在途；按钮保持禁用，重复点击不会产生第二个提交。 */
  isSubmitting: boolean
  /** 本页 owned 的 run（活动或终态），供执行进度面板读取进度与摘要。 */
  trackedRun: AgentRun | null
  /** 本页发起该 run 时记录的任务名；刷新后无法恢复时为 null。 */
  trackedRunLabel: string | null
  /** 服务端最近一次终态 run；不保证属于本页或当前模式。 */
  lastRun: AgentRun | null
  /** 执行快照是否已经到达；用于区分“尚未加载”和“确实没有执行”。 */
  hasSnapshot: boolean
  /** 本页身份已恢复但 run 详情尚未取回；用于避免误报空闲或旧结果。 */
  resolvingIdentity: boolean
  /** 活动 run 的进度模式；只有活动 run 提供进度时才有值。 */
  trackedCommand: RoguelikeCommand | null
  execute: (request: RoguelikeExecutionRequest) => Promise<void>
  stop: (mode?: StopMode) => Promise<void>
}

interface UseRoguelikeExecutionOptions {
  notify: Notify
  controller?: ExecutionController
}

export function useRoguelikeExecution({
  notify,
  controller = defaultExecutionController,
}: UseRoguelikeExecutionOptions): RoguelikeExecution {
  const execution = useExecutionSnapshot(controller)
  const owned = execution.trackedScope === ROGUELIKE_EXECUTION_SCOPE
  const ownedRunId = owned ? execution.trackedRunId : null
  const trackedRun = owned ? execution.trackedRun : null
  const activeRun = trackedRun && isActiveRunState(trackedRun.state) ? trackedRun : null
  const lastRun = execution.snapshot?.lastRun ?? null
  const hasSnapshot = execution.snapshot !== null
  const trackedCommand = activeRun ? readRoguelikeRunProgress(activeRun)?.command ?? null : null
  // 身份已持久化但快照还没返回：保守地按运行中处理，刷新后不能因此重复提交。
  const unresolved = owned && Boolean(ownedRunId) && execution.identity === 'tracked' && !trackedRun
  const isRunning = Boolean(activeRun) || unresolved
  const isSubmitting = execution.submission === 'pending'

  const [pendingStopMode, setPendingStopMode] = useState<StopMode | null>(null)
  const [stopAcknowledged, setStopAcknowledged] = useState(false)
  const [waitAccepted, setWaitAccepted] = useState(false)
  const stopRequestRef = useRef<StopMode | null>(null)
  const lastOwnedRunIdRef = useRef<string | null>(null)
  const observedActiveRunRef = useRef<string | null>(null)
  const announcedRunRef = useRef<string | null>(null)
  const runLabelsRef = useRef(new Map<string, string>())
  const trackedRunLabel = trackedRun
    ? runLabelsRef.current.get(trackedRun.runId) ?? null
    : null

  const isLeaving = trackedRun?.state === 'stopping'
  const { isWaitingForCombat, isStopping } = projectRoguelikeStopState({
    run: trackedRun,
    hasActiveRun: isRunning,
    acceptedWait: waitAccepted,
    requestedMode: pendingStopMode,
    stopAcknowledged,
  })

  // 新 run 身份出现或解除时，停止确认状态属于上一个 run，不能沿用到新一次执行。
  // 用 ref 比较而不是只在依赖变化时重置：Activity 恢复会重新执行全部 Effects。
  useEffect(() => {
    if (lastOwnedRunIdRef.current === ownedRunId) return
    lastOwnedRunIdRef.current = ownedRunId
    setPendingStopMode(null)
    setStopAcknowledged(false)
    setWaitAccepted(false)
    stopRequestRef.current = null
  }, [ownedRunId])

  useEffect(() => {
    if (waitAccepted && (!isRunning || isLeaving)) setWaitAccepted(false)
  }, [isLeaving, isRunning, waitAccepted])

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
    announcedRunRef.current = trackedRun.runId
    const label = runLabelsRef.current.get(trackedRun.runId)
    const terminal = describeRoguelikeTerminalRun(trackedRun, label)
    notify(terminal.message, terminal.type, { id: EXECUTION_NOTICE_ID })
  }, [activeRun, notify, ownedRunId, trackedRun])

  useEffect(() => {
    if (!stopAcknowledged || !isRunning || isWaitingForCombat) return
    // 服务端已经进入 stopping 时继续等待终态；只有仍显示 running 或状态未知才解锁。
    if (trackedRun?.state === 'stopping') return

    const timer = window.setTimeout(() => {
      setStopAcknowledged(false)
      notify('终止失败: 终止请求已发送，但尚未确认任务停止', 'error', { id: EXECUTION_NOTICE_ID })
    }, ROGUELIKE_STOP_CONFIRM_TIMEOUT_MS)

    return () => window.clearTimeout(timer)
  }, [isRunning, isWaitingForCombat, notify, stopAcknowledged, trackedRun?.state])

  const execute = useCallback(async ({ command, params, taskConfig, taskName }: RoguelikeExecutionRequest) => {
    if (isRunning || controller.getState().submission === 'pending') return

    notifyProgress('正在执行命令...', EXECUTION_NOTICE_ID)
    try {
      const result = await controller.submitExecution(
        'run_task',
        ({ idempotencyKey }) => executePredefinedTask(
          command,
          params,
          taskConfig,
          null,
          taskName,
          'roguelike',
          false,
          { idempotencyKey },
        ),
        { scope: ROGUELIKE_EXECUTION_SCOPE },
      )

      if (!result.success) {
        notify(`执行失败: ${getErrorMessage(result)}`, 'error', { id: EXECUTION_NOTICE_ID })
        return
      }

      const runId = readSubmittedRunId(result.data)
      if (runId) {
        runLabelsRef.current.set(runId, taskName)
        observedActiveRunRef.current = runId
      } else {
        notify('服务端未返回运行身份，无法确认本次执行状态', 'warning', { id: EXECUTION_NOTICE_ID })
      }
    } catch (error) {
      // 传输失败时服务端可能已经接受执行，不能宣称失败或自动重提。
      notify(`无法确认执行状态: ${(error as Error).message}`, 'warning', { id: EXECUTION_NOTICE_ID })
    }
  }, [controller, isRunning, notify])

  const stop = useCallback(async (mode: StopMode = 'now') => {
    if (stopRequestRef.current) return
    const trackedRunId = controller.getState().trackedRunId
    if (!trackedRunId) return

    observedActiveRunRef.current = trackedRunId
    stopRequestRef.current = mode
    setPendingStopMode(mode)
    if (mode === 'now') setWaitAccepted(false)
    notifyProgress(STOP_REQUEST_MESSAGES[mode], EXECUTION_NOTICE_ID)

    try {
      const result = await controller.stopTrackedRun({ mode })
      if (!result) {
        notify('未找到可终止的肉鸽运行', 'warning', { id: EXECUTION_NOTICE_ID })
        setStopAcknowledged(false)
        return
      }
      if (!result.success) {
        notify(`终止失败: ${getErrorMessage(result)}`, 'error', { id: EXECUTION_NOTICE_ID })
        setStopAcknowledged(false)
        return
      }
      if (result.data?.pendingStop) {
        setWaitAccepted(true)
        setStopAcknowledged(false)
        notify('已受理，等待战斗结束后终止', 'warning', { id: EXECUTION_NOTICE_ID })
        return
      }
      setStopAcknowledged(!result.data?.alreadyTerminal)
      if (mode === 'after-combat' && !result.data?.alreadyTerminal && !result.data?.alreadyStopping) {
        notify('未在战斗中，已立即终止', 'warning', { id: EXECUTION_NOTICE_ID })
      }
    } catch (error) {
      notify(`终止失败: ${(error as Error).message}`, 'error', { id: EXECUTION_NOTICE_ID })
      setStopAcknowledged(false)
    } finally {
      stopRequestRef.current = null
      setPendingStopMode(null)
    }
  }, [controller, notify])

  return {
    isRunning,
    isStopping,
    isWaitingForCombat,
    pendingStopMode,
    isSubmitting,
    trackedRun,
    trackedRunLabel,
    lastRun,
    hasSnapshot,
    resolvingIdentity: unresolved,
    trackedCommand,
    execute,
    stop,
  }
}
