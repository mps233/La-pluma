import { isAbortError, type ApiResponse } from '@/shared/api'
import { cleanupLogs as defaultCleanupLogs } from '../api'
import type { HistoryFilesOutcome } from './historyLogSession'

/** 清理上限：保留最新日志，较旧文件按上限清理。 */
export const LOG_CLEANUP_MAX_SIZE_MB = 10

export type LogCommandOutcome =
  | { readonly status: 'succeeded'; readonly message: string }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'ignored' }

/** 清理历史文件需要协调的列表与选择动作；不包含实时缓冲。 */
export interface HistoryLogCommandPort {
  readonly reloadFiles: () => Promise<HistoryFilesOutcome>
  readonly reconcileSelection: () => boolean
}

type CleanupRequest = (
  maxSizeMB: number,
  signal?: AbortSignal,
) => Promise<ApiResponse<unknown>>

const responseMessage = (response: ApiResponse<unknown>, fallback: string): string => {
  const message = response.message || response.errorInfo?.message || response.error
  return typeof message === 'string' && message.trim() ? message : fallback
}

const caughtMessage = (error: unknown, fallback: string): string => (
  error instanceof Error && error.message ? error.message : fallback
)

/**
 * 清理历史日志文件。
 *
 * 只有在服务端确认清理并成功读取新列表后才裁决当前选择：被删除的选中
 * 文件会退出历史模式，仍存在的文件保持不变。列表读取失败仍视为清理成功
 * （删除已发生），由历史会话展示列表错误并提供重试。取消只结束本地等待，
 * 不再刷新列表或展示失败。
 */
export async function cleanupHistoryLogsCommand(
  history: HistoryLogCommandPort,
  request: CleanupRequest = defaultCleanupLogs,
  signal?: AbortSignal,
): Promise<LogCommandOutcome> {
  if (signal?.aborted) return { status: 'cancelled' }
  try {
    const result = await request(LOG_CLEANUP_MAX_SIZE_MB, signal)
    if (signal?.aborted) return { status: 'cancelled' }
    if (!result.success) {
      return { status: 'failed', message: responseMessage(result, '清理历史日志失败') }
    }

    const filesOutcome = await history.reloadFiles()
    if (filesOutcome === 'ready') history.reconcileSelection()
    return { status: 'succeeded', message: result.message || '历史日志清理完成' }
  } catch (error) {
    if (isAbortError(error)) return { status: 'cancelled' }
    return { status: 'failed', message: caughtMessage(error, '清理历史日志失败') }
  }
}
