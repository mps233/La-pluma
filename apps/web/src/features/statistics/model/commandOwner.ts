import { getErrorMessage, isAbortError, isRecord, type ApiResponse } from '@/shared/api'
import {
  executionController as defaultExecutionController,
  executeCommand as defaultExecuteCommand,
  getRun as defaultGetRun,
  isActiveRunState,
  isTerminalRunState,
  readSubmittedRun,
  readSubmittedRunId,
  type AgentRun,
  type ExecutionIntent,
  type TaskConfig,
} from '@/features/task-execution'
import {
  publishResourceInvalidation as defaultPublishResourceInvalidation,
  type ResourceInvalidation,
  type ResourceScope,
} from '@/features/resource-invalidation'
import { fetchOperatorMaterials as defaultFetchOperatorMaterials } from '@/features/training'
import type {
  DepotDataDetailed,
  DepotItem,
  OperBoxCatalogOperator,
  OperBoxData,
  OperBoxRecognitionInfo,
  OperatorDetailed,
} from '@/features/game-data'
import { parseDepotData, parseOperBoxData } from '../api'

export const STATISTICS_COMMAND_SCOPE = 'statistics'

/** 同步 `run-task` 的响应上限；超时后前端不再等待，但服务端可能仍在执行。 */
export const STATISTICS_COMMAND_TIMEOUT_MS = 5 * 60_000
/** 回放已接受的 Run 时，最多再等待终态的时间。 */
export const STATISTICS_RUN_TIMEOUT_MS = 5 * 60_000
/** 命令完成到 MAA 日志可解析之间的等待上限。 */
export const STATISTICS_PARSE_TIMEOUT_MS = 30_000
/** 材料刷新脚本没有 Run 身份，超时只表示无法确认刷新是否完成。 */
export const STATISTICS_MATERIALS_TIMEOUT_MS = 5 * 60_000
export const STATISTICS_RUN_POLL_MS = 1_000
export const STATISTICS_PARSE_POLL_MS = 500

export type StatisticsCommandKind = 'depot' | 'operbox' | 'materials'
export type StatisticsRecognitionKind = Exclude<StatisticsCommandKind, 'materials'>

export type StatisticsCommandPhase =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'parsing'
  | 'succeeded'
  | 'failed'
  | 'timed-out'
  | 'cancelled'

/**
 * 中断后继续的方式：
 * - `parse`：命令已确认完成，只继续等待 Run 终态/解析，不得重新提交命令；
 * - `command`：命令结果不确定，继续时复用同一幂等键确认结果；
 * - `null`：没有可继续的中断。
 */
export type StatisticsCommandResumeMode = 'parse' | 'command' | null

export interface StatisticsCommandState {
  readonly kind: StatisticsCommandKind | null
  readonly phase: StatisticsCommandPhase
  readonly resumeMode: StatisticsCommandResumeMode
}

export type StatisticsCommandResult =
  | { status: 'succeeded'; kind: 'depot'; message: string; depot: DepotDataDetailed }
  | { status: 'succeeded'; kind: 'operbox'; message: string; operBox: OperBoxData }
  | { status: 'succeeded'; kind: 'materials'; message: string }
  | { status: 'failed'; kind: StatisticsCommandKind; message: string }
  | { status: 'timed-out'; kind: StatisticsCommandKind; message: string }
  | { status: 'cancelled'; kind: StatisticsCommandKind; message: string }
  | { status: 'busy'; kind: StatisticsCommandKind; message: string }
  | { status: 'idle'; message: string }

/** 识别成功后的权威快照；调用方必须在失效发布前写入唯一 Query 缓存。 */
export type StatisticsRecognitionSnapshot =
  | { kind: 'depot'; depot: DepotDataDetailed }
  | { kind: 'operbox'; operBox: OperBoxData }

export interface StatisticsCommandProgressOptions {
  /** 命令阶段变化时同步提示；即使 Activity 隐藏也会继续收到。 */
  onProgress?: (message: string) => void
  /**
   * 在发布识别资源失效前应用权威快照。实现方应先取消在途读取再写缓存，
   * 避免监听器触发的旧 GET 覆盖刚解析出的结果。
   */
  applyRecognitionSnapshot?: (snapshot: StatisticsRecognitionSnapshot) => void | Promise<void>
}

export interface StatisticsCommandExecutionPort {
  beginExecutionIntent(
    operationId: string,
    options?: { idempotencyKey?: string; scope?: string | null },
  ): ExecutionIntent
  settleExecutionIntent(
    intent: ExecutionIntent,
    result: ApiResponse<unknown> | null,
    error?: unknown,
  ): boolean
}

export interface StatisticsCommandTimeouts {
  command: number
  run: number
  parse: number
  materials: number
}

export interface StatisticsCommandOwnerOptions {
  execution?: StatisticsCommandExecutionPort
  runCommand?: typeof defaultExecuteCommand
  readRun?: (runId: string, signal?: AbortSignal) => Promise<ApiResponse<AgentRun>>
  parseDepot?: (signal?: AbortSignal) => Promise<ApiResponse>
  parseOperBox?: (signal?: AbortSignal) => Promise<ApiResponse>
  fetchMaterials?: (signal?: AbortSignal) => Promise<ApiResponse>
  publish?: (invalidation: ResourceInvalidation) => void
  timeouts?: Partial<StatisticsCommandTimeouts>
  runPollMs?: number
  parsePollMs?: number
}

interface ResumableCommand {
  readonly kind: StatisticsRecognitionKind
  readonly idempotencyKey: string
  readonly runId: string | null
  readonly commandSucceeded: boolean
}

type RecognitionPayload =
  | { kind: 'depot'; itemCount: number; items: DepotItem[]; path?: string }
  | {
      kind: 'operbox'
      operCount: number
      data: OperatorDetailed[]
      path?: string
      allOpers?: OperBoxCatalogOperator[]
      operTotal?: number
      recognition?: OperBoxRecognitionInfo
    }

const DEFAULT_TIMEOUTS: StatisticsCommandTimeouts = {
  command: STATISTICS_COMMAND_TIMEOUT_MS,
  run: STATISTICS_RUN_TIMEOUT_MS,
  parse: STATISTICS_PARSE_TIMEOUT_MS,
  materials: STATISTICS_MATERIALS_TIMEOUT_MS,
}

const DEPOT_RECOGNITION_SCOPES = [
  'depot',
  'materials',
  'training-queue',
  'dashboard-snapshot',
] as const satisfies readonly ResourceScope[]

const OPERBOX_RECOGNITION_SCOPES = [
  'operbox',
  'catalog',
  'materials',
  'training-queue',
  'dashboard-snapshot',
] as const satisfies readonly ResourceScope[]

const MATERIALS_REFRESH_SCOPES = [
  'materials',
  'training-queue',
  'dashboard-snapshot',
] as const satisfies readonly ResourceScope[]

const RECOGNITION_TASKS = {
  depot: { name: '仓库识别', type: 'Depot', params: { enable: true } },
  operbox: { name: '干员识别', type: 'OperBox', params: { enable: true } },
} as const satisfies Record<StatisticsRecognitionKind, TaskConfig>

const RECOGNITION_LABELS = {
  depot: {
    name: '仓库识别',
    running: '正在识别仓库物品...',
    unit: '种物品',
  },
  operbox: {
    name: '干员识别',
    running: '正在识别干员数据...',
    unit: '名干员',
  },
} as const

const idleState = (): StatisticsCommandState => ({
  kind: null,
  phase: 'idle',
  resumeMode: null,
})

function createAbortError(): DOMException {
  return new DOMException('统计命令等待已取消', 'AbortError')
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '未知错误'
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw createAbortError()
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError())
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(createAbortError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function readDepotPayload(data: unknown): Extract<RecognitionPayload, { kind: 'depot' }> | null {
  if (!isRecord(data) || data.success === false) return null
  if (typeof data.itemCount !== 'number' || !Array.isArray(data.items)) return null
  return {
    kind: 'depot',
    itemCount: data.itemCount,
    items: data.items as DepotItem[],
    path: typeof data.path === 'string' ? data.path : undefined,
  }
}

function readOperBoxRecognition(value: unknown): OperBoxRecognitionInfo | undefined {
  if (!isRecord(value)) return undefined
  const { status, total, owned } = value
  if (status !== 'complete' && status !== 'partial') return undefined
  if (typeof total !== 'number' || typeof owned !== 'number') return undefined
  return { status, total, owned }
}

function readOperBoxPayload(data: unknown): Extract<RecognitionPayload, { kind: 'operbox' }> | null {
  if (!isRecord(data) || data.success === false) return null
  if (typeof data.operCount !== 'number' || !Array.isArray(data.data)) return null
  // 识别目录与概要随解析响应返回；旧服务端没有这些字段时保持缺省。
  const recognition = readOperBoxRecognition(data.recognition)
  return {
    kind: 'operbox',
    operCount: data.operCount,
    data: data.data as OperatorDetailed[],
    path: typeof data.path === 'string' ? data.path : undefined,
    ...(Array.isArray(data.allOpers) ? { allOpers: data.allOpers as OperBoxCatalogOperator[] } : {}),
    ...(typeof data.operTotal === 'number' ? { operTotal: data.operTotal } : {}),
    ...(recognition ? { recognition } : {}),
  }
}

function readRecognitionPayload(kind: StatisticsRecognitionKind, data: unknown): RecognitionPayload | null {
  return kind === 'depot' ? readDepotPayload(data) : readOperBoxPayload(data)
}

function describeRunFailure(run: AgentRun): string {
  if (run.state === 'stopped') return '识别已停止'
  if (run.state === 'interrupted') {
    return `识别中断: ${run.error?.message || '服务重启后无法确认执行结果'}`
  }
  return `识别失败: ${run.error?.message || '任务未能完成'}`
}

class CommandOperation {
  readonly controller = new AbortController()
  readonly generation: number
  timedOut = false
  cancelled = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(generation: number) {
    this.generation = generation
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  arm(timeoutMs: number): void {
    this.clearTimer()
    this.timedOut = false
    this.timer = setTimeout(() => {
      this.timer = null
      this.timedOut = true
      this.controller.abort()
    }, timeoutMs)
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    this.clearTimer()
    this.controller.abort()
  }

  clearTimer(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }
}

export class StatisticsCommandOwner {
  private readonly execution: StatisticsCommandExecutionPort
  private readonly runCommand: typeof defaultExecuteCommand
  private readonly readRun: (runId: string, signal?: AbortSignal) => Promise<ApiResponse<AgentRun>>
  private readonly parseDepot: (signal?: AbortSignal) => Promise<ApiResponse>
  private readonly parseOperBox: (signal?: AbortSignal) => Promise<ApiResponse>
  private readonly fetchMaterials: (signal?: AbortSignal) => Promise<ApiResponse>
  private readonly publish: (invalidation: ResourceInvalidation) => void
  private readonly timeouts: StatisticsCommandTimeouts
  private readonly runPollMs: number
  private readonly parsePollMs: number

  private state: StatisticsCommandState = idleState()
  private readonly listeners = new Set<() => void>()
  private operation: CommandOperation | null = null
  private resumable: ResumableCommand | null = null
  private generation = 0

  constructor(options: StatisticsCommandOwnerOptions = {}) {
    this.execution = options.execution ?? defaultExecutionController
    this.runCommand = options.runCommand ?? defaultExecuteCommand
    this.readRun = options.readRun ?? defaultGetRun
    this.parseDepot = options.parseDepot ?? parseDepotData
    this.parseOperBox = options.parseOperBox ?? parseOperBoxData
    this.fetchMaterials = options.fetchMaterials ?? defaultFetchOperatorMaterials
    this.publish = options.publish ?? defaultPublishResourceInvalidation
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts }
    this.runPollMs = options.runPollMs ?? STATISTICS_RUN_POLL_MS
    this.parsePollMs = options.parsePollMs ?? STATISTICS_PARSE_POLL_MS
  }

  readonly getState = (): StatisticsCommandState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 页面测试与显式重置使用；中止本地等待，不停止服务端执行。 */
  reset(): void {
    this.generation += 1
    this.operation?.cancel()
    this.operation = null
    this.resumable = null
    this.setState(idleState())
  }

  /** 取消本地等待；服务端可能仍在执行，之后可用同一命令继续确认。 */
  cancel(): void {
    this.operation?.cancel()
  }

  async run(
    kind: StatisticsCommandKind,
    options: StatisticsCommandProgressOptions = {},
  ): Promise<StatisticsCommandResult> {
    if (this.operation) {
      return {
        status: 'busy',
        kind,
        message: '另一项统计命令正在执行，请稍候。',
      }
    }

    if (this.resumable?.kind === kind) return this.resume(options)
    // 另一类识别留下的中断结果不影响用户主动开始新命令；旧结果由后续日志仍可解析。
    if (this.resumable) this.resumable = null

    if (kind === 'materials') return this.runMaterials(options)
    return this.runRecognition(kind, options)
  }

  async resume(
    options: StatisticsCommandProgressOptions = {},
  ): Promise<StatisticsCommandResult> {
    if (this.operation) {
      return {
        status: 'busy',
        kind: this.resumable?.kind ?? 'depot',
        message: '另一项统计命令正在执行，请稍候。',
      }
    }
    const resumable = this.resumable
    if (!resumable) {
      return { status: 'idle', message: '没有可继续的识别结果。' }
    }

    const operation = this.beginOperation()
    try {
      if (!resumable.commandSucceeded) {
        return await this.submitRecognition(operation, resumable.kind, resumable.idempotencyKey, options)
      }
      return await this.completeRecognition(operation, resumable, null, options)
    } finally {
      this.finishOperation(operation)
    }
  }

  private async runRecognition(
    kind: StatisticsRecognitionKind,
    options: StatisticsCommandProgressOptions,
  ): Promise<StatisticsCommandResult> {
    const operation = this.beginOperation()
    try {
      return await this.submitRecognition(operation, kind, undefined, options)
    } finally {
      this.finishOperation(operation)
    }
  }

  private async submitRecognition(
    operation: CommandOperation,
    kind: StatisticsRecognitionKind,
    idempotencyKey: string | undefined,
    options: StatisticsCommandProgressOptions,
  ): Promise<StatisticsCommandResult> {
    const intent = this.execution.beginExecutionIntent('run_task', {
      idempotencyKey,
      scope: STATISTICS_COMMAND_SCOPE,
    })
    const key = intent.idempotencyKey
    this.resumable = {
      kind,
      idempotencyKey: key,
      runId: this.resumable?.kind === kind ? this.resumable.runId : null,
      commandSucceeded: false,
    }

    const label = RECOGNITION_LABELS[kind]
    this.enter(operation, kind, 'running', label.running, options)
    operation.arm(this.timeouts.command)

    try {
      const result = await this.runCommand(
        'run',
        [kind],
        RECOGNITION_TASKS[kind],
        operation.signal,
        label.name,
        STATISTICS_COMMAND_SCOPE,
        true,
        { idempotencyKey: key },
      )
      this.execution.settleExecutionIntent(intent, result)

      const interrupted = this.finishIfInterrupted(operation, kind, options)
      if (interrupted) return interrupted

      if (!result.success) {
        return this.finishFailure(
          kind,
          `识别失败: ${getErrorMessage(result)}`,
          null,
          options,
        )
      }

      const runId = readSubmittedRunId(result.data)
      const run = runId ? readSubmittedRun(result.data, runId) : null
      this.resumable = {
        kind,
        idempotencyKey: key,
        runId,
        commandSucceeded: true,
      }
      return await this.completeRecognition(operation, this.resumable, run, options)
    } catch (error) {
      this.execution.settleExecutionIntent(intent, null, error)

      const interrupted = this.finishIfInterrupted(operation, kind, options)
      if (interrupted) return interrupted

      // 传输失败时命令可能已经到达服务端：保留幂等键，继续时先确认已有 Run。
      return this.finishFailure(
        kind,
        `识别失败: ${describeError(error)}`,
        'command',
        options,
      )
    }
  }

  private async completeRecognition(
    operation: CommandOperation,
    command: ResumableCommand,
    submittedRun: AgentRun | null,
    options: StatisticsCommandProgressOptions,
  ): Promise<StatisticsCommandResult> {
    const kind = command.kind

    try {
      const runFailure = await this.waitForRunOutcome(operation, command, submittedRun, options)
      if (runFailure) return runFailure
      return await this.parseAndFinish(operation, command, options)
    } catch (error) {
      const interrupted = this.finishIfInterrupted(operation, kind, options)
      if (interrupted) return interrupted

      return this.finishFailure(
        kind,
        `识别完成，但数据解析失败: ${describeError(error)}`,
        'parse',
        options,
      )
    }
  }

  /**
   * 确认识别 Run 的终态。正常同步响应已带终态；超时后复用幂等键得到的
   * 响应可能是已接受的 Run，此时只读取该 Run，不重新提交命令。
   */
  private async waitForRunOutcome(
    operation: CommandOperation,
    command: ResumableCommand,
    submittedRun: AgentRun | null,
    options: StatisticsCommandProgressOptions,
  ): Promise<StatisticsCommandResult | null> {
    const kind = command.kind
    const runId = command.runId
    if (!runId) return null

    if (submittedRun) {
      if (submittedRun.state === 'succeeded') return null
      if (isTerminalRunState(submittedRun.state)) {
        return this.finishFailure(kind, describeRunFailure(submittedRun), null, options)
      }
      if (!isActiveRunState(submittedRun.state)) {
        return this.finishFailure(kind, '无法确认识别命令的执行结果', 'command', options)
      }
    }

    operation.arm(this.timeouts.run)
    this.enter(operation, kind, 'waiting', '识别命令已提交，正在等待执行结果...', options)

    while (true) {
      throwIfAborted(operation.signal)

      try {
        const result = await this.readRun(runId, operation.signal)
        if (result.success && result.data) {
          if (result.data.state === 'succeeded') return null
          if (isTerminalRunState(result.data.state)) {
            return this.finishFailure(kind, describeRunFailure(result.data), null, options)
          }
        } else if (result.errorInfo?.code === 'AGENT_RUN_NOT_FOUND') {
          return this.finishFailure(kind, '无法确认识别命令的执行结果', null, options)
        }
      } catch (error) {
        if (isAbortError(error)) throw error
        // 读取 Run 失败不等于执行失败；在超时前继续观察。
      }

      await sleep(this.runPollMs, operation.signal)
    }
  }

  private async parseAndFinish(
    operation: CommandOperation,
    command: ResumableCommand,
    options: StatisticsCommandProgressOptions,
  ): Promise<StatisticsCommandResult> {
    const kind = command.kind
    operation.arm(this.timeouts.parse)
    this.enter(operation, kind, 'parsing', '识别完成，正在解析数据...', options)

    const payload = await this.waitForParsedResult(operation, kind)
    const label = RECOGNITION_LABELS[kind]

    if (payload.kind === 'depot') {
      const depot: DepotDataDetailed = {
        itemCount: payload.itemCount,
        items: payload.items,
        path: payload.path,
        timestamp: new Date().toISOString(),
      }
      // 先写权威快照再发布失效：监听器读取到的是同一份新数据，不会被旧 GET 覆盖。
      const snapshotApplied = await this.applyRecognitionSnapshot(options, { kind: 'depot', depot })
      this.publishScopes(DEPOT_RECOGNITION_SCOPES, snapshotApplied)
      const message = `识别完成！共识别 ${depot.itemCount} ${label.unit}`
      this.finishSuccess(kind, message, options)
      return { status: 'succeeded', kind: 'depot', message, depot }
    }

    const operBox: OperBoxData = {
      operCount: payload.operCount,
      data: payload.data,
      path: payload.path,
      ...(payload.allOpers ? { allOpers: payload.allOpers } : {}),
      ...(payload.operTotal !== undefined ? { operTotal: payload.operTotal } : {}),
      ...(payload.recognition ? { recognition: payload.recognition } : {}),
      timestamp: new Date().toISOString(),
    }
    const snapshotApplied = await this.applyRecognitionSnapshot(options, { kind: 'operbox', operBox })
    this.publishScopes(OPERBOX_RECOGNITION_SCOPES, snapshotApplied)
    const message = `识别完成！共识别 ${operBox.operCount} ${label.unit}`
    this.finishSuccess(kind, message, options)
    return { status: 'succeeded', kind: 'operbox', message, operBox }
  }

  private async waitForParsedResult(
    operation: CommandOperation,
    kind: StatisticsRecognitionKind,
  ): Promise<RecognitionPayload> {
    const parse = kind === 'depot' ? this.parseDepot : this.parseOperBox

    while (true) {
      throwIfAborted(operation.signal)

      try {
        const result = await parse(operation.signal)
        if (result.success) {
          const payload = readRecognitionPayload(kind, result.data)
          // 日志尚未写入完成时解析端点会返回空数据或错误信封；继续等待而不是重执行命令。
          if (payload) return payload
        }
      } catch (error) {
        if (isAbortError(error)) throw error
        // 解析失败可能只是日志仍在写入；在超时前继续轮询。
      }

      await sleep(this.parsePollMs, operation.signal)
    }
  }

  private async runMaterials(
    options: StatisticsCommandProgressOptions,
  ): Promise<StatisticsCommandResult> {
    const operation = this.beginOperation()
    const message = '正在获取干员材料数据...'
    this.setState({
      kind: 'materials',
      phase: 'running',
      resumeMode: null,
    })
    this.emit(options, message)
    operation.arm(this.timeouts.materials)

    try {
      const result = await this.fetchMaterials(operation.signal)
      const interrupted = this.finishIfInterrupted(operation, 'materials', options)
      if (interrupted) return interrupted

      if (!result.success) {
        return this.finishFailure(
          'materials',
          `获取失败: ${getErrorMessage(result)}`,
          null,
          options,
        )
      }

      this.publishScopes(MATERIALS_REFRESH_SCOPES)
      const successMessage = '干员材料数据获取成功！'
      this.finishSuccess('materials', successMessage, options)
      return { status: 'succeeded', kind: 'materials', message: successMessage }
    } catch (error) {
      const interrupted = this.finishIfInterrupted(operation, 'materials', options)
      if (interrupted) return interrupted

      return this.finishFailure(
        'materials',
        `获取失败: ${describeError(error)}`,
        null,
        options,
      )
    } finally {
      this.finishOperation(operation)
    }
  }

  private beginOperation(): CommandOperation {
    const operation = new CommandOperation(this.generation)
    this.operation = operation
    return operation
  }

  private finishOperation(operation: CommandOperation): void {
    operation.clearTimer()
    if (this.operation === operation) this.operation = null
  }

  private isCurrent(operation: CommandOperation): boolean {
    return operation.generation === this.generation
  }

  private enter(
    operation: CommandOperation,
    kind: StatisticsRecognitionKind,
    phase: StatisticsCommandPhase,
    message: string,
    options: StatisticsCommandProgressOptions,
  ): void {
    if (!this.isCurrent(operation)) return
    this.setState({
      kind,
      phase,
      resumeMode: this.resumable?.commandSucceeded ? 'parse' : 'command',
    })
    this.emit(options, message)
  }

  private finishIfInterrupted(
    operation: CommandOperation,
    kind: StatisticsCommandKind,
    options: StatisticsCommandProgressOptions,
  ): StatisticsCommandResult | null {
    if (!this.isCurrent(operation)) {
      return { status: 'cancelled', kind, message: '已取消等待' }
    }
    if (!operation.cancelled && !operation.timedOut) return null

    const commandSucceeded = this.resumable?.commandSucceeded ?? false
    const resumeMode: StatisticsCommandResumeMode = commandSucceeded ? 'parse' : 'command'
    const cancelled = operation.cancelled
    const waitingForRun = this.state.phase === 'waiting'
    const message = kind === 'materials'
      ? (cancelled ? '已取消等待材料数据' : '等待材料数据结果超时')
      : cancelled
        ? '已取消等待识别结果'
        : commandSucceeded
          ? waitingForRun
            ? '识别命令仍在执行，可继续等待结果'
            : '识别完成，但等待解析结果超时'
          : '等待识别命令结果超时'

    this.setState({
      kind,
      phase: cancelled ? 'cancelled' : 'timed-out',
      resumeMode: kind === 'materials' ? null : resumeMode,
    })
    this.emit(options, message)

    return {
      status: cancelled ? 'cancelled' : 'timed-out',
      kind,
      message,
    }
  }

  private finishFailure(
    kind: StatisticsCommandKind,
    message: string,
    resumeMode: StatisticsCommandResumeMode,
    options: StatisticsCommandProgressOptions,
  ): StatisticsCommandResult {
    if (resumeMode === null) this.resumable = null
    this.setState({
      kind,
      phase: 'failed',
      resumeMode,
    })
    this.emit(options, message)
    return { status: 'failed', kind, message }
  }

  private finishSuccess(
    kind: StatisticsCommandKind,
    message: string,
    options: StatisticsCommandProgressOptions,
  ): void {
    this.resumable = null
    this.setState({
      kind,
      phase: 'succeeded',
      resumeMode: null,
    })
    this.emit(options, message)
  }

  /**
   * 快照写入失败不能把已成功的设备命令误报为失败：记录后继续发布失效，
   * 读取方仍可通过普通 GET 恢复。实现方负责先取消在途读取。
   */
  private async applyRecognitionSnapshot(
    options: StatisticsCommandProgressOptions,
    snapshot: StatisticsRecognitionSnapshot,
  ): Promise<boolean> {
    if (!options.applyRecognitionSnapshot) return false
    try {
      await options.applyRecognitionSnapshot(snapshot)
      return true
    } catch (error) {
      console.error('应用识别快照失败', error)
      return false
    }
  }

  private publishScopes(
    resources: readonly ResourceScope[],
    authoritativeSnapshot = false,
  ): void {
    try {
      this.publish({
        resources,
        cause: 'recognition',
        ...(authoritativeSnapshot ? { detail: { authoritativeSnapshot: true } } : {}),
      })
    } catch (error) {
      // 写入目标已经成功；失效发布失败不能让命令被误报为失败。
      console.error('发布识别资源失效失败', error)
    }
  }

  private emit(options: StatisticsCommandProgressOptions, message: string): void {
    try {
      options.onProgress?.(message)
    } catch (error) {
      console.error('统计命令提示回调失败', error)
    }
  }

  private setState(state: StatisticsCommandState): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}

export function isStatisticsCommandRunning(state: StatisticsCommandState): boolean {
  return state.phase === 'running' || state.phase === 'waiting' || state.phase === 'parsing'
}

export const statisticsCommandOwner = new StatisticsCommandOwner()
