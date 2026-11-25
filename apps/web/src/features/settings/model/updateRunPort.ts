// 设置域更新命令的 Run 观察端口：提交后采纳服务端 runId，按控制器已持有的
// 快照等待终态，并把停止映射为目标 run 的停止请求。没有 runId 的旧同步响应
// 保持原语义，不伪造执行身份。

import {
  executionController,
  isActiveRunState,
  isTerminalRunState,
  type AgentRun,
  type ExecutionController,
} from '@/features/task-execution'
import { isRecord, type ApiResponse } from '@/shared/api'

export type UpdateRunTerminalState =
  | 'succeeded'
  | 'failed'
  | 'stopped'
  | 'interrupted'
  | 'unknown'

export interface UpdateRunTerminal {
  readonly state: UpdateRunTerminalState
  readonly message: string | null
  readonly errorDetails: Record<string, unknown>
  /** 服务端 Run 终态结果；成功载荷里的领域事实（如 `channelPersisted`）从这里读取。 */
  readonly result: unknown
}

export type SettingsUpdateRunOperationId = 'update_core' | 'update_cli' | 'update_resources'

export const SETTINGS_UPDATE_RUN_OPERATION_IDS: readonly SettingsUpdateRunOperationId[] = [
  'update_core',
  'update_cli',
  'update_resources',
]

export function isSettingsUpdateRunOperationId(
  value: string,
): value is SettingsUpdateRunOperationId {
  return (SETTINGS_UPDATE_RUN_OPERATION_IDS as readonly string[]).includes(value)
}

export interface SettingsUpdateRunIdentity {
  readonly runId: string
  readonly operationId: SettingsUpdateRunOperationId
}

export interface SettingsUpdateRunPort {
  /** 采纳响应中的 runId 并让全局控制器观察它；旧同步响应返回 null。 */
  adopt(response: ApiResponse, operationId: string): string | null
  /** 等待目标 run 进入终态；只由服务端终态或身份失效结算，没有本地时限。 */
  wait(runId: string): Promise<UpdateRunTerminal>
  /** 服务端执行结束或失败后解除本域身份；只解除仍属于该 run 的身份。 */
  release(runId: string): void
  /** 拒绝未知状态时不退化为旧式“停止当前任务”。 */
  cancel(runId: string): Promise<ApiResponse<unknown> | null>
  /** 本域仍持有且未到终态的 run；页面刷新后由控制器恢复。 */
  tracked(): SettingsUpdateRunIdentity | null
  /** 订阅控制器状态变化；恢复刷新后仍在运行的 run。 */
  subscribe(listener: () => void): () => void
}

const SETTINGS_UPDATE_SCOPE = 'settings'

/** 本域只使用控制器的身份采纳、观察与目标停止能力，测试可注入独立实例。 */
export type SettingsUpdateRunController = Pick<
  ExecutionController,
  'adoptSubmission' | 'getState' | 'subscribe' | 'observeRun' | 'stopTrackedRun'
>

const UNKNOWN_TERMINAL: UpdateRunTerminal = {
  state: 'unknown',
  message: null,
  errorDetails: {},
  result: null,
}

function terminalOf(run: AgentRun): UpdateRunTerminal {
  if (!isTerminalRunState(run.state)) return UNKNOWN_TERMINAL
  const message = typeof run.error?.message === 'string' ? run.error.message : null
  const errorDetails = isRecord(run.error?.details) ? run.error.details : {}
  return { state: run.state, message, errorDetails, result: run.result ?? null }
}

export function createSettingsUpdateRunPort(
  controller: SettingsUpdateRunController = executionController,
): SettingsUpdateRunPort {
  return {
    adopt(response, operationId) {
      return controller.adoptSubmission(response, operationId, {
        scope: SETTINGS_UPDATE_SCOPE,
      })
    },

    wait(runId) {
      return new Promise<UpdateRunTerminal>(resolve => {
        let settled = false
        const finish = (terminal: UpdateRunTerminal) => {
          if (settled) return
          settled = true
          unsubscribe()
          resolve(terminal)
        }
        const read = () => {
          const state = controller.getState()
          if (state.trackedRunId !== runId) {
            finish(UNKNOWN_TERMINAL)
            return
          }
          const run = state.trackedRun
          if (run && isTerminalRunState(run.state)) {
            finish(terminalOf(run))
            return
          }
          // 服务端按 id 查不到该 run 时控制器只标记 identity=unknown，仍保留
          // trackedRunId 与最后一次快照；不在这里结算就会一直等下去。
          if (state.identity !== 'tracked') finish(UNKNOWN_TERMINAL)
        }
        const unsubscribe = controller.subscribe(read)
        read()
      })
    },

    release(runId) {
      if (controller.getState().trackedRunId !== runId) return
      controller.observeRun(null)
    },

    async cancel(runId) {
      if (controller.getState().trackedRunId !== runId) return null
      return controller.stopTrackedRun()
    },

    tracked() {
      const state = controller.getState()
      if (state.identity !== 'tracked' || state.trackedScope !== SETTINGS_UPDATE_SCOPE) return null
      const run = state.trackedRun
      if (!run || !isActiveRunState(run.state)) return null
      if (!isSettingsUpdateRunOperationId(run.operationId)) return null
      return { runId: run.runId, operationId: run.operationId }
    },

    subscribe(listener) {
      return controller.subscribe(listener)
    },
  }
}
