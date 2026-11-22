import { isRecord, unwrapApiResponse, type ApiResponse } from '@/shared/api'
import {
  publishResourceInvalidation as defaultPublishResourceInvalidation,
  type ResourceInvalidation,
  type ResourceScope,
} from '@/features/resource-invalidation'
import {
  addToTrainingQueue as defaultAddToTrainingQueue,
  getTrainingQueue as defaultGetTrainingQueue,
  removeFromTrainingQueue as defaultRemoveFromTrainingQueue,
  updateTrainingQueueOrder as defaultUpdateTrainingQueueOrder,
} from '../api'
import type {
  TrainingFlowSync,
  TrainingOperator,
  TrainingQueueItem,
  TrainingQueueMutationData,
  TrainingQueueSnapshot,
} from '../types'

/** 写入成功但写后刷新失败时的快照标记；下一次权威读取会清除它。 */
export const TRAINING_QUEUE_UNCERTAIN_MESSAGE =
  '队列写入已成功，但读取最新状态失败，当前显示本地结果。重新加载后再预览计划。'

/** 队列写入成功后受影响的作用域；与资源归属文档的触发映射一致。 */
export const TRAINING_QUEUE_MUTATION_SCOPES = [
  'training-queue',
  'materials',
  'training-plan',
  'dashboard-snapshot',
] as const satisfies readonly ResourceScope[]

/**
 * 队列写入同步任务流程后只声明 automation 配置变化。
 *
 * 自动同步路径不会重新注册已存在的定时任务（见 docs/api/agent.md）；cron 仍持有
 * 旧 taskFlow，因此不能把 `automation-schedule` 说成已变化。该作用域只由显式
 * 应用计划的路径发布。
 */
export const TRAINING_QUEUE_FLOW_SYNC_SCOPES = [
  'automation-config',
] as const satisfies readonly ResourceScope[]

/** 用于让本页忽略自己发布的队列失效；外部发布不带该标记。 */
export const TRAINING_QUEUE_MUTATION_SOURCE = 'training-queue-command'

export interface TrainingQueueMutationInvalidationDetail {
  source: typeof TRAINING_QUEUE_MUTATION_SOURCE
}

export function isTrainingQueueMutationInvalidation(
  invalidation: ResourceInvalidation,
): boolean {
  if (invalidation.cause !== 'training-queue') return false
  return isRecord(invalidation.detail)
    && invalidation.detail.source === TRAINING_QUEUE_MUTATION_SOURCE
}

export type TrainingQueueCommand =
  | { readonly type: 'add'; readonly operator: TrainingOperator }
  | { readonly type: 'remove'; readonly operatorId: string }
  | { readonly type: 'undo'; readonly item: TrainingQueueItem; readonly index: number }
  | { readonly type: 'reorder'; readonly operatorId: string; readonly destination: number }

export interface TrainingQueuePendingCommand {
  readonly id: number
  readonly type: TrainingQueueCommand['type']
  readonly operatorId: string
}

export interface TrainingQueueCommandState {
  readonly pending: readonly TrainingQueuePendingCommand[]
}

/**
 * 命令执行上下文。快照读写与取消读取由页面注入，使命令保持非 React 且
 * 写入应用级 QueryClient 的唯一 `queue` key。
 */
export interface TrainingQueueCommandContext {
  getSnapshot(): TrainingQueueSnapshot | undefined
  commitSnapshot(snapshot: TrainingQueueSnapshot): void
  /** 取消开始于写入之前的在途读取；读取函数必须传递 AbortSignal。 */
  cancelReads?(): Promise<void>
}

export interface TrainingQueueRemovedItem {
  readonly item: TrainingQueueItem
  readonly index: number
}

export type TrainingQueueCommandOutcome =
  | {
      readonly status: 'applied'
      readonly type: TrainingQueueCommand['type']
      readonly operatorId: string
      readonly snapshot: TrainingQueueSnapshot
      readonly message: string
      readonly flowSync?: TrainingFlowSync
      readonly removed?: TrainingQueueRemovedItem
    }
  | {
      readonly status: 'uncertain'
      readonly type: TrainingQueueCommand['type']
      readonly operatorId: string
      readonly snapshot: TrainingQueueSnapshot
      readonly message: string
      readonly flowSync?: TrainingFlowSync
      readonly removed?: TrainingQueueRemovedItem
    }
  | {
      readonly status: 'failed'
      readonly type: TrainingQueueCommand['type']
      readonly operatorId: string
      readonly message: string
    }
  | {
      readonly status: 'ignored'
      readonly type: TrainingQueueCommand['type']
      readonly operatorId: string
    }

export interface TrainingQueueCommandOwnerOptions {
  readQueue?: () => Promise<TrainingQueueSnapshot>
  add?: typeof defaultAddToTrainingQueue
  remove?: typeof defaultRemoveFromTrainingQueue
  reorder?: typeof defaultUpdateTrainingQueueOrder
  publish?: (invalidation: ResourceInvalidation) => void
}

interface WriteMessages {
  readonly success: string
  readonly uncertain: string
  readonly failure: string
}

const readQueueSnapshot = async (): Promise<TrainingQueueSnapshot> => (
  unwrapApiResponse<TrainingQueueSnapshot>(await defaultGetTrainingQueue())
)

const operatorIdOf = (command: TrainingQueueCommand): string => {
  switch (command.type) {
    case 'add': return command.operator.id
    case 'undo': return command.item.operatorId
    default: return command.operatorId
  }
}

const buildFallbackQueueItem = (operator: TrainingOperator): TrainingQueueItem => ({
  operatorId: operator.id,
  operator: {
    name: operator.name,
    rarity: operator.rarity,
    profession: operator.profession,
  },
  currentElite: operator.currentElite ?? 0,
  targetElite: operator.targetElite ?? 2,
  materials: [],
  progress: 0,
})

const moveQueueItem = (
  queue: readonly TrainingQueueItem[],
  from: number,
  to: number,
): TrainingQueueItem[] => {
  const next = [...queue]
  const [item] = next.splice(from, 1)
  if (!item) return next
  next.splice(Math.min(Math.max(to, 0), next.length), 0, item)
  return next
}

const moveOperatorTo = (
  queue: readonly TrainingQueueItem[],
  operatorId: string,
  destination: number,
): TrainingQueueItem[] => {
  const from = queue.findIndex(item => item.operatorId === operatorId)
  if (from < 0) return [...queue]
  return moveQueueItem(queue, from, destination)
}

const resolveFailureMessage = (response: ApiResponse<unknown>, fallback: string): string => {
  const message = response.message || response.errorInfo?.message || response.error
  return typeof message === 'string' && message.trim() ? message : fallback
}

const describeError = (error: unknown, fallback: string): string => (
  error instanceof Error && error.message ? error.message : fallback
)

/**
 * 模块级队列命令所有者。
 *
 * 寿命不跟随页面：Activity 隐藏或页面重挂载不会重建串行链、取消已发出的写入，
 * 也不会让新页面在旧命令仍在执行时插入第二个并发写。
 */
export class TrainingQueueCommandOwner {
  private readonly readQueue: () => Promise<TrainingQueueSnapshot>
  private readonly add: typeof defaultAddToTrainingQueue
  private readonly remove: typeof defaultRemoveFromTrainingQueue
  private readonly reorder: typeof defaultUpdateTrainingQueueOrder
  private readonly publishInvalidation: (invalidation: ResourceInvalidation) => void

  private tail: Promise<void> = Promise.resolve()
  private pending: TrainingQueuePendingCommand[] = []
  private nextId = 0
  private state: TrainingQueueCommandState = { pending: [] }
  private readonly listeners = new Set<() => void>()

  constructor(options: TrainingQueueCommandOwnerOptions = {}) {
    this.readQueue = options.readQueue ?? readQueueSnapshot
    this.add = options.add ?? defaultAddToTrainingQueue
    this.remove = options.remove ?? defaultRemoveFromTrainingQueue
    this.reorder = options.reorder ?? defaultUpdateTrainingQueueOrder
    this.publishInvalidation = options.publish ?? defaultPublishResourceInvalidation
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState = (): TrainingQueueCommandState => this.state

  /** 仅用于测试与明确的全局重置；正常页面生命周期不调用。 */
  reset(): void {
    this.tail = Promise.resolve()
    this.pending = []
    this.nextId = 0
    this.state = { pending: [] }
    for (const listener of [...this.listeners]) listener()
  }

  run(
    command: TrainingQueueCommand,
    context: TrainingQueueCommandContext,
  ): Promise<TrainingQueueCommandOutcome> {
    const operatorId = operatorIdOf(command)
    if (this.isDuplicate(command)) {
      return Promise.resolve({ status: 'ignored', type: command.type, operatorId })
    }

    const pending: TrainingQueuePendingCommand = {
      id: ++this.nextId,
      type: command.type,
      operatorId,
    }
    this.pending = [...this.pending, pending]
    this.updateState()

    const execute = async (): Promise<TrainingQueueCommandOutcome> => {
      try {
        return await this.execute(command, context)
      } catch (error) {
        return {
          status: 'failed',
          type: command.type,
          operatorId,
          message: describeError(error, '队列操作失败，请重试'),
        }
      } finally {
        this.pending = this.pending.filter(entry => entry.id !== pending.id)
        this.updateState()
      }
    }

    const job = this.tail.then(execute, execute)
    this.tail = job.then(() => undefined, () => undefined)
    return job
  }

  private isDuplicate(command: TrainingQueueCommand): boolean {
    // 排序在执行时会按最新位置判断是否仍需要写入，同一干员的后续目标不应被丢弃。
    if (command.type === 'reorder') return false
    const operatorId = operatorIdOf(command)
    return this.pending.some(entry => (
      entry.type === command.type && entry.operatorId === operatorId
    ))
  }

  private updateState(): void {
    // 引用只在 pending 变化时更换，useSyncExternalStore 不会因无关渲染重复通知。
    this.state = { pending: [...this.pending] }
    for (const listener of [...this.listeners]) listener()
  }

  private async execute(
    command: TrainingQueueCommand,
    context: TrainingQueueCommandContext,
  ): Promise<TrainingQueueCommandOutcome> {
    await context.cancelReads?.()
    const before = context.getSnapshot()

    switch (command.type) {
      case 'add': return this.executeAdd(command, before, context)
      case 'remove': return this.executeRemove(command, before, context)
      case 'undo': return this.executeUndo(command, before, context)
      case 'reorder': return this.executeReorder(command, before, context)
    }
  }

  private async executeAdd(
    command: Extract<TrainingQueueCommand, { type: 'add' }>,
    before: TrainingQueueSnapshot | undefined,
    context: TrainingQueueCommandContext,
  ): Promise<TrainingQueueCommandOutcome> {
    const { operator } = command
    // 已在前一条命令或外部刷新中加入时，重复点击不再产生第二个写请求。
    if (before?.queue.some(item => item.operatorId === operator.id)) {
      return { status: 'ignored', type: 'add', operatorId: operator.id }
    }

    const response = await this.add({
      operatorId: operator.id,
      currentElite: operator.currentElite ?? 0,
      targetElite: operator.targetElite ?? 2,
    })

    return this.finishWrite({
      command,
      context,
      before,
      response,
      buildFallback: queue => (
        queue.some(entry => entry.operatorId === operator.id)
          ? [...queue]
          : [...queue, buildFallbackQueueItem(operator)]
      ),
      messages: {
        success: `${operator.name} 已加入养成队列`,
        uncertain: `${operator.name} 已添加，但队列刷新失败，请重试`,
        failure: '添加失败，请重试',
      },
    })
  }

  private async executeRemove(
    command: Extract<TrainingQueueCommand, { type: 'remove' }>,
    before: TrainingQueueSnapshot | undefined,
    context: TrainingQueueCommandContext,
  ): Promise<TrainingQueueCommandOutcome> {
    const index = before?.queue.findIndex(item => item.operatorId === command.operatorId) ?? -1
    const item = index >= 0 ? before?.queue[index] : undefined
    if (!item) {
      return {
        status: 'failed',
        type: 'remove',
        operatorId: command.operatorId,
        message: '干员已不在养成队列中，请重新加载',
      }
    }

    const response = await this.remove(command.operatorId)

    return this.finishWrite({
      command,
      context,
      before,
      response,
      buildFallback: queue => queue.filter(entry => entry.operatorId !== command.operatorId),
      messages: {
        success: '',
        uncertain: '已移除，但队列刷新失败，请重试',
        failure: '删除失败，请重试',
      },
      removed: { item, index },
    })
  }

  private async executeUndo(
    command: Extract<TrainingQueueCommand, { type: 'undo' }>,
    before: TrainingQueueSnapshot | undefined,
    context: TrainingQueueCommandContext,
  ): Promise<TrainingQueueCommandOutcome> {
    const { item, index } = command
    if (before?.queue.some(entry => entry.operatorId === item.operatorId)) {
      return { status: 'ignored', type: 'undo', operatorId: item.operatorId }
    }

    const position = Math.min(
      Math.max(index, 0),
      before?.queue.length ?? Math.max(index, 0),
    )
    const response = await this.add({
      operatorId: item.operatorId,
      currentElite: item.currentElite,
      targetElite: item.targetElite,
      position,
    })

    return this.finishWrite({
      command,
      context,
      before,
      response,
      buildFallback: queue => {
        const restored = queue.filter(entry => entry.operatorId !== item.operatorId)
        restored.splice(Math.min(Math.max(index, 0), restored.length), 0, item)
        return restored
      },
      messages: {
        success: `${item.operator.name} 已恢复`,
        uncertain: `${item.operator.name} 已恢复，但队列刷新失败，请重试`,
        failure: '撤销失败，请重试',
      },
    })
  }

  private async executeReorder(
    command: Extract<TrainingQueueCommand, { type: 'reorder' }>,
    before: TrainingQueueSnapshot | undefined,
    context: TrainingQueueCommandContext,
  ): Promise<TrainingQueueCommandOutcome> {
    const queue = before?.queue ?? []
    const index = queue.findIndex(item => item.operatorId === command.operatorId)
    if (index < 0) {
      return {
        status: 'failed',
        type: 'reorder',
        operatorId: command.operatorId,
        message: '队列已变化，请重新排序',
      }
    }
    if (
      command.destination < 0
      || command.destination >= queue.length
      || command.destination === index
    ) {
      return { status: 'ignored', type: 'reorder', operatorId: command.operatorId }
    }

    const reordered = moveQueueItem(queue, index, command.destination)
    const response = await this.reorder(reordered.map(item => item.operatorId))

    return this.finishWrite({
      command,
      context,
      before,
      response,
      buildFallback: current => moveOperatorTo(
        current,
        command.operatorId,
        command.destination,
      ),
      messages: {
        success: '养成顺序已更新',
        uncertain: '顺序已更新，但队列刷新失败，请重试',
        failure: '顺序更新失败，请重试',
      },
    })
  }

  /**
   * 写成功后的统一收尾：刷新权威队列；刷新失败时在最新缓存上应用命令效果，
   * 保留可解释 fallback 并标记不确定状态。
   */
  private async finishWrite({
    command,
    context,
    before,
    response,
    buildFallback,
    messages,
    removed,
  }: {
    command: TrainingQueueCommand
    context: TrainingQueueCommandContext
    before: TrainingQueueSnapshot | undefined
    response: ApiResponse<TrainingQueueMutationData>
    buildFallback: (queue: readonly TrainingQueueItem[]) => TrainingQueueItem[]
    messages: WriteMessages
    removed?: TrainingQueueRemovedItem
  }): Promise<TrainingQueueCommandOutcome> {
    const type = command.type
    const operatorId = operatorIdOf(command)
    if (!response.success) {
      return {
        status: 'failed',
        type,
        operatorId,
        message: resolveFailureMessage(response, messages.failure),
      }
    }

    const writeFlowSync = response.data?.flowSync
    const writeRevision = response.data?.queueRevision

    // 写入期间外部失效可能又发起了一次读取；在读取权威快照前取消它们，
    // 避免该读取以写入前的服务端状态覆盖本次结果。
    await context.cancelReads?.()

    let refreshed: TrainingQueueSnapshot | null = null
    try {
      refreshed = await this.readQueue()
    } catch {
      // 写入已经成功；刷新失败只影响本地可确认性，不能伪装成写入失败。
    }

    if (refreshed) {
      // 服务端权威快照不带 `uncertain`，同时清除上一次 fallback 的不确定状态。
      context.commitSnapshot(refreshed)
      this.publish(refreshed.flowSync ?? writeFlowSync)
      return {
        status: 'applied',
        type,
        operatorId,
        snapshot: refreshed,
        message: messages.success,
        flowSync: refreshed.flowSync ?? writeFlowSync,
        removed,
      }
    }

    const latest = context.getSnapshot() ?? before
    const cacheAdvanced = latest !== before || latest?.revision !== before?.revision
    const snapshot: TrainingQueueSnapshot = {
      ...latest,
      queue: buildFallback(latest?.queue ?? []),
      revision: cacheAdvanced ? latest?.revision : writeRevision ?? latest?.revision,
      flowSync: writeFlowSync ?? latest?.flowSync,
      uncertain: TRAINING_QUEUE_UNCERTAIN_MESSAGE,
    }
    context.commitSnapshot(snapshot)
    this.publish(snapshot.flowSync)
    return {
      status: 'uncertain',
      type,
      operatorId,
      snapshot,
      message: messages.uncertain,
      flowSync: snapshot.flowSync,
      removed,
    }
  }

  private publish(flowSync?: TrainingFlowSync): void {
    const resources = flowSync?.status === 'synced'
      ? [...TRAINING_QUEUE_MUTATION_SCOPES, ...TRAINING_QUEUE_FLOW_SYNC_SCOPES]
      : TRAINING_QUEUE_MUTATION_SCOPES
    this.publishInvalidation({
      resources,
      cause: 'training-queue',
      detail: { source: TRAINING_QUEUE_MUTATION_SOURCE },
    })
  }
}

export const trainingQueueCommandOwner = new TrainingQueueCommandOwner()
