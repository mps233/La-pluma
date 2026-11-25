// 更新命令的契约与纯策略：操作类型、跨域失效作用域、core 渠道目标与失败详情读取。
// 命令状态机在 updateCommands.ts，二者分开是为了让模型文件保持单一职责。

import {
  isRecord,
  type ApiResponse,
} from '@/shared/api'
import type { ResourceScope } from '@/features/resource-invalidation'
import { CORE_UPDATE_CHANNEL_LABELS } from '../types'
import type { CoreUpdateChannel } from '../types'
import type { SettingsUpdateRunOperationId, UpdateRunTerminal } from './updateRunPort'

export type UpdateOperation = 'core' | 'core-channel' | 'cli' | 'resources'

/**
 * 组件/资源更新成功后受影响的作用域。
 *
 * core 更新与渠道切换在服务端同时同步资源，因此与“更新资源”一样发布
 * 目录、材料、计划前提与总览；CLI 更新只改变版本，不发布任何资源失效。
 * 不在这里清空缓存，也不发布未受影响的 `depot`/`operbox` 等识别快照。
 */
export const SETTINGS_UPDATE_RESOURCE_SCOPES = [
  'catalog',
  'materials',
  'training-plan',
  'dashboard-snapshot',
] as const satisfies readonly ResourceScope[]

export interface UpdateFeedback {
  readonly type: 'success' | 'error'
  readonly message: string
  /** core/热更新部分失败后，页面显示“重试资源同步”入口。 */
  readonly resourceRetry: boolean
}

export interface SettingsUpdateState {
  readonly running: UpdateOperation | null
  readonly feedback: UpdateFeedback | null
  /** 已提交停止请求，等待目标 run 进入终态。 */
  readonly canceling: boolean
}

export type UpdateCommandStatus = 'succeeded' | 'failed' | 'canceled' | 'ignored'

export interface UpdateCommandOutcome {
  readonly status: UpdateCommandStatus
  readonly operation: UpdateOperation
  /** 页内反馈；CLI 更新为 null（迁移前没有页内反馈）。 */
  readonly feedback: UpdateFeedback | null
  /** 完成后的全局状态提示；`ignored` 为 null。 */
  readonly message: string | null
  /** 只有失败显式指定 error，其余沿用全局状态的消息类型推断。 */
  readonly messageType: 'error' | null
  /** 成功更新了游戏资源，适配层需要发布 `catalog`/`materials` 等失效。 */
  readonly resourcesChanged: boolean
  /** 组件或资源版本可能变化，适配层需要重取 `settings/version`。 */
  readonly versionChanged: boolean
}

export const coreChannelLabel = (
  version: CoreUpdateChannel,
): (typeof CORE_UPDATE_CHANNEL_LABELS)[CoreUpdateChannel] => (
  CORE_UPDATE_CHANNEL_LABELS[version]
)

/** 由已安装版本推断当前渠道；版本读取失败（`null`）时按正式版处理。 */
export const resolveCoreChannel = (currentCore: string | null | undefined): CoreUpdateChannel => {
  if (typeof currentCore !== 'string') return 'stable'
  if (currentCore.includes('alpha')) return 'alpha'
  if (currentCore.includes('beta')) return 'beta'
  return 'stable'
}

export const readUpdateFailureDetails = (
  result: ApiResponse,
): Record<string, unknown> => {
  const details = result.errorInfo?.details
  return isRecord(details) ? details : {}
}

export const shouldRetryUpdateResourcesFromDetails = (
  details: Record<string, unknown>,
): boolean => details.failedStep === 'resources' || details.coreUpdated === true

export const shouldRetryUpdateResources = (result: ApiResponse): boolean => {
  return shouldRetryUpdateResourcesFromDetails(readUpdateFailureDetails(result))
}

/** 命令执行结果；终态映射与反馈构造是纯函数，状态机只负责槽位与提交。 */
export interface UpdateExecution {
  readonly status: 'succeeded' | 'failed' | 'canceled'
  readonly feedback: UpdateFeedback | null
  readonly message: string
  readonly messageType: 'error' | null
  readonly resourcesChanged: boolean
  readonly versionChanged: boolean
}

export interface TerminalFailurePolicy {
  readonly resourceRetry: (details: Record<string, unknown>) => boolean
  readonly showFeedback: boolean
}

export const initialUpdateState = (): SettingsUpdateState => ({
  running: null,
  feedback: null,
  canceling: false,
})

export const succeededExecution = (
  message: string,
  resourcesChanged: boolean,
  versionChanged: boolean,
): UpdateExecution => ({
  status: 'succeeded',
  feedback: resourcesChanged
    ? { type: 'success', message, resourceRetry: false }
    : null,
  message,
  messageType: null,
  resourcesChanged,
  versionChanged,
})

export const failedExecution = (
  message: string,
  resourceRetry: boolean,
  showFeedback = true,
): UpdateExecution => ({
  status: 'failed',
  feedback: showFeedback ? { type: 'error', message, resourceRetry } : null,
  message,
  messageType: 'error',
  resourcesChanged: false,
  versionChanged: false,
})

export const canceledExecution = (): UpdateExecution => ({
  status: 'canceled',
  feedback: null,
  message: '更新已取消',
  messageType: null,
  resourcesChanged: false,
  versionChanged: true,
})

export function terminalExecution(
  terminal: UpdateRunTerminal,
  policy: TerminalFailurePolicy,
): UpdateExecution | null {
  if (terminal.state === 'succeeded') return null
  if (terminal.state === 'stopped') return canceledExecution()

  const message = terminal.state === 'interrupted' || terminal.state === 'unknown'
    ? '无法确认更新结果（服务中断或记录已失效），请重新读取版本'
    : (terminal.message || '更新失败')
  return failedExecution(
    message,
    policy.resourceRetry(terminal.errorDetails),
    policy.showFeedback,
  )
}

/** 控制器持久化身份里的操作名映射到本域命令类型；刷新恢复时只认这三类。 */
export const UPDATE_OPERATION_BY_RUN_OPERATION: Record<SettingsUpdateRunOperationId, UpdateOperation> = {
  update_core: 'core',
  update_cli: 'cli',
  update_resources: 'resources',
}

export const TERMINAL_FAILURE_POLICIES: Record<UpdateOperation, TerminalFailurePolicy> = {
  core: { resourceRetry: shouldRetryUpdateResourcesFromDetails, showFeedback: true },
  'core-channel': { resourceRetry: shouldRetryUpdateResourcesFromDetails, showFeedback: true },
  cli: { resourceRetry: () => false, showFeedback: false },
  resources: { resourceRetry: () => true, showFeedback: true },
}

/** 恢复的 run 看不到提交响应，成功文案与失效范围按操作类型回填。 */
export const RESUMED_SUCCESS_EXECUTIONS: Record<UpdateOperation, UpdateExecution> = {
  core: succeededExecution('MaaCore 和资源已更新', true, true),
  'core-channel': succeededExecution('MaaCore 和资源已更新', true, true),
  cli: succeededExecution('MAA CLI 更新成功', false, true),
  resources: succeededExecution('资源已更新', true, true),
}
