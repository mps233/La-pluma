// 实时日志按固定节奏整体重读（接口只返回最近 N 行、无 cursor/offset），内容未变时
// 保留引用并跳过提交；同一时刻最多一个在途请求，已中止/被取代/隐藏期间返回的旧响应
// 一律丢弃。页面与文档可见性分别驱动 start/stop 与 setDocumentVisible，暂停不被覆盖。

import { isAbortError, type ApiResponse } from '@/shared/api'
import { getRealtimeLogs } from '../api'
import { getLogIdentity, parseRealtimeLog } from './logModel'
import type { LogEntry } from '../types'

/** 实时快照请求行数；服务端把 lines 限制在 1–500。 */
export const REALTIME_LOG_LINES = 200
/** 实时轮询间隔；与迁移前的页面计时器一致。 */
export const REALTIME_LOG_INTERVAL_MS = 1250

export type RealtimeLogReader = (
  lines: number,
  signal?: AbortSignal,
) => Promise<ApiResponse<unknown>>

export interface RealtimeLogStreamOptions {
  readonly read?: RealtimeLogReader
  readonly lines?: number
  readonly intervalMs?: number
}

export interface RealtimeLogStreamState {
  readonly logs: readonly LogEntry[]
  readonly error: string | null
  readonly paused: boolean
  /** 首次读取完成前为 false；失败也视为已完成，错误单独展示。 */
  readonly hasLoaded: boolean
  /** 已观察快照之间失去连续性；不是完整 Run 归档。 */
  readonly coverageNotice: string | null
}

interface ActiveRequest {
  readonly controller: AbortController
}

const initialRequestFailure = '实时日志请求失败'
const initialReadFailure = '暂时无法获取实时日志'

const readFailureMessage = (response: ApiResponse<unknown>): string => (
  response.message
  || response.errorInfo?.message
  || response.error
  || initialRequestFailure
)

const catchFailureMessage = (error: unknown): string => (
  error instanceof Error && error.message ? error.message : initialReadFailure
)

const areLogsEqual = (
  previous: readonly LogEntry[],
  next: readonly LogEntry[],
): boolean => (
  previous.length === next.length
  && previous.every((log, index) => {
    const candidate = next[index]
    return candidate !== undefined && JSON.stringify(log) === JSON.stringify(candidate)
  })
)

function hasSnapshotGap(previous: readonly LogEntry[], next: readonly LogEntry[]): boolean {
  const last = previous[previous.length - 1]
  const first = next[0]
  if (!last?.id || !first?.id) return false
  if (next.some(record => record.id === last.id)) return false
  const previousSequence = last.envelope?.sequence
  const nextSequence = first.envelope?.sequence
  const previousSource = last.id.slice(0, last.id.lastIndexOf(':'))
  const nextSource = first.id.slice(0, first.id.lastIndexOf(':'))
  if (previousSource !== nextSource) return true
  return typeof previousSequence === 'number' && typeof nextSequence === 'number'
    ? nextSequence > previousSequence + 1
    : true
}

export class RealtimeLogStream {
  private readonly read: RealtimeLogReader
  private readonly lines: number
  private readonly intervalMs: number

  private state: RealtimeLogStreamState = {
    logs: [],
    error: null,
    paused: false,
    hasLoaded: false,
    coverageNotice: null,
  }
  private latestSnapshot: readonly LogEntry[] = []
  private coverageSnapshot: readonly LogEntry[] = []
  private clearedIdentities = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private active: ActiveRequest | null = null
  private started = false
  private documentVisible = true

  constructor(options: RealtimeLogStreamOptions = {}) {
    this.read = options.read ?? getRealtimeLogs
    this.lines = options.lines ?? REALTIME_LOG_LINES
    this.intervalMs = options.intervalMs ?? REALTIME_LOG_INTERVAL_MS
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState = (): RealtimeLogStreamState => this.state

  /** 页面可见：启动计时器并立即重读；重复调用不会叠加计时器。 */
  start(): void {
    this.started = true
    if (this.timer === null) {
      this.timer = setInterval(() => this.fetchIfAllowed(), this.intervalMs)
    }
    this.fetchIfAllowed()
  }

  /** 页面隐藏或卸载：停止轮询并取消在途请求，保留已显示缓冲。 */
  stop(): void {
    this.started = false
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.abortActive()
  }

  /**
   * 浏览器文档可见性。隐藏时取消在途请求；可见时立即重读。
   * 计时器在隐藏期间保留，但 `fetchIfAllowed` 的可见性守卫会跳过发送。
   */
  setDocumentVisible(visible: boolean): void {
    if (this.documentVisible === visible) return
    this.documentVisible = visible
    if (!visible) {
      this.abortActive()
      return
    }
    this.fetchIfAllowed()
  }

  /** 手动暂停：取消在途请求并停止发送；暂停状态不被可见性变化清除。 */
  pause(): void {
    if (this.state.paused) return
    this.abortActive()
    this.setState({ ...this.state, paused: true })
  }

  /** 手动恢复：立即重读一次，之后继续按间隔轮询。 */
  resume(): void {
    if (!this.state.paused) return
    this.setState({ ...this.state, paused: false })
    this.fetchIfAllowed()
  }

  /** 错误重试入口；已有在途请求时保持单在途语义，不抢占。 */
  refresh(): void {
    this.fetchIfAllowed()
  }

  /** 本地清屏：记住当前快照边界，后续轮询不重新显示已清除的记录。 */
  clear(): void {
    this.clearedIdentities = new Set(this.latestSnapshot.map(getLogIdentity))
    if (this.state.logs.length === 0 && this.state.error === null) return
    this.setState({ ...this.state, logs: [], error: null })
  }

  /** 进入另一来源时丢弃实时观察会话；返回实时从当前窗口重新开始。 */
  reset(): void {
    this.abortActive()
    this.latestSnapshot = []
    this.coverageSnapshot = []
    this.clearedIdentities.clear()
    this.setState({ ...this.state, logs: [], error: null, hasLoaded: false, coverageNotice: null })
  }

  private setState(next: RealtimeLogStreamState): void {
    this.state = next
    this.listeners.forEach(listener => listener())
  }

  private fetchIfAllowed(): void {
    if (!this.started || !this.documentVisible || this.state.paused || this.active) return

    const request: ActiveRequest = { controller: new AbortController() }
    this.active = request
    void this.read(this.lines, request.controller.signal).then(
      response => this.commit(request, response),
      error => this.fail(request, error),
    )
  }

  private isCurrent(request: ActiveRequest): boolean {
    return this.active === request && !request.controller.signal.aborted
  }

  private commit(request: ActiveRequest, response: ApiResponse<unknown>): void {
    if (!this.isCurrent(request)) return
    this.active = null

    if (!response.success) {
      const error = readFailureMessage(response)
      if (this.state.error === error && this.state.hasLoaded) return
      this.setState({ ...this.state, error, hasLoaded: true })
      return
    }

    if (!Array.isArray(response.data)) {
      if (this.state.error === '实时日志响应格式无效' && this.state.hasLoaded) return
      this.setState({ ...this.state, error: '实时日志响应格式无效', hasLoaded: true })
      return
    }
    const values: unknown[] = response.data
    const snapshot = values.map(parseRealtimeLog)
    const lostContinuity = hasSnapshotGap(this.coverageSnapshot, snapshot)
    const coverageNotice = lostContinuity
      ? '实时日志窗口已失去连续性，期间可能有未加载的记录；当前内容不代表完整执行日志。'
      : this.state.coverageNotice
    this.latestSnapshot = snapshot
    if (snapshot.length > 0) this.coverageSnapshot = snapshot
    const currentIds = new Set(snapshot.map(getLogIdentity))
    this.clearedIdentities = new Set([...this.clearedIdentities].filter(id => currentIds.has(id)))
    const logs = snapshot.filter(log => !this.clearedIdentities.has(getLogIdentity(log)))
    if (
      this.state.hasLoaded
      && areLogsEqual(this.state.logs, logs)
      && coverageNotice === this.state.coverageNotice
    ) {
      // 内容未变时保留既有行数组引用并跳过提交：消费方（useSyncExternalStore、
      // 滚动 Effect）靠引用与内容指纹区分「内容变化」与「仅轮询到达」，短路后
      // 相同快照不再触发重渲染与全量重建。有错误待清除时仍需提交一次。
      if (this.state.error === null) return
      this.setState({ ...this.state, error: null })
      return
    }
    this.setState({
      ...this.state,
      logs,
      error: null,
      hasLoaded: true,
      coverageNotice,
    })
  }

  private fail(request: ActiveRequest, error: unknown): void {
    if (!this.isCurrent(request)) return
    this.active = null
    if (isAbortError(error)) return
    const message = catchFailureMessage(error)
    if (this.state.error === message && this.state.hasLoaded) return
    this.setState({ ...this.state, error: message, hasLoaded: true })
  }

  private abortActive(): void {
    const request = this.active
    if (!request) return
    this.active = null
    request.controller.abort()
  }
}
