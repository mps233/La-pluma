import type { NoticeType } from '@/shared/notifications'
import type { AgentRun, StopMode } from '@/features/task-execution'

export interface RoguelikeStopProjection {
  /** 等待战斗结束后停止：run 仍是 running，右侧按钮进入等待态。 */
  isWaitingForCombat: boolean
  /** 停止确认中：服务端已进入 stopping，或停止请求在途/已受理。等待态不算停止确认。 */
  isStopping: boolean
}

interface RoguelikeStopProjectionInput {
  run: AgentRun | null
  hasActiveRun: boolean
  acceptedWait: boolean
  requestedMode: StopMode | null
  stopAcknowledged: boolean
}

export function projectRoguelikeStopState({
  run,
  hasActiveRun,
  acceptedWait,
  requestedMode,
  stopAcknowledged,
}: RoguelikeStopProjectionInput): RoguelikeStopProjection {
  const leaving = run?.state === 'stopping'
  const isWaitingForCombat = hasActiveRun && !leaving && (Boolean(run?.progress?.stopIntent) || acceptedWait)
  const isStopping = hasActiveRun && !isWaitingForCombat && (leaving || requestedMode !== null || stopAcknowledged)
  return { isWaitingForCombat, isStopping }
}

export function describeRoguelikeTerminalRun(
  run: AgentRun,
  label: string | undefined,
): { message: string; type: NoticeType } {
  if (run.state === 'succeeded') {
    return { message: label ? `${label} 执行成功` : '肉鸽任务执行成功', type: 'success' }
  }
  if (run.state === 'stopped') return { message: '肉鸽任务已终止', type: 'warning' }
  if (run.state === 'failed') {
    return { message: `执行失败: ${run.error?.message || '任务未能完成'}`, type: 'error' }
  }
  return {
    message: `任务已中断: ${run.error?.message || '服务重启后无法确认执行结果'}`,
    type: 'warning',
  }
}
