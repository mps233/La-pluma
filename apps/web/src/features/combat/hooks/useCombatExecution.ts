import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getErrorMessage } from '@/shared/api'
import {
  EXECUTION_NOTICE_ID,
  notifyProgress,
  type Notify,
} from '@/shared/notifications'
import {
  executionController as defaultExecutionController,
  executePredefinedTaskArgs,
  isActiveRunState,
  isTerminalRunState,
  readSubmittedRun,
  readSubmittedRunId,
  useExecutionSnapshot,
  type AgentRun,
  type ExecutionController,
  type TerminalRunState,
} from '@/features/task-execution'
import {
  continueCopilotQueue,
  continueCopilotSet,
  executeCopilotQueue,
  executeCopilotSetPlan,
  skipCopilotQueueEntry,
  type CopilotQueueFailurePolicy,
  type CopilotQueueRunEntry,
  type CopilotQueueRunMode,
  type CopilotSetRunMode,
} from '../api'
import type { CopilotRaid } from '../types'
import {
  describeCombatTaskTerminal,
  describeCopilotSetRunTerminal,
  readCopilotSetRunProjection,
  type CopilotSetEntryProjection,
  type CopilotSetRunProjection,
} from '../model/copilotSetRun'
import {
  describeCopilotQueueRunTerminal,
  readCopilotQueueRunProjection,
  type CopilotQueueRunProjection,
} from '../model/copilotQueueRun'

export const COMBAT_EXECUTION_SCOPE = 'combat'

/** 停止请求成功但 run 长期没有离开 running 时，解锁按钮允许重试。 */
export const COMBAT_STOP_CONFIRM_TIMEOUT_MS = 15_000

export interface CombatTaskSubmission {
  command: string
  args: string[]
  taskName: string
  /** 页面对当前单作业展示用的输入摘要，只用于本地提示。 */
  inputSummary?: string
}

export interface CombatSetSubmission {
  setId: string
  /** 服务端模式；页面的 `app`/`cli` 都映射为 `continuous`。 */
  mode: CopilotSetRunMode
  raid: CopilotRaid
  selectedIndexes: number[]
  options: Record<string, unknown>
  taskName: string
}

export interface CombatQueueSubmission {
  queueId: string
  name: string
  mode: CopilotQueueRunMode
  failurePolicy: CopilotQueueFailurePolicy
  entries: CopilotQueueRunEntry[]
  options: Record<string, unknown>
  taskName: string
}

export interface CombatTerminalResult {
  runId: string
  state: TerminalRunState
  message: string
  type: 'success' | 'warning' | 'error'
}

export interface CombatExecution {
  /** 本页发起且仍处于活动的 run（含等待下一关），或身份已持久化但快照尚未解析出来。 */
  isRunning: boolean
  isWaitingForNext: boolean
  /** 按队列策略自动停止期间，不再展示可点击的“开始下一关”。 */
  isAutoStopping: boolean
  /** 停止确认中：服务端已进入 stopping，或停止请求已成功等待终态。 */
  isStopping: boolean
  /** 继续下一关的请求在途；按钮保持禁用，重复点击不会并发提交。 */
  isContinuing: boolean
  isSkipping: boolean
  /** 提交请求在途；按钮保持禁用，重复点击不会产生第二个提交。 */
  isSubmitting: boolean
  /** 本页所属作业集 run 的投影；单作业运行或其它领域 run 时为 null。 */
  setRun: CopilotSetRunProjection | null
  queueRun: CopilotQueueRunProjection | null
  run: AgentRun | null
  /** 本页观察到的最近一次终态结果；新提交开始时清空。 */
  terminalResult: CombatTerminalResult | null
  submitTask: (request: CombatTaskSubmission) => Promise<boolean>
  submitSet: (request: CombatSetSubmission) => Promise<boolean>
  submitQueue: (request: CombatQueueSubmission) => Promise<boolean>
  continueSet: () => Promise<void>
  continueQueue: () => Promise<void>
  skipQueueEntry: () => Promise<void>
  stop: () => Promise<void>
}

interface UseCombatExecutionOptions {
  notify: Notify
  stopOnFailure?: boolean
  controller?: ExecutionController
}

// “已结算”只统计真正执行过并得到结果的条目；服务端会按计划把未选中且此前
// 未通关的条目推导成 skipped 追加在 taskResults 尾部，它们从 run 开始就存在、
// 从未执行，不能当作“最近结算”参与自动停止与等待态提示。
function isSettledEntry(entry: CopilotSetEntryProjection): boolean {
  return entry.status === 'success' || entry.status === 'failed' || entry.status === 'stopped'
}

/** manual 等待态下最近结算的条目：按作业顺序取最后一个，同作业优先失败。 */
function latestSettledEntry(projection: CopilotSetRunProjection): CopilotSetEntryProjection | null {
  const settled = projection.entries.filter(isSettledEntry)
  if (!settled.length) return null
  const lastIndex = Math.max(...settled.map(entry => entry.itemIndex ?? -1))
  const lastEntries = settled.filter(entry => (entry.itemIndex ?? -1) === lastIndex)
  return lastEntries.find(entry => entry.status === 'failed') ?? lastEntries[0] ?? null
}

function describeSettledEntry(entry: CopilotSetEntryProjection, projection: CopilotSetRunProjection) {
  const position = entry.itemIndex === null
    ? '作业'
    : `作业 ${entry.itemIndex + 1}/${Math.max(projection.itemCount, 1)}`
  if (entry.status === 'failed') {
    return `${position} 执行失败: ${entry.error || '未知错误'}`
  }
  if (entry.status === 'stopped') {
    return `${position} 已终止`
  }
  return `${position} 完成`
}

export function useCombatExecution({
  notify,
  stopOnFailure = false,
  controller = defaultExecutionController,
}: UseCombatExecutionOptions): CombatExecution {
  const execution = useExecutionSnapshot(controller)
  const owned = execution.trackedScope === COMBAT_EXECUTION_SCOPE
  const ownedRunId = owned ? execution.trackedRunId : null
  const trackedRun = owned ? execution.trackedRun : null
  const activeRun = trackedRun && isActiveRunState(trackedRun.state) ? trackedRun : null
  // 身份已持久化但快照还没返回：保守地按运行中处理，刷新后不能因此重复提交。
  const unresolved = owned && Boolean(ownedRunId) && execution.identity === 'tracked' && !trackedRun
  const isRunning = Boolean(activeRun) || unresolved
  // 投影每次渲染都会新建对象；缓存到 trackedRun 变化为止，避免三个 Effect
  // 因同一份服务端快照的引用变化而重复执行。
  const setRun = useMemo(() => readCopilotSetRunProjection(trackedRun), [trackedRun])
  const queueRun = useMemo(() => readCopilotQueueRunProjection(trackedRun), [trackedRun])
  const isWaitingForNext = Boolean(setRun?.isWaiting)
  const isSubmitting = execution.submission === 'pending'

  const [stopRequestPending, setStopRequestPending] = useState(false)
  const [stopAcknowledged, setStopAcknowledged] = useState(false)
  const [isContinuing, setIsContinuing] = useState(false)
  const [isSkipping, setIsSkipping] = useState(false)
  const [terminalResult, setTerminalResult] = useState<CombatTerminalResult | null>(null)
  const [autoStoppingRunId, setAutoStoppingRunId] = useState<string | null>(null)
  const stopRequestRef = useRef(false)
  const continuingRef = useRef(false)
  const skippingRef = useRef(false)
  const autoStopRef = useRef<string | null>(null)
  const lastOwnedRunIdRef = useRef<string | null>(null)
  const observedActiveRunRef = useRef<string | null>(null)
  const announcedRunRef = useRef<string | null>(null)
  const itemMessageRef = useRef<string | null>(null)
  const queueItemMessageRef = useRef<string | null>(null)
  const waitingMessageRef = useRef<string | null>(null)
  const runLabelsRef = useRef(new Map<string, string>())

  // 新 run 身份出现或解除时，停止/继续/自动停止状态属于上一个 run，不能沿用到新一次执行。
  // 用 ref 比较而不是只在依赖变化时重置：Activity 恢复会重新执行全部 Effects。
  useEffect(() => {
    if (lastOwnedRunIdRef.current === ownedRunId) return
    lastOwnedRunIdRef.current = ownedRunId
    setStopRequestPending(false)
    setStopAcknowledged(false)
    setAutoStoppingRunId(null)
    stopRequestRef.current = false
    continuingRef.current = false
    skippingRef.current = false
    autoStopRef.current = null
    queueItemMessageRef.current = null
  }, [ownedRunId])

  const announceTerminal = useCallback((run: AgentRun) => {
    if (!isTerminalRunState(run.state)) return
    announcedRunRef.current = run.runId
    const queueProjection = readCopilotQueueRunProjection(run)
    let notice = queueProjection ? describeCopilotQueueRunTerminal(run, queueProjection) : null
    if (!notice) {
      const projection = readCopilotSetRunProjection(run)
      notice = projection
        ? describeCopilotSetRunTerminal(run, projection)
        : describeCombatTaskTerminal(run, runLabelsRef.current.get(run.runId))
    }
    setTerminalResult({
      runId: run.runId,
      state: run.state,
      message: notice.message,
      type: notice.type,
    })
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

  useEffect(() => {
    if (!setRun?.isActive || setRun.currentItemIndex === null) return
    const key = `${setRun.runId}:${setRun.currentItemIndex}`
    if (itemMessageRef.current === key) return
    itemMessageRef.current = key
    const entry = setRun.entries.find(item => item.status === 'running')
    const stage = entry?.stage ? `: ${entry.stage}` : ''
    notifyProgress(`正在执行作业 ${setRun.currentItemIndex + 1}/${Math.max(setRun.itemCount, 1)}${stage}`, EXECUTION_NOTICE_ID)
  }, [notify, setRun])

  useEffect(() => {
    if (queueRun?.state !== 'running' || !queueRun.currentClientId) return
    const key = `${queueRun.runId}:${queueRun.currentClientId}`
    if (queueItemMessageRef.current === key) return
    queueItemMessageRef.current = key
    const entry = queueRun.taskResults.find(item => item.clientId === queueRun.currentClientId)
    const stage = entry?.stage ? `: ${entry.stage}` : ''
    const position = queueRun.currentItemIndex ?? 0
    notifyProgress(`正在执行队列第 ${position + 1}/${Math.max(queueRun.totalCount, 1)} 项${stage}`, EXECUTION_NOTICE_ID)
  }, [notify, queueRun])

  const stop = useCallback(async () => {
    if (stopRequestRef.current) return
    const trackedRunId = controller.getState().trackedRunId
    if (!trackedRunId) return

    observedActiveRunRef.current = trackedRunId
    stopRequestRef.current = true
    setStopRequestPending(true)
    notifyProgress('正在终止自动战斗...', EXECUTION_NOTICE_ID)

    try {
      const result = await controller.stopTrackedRun()
      if (!result) {
        notify('未找到可终止的自动战斗运行', 'warning', { id: EXECUTION_NOTICE_ID })
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
      notify(`终止失败: ${(error as Error).message}`, 'error', { id: EXECUTION_NOTICE_ID })
      setStopAcknowledged(false)
    } finally {
      stopRequestRef.current = false
      setStopRequestPending(false)
    }
  }, [controller, notify])

  useEffect(() => {
    if (!stopAcknowledged || !isRunning) return
    // 服务端已经进入 stopping 时继续等待终态；只有仍显示 running 或状态未知才解锁。
    if (trackedRun?.state === 'stopping') return

    const timer = window.setTimeout(() => {
      setStopAcknowledged(false)
      notify('终止失败: 终止请求已发送，但尚未确认任务停止', 'error', { id: EXECUTION_NOTICE_ID })
    }, COMBAT_STOP_CONFIRM_TIMEOUT_MS)

    return () => window.clearTimeout(timer)
  }, [isRunning, notify, stopAcknowledged, trackedRun?.state])

  // manual 作业集在“失败后停止”策略下结束等待态；继续请求在途时不介入，避免停掉刚启动的下一关。
  useEffect(() => {
    if (!stopOnFailure || !setRun?.isWaiting) {
      if (autoStoppingRunId) setAutoStoppingRunId(null)
      return
    }
    if (continuingRef.current || stopRequestRef.current) return

    const failed = latestSettledEntry(setRun)
    if (!failed || failed.status !== 'failed') return
    const key = `${setRun.runId}:${failed.key ?? failed.itemIndex}`
    if (autoStopRef.current === key) return

    autoStopRef.current = key
    setAutoStoppingRunId(setRun.runId)
    notify(`${describeSettledEntry(failed, setRun)}，已按队列策略停止`, 'error')
    void stop()
  }, [autoStoppingRunId, notify, setRun, stop, stopOnFailure])

  // manual 等待态提示与“下一项”说明只描述服务端事实。
  useEffect(() => {
    if (!setRun?.isWaiting) {
      waitingMessageRef.current = null
      return
    }
    const settled = latestSettledEntry(setRun)
    if (!settled) return
    // 失败后停止策略会紧接着结束 run，不再提示“等待开始下一关”。
    if (stopOnFailure && settled.status === 'failed') return
    const key = `${setRun.runId}:${settled.key ?? settled.itemIndex}:${settled.status}`
    if (waitingMessageRef.current === key) return
    waitingMessageRef.current = key
    notifyProgress(`${describeSettledEntry(settled, setRun)}，等待开始下一关`, EXECUTION_NOTICE_ID)
  }, [notify, setRun, stopOnFailure])

  const submitTask = useCallback(async ({ command, args, taskName }: CombatTaskSubmission) => {
    if (isRunning || controller.getState().submission === 'pending') return false

    setTerminalResult(null)
    notifyProgress(`正在执行: ${taskName}`, EXECUTION_NOTICE_ID)
    try {
      const result = await controller.submitExecution(
        'run_task',
        ({ idempotencyKey }) => executePredefinedTaskArgs(
          command,
          args,
          null,
          null,
          taskName,
          'combat',
          false,
          { idempotencyKey },
        ),
        { scope: COMBAT_EXECUTION_SCOPE },
      )

      if (!result.success) {
        notify(`执行失败: ${getErrorMessage(result)}`, 'error', { id: EXECUTION_NOTICE_ID })
        return false
      }

      const runId = readSubmittedRunId(result.data)
      if (runId) {
        runLabelsRef.current.set(runId, taskName)
        observedActiveRunRef.current = runId
      } else {
        notify('服务端未返回运行身份，无法确认本次执行状态', 'warning', { id: EXECUTION_NOTICE_ID })
        return false
      }
      const submittedRun = readSubmittedRun(result.data, runId)
      if (submittedRun && isTerminalRunState(submittedRun.state)) announceTerminal(submittedRun)
      return true
    } catch (error) {
      // 传输失败时服务端可能已经接受执行，不能宣称失败或自动重提。
      notify(`无法确认执行状态: ${(error as Error).message}`, 'warning', { id: EXECUTION_NOTICE_ID })
      return false
    }
  }, [announceTerminal, controller, isRunning, notify])

  const submitSet = useCallback(async (request: CombatSetSubmission) => {
    if (isRunning || controller.getState().submission === 'pending') return false
    if (!request.selectedIndexes.length) {
      notify('请至少选择一个作业', 'warning')
      return false
    }

    setTerminalResult(null)
    notifyProgress(request.mode === 'manual' ? '正在执行作业集（手动逐关）' : '正在连续执行作业集', EXECUTION_NOTICE_ID)
    try {
      const result = await controller.submitExecution(
        'run_copilot_set',
        ({ idempotencyKey }) => executeCopilotSetPlan(request.setId, {
          raid: request.raid,
          selectedIndexes: request.selectedIndexes,
          options: request.options,
          mode: request.mode,
          waitForCompletion: false,
        }, { idempotencyKey }),
        { scope: COMBAT_EXECUTION_SCOPE },
      )

      if (!result.success) {
        notify(`作业集执行失败: ${getErrorMessage(result)}`, 'error', { id: EXECUTION_NOTICE_ID })
        return false
      }

      const runId = readSubmittedRunId(result.data)
      if (runId) {
        runLabelsRef.current.set(runId, request.taskName)
        observedActiveRunRef.current = runId
      } else {
        notify('服务端未返回运行身份，无法确认本次执行状态', 'warning', { id: EXECUTION_NOTICE_ID })
        return false
      }
      const submittedRun = readSubmittedRun(result.data, runId)
      if (submittedRun && isTerminalRunState(submittedRun.state)) announceTerminal(submittedRun)
      return true
    } catch (error) {
      notify(`无法确认作业集执行状态: ${(error as Error).message}`, 'warning', { id: EXECUTION_NOTICE_ID })
      return false
    }
  }, [announceTerminal, controller, isRunning, notify])

  const submitQueue = useCallback(async (request: CombatQueueSubmission) => {
    if (isRunning || controller.getState().submission === 'pending') return false
    if (!request.entries.length) {
      notify('请至少选择一个作业', 'warning')
      return false
    }

    setTerminalResult(null)
    notifyProgress(request.mode === 'manual' ? '正在执行作业队列（手动逐项）' : '正在连续执行作业队列', EXECUTION_NOTICE_ID)
    try {
      const result = await controller.submitExecution(
        'run_copilot_queue',
        ({ idempotencyKey }) => executeCopilotQueue({
          queueId: request.queueId,
          name: request.name,
          mode: request.mode,
          failurePolicy: request.failurePolicy,
          entries: request.entries,
          options: request.options,
          waitForCompletion: false,
        }, { idempotencyKey }),
        { scope: COMBAT_EXECUTION_SCOPE },
      )

      if (!result.success) {
        notify(`队列执行失败: ${getErrorMessage(result)}`, 'error', { id: EXECUTION_NOTICE_ID })
        return false
      }

      const runId = readSubmittedRunId(result.data)
      if (runId) {
        runLabelsRef.current.set(runId, request.taskName)
        observedActiveRunRef.current = runId
      } else {
        notify('服务端未返回运行身份，无法确认本次执行状态', 'warning', { id: EXECUTION_NOTICE_ID })
        return false
      }
      const submittedRun = readSubmittedRun(result.data, runId)
      if (submittedRun && isTerminalRunState(submittedRun.state)) announceTerminal(submittedRun)
      return true
    } catch (error) {
      notify(`无法确认队列执行状态: ${(error as Error).message}`, 'warning', { id: EXECUTION_NOTICE_ID })
      return false
    }
  }, [announceTerminal, controller, isRunning, notify])

  const continueSet = useCallback(async () => {
    if (continuingRef.current) return
    const state = controller.getState()
    if (state.trackedScope !== COMBAT_EXECUTION_SCOPE || !state.trackedRunId) return

    observedActiveRunRef.current = state.trackedRunId
    continuingRef.current = true
    setIsContinuing(true)
    notifyProgress('正在执行下一关...', EXECUTION_NOTICE_ID)

    try {
      const result = await continueCopilotSet(state.trackedRunId, { waitForCompletion: false })
      if (!result.success) {
        const code = result.errorInfo?.code
        if (code === 'MAA_EXECUTION_BUSY') {
          notify('设备正被其他任务占用，请稍后重试', 'warning', { id: EXECUTION_NOTICE_ID })
        } else if (code === 'AGENT_COPILOT_SET_SESSION_LOST') {
          notify('作业集会话已失效，无法继续下一关，请重新提交作业集', 'error', { id: EXECUTION_NOTICE_ID })
        } else if (code === 'AGENT_COPILOT_SET_NOT_WAITING') {
          notify('作业集已不在等待下一关状态，正在重新确认', 'warning', { id: EXECUTION_NOTICE_ID })
        } else {
          notify(`继续执行失败: ${getErrorMessage(result)}`, 'error', { id: EXECUTION_NOTICE_ID })
        }
        await controller.refresh('manual')
        return
      }

      if (result.data?.alreadyTerminal) {
        notify('作业集已经结束', 'warning', { id: EXECUTION_NOTICE_ID })
      }
      await controller.refresh('manual')
    } catch (error) {
      notify(`无法确认下一关状态: ${(error as Error).message}`, 'warning', { id: EXECUTION_NOTICE_ID })
    } finally {
      continuingRef.current = false
      setIsContinuing(false)
    }
  }, [controller, notify])

  const continueQueue = useCallback(async () => {
    if (continuingRef.current) return
    const state = controller.getState()
    if (state.trackedScope !== COMBAT_EXECUTION_SCOPE || !state.trackedRunId) return

    observedActiveRunRef.current = state.trackedRunId
    continuingRef.current = true
    setIsContinuing(true)
    notifyProgress('正在执行下一项...', EXECUTION_NOTICE_ID)

    try {
      const result = await continueCopilotQueue(state.trackedRunId, false)
      if (!result.success) {
        const code = result.errorInfo?.code
        if (code === 'MAA_EXECUTION_BUSY') {
          notify('设备正被其他任务占用，请稍后重试', 'warning', { id: EXECUTION_NOTICE_ID })
        } else if (code === 'AGENT_COPILOT_QUEUE_SESSION_LOST') {
          notify('队列会话已失效，无法继续下一项，请重新提交队列', 'error', { id: EXECUTION_NOTICE_ID })
        } else if (code === 'AGENT_COPILOT_QUEUE_NOT_WAITING') {
          notify('队列已不在等待下一项状态，正在重新确认', 'warning', { id: EXECUTION_NOTICE_ID })
        } else {
          notify(`继续执行失败: ${getErrorMessage(result)}`, 'error', { id: EXECUTION_NOTICE_ID })
        }
        await controller.refresh('manual')
        return
      }

      if (result.data?.alreadyTerminal) {
        notify('队列已经结束', 'warning', { id: EXECUTION_NOTICE_ID })
      }
      await controller.refresh('manual')
    } catch (error) {
      notify(`无法确认下一项状态: ${(error as Error).message}`, 'warning', { id: EXECUTION_NOTICE_ID })
    } finally {
      continuingRef.current = false
      setIsContinuing(false)
    }
  }, [controller, notify])

  const skipQueueEntry = useCallback(async () => {
    if (skippingRef.current) return
    const state = controller.getState()
    if (state.trackedScope !== COMBAT_EXECUTION_SCOPE || !state.trackedRunId) return

    observedActiveRunRef.current = state.trackedRunId
    skippingRef.current = true
    setIsSkipping(true)
    notifyProgress('正在跳过当前项...', EXECUTION_NOTICE_ID)

    try {
      const result = await skipCopilotQueueEntry(state.trackedRunId)
      if (!result.success) {
        const code = result.errorInfo?.code
        if (code === 'AGENT_COPILOT_QUEUE_NOT_WAITING') {
          notify('队列已不在等待下一项状态，正在重新确认', 'warning', { id: EXECUTION_NOTICE_ID })
        } else if (code === 'AGENT_COPILOT_QUEUE_SESSION_LOST') {
          notify('队列会话已失效，无法跳过当前项，请重新提交队列', 'error', { id: EXECUTION_NOTICE_ID })
        } else {
          notify(`跳过失败: ${getErrorMessage(result)}`, 'error', { id: EXECUTION_NOTICE_ID })
        }
        await controller.refresh('manual')
        return
      }

      notify(
        result.data?.finished ? '已跳过当前项，队列执行结束' : '已跳过当前项',
        'success',
        { id: EXECUTION_NOTICE_ID },
      )
      await controller.refresh('manual')
    } catch (error) {
      notify(`无法确认跳过结果: ${(error as Error).message}`, 'warning', { id: EXECUTION_NOTICE_ID })
    } finally {
      skippingRef.current = false
      setIsSkipping(false)
    }
  }, [controller, notify])

  const isStopping = isRunning
    && (trackedRun?.state === 'stopping' || stopRequestPending || stopAcknowledged)

  return {
    isRunning,
    isWaitingForNext,
    isAutoStopping: Boolean(setRun) && autoStoppingRunId === setRun?.runId,
    isStopping,
    isContinuing,
    isSkipping,
    isSubmitting,
    setRun,
    queueRun,
    run: trackedRun,
    terminalResult,
    submitTask,
    submitSet,
    submitQueue,
    continueSet,
    continueQueue,
    skipQueueEntry,
    stop,
  }
}
