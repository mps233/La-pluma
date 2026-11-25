// 设置页配置草稿的通用所有者：寿命不跟随页面，采用「读取开始时的 revision/dirty/saving
// 快照」裁决迟到读取，保存期间允许继续编辑，只有 revision 未变才确认当前草稿已保存。
// 具体配置的默认值、归一化与写请求由 connection / instance / resource 各自的工厂提供。

import { isRecord, type ApiResponse } from '@/shared/api'

export type ConfigSyncState = 'idle' | 'saving' | 'failed'

export interface ConfigDraftState<T extends Record<string, unknown>> {
  readonly draft: T
  readonly persisted: T
  /** 草稿可观察版本；编辑、采用服务端值与保存成功都会推进。 */
  readonly revision: number
  readonly dirty: boolean
  readonly syncState: ConfigSyncState
  readonly error: string | null
  readonly loaded: boolean
  readonly lastSavedAt: number | null
}

/** 一次读取开始时的草稿版本；用于丢弃迟到响应。 */
export interface ConfigReadToken {
  readonly revision: number
  readonly dirty: boolean
  readonly saving: boolean
}

export interface ConfigSnapshot<T extends Record<string, unknown>> {
  readonly config: T
  readonly readToken: ConfigReadToken
}

export type ConfigSaveStatus = 'saved' | 'failed' | 'ignored'

export interface ConfigSaveOutcome<T extends Record<string, unknown>> {
  readonly status: ConfigSaveStatus
  readonly config: T
  /** 保存期间出现了新编辑或新草稿，本次响应不代表当前页面值。 */
  readonly superseded: boolean
  readonly message?: string
}

export interface ConfigDraftOwnerOptions<T extends Record<string, unknown>> {
  readonly profileName?: string
  readonly write: (profileName: string, config: T) => Promise<ApiResponse<unknown>>
  readonly normalize: (value: unknown) => T | null
  readonly defaultValue: () => T
  readonly failureMessage: string
  /** 深拷贝策略；含嵌套 section 的草稿必须覆盖，避免草稿与持久值共享引用。 */
  readonly clone?: (config: T) => T
  /** 相等比较；含嵌套 section 的草稿使用深比较。 */
  readonly equal?: (left: T, right: T) => boolean
}

const shallowClone = <T extends Record<string, unknown>>(config: T): T => ({ ...config })

/** 深比较配置值：对象键序无关，数组按位置比较。 */
export const configValuesEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => configValuesEqual(value, right[index]))
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) {
      if (!configValuesEqual(left[key], right[key])) return false
    }
    return true
  }
  return false
}

const shallowEqual = (
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean => {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (left[key] !== right[key]) return false
  }
  return true
}

const resolveFailureMessage = (response: ApiResponse<unknown>, fallback: string): string => {
  const message = response.errorInfo?.message || response.message || response.error
  return typeof message === 'string' && message.trim() ? message : fallback
}

const describeError = (error: unknown, fallback: string): string => (
  error instanceof Error && error.message ? error.message : fallback
)

/**
 * 模块级配置草稿所有者。
 *
 * 寿命不跟随页面：真正卸载后重挂载仍能看到未保存草稿；Activity 隐藏只清理
 * Effects，不会取消已发出的保存。测试或明确的全局重置使用 `reset()`。
 */
export class ConfigDraftOwner<T extends Record<string, unknown>> {
  private readonly profileName: string
  private readonly writeRequest: (profileName: string, config: T) => Promise<ApiResponse<unknown>>
  private readonly normalize: (value: unknown) => T | null
  private readonly createDefault: () => T
  private readonly failureMessage: string
  private readonly clone: (config: T) => T
  private readonly equal: (left: T, right: T) => boolean

  private state: ConfigDraftState<T>
  private readonly listeners = new Set<() => void>()

  constructor(options: ConfigDraftOwnerOptions<T>) {
    this.profileName = options.profileName ?? 'default'
    this.writeRequest = options.write
    this.normalize = options.normalize
    this.createDefault = options.defaultValue
    this.failureMessage = options.failureMessage
    this.clone = options.clone ?? shallowClone
    this.equal = options.equal ?? shallowEqual
    this.state = {
      draft: this.clone(this.createDefault()),
      persisted: this.clone(this.createDefault()),
      revision: 0,
      dirty: false,
      syncState: 'idle',
      error: null,
      loaded: false,
      lastSavedAt: null,
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState = (): ConfigDraftState<T> => this.state

  /** 仅用于测试与明确的全局重置；正常页面生命周期不调用。 */
  reset(): void {
    this.state = {
      draft: this.clone(this.createDefault()),
      persisted: this.clone(this.createDefault()),
      revision: 0,
      dirty: false,
      syncState: 'idle',
      error: null,
      loaded: false,
      lastSavedAt: null,
    }
    this.notify()
  }

  /** 记录一次服务端读取的起点，读取返回时交给 `adoptServer()` 裁决。 */
  beginRead(): ConfigReadToken {
    return {
      revision: this.state.revision,
      dirty: this.state.dirty,
      saving: this.state.syncState === 'saving',
    }
  }

  /**
   * 采用服务端读取结果。
   *
   * 只有读取开始后没有新编辑、没有新保存、当前也没有未保存草稿时才接受；
   * 保存成功后 revision 会推进，因此保存前发出的读取即使更晚返回也会被丢弃。
   */
  adoptServer(snapshot: ConfigSnapshot<T>): boolean {
    const normalized = this.normalize(snapshot.config)
    if (!normalized) return false
    if (this.state.syncState === 'saving') return false
    if (snapshot.readToken.saving) return false
    if (snapshot.readToken.revision !== this.state.revision) return false
    if (snapshot.readToken.dirty || this.state.dirty) return false

    const changed = !this.equal(normalized, this.state.draft)
    const persistedChanged = !this.equal(normalized, this.state.persisted)
    const loaded = this.state.loaded
    if (!changed && !persistedChanged && loaded) return false

    this.state = {
      ...this.state,
      draft: changed ? normalized : this.state.draft,
      persisted: normalized,
      revision: changed ? this.state.revision + 1 : this.state.revision,
      syncState: 'idle',
      error: null,
      loaded: true,
    }
    this.notify()
    return changed
  }

  /**
   * 接受一次字段编辑；内容未变化时不推进 revision。
   * 首次服务端读取被采纳前忽略编辑：页面显示的默认值尚未与服务端值比对，
   * 此时推进 revision 会让首次读取被丢弃，草稿将一直停留在未加载状态。
   */
  update(patch: Partial<T>): boolean {
    if (!this.state.loaded) return false
    const next = { ...this.state.draft, ...patch } as T
    if (this.equal(next, this.state.draft)) return false

    this.state = {
      ...this.state,
      draft: next,
      revision: this.state.revision + 1,
      dirty: !this.equal(next, this.state.persisted),
      syncState: this.state.syncState === 'saving' ? 'saving' : 'idle',
      error: null,
    }
    this.notify()
    return true
  }

  /**
   * 保存当前草稿。
   *
   * 首次服务端读取被采纳前（`loaded` 为 false）拒绝保存，避免把页面默认值
   * 写回服务端；保存期间允许继续编辑：响应返回时只有 revision 未变才把当前
   * 草稿视为已保存；否则返回 `superseded`，页面保留新草稿并提示尚未保存。
   */
  async save(): Promise<ConfigSaveOutcome<T>> {
    if (!this.state.loaded) {
      return {
        status: 'ignored',
        config: this.state.draft,
        superseded: false,
        message: '配置尚未从服务端加载完成，已取消保存',
      }
    }

    if (this.state.syncState === 'saving') {
      return {
        status: 'ignored',
        config: this.state.draft,
        superseded: false,
      }
    }

    const snapshot = this.clone(this.state.draft)
    const revisionAtStart = this.state.revision
    this.state = {
      ...this.state,
      syncState: 'saving',
      error: null,
    }
    this.notify()

    let response: ApiResponse<unknown> | null = null
    let failure: string | null = null
    try {
      response = await this.writeRequest(this.profileName, snapshot)
      if (!response.success) {
        failure = resolveFailureMessage(response, this.failureMessage)
      }
    } catch (error) {
      failure = describeError(error, this.failureMessage)
    }

    if (!failure && response?.success) {
      const superseded = revisionAtStart !== this.state.revision
      this.state = {
        ...this.state,
        persisted: snapshot,
        revision: this.state.revision + 1,
        dirty: !this.equal(this.state.draft, snapshot),
        syncState: 'idle',
        error: null,
        loaded: true,
        lastSavedAt: Date.now(),
      }
      this.notify()
      return { status: 'saved', config: snapshot, superseded }
    }

    const message = failure ?? this.failureMessage
    const superseded = revisionAtStart !== this.state.revision
    this.state = {
      ...this.state,
      syncState: 'failed',
      error: message,
    }
    this.notify()
    return {
      status: 'failed',
      config: this.state.draft,
      superseded,
      message,
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
