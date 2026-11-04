import { useEffect } from 'react'
import { maaApi } from '../services/api'
import { useRunStore } from '../store/runStore'
import { useStatusStore } from '../store/statusStore'
import {
  IDLE_RUN_STATUS,
  isActiveRunState,
  type AgentRun,
  type CurrentRunSnapshot,
  type GlobalRunStatus,
} from '../types/run'

const ACTIVE_RUN_POLL_MS = 2_000
const IDLE_RUN_POLL_MS = 10_000
const HIDDEN_RUN_POLL_MS = 10_000

interface LegacyTaskSnapshot {
  isRunning?: boolean
  taskName?: string | null
  currentStage?: string | null
  currentTask?: string | null
}

/**
 * 把服务端 Run 投影成全局可读状态。
 * Run 是运行身份和终态的唯一来源；只有活动状态才产生忙状态。
 */
export function runToGlobalStatus(run: AgentRun | null): GlobalRunStatus {
  if (!run || !isActiveRunState(run.state)) return IDLE_RUN_STATUS

  const message = typeof run.progress?.message === 'string' ? run.progress.message.trim() : ''
  const task = typeof run.progress?.currentTask === 'string' ? run.progress.currentTask.trim() : ''
  const specificMessage = message && message !== '任务执行中' ? message : ''
  const labelText = specificMessage || task
  const label = run.state === 'stopping'
    ? '正在停止'
    : run.state === 'waiting'
      ? (labelText || '等待继续下一关')
      : run.state === 'accepted'
        ? (labelText || '等待执行')
        : labelText
        ? (labelText.startsWith('正在') ? labelText : `正在执行: ${labelText}`)
        : '任务执行中'

  return {
    phase: run.state === 'stopping' ? 'stopping' : 'running',
    isRunning: true,
    runId: run.runId,
    label,
    detail: specificMessage || null,
  }
}

/**
 * 应用级 Run 观察器。
 *
 * 只负责把 /runs/current 的 Run 快照投影到 statusStore.runStatus，
 * 不提交、不停止，也不把请求失败解释成完成。页面和 FloatingStatusIndicator
 * 都消费同一份投影，因此切换页面、刷新或从其它页面启动的任务仍可见。
 */
export function useRunStatusMonitor() {
  useEffect(() => {
    let disposed = false
    let timer: number | null = null
    let controller: AbortController | null = null
    let inFlight = false
    let lastActive = false

    const clearTimer = () => {
      if (timer === null) return
      window.clearTimeout(timer)
      timer = null
    }

    const schedule = (delay: number) => {
      if (disposed) return
      clearTimer()
      timer = window.setTimeout(() => void request(), delay)
    }

    const request = async () => {
      if (disposed || inFlight) return
      if (typeof document !== 'undefined' && document.hidden) {
        schedule(HIDDEN_RUN_POLL_MS)
        return
      }

      inFlight = true
      const requestController = new AbortController()
      controller = requestController

      try {
        const result = await maaApi.getCurrentRun(requestController.signal)
        if (disposed) return
        if (!result.success) throw new Error(result.message || '获取运行状态失败')

        const snapshot = result.data as (CurrentRunSnapshot & LegacyTaskSnapshot) | undefined
        useRunStore.getState().applyRun(snapshot?.run ?? null)
        const runStatus = runToGlobalStatus(snapshot?.run ?? null)
        const legacyStatus = runStatus.phase === 'idle' && snapshot?.isRunning === true
          ? {
              phase: 'running' as const,
              isRunning: true,
              runId: null,
              label: (() => {
                const legacyTask = snapshot.currentStage || snapshot.currentTask || snapshot.taskName || ''
                return legacyTask ? `正在执行: ${legacyTask}` : '任务执行中'
              })(),
              detail: snapshot.currentStage || null,
            }
          : runStatus

        useStatusStore.getState().applyRunStatus(legacyStatus)
        lastActive = legacyStatus.isRunning
      } catch (error) {
        if (disposed || (error instanceof Error && error.name === 'AbortError')) return
        const previous = useStatusStore.getState().runStatus
        if (previous.isRunning) {
          useStatusStore.getState().applyRunStatus({
            ...previous,
            phase: 'unknown',
            label: '执行状态未知',
            detail: null,
          })
        }
        lastActive = previous.isRunning
      } finally {
        if (!disposed) {
          inFlight = false
          controller = null
          schedule(lastActive ? ACTIVE_RUN_POLL_MS : IDLE_RUN_POLL_MS)
        }
      }
    }

    const handleVisibilityChange = () => {
      clearTimer()
      if (typeof document !== 'undefined' && document.hidden) {
        schedule(HIDDEN_RUN_POLL_MS)
        return
      }
      void request()
    }

    const handleOnline = () => {
      clearTimer()
      void request()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('online', handleOnline)
    void request()

    return () => {
      disposed = true
      clearTimer()
      controller?.abort()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('online', handleOnline)
      useStatusStore.getState().applyRunStatus(IDLE_RUN_STATUS)
      useRunStore.getState().applyRun(null)
    }
  }, [])
}
