import { useQueryClient } from '@tanstack/react-query'
import { gameDataKeys } from '@/features/game-data'
import {
  dismissNotice,
  notify,
  notifyProgress,
  STATISTICS_NOTICE_ID,
  type NoticeType,
} from '@/shared/notifications'
import {
  isStatisticsCommandRunning,
  statisticsCommandOwner,
  type StatisticsCommandKind,
  type StatisticsCommandResult,
  type StatisticsRecognitionKind,
  type StatisticsRecognitionSnapshot,
} from '../model/commandOwner'
import { useStatisticsCommandState } from './useStatisticsCommand'
import type { ActiveTask } from '../types'

export interface StatisticsCommands {
  isRunning: boolean
  /** 正在识别仓库/干员时的任务名；其他命令或空闲时为 null。 */
  activeTask: ActiveTask
  activeKind: StatisticsCommandKind | null
  actionLabel: (kind: StatisticsRecognitionKind) => string
  startRecognition: (kind: StatisticsRecognitionKind) => void
  fetchMaterials: () => void
}

export function useStatisticsCommands(): StatisticsCommands {
  const commandState = useStatisticsCommandState()
  const queryClient = useQueryClient()
  const isRunning = isStatisticsCommandRunning(commandState)

  // 解析结果是权威完整快照：先取消该 key 的在途读取，再写入唯一 Query 缓存。
  // 命令所有者会在这之后才发布失效，监听器看到的是刚写入的新快照。
  const applyRecognitionSnapshot = async (snapshot: StatisticsRecognitionSnapshot) => {
    const key = snapshot.kind === 'depot'
      ? gameDataKeys.resource('depot')
      : gameDataKeys.resource('operbox')
    await queryClient.cancelQueries({ queryKey: key })
    queryClient.setQueryData(
      key,
      snapshot.kind === 'depot' ? snapshot.depot : snapshot.operBox,
    )
  }

  const settleNotice = (message: string, type: NoticeType) => {
    if (message) notify(message, type, { id: STATISTICS_NOTICE_ID })
    else dismissNotice(STATISTICS_NOTICE_ID)
  }

  const applyCommandResult = (result: StatisticsCommandResult) => {
    switch (result.status) {
      case 'succeeded':
        settleNotice(result.message, 'success')
        return
      case 'failed':
        settleNotice(result.message, 'error')
        return
      case 'timed-out':
      case 'cancelled':
        settleNotice(result.message, 'warning')
        return
      case 'busy':
      case 'idle':
        notify(result.message)
    }
  }

  const progressOptions = {
    onProgress: (message: string) => notifyProgress(message, STATISTICS_NOTICE_ID),
    applyRecognitionSnapshot,
  }

  const runRecognition = async (kind: StatisticsRecognitionKind) => {
    applyCommandResult(await statisticsCommandOwner.run(kind, progressOptions))
  }

  const continueRecognition = async () => {
    applyCommandResult(await statisticsCommandOwner.resume(progressOptions))
  }

  // 同一命令的超时/取消之后，按钮继续等待或重试确认；不会重新执行设备命令。
  const startRecognition = (kind: StatisticsRecognitionKind) => {
    if (commandState.kind === kind && commandState.resumeMode) {
      void continueRecognition()
      return
    }
    void runRecognition(kind)
  }

  const actionLabel = (kind: StatisticsRecognitionKind) => {
    if (isRunning || commandState.kind !== kind || !commandState.resumeMode) return '立即执行'
    return commandState.resumeMode === 'parse' ? '继续解析' : '重试识别'
  }

  // 材料刷新是统计域持有的脚本命令，不进入 Query，也不读一次目录当作完成条件。
  const fetchMaterials = () => {
    void (async () => {
      applyCommandResult(await statisticsCommandOwner.run('materials', progressOptions))
    })()
  }

  const activeTask: ActiveTask =
    isRunning && (commandState.kind === 'depot' || commandState.kind === 'operbox')
      ? commandState.kind
      : null

  return {
    isRunning,
    activeTask,
    activeKind: commandState.kind,
    actionLabel,
    startRecognition,
    fetchMaterials,
  }
}
