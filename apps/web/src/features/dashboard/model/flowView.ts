import type { GlobalRunPhase } from '@/features/task-execution'

export const DASHBOARD_CONNECTION_CHECKING_TITLE = '正在检查服务'
export const DASHBOARD_CONNECTION_CHECKING_DESCRIPTION = '正在确认自动化服务状态'

export interface DashboardFlowViewInput {
  readonly automationAvailable: boolean
  readonly connectionChecking: boolean
  readonly quickStartLoading: boolean
  readonly deviceBusy: boolean
  readonly phase: GlobalRunPhase
  readonly runLabel?: string | null
  readonly runDetail?: string | null
  readonly currentTask?: string | null
  readonly scheduleMessage?: string | null
  readonly observationError?: string | null
}

export interface DashboardFlowView {
  readonly isRunning: boolean
  readonly controlsDisabled: boolean
  readonly commandTitle: string
  readonly commandDescription: string
  readonly primaryActionLabel: '等待继续' | '正在运行' | '执行日常'
}

export function buildDashboardFlowView({
  automationAvailable,
  connectionChecking,
  quickStartLoading,
  deviceBusy,
  phase,
  runLabel,
  runDetail,
  currentTask,
  scheduleMessage,
  observationError,
}: DashboardFlowViewInput): DashboardFlowView {
  const isRunning = phase === 'running' || phase === 'waiting'

  const commandTitle = connectionChecking
    ? DASHBOARD_CONNECTION_CHECKING_TITLE
    : !automationAvailable
      ? '连接不可用'
      : quickStartLoading
        ? '正在启动今日流程'
        : phase === 'waiting'
          ? '等待继续'
          : phase === 'running'
            ? (runLabel || currentTask || '流程执行中')
            : phase === 'occupied'
              ? '设备被其他任务占用'
              : phase === 'unknown'
                ? '执行状态未知'
                : '准备就绪'

  const commandDescription = connectionChecking
    ? DASHBOARD_CONNECTION_CHECKING_DESCRIPTION
    : !automationAvailable
      ? '连接恢复后可以继续操作'
      : quickStartLoading
        ? '正在读取任务配置并提交执行'
        : phase === 'waiting'
          ? '作业集等待下一关，请回到发起页面继续或停止'
          : phase === 'running'
            ? (runDetail || scheduleMessage || '自动化任务正在按计划推进')
            : phase === 'occupied'
              ? '设备被未纳管的执行占用，等待结束后再开始'
              : phase === 'unknown'
                ? (observationError || '暂时无法确认执行状态，恢复连接后会自动刷新')
                : (scheduleMessage || '设备待命，可以开始今天的自动化任务')

  return {
    isRunning,
    controlsDisabled: quickStartLoading || deviceBusy || !automationAvailable,
    commandTitle,
    commandDescription,
    primaryActionLabel: phase === 'waiting'
      ? '等待继续'
      : isRunning
        ? '正在运行'
        : '执行日常',
  }
}
