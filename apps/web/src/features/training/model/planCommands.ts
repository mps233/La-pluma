// 计划所有者是模块级单例：Activity 隐藏或页面重挂载不会重建计划状态或取消在途写请求。

import { isRecord, type ApiResponse } from '@/shared/api'
import {
  publishResourceInvalidation as defaultPublishResourceInvalidation,
  type ResourceInvalidation,
  type ResourceScope,
} from '@/features/resource-invalidation'
import {
  USER_CONFIG_KEYS,
  userConfigCoordinator,
  type ConfigSettleResult,
} from '@/features/user-config'
import {
  applyTrainingPlan as defaultApplyTrainingPlan,
  generateTrainingPlan as defaultGenerateTrainingPlan,
  retryTrainingSync as defaultRetryTrainingSync,
  type ApplyTrainingPlanData,
  type TrainingPlanOptions,
} from '../api'
import type {
  TrainingFlowSync,
  TrainingPlan,
  TrainingQueueSnapshot,
  TrainingSettings,
} from '../types'
import { getOpenStagePlan } from './planDisplay'
import {
  canApplyTrainingPlan,
  canGenerateTrainingPlan,
  captureTrainingPlanBasis,
  isTrainingPlanBasisCurrent,
  type TrainingPlanBasis,
  type TrainingPlanBasisContext,
} from './planValidity'
import {
  trainingSettingsOwner,
  type TrainingSettingsOwnerState,
} from './settingsCommands'

/** 应用计划成功后受影响的作用域；写入确认成功才发布。 */
export const TRAINING_PLAN_APPLIED_SCOPES = [
  'automation-config',
  'automation-schedule',
  'dashboard-snapshot',
] as const satisfies readonly ResourceScope[]

/**
 * 任务流程同步（队列写入、重试同步）只改写 automation 配置。
 *
 * 这些路径不会重注册已存在的定时任务，因此不能发布 `automation-schedule`；
 * 该作用域只属于显式应用计划（服务端会重新注册）。Dashboard 仍需刷新快照。
 */
export const TRAINING_FLOW_SYNCED_SCOPES = [
  'automation-config',
  'dashboard-snapshot',
] as const satisfies readonly ResourceScope[]

export const TRAINING_PLAN_APPLIED_SOURCE = 'training-plan-owner'

export const TRAINING_PLAN_PARTIAL_REFRESH_MESSAGE =
  '计划已应用，但读取最新队列失败；请重新加载后确认状态'

export const TRAINING_PLAN_PARTIAL_SCHEDULE_MESSAGE =
  '计划已应用，但定时任务刷新失败；请重试应用或检查定时设置'

export const TRAINING_PLAN_BLOCKED_CONFIG_MESSAGE =
  '自动化配置仍有未同步的本地编辑，请先完成同步后再应用计划'

export const TRAINING_PLAN_BASIS_CHANGED_MESSAGE = '计划前提已变化，请重新预览计划'

export const TRAINING_PLAN_STALE_MESSAGE = '计划已过期，请重新预览计划后再应用'

export const TRAINING_PLAN_STALE_GAME_DAY_MESSAGE = '游戏日已变化，请重新预览计划后再应用'

export const TRAINING_PLAN_STALE_CLIENT_TYPE_MESSAGE = '客户端区服已变化，请重新预览计划后再应用'

export const TRAINING_PLAN_STALE_STAGE_CLOSED_MESSAGE = '计划中的资源关卡已关闭，请重新预览计划后再应用'

const TRAINING_PLAN_STALE_CODE = 'AGENT_TRAINING_PLAN_STALE'

export const DEFAULT_TRAINING_FLOW_SYNC: TrainingFlowSync = {
  status: 'not_applied',
  flowName: '自动任务',
}

export type TrainingPlanOperation = 'generate' | 'apply' | 'sync'

export interface TrainingPlanOwnerState {
  readonly plan: TrainingPlan | null
  readonly basis: TrainingPlanBasis | null
  readonly error: string | null
  /** 写操作已生效但后续权威读取失败；页面提供独立重试入口。 */
  readonly warning: string | null
  readonly flowSync: TrainingFlowSync
  readonly operation: TrainingPlanOperation | null
}

export type TrainingPlanGenerateOutcome =
  | { readonly status: 'generated'; readonly plan: TrainingPlan; readonly basis: TrainingPlanBasis }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'stale'; readonly message: string }
  | { readonly status: 'ignored' }

export type TrainingPlanApplyOutcome =
  | {
      readonly status: 'applied'
      readonly flowSync: TrainingFlowSync
      readonly flowName: string
      readonly stageCount: number | null
    }
  | {
      readonly status: 'partial'
      readonly message: string
      readonly flowSync: TrainingFlowSync
      readonly flowName: string
      readonly stageCount: number | null
    }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'blocked'; readonly message: string }
  | { readonly status: 'ignored' }

export type TrainingPlanSyncOutcome =
  | { readonly status: 'synced'; readonly flowSync: TrainingFlowSync | null }
  | { readonly status: 'partial'; readonly message: string; readonly flowSync: TrainingFlowSync | null }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'ignored' }

/**
 * 计划所有者使用的队列上下文。由 React 适配层注入应用级 QueryClient 与
 * 设置所有者；所有者自身不依赖 React 或某个页面实例。
 */
export interface TrainingPlanQueueContext {
  getSnapshot(): TrainingQueueSnapshot | undefined
  /** 强制读取权威队列；失败返回 null，不抛给调用方。 */
  refetch(): Promise<TrainingQueueSnapshot | null>
  /** 队列有数据但刷新失败（含 uncertain fallback）。 */
  isRefreshFailed(): boolean
  isQueueMutationPending(): boolean
  adoptSettings(settings?: TrainingSettings | null): boolean
}

export interface TrainingPlanOwnerOptions {
  generatePlan?: (options: TrainingPlanOptions) => Promise<ApiResponse>
  applyPlan?: (data: ApplyTrainingPlanData) => Promise<ApiResponse>
  retrySync?: () => Promise<ApiResponse>
  publish?: (invalidation: ResourceInvalidation) => void
  settleAutomationConfig?: () => Promise<ConfigSettleResult>
  readSettings?: () => TrainingSettingsOwnerState
  subscribeSettings?: (listener: () => void) => () => void
}

const flowSyncEqual = (left: TrainingFlowSync, right: TrainingFlowSync): boolean => (
  left.status === right.status
  && left.flowName === right.flowName
  && left.taskName === right.taskName
  && left.error === right.error
  && left.syncedRevision === right.syncedRevision
)

const readFlowSync = (value: unknown): TrainingFlowSync | null => {
  if (!isRecord(value)) return null
  const status = value.status
  if (status !== 'not_applied' && status !== 'synced' && status !== 'failed') return null
  return {
    status,
    flowName: typeof value.flowName === 'string' && value.flowName ? value.flowName : '自动任务',
    ...(typeof value.taskName === 'string' && value.taskName ? { taskName: value.taskName } : {}),
    ...(typeof value.error === 'string' && value.error ? { error: value.error } : {}),
    ...(typeof value.syncedRevision === 'string' && value.syncedRevision
      ? { syncedRevision: value.syncedRevision }
      : {}),
  }
}

const resolveFailureMessage = (response: ApiResponse<unknown>, fallback: string): string => {
  const message = response.message || response.errorInfo?.message || response.error
  return typeof message === 'string' && message.trim() ? message : fallback
}

const describeError = (error: unknown, fallback: string): string => (
  error instanceof Error && error.message ? error.message : fallback
)

const readResponseData = (response: ApiResponse): Record<string, unknown> => (
  isRecord(response.data) ? response.data : {}
)

const readPlanBasisContext = (plan: TrainingPlan): TrainingPlanBasisContext => {
  const summary: unknown = plan.summary
  if (!isRecord(summary)) return { gameDate: null, clientType: null }
  return {
    gameDate: typeof summary.gameDate === 'string' ? summary.gameDate : null,
    clientType: typeof summary.clientType === 'string' ? summary.clientType : null,
  }
}

const readClosedStages = (details: unknown): string[] => {
  if (!isRecord(details) || !Array.isArray(details.closedStages)) return []
  return details.closedStages
    .filter((stage): stage is string => typeof stage === 'string' && stage.trim() !== '')
    .map(stage => stage.trim())
}

const describeStalePlanMessage = (response: ApiResponse): string | null => {
  const errorInfo = response.errorInfo
  if (!isRecord(errorInfo)) return null
  const details: unknown = errorInfo.details
  const reason = isRecord(details) ? details.reason : null
  const codeIsStale = errorInfo.code === TRAINING_PLAN_STALE_CODE
  if (
    !codeIsStale
    && reason !== 'game_day'
    && reason !== 'client_type'
    && reason !== 'stage_closed'
  ) {
    return null
  }
  if (reason === 'game_day') return TRAINING_PLAN_STALE_GAME_DAY_MESSAGE
  if (reason === 'client_type') return TRAINING_PLAN_STALE_CLIENT_TYPE_MESSAGE
  if (reason === 'stage_closed') {
    const closedStages = readClosedStages(details)
    return closedStages.length > 0
      ? `计划中的资源关卡已关闭（${closedStages.join('、')}），请重新预览计划后再应用`
      : TRAINING_PLAN_STALE_STAGE_CLOSED_MESSAGE
  }
  return TRAINING_PLAN_STALE_MESSAGE
}

const defaultSettleAutomationConfig = (): Promise<ConfigSettleResult> => (
  userConfigCoordinator.settle([USER_CONFIG_KEYS.automationTasks])
)

/**
 * 模块级计划所有者。
 *
 * 同一时刻只允许一个生成/应用/同步操作；重复触发返回 `ignored`，不会产生
 * 第二个写请求。设置 revision 变化由订阅直接作废旧计划，避免页面 Effect 的
 * 延迟把刚按新设置生成的计划误判为过期。
 */
export class TrainingPlanOwner {
  private readonly generatePlan: (options: TrainingPlanOptions) => Promise<ApiResponse>
  private readonly applyPlan: (data: ApplyTrainingPlanData) => Promise<ApiResponse>
  private readonly retrySyncRequest: () => Promise<ApiResponse>
  private readonly publishInvalidation: (invalidation: ResourceInvalidation) => void
  private readonly settleAutomationConfig: () => Promise<ConfigSettleResult>
  private readonly readSettings: () => TrainingSettingsOwnerState
  private readonly unsubscribeSettings: () => void

  private generation = 0
  private queueRevision: string | null = null
  private observedSettingsRevision: number
  private state: TrainingPlanOwnerState
  private readonly listeners = new Set<() => void>()

  constructor(options: TrainingPlanOwnerOptions = {}) {
    this.generatePlan = options.generatePlan ?? defaultGenerateTrainingPlan
    this.applyPlan = options.applyPlan ?? defaultApplyTrainingPlan
    this.retrySyncRequest = options.retrySync ?? defaultRetryTrainingSync
    this.publishInvalidation = options.publish ?? defaultPublishResourceInvalidation
    this.settleAutomationConfig = options.settleAutomationConfig ?? defaultSettleAutomationConfig
    this.readSettings = options.readSettings ?? (() => trainingSettingsOwner.getState())
    this.unsubscribeSettings = (options.subscribeSettings ?? (listener => trainingSettingsOwner.subscribe(listener)))(
      this.handleSettingsChange,
    )
    this.observedSettingsRevision = this.readSettings().revision
    this.state = this.createInitialState()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState = (): TrainingPlanOwnerState => this.state

  /** 停止订阅设置所有者；仅用于测试或应用级销毁。 */
  dispose(): void {
    this.unsubscribeSettings()
  }

  /** 仅用于测试与明确的全局重置；正常页面生命周期不调用。 */
  reset(): void {
    this.generation += 1
    this.queueRevision = null
    this.observedSettingsRevision = this.readSettings().revision
    this.state = this.createInitialState()
    this.notify()
  }

  /** 作废旧计划与提示；递增 generation 使迟到的生成响应失效。 */
  invalidate(): void {
    this.generation += 1
    if (!this.state.plan && !this.state.basis && !this.state.error) return
    this.state = {
      ...this.state,
      plan: null,
      basis: null,
      error: null,
    }
    this.notify()
  }

  /**
   * 观察队列快照：revision 变化作废旧计划；空闲时采用快照的 flowSync。
   * 写操作期间不采用快照 flowSync，避免后台刷新覆盖写入响应。
   */
  observeQueueSnapshot(snapshot: TrainingQueueSnapshot | undefined): void {
    if (!snapshot) return

    const revision = snapshot.revision
    if (revision) {
      const previous = this.queueRevision
      this.queueRevision = revision
      if (previous && previous !== revision) this.invalidate()
    }

    if (
      snapshot.flowSync
      && this.state.operation !== 'apply'
      && this.state.operation !== 'sync'
    ) {
      this.setFlowSync(snapshot.flowSync)
    }
  }

  /** 队列命令同步任务流程后更新横幅；失效发布由队列命令统一负责。 */
  recordFlowSync(flowSync?: TrainingFlowSync): void {
    if (!flowSync) return
    this.setFlowSync(flowSync)
  }

  async generate(
    mode: TrainingPlanOptions['mode'],
    context: TrainingPlanQueueContext,
  ): Promise<TrainingPlanGenerateOutcome> {
    if (this.state.operation !== null || context.isQueueMutationPending()) {
      return { status: 'ignored' }
    }

    const snapshot = context.getSnapshot()
    const refreshFailed = context.isRefreshFailed()
    const hasQueue = Boolean(snapshot && snapshot.queue.length > 0)
    if (refreshFailed) {
      const message = '队列刷新失败，请重新加载后预览'
      this.setError(message)
      return { status: 'failed', message }
    }
    if (!hasQueue) {
      const message = '养成队列为空，请先添加干员'
      this.setError(message)
      return { status: 'failed', message }
    }
    if (!canGenerateTrainingPlan({ hasQueue, busy: false, refreshFailed })) {
      return { status: 'ignored' }
    }

    let request = ++this.generation
    this.state = {
      ...this.state,
      operation: 'generate',
      plan: null,
      basis: null,
      error: null,
      warning: null,
    }
    this.notify()

    try {
      const fresh = await this.refreshQueue(context)
      // 重读期间的自身版本推进（采用外部设置/队列）不算外部变化：冻结 basis 前重新取号。
      request = ++this.generation
      if (!fresh) throw new Error('队列刷新失败，请重新加载后预览')
      if (!fresh.queue.length) throw new Error('养成队列为空，请先添加干员')

      const basis = captureTrainingPlanBasis(fresh.revision, this.readSettings().revision)
      const response = await this.generatePlan({ mode })
      if (request !== this.generation) {
        const message = TRAINING_PLAN_BASIS_CHANGED_MESSAGE
        if (!this.state.error) this.setError(message)
        return { status: 'stale', message }
      }
      if (!response.success || !response.data) {
        throw new Error(resolveFailureMessage(response, '生成计划失败，请重试'))
      }

      const generated = response.data as TrainingPlan
      if (generated.queueRevision && fresh.revision && generated.queueRevision !== fresh.revision) {
        await this.refreshQueue(context)
        const message = '养成队列已变化，请重新预览计划'
        this.setError(message)
        return { status: 'failed', message }
      }

      const planBasis = captureTrainingPlanBasis(
        basis.queueRevision,
        basis.settingsRevision,
        readPlanBasisContext(generated),
      )
      // 生成期间若有版本变化但页面 Effect 尚未运行，响应返回时仍按实时版本裁决。
      if (!isTrainingPlanBasisCurrent(planBasis, this.currentBasis(context))) {
        await this.refreshQueue(context)
        const message = TRAINING_PLAN_BASIS_CHANGED_MESSAGE
        this.setError(message)
        return { status: 'failed', message }
      }

      this.state = {
        ...this.state,
        plan: generated,
        basis: planBasis,
        error: null,
        warning: null,
      }
      this.notify()
      return { status: 'generated', plan: generated, basis: planBasis }
    } catch (error) {
      const message = describeError(error, '生成计划失败，请重试')
      if (request === this.generation || !this.state.error) this.setError(message)
      return { status: 'failed', message }
    } finally {
      this.finishOperation('generate')
    }
  }

  async apply(context: TrainingPlanQueueContext): Promise<TrainingPlanApplyOutcome> {
    const plan = this.state.plan
    const basis = this.state.basis
    if (!plan || !basis) return { status: 'ignored' }
    if (this.state.operation !== null || context.isQueueMutationPending()) {
      return { status: 'ignored' }
    }

    const available = canApplyTrainingPlan({
      hasPlan: true,
      busy: false,
      refreshFailed: context.isRefreshFailed(),
      basisCurrent: isTrainingPlanBasisCurrent(basis, this.currentBasis(context)),
    })
    if (!available) {
      const message = TRAINING_PLAN_BASIS_CHANGED_MESSAGE
      this.setError(message)
      return { status: 'failed', message }
    }

    const todayPlan = getOpenStagePlan(plan)
    if (!todayPlan.stages?.length) return { status: 'ignored' }

    const warningBeforeApply = this.state.warning
    this.state = { ...this.state, operation: 'apply', error: null, warning: null }
    this.notify()

    try {
      // 同一配置协调协议：先等 automation 的在途提交落盘，仍有未确认草稿则拒绝应用，
      // 避免旧保存后到覆盖刚刚应用的计划。
      let settled: ConfigSettleResult
      try {
        settled = await this.settleAutomationConfig()
      } catch {
        settled = { pendingKeys: [USER_CONFIG_KEYS.automationTasks] }
      }
      if (settled.pendingKeys.length > 0) {
        this.setError(TRAINING_PLAN_BLOCKED_CONFIG_MESSAGE)
        return { status: 'blocked', message: TRAINING_PLAN_BLOCKED_CONFIG_MESSAGE }
      }

      // 排空等待期间设置或队列可能变化，提交前再按实时版本校验一次。
      if (
        !isTrainingPlanBasisCurrent(basis, this.currentBasis(context))
        || context.isRefreshFailed()
      ) {
        const message = TRAINING_PLAN_BASIS_CHANGED_MESSAGE
        this.setError(message)
        return { status: 'failed', message }
      }

      const response = await this.applyPlan({
        plan: todayPlan,
        settings: this.readSettings().settings,
      })
      if (!response.success) {
        const staleMessage = describeStalePlanMessage(response)
        if (staleMessage) {
          this.invalidate()
          await this.refreshQueue(context)
          this.state = {
            ...this.state,
            error: staleMessage,
            warning: warningBeforeApply,
          }
          this.notify()
          return { status: 'failed', message: staleMessage }
        }
        throw new Error(resolveFailureMessage(response, '应用失败，请重新预览后重试'))
      }

      const data = readResponseData(response)
      const flowSync = readFlowSync(data.flowSync) ?? {
        status: 'synced' as const,
        flowName: typeof data.flowName === 'string' && data.flowName
          ? data.flowName
          : this.state.flowSync.flowName,
        ...(typeof data.taskName === 'string' && data.taskName ? { taskName: data.taskName } : {}),
      }
      const stageCount = typeof data.stageCount === 'number' && Number.isFinite(data.stageCount)
        ? data.stageCount
        : null
      // 服务端在配置与队列落盘后尝试重新注册已存在的定时任务；失败属于部分成功，
      // 不回滚已应用的计划，但必须让用户看到并可重试。
      const scheduleSync = isRecord(data.scheduleSync) ? data.scheduleSync : null
      const scheduleFailed = scheduleSync?.attempted === true && scheduleSync.success === false
      const scheduleMessage = scheduleFailed
        ? (typeof scheduleSync.message === 'string' && scheduleSync.message
            ? `${TRAINING_PLAN_PARTIAL_SCHEDULE_MESSAGE}（${scheduleSync.message}）`
            : TRAINING_PLAN_PARTIAL_SCHEDULE_MESSAGE)
        : null
      this.setFlowSync(flowSync)

      // 服务端已确认写入：先发布失效，后续权威读取失败也不回滚或重复应用。
      this.publishInvalidation({
        resources: TRAINING_PLAN_APPLIED_SCOPES,
        cause: 'plan-applied',
        detail: {
          stageCount,
          flowName: flowSync.flowName,
          taskName: flowSync.taskName,
          source: TRAINING_PLAN_APPLIED_SOURCE,
        },
      })

      const refreshed = await this.refreshQueue(context)
      const warnings = [
        ...(scheduleMessage ? [scheduleMessage] : []),
        ...(refreshed ? [] : [TRAINING_PLAN_PARTIAL_REFRESH_MESSAGE]),
      ]
      if (warnings.length > 0) {
        const message = warnings.join('；')
        this.state = { ...this.state, warning: message }
        this.notify()
        return {
          status: 'partial',
          message,
          flowSync,
          flowName: flowSync.flowName,
          stageCount,
        }
      }
      return { status: 'applied', flowSync, flowName: flowSync.flowName, stageCount }
    } catch (error) {
      const message = describeError(error, '应用失败，请重新预览后重试')
      this.invalidate()
      await this.refreshQueue(context)
      this.setError(message)
      return { status: 'failed', message }
    } finally {
      this.finishOperation('apply')
    }
  }

  async retrySync(context: TrainingPlanQueueContext): Promise<TrainingPlanSyncOutcome> {
    if (this.state.operation !== null || context.isQueueMutationPending()) {
      return { status: 'ignored' }
    }

    this.state = { ...this.state, operation: 'sync', warning: null }
    this.notify()

    try {
      const response = await this.retrySyncRequest()
      const responseSync = readFlowSync(readResponseData(response).flowSync)
      const refreshed = await this.refreshQueue(context)
      if (!response.success && !responseSync) {
        throw new Error(resolveFailureMessage(response, '同步失败，请重试'))
      }
      const resolvedSync = responseSync ?? refreshed?.flowSync ?? null

      if (resolvedSync) this.setFlowSync(resolvedSync)
      if (resolvedSync?.status === 'failed') {
        return { status: 'failed', message: resolvedSync.error || '同步失败，请重试' }
      }

      if (resolvedSync?.status === 'synced') {
        this.publishInvalidation({
          resources: TRAINING_FLOW_SYNCED_SCOPES,
          cause: 'plan-applied',
          detail: {
            stageCount: null,
            flowName: resolvedSync.flowName,
            taskName: resolvedSync.taskName,
            source: TRAINING_PLAN_APPLIED_SOURCE,
          },
        })
      }

      if (!refreshed) {
        const message = TRAINING_PLAN_PARTIAL_REFRESH_MESSAGE
        this.state = { ...this.state, warning: message }
        this.notify()
        return { status: 'partial', message, flowSync: resolvedSync }
      }
      return { status: 'synced', flowSync: resolvedSync }
    } catch (error) {
      const message = describeError(error, '同步失败，请重试')
      this.setFlowSync({ ...this.state.flowSync, status: 'failed', error: message })
      return { status: 'failed', message }
    } finally {
      this.finishOperation('sync')
    }
  }

  /**
   * 显式“重新加载”与外部失效使用。成功后只清除“读取队列失败”这一类提示；
   * 定时注册失败或混合提示需要重新应用计划才能修复，不能被一次成功读取掩盖。
   */
  async reload(context: TrainingPlanQueueContext): Promise<TrainingQueueSnapshot | null> {
    const snapshot = await this.refreshQueue(context)
    if (snapshot && this.state.warning === TRAINING_PLAN_PARTIAL_REFRESH_MESSAGE) {
      this.state = { ...this.state, warning: null }
      this.notify()
    }
    return snapshot
  }

  private createInitialState(): TrainingPlanOwnerState {
    return {
      plan: null,
      basis: null,
      error: null,
      warning: null,
      flowSync: { ...DEFAULT_TRAINING_FLOW_SYNC },
      operation: null,
    }
  }

  private currentBasis(context: TrainingPlanQueueContext): TrainingPlanBasis {
    const snapshot = context.getSnapshot()
    return captureTrainingPlanBasis(
      snapshot?.revision,
      this.readSettings().revision,
      {
        gameDate: snapshot?.gameDate,
        clientType: snapshot?.clientType,
      },
    )
  }

  private async refreshQueue(
    context: TrainingPlanQueueContext,
  ): Promise<TrainingQueueSnapshot | null> {
    const settingsBefore = this.readSettings()
    let snapshot: TrainingQueueSnapshot | null
    try {
      snapshot = await context.refetch()
    } catch {
      return null
    }
    if (!snapshot) return null

    this.observeQueueSnapshot(snapshot)

    // 读取期间本地设置若发生编辑或写入完成，本次快照的设置可能早于本地值，不采用。
    const settingsAfter = this.readSettings()
    if (
      settingsBefore.syncState !== 'saving'
      && settingsAfter.syncState !== 'saving'
      && settingsBefore.revision === settingsAfter.revision
    ) {
      context.adoptSettings(snapshot.settings)
    }
    return snapshot
  }

  private handleSettingsChange = (): void => {
    const revision = this.readSettings().revision
    if (revision === this.observedSettingsRevision) return
    this.observedSettingsRevision = revision
    this.invalidate()
  }

  private setFlowSync(flowSync: TrainingFlowSync): void {
    if (flowSyncEqual(this.state.flowSync, flowSync)) return
    this.state = { ...this.state, flowSync }
    this.notify()
  }

  private setError(message: string): void {
    this.state = { ...this.state, error: message, warning: null }
    this.notify()
  }

  private finishOperation(operation: TrainingPlanOperation): void {
    if (this.state.operation !== operation) return
    this.state = { ...this.state, operation: null }
    this.notify()
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

export const trainingPlanOwner = new TrainingPlanOwner()
