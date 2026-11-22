// 设置与队列共享服务端文件，但没有独立端点 revision：`PUT /agent/training/settings`
// 返回归一化后的设置，队列快照的 `revision` 只覆盖队列成员与精英目标；设置版本
// 由本所有者单独维护。

import { isRecord, type ApiResponse } from '@/shared/api'
import {
  publishResourceInvalidation as defaultPublishResourceInvalidation,
  type ResourceInvalidation,
  type ResourceScope,
} from '@/features/resource-invalidation'
import { updateTrainingSettings as defaultUpdateTrainingSettings } from '../api'
import type { TrainingSettings } from '../types'

export const DEFAULT_TRAINING_SETTINGS: TrainingSettings = {
  useMedicine: 0,
  useStone: 0,
  autoSwitch: true,
  notifyOnComplete: true,
}

/** 设置写入失败后的统一页内提示；页面不把失败伪装成已保存。 */
export const TRAINING_SETTINGS_FAILURE_MESSAGE = '设置保存失败，已恢复原设置'

/**
 * 设置写入成功后受影响的作用域。计划是否可应用由设置版本决定，因此只声明
 * `training-plan`；队列成员与材料不受设置影响。
 */
export const TRAINING_SETTINGS_MUTATION_SCOPES = [
  'training-plan',
] as const satisfies readonly ResourceScope[]

/** 供本页忽略自己发布的设置失效；外部发布不需要携带该标记。 */
export const TRAINING_SETTINGS_MUTATION_SOURCE = 'training-settings-owner'

export interface TrainingSettingsMutationInvalidationDetail {
  source: typeof TRAINING_SETTINGS_MUTATION_SOURCE
}

export function isTrainingSettingsInvalidation(
  invalidation: ResourceInvalidation,
): boolean {
  if (invalidation.cause !== 'training-settings') return false
  return isRecord(invalidation.detail)
    && invalidation.detail.source === TRAINING_SETTINGS_MUTATION_SOURCE
}

export type TrainingSettingsSyncState = 'idle' | 'saving' | 'failed'

export type TrainingSettingsPatch = Partial<TrainingSettings>

export interface TrainingSettingsOwnerState {
  /** 页面当前显示并会随计划应用提交的设置。 */
  readonly settings: TrainingSettings
  /** 最近一次已确认写入服务端的设置。 */
  readonly persisted: TrainingSettings
  /** 可观察设置值的版本；值不变时不递增。 */
  readonly revision: number
  readonly syncState: TrainingSettingsSyncState
  readonly error: string | null
}

export interface TrainingSettingsWriteOutcome {
  readonly status: 'saved' | 'failed' | 'ignored'
  readonly settings: TrainingSettings
  /** 后续编辑已让本次结果过期；页面不应据此提示或回滚新草稿。 */
  readonly superseded: boolean
  readonly message?: string
}

export interface TrainingSettingsOwnerOptions {
  write?: (settings: TrainingSettingsPatch) => Promise<ApiResponse<unknown>>
  publish?: (invalidation: ResourceInvalidation) => void
}

const cloneSettings = (settings: TrainingSettings): TrainingSettings => ({ ...settings })

const copyPatch = (patch: TrainingSettingsPatch): TrainingSettingsPatch => {
  const next: TrainingSettingsPatch = {}
  if (patch.useMedicine !== undefined) next.useMedicine = patch.useMedicine
  if (patch.useStone !== undefined) next.useStone = patch.useStone
  if (patch.autoSwitch !== undefined) next.autoSwitch = patch.autoSwitch
  if (patch.notifyOnComplete !== undefined) next.notifyOnComplete = patch.notifyOnComplete
  return next
}

const mergeSettings = (
  settings: TrainingSettings,
  patch: TrainingSettingsPatch,
): TrainingSettings => ({ ...settings, ...patch })

const settingsEqual = (left: TrainingSettings, right: TrainingSettings): boolean => (
  left.useMedicine === right.useMedicine
  && left.useStone === right.useStone
  && left.autoSwitch === right.autoSwitch
  && left.notifyOnComplete === right.notifyOnComplete
)

/**
 * 只接受已知字段与类型；缺失或损坏字段沿用 fallback。
 * 服务端 `normalizeTrainingSettings` 会补齐默认值，这里不重复推断旧别名。
 */
const coerceSettings = (value: unknown, fallback: TrainingSettings): TrainingSettings => {
  if (!isRecord(value)) return cloneSettings(fallback)
  return {
    useMedicine: typeof value.useMedicine === 'number' ? value.useMedicine : fallback.useMedicine,
    useStone: typeof value.useStone === 'number' ? value.useStone : fallback.useStone,
    autoSwitch: typeof value.autoSwitch === 'boolean' ? value.autoSwitch : fallback.autoSwitch,
    notifyOnComplete: typeof value.notifyOnComplete === 'boolean'
      ? value.notifyOnComplete
      : fallback.notifyOnComplete,
  }
}

const resolveFailureMessage = (response: ApiResponse<unknown>): string => {
  const message = response.message || response.errorInfo?.message || response.error
  return typeof message === 'string' && message.trim()
    ? message
    : TRAINING_SETTINGS_FAILURE_MESSAGE
}

const describeError = (error: unknown): string => (
  error instanceof Error && error.message ? error.message : TRAINING_SETTINGS_FAILURE_MESSAGE
)

/**
 * 模块级设置所有者。
 *
 * 寿命不跟随页面：Activity 隐藏或页面重挂载不会重建串行链，也不会让新页面在旧
 * 写入仍在执行时插入第二个并发写。
 */
export class TrainingSettingsOwner {
  private readonly writeRequest: (settings: TrainingSettingsPatch) => Promise<ApiResponse<unknown>>
  private readonly publishInvalidation: (invalidation: ResourceInvalidation) => void

  private tail: Promise<void> = Promise.resolve()
  private generation = 0
  private hydrated = false
  private touched = false
  private state: TrainingSettingsOwnerState = {
    settings: cloneSettings(DEFAULT_TRAINING_SETTINGS),
    persisted: cloneSettings(DEFAULT_TRAINING_SETTINGS),
    revision: 0,
    syncState: 'idle',
    error: null,
  }

  private readonly listeners = new Set<() => void>()

  constructor(options: TrainingSettingsOwnerOptions = {}) {
    this.writeRequest = options.write ?? defaultUpdateTrainingSettings
    this.publishInvalidation = options.publish ?? defaultPublishResourceInvalidation
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState = (): TrainingSettingsOwnerState => this.state

  /** 仅用于测试与明确的全局重置；正常页面生命周期不调用。 */
  reset(): void {
    this.generation += 1
    this.tail = Promise.resolve()
    this.hydrated = false
    this.touched = false
    this.state = {
      settings: cloneSettings(DEFAULT_TRAINING_SETTINGS),
      persisted: cloneSettings(DEFAULT_TRAINING_SETTINGS),
      revision: 0,
      syncState: 'idle',
      error: null,
    }
    this.notify()
  }

  /**
   * 首次成功队列快照的 hydrate。用户已编辑过或已有本地写入时不再采用服务端
   * 值，避免迟到的首屏响应覆盖新草稿。
   */
  hydrate(settings?: TrainingSettings | null): boolean {
    if (!settings || this.hydrated || this.touched) return false
    this.hydrated = true
    return this.adopt(settings)
  }

  /**
   * 采用权威快照中的设置。显式“重新加载”使用该入口；写入在途时忽略，
   * 避免服务端尚未包含本地编辑的中间状态覆盖草稿。
   */
  adopt(settings?: TrainingSettings | null): boolean {
    if (!settings || this.state.syncState === 'saving') return false
    const next = coerceSettings(settings, this.state.settings)
    if (settingsEqual(next, this.state.settings)) {
      if (!settingsEqual(next, this.state.persisted)) {
        this.state = { ...this.state, persisted: next }
        this.notify()
      }
      return false
    }

    this.state = {
      ...this.state,
      settings: next,
      persisted: next,
      revision: this.state.revision + 1,
      syncState: 'idle',
      error: null,
    }
    this.notify()
    return true
  }

  /**
   * 接受一次设置编辑并排入串行写链。
   *
   * 立即更新页面值与 revision（计划据此失效）；写入完成时只有仍是最新编辑的
   * 响应可以确认或回滚页面值。旧响应只更新内部 persisted，供后续失败回滚。
   */
  update(patch: TrainingSettingsPatch): Promise<TrainingSettingsWriteOutcome> {
    const requested = copyPatch(patch)
    const next = mergeSettings(this.state.settings, requested)
    if (settingsEqual(next, this.state.settings)) {
      return Promise.resolve({
        status: 'ignored',
        settings: this.state.settings,
        superseded: false,
      })
    }

    const generation = this.generation
    const revision = this.state.revision + 1
    this.touched = true
    this.state = {
      ...this.state,
      settings: next,
      revision,
      syncState: 'saving',
      error: null,
    }
    this.notify()

    const execute = async (): Promise<TrainingSettingsWriteOutcome> => {
      let saved: TrainingSettings | null = null
      let failure: string | null = null

      try {
        const response = await this.writeRequest(requested)
        if (response.success) {
          saved = coerceSettings(
            response.data,
            mergeSettings(this.state.persisted, requested),
          )
        } else {
          failure = resolveFailureMessage(response)
        }
      } catch (error) {
        failure = describeError(error)
      }

      if (generation !== this.generation) {
        return {
          status: saved ? 'saved' : 'failed',
          settings: saved ?? this.state.settings,
          superseded: true,
          ...(failure ? { message: failure } : {}),
        }
      }

      const latest = revision === this.state.revision
      if (saved) {
        const normalized = saved
        const changed = !settingsEqual(normalized, this.state.settings)
        this.state = {
          ...this.state,
          persisted: normalized,
          ...(latest
            ? {
                settings: normalized,
                revision: changed ? this.state.revision + 1 : this.state.revision,
                syncState: 'idle' as const,
                error: null,
              }
            : {}),
        }
        this.publishInvalidation({
          resources: TRAINING_SETTINGS_MUTATION_SCOPES,
          cause: 'training-settings',
          detail: { source: TRAINING_SETTINGS_MUTATION_SOURCE },
        })
        this.notify()
        return { status: 'saved', settings: normalized, superseded: !latest }
      }

      const message = failure ?? TRAINING_SETTINGS_FAILURE_MESSAGE
      if (latest) {
        const restored = this.state.persisted
        const changed = !settingsEqual(restored, this.state.settings)
        this.state = {
          ...this.state,
          settings: restored,
          revision: changed ? this.state.revision + 1 : this.state.revision,
          syncState: 'failed',
          error: message,
        }
        this.notify()
      }
      return {
        status: 'failed',
        settings: this.state.settings,
        superseded: !latest,
        message,
      }
    }

    const job = this.tail.then(execute, execute)
    this.tail = job.then(() => undefined, () => undefined)
    // 写请求本身在 execute 内已分类；这里兜住状态通知/发布等意外异常，
    // 保证页面拿到的始终是可解释的结果而不是未处理的 rejection。
    return job.catch((error): TrainingSettingsWriteOutcome => ({
      status: 'failed',
      settings: this.state.settings,
      superseded: false,
      message: describeError(error),
    }))
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

export const trainingSettingsOwner = new TrainingSettingsOwner()
