// 按配置 key 串行提交，状态与队列的寿命不跟随页面：协调器实例由应用持有，重挂载不重建。
// 协调器不理解字段语义，完整提交由适配器 `commit` 定义；旧提交的成功/失败不能确认或覆盖
// 更新的草稿，本地未确认草稿跨挂载优先，迟到的加载/提交响应都重新校验身份。

import { USER_CONFIG_PENDING_KEYS, type UserConfigKey } from './configKeys'

/** 协调器使用的键值存储；生产为 localStorage，测试注入内存实现。 */
export interface ConfigKeyStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * 一次完整提交的结果。`ok: false` 表示尚未完整持久化——协调器必须保留 pending
 * 草稿与重试入口，不能因为其中一部分请求成功就确认草稿。
 */
export type ConfigCommitResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

/** 一次服务端读取的结果；载荷是否可用由适配器的 `decodeDraft` 判定。 */
export type ConfigLoadResult =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly message: string }

/**
 * 配置 key 的持久化适配器。
 *
 * 适配器是域内唯一的配置所有者：本地草稿布局、服务端 wire 格式、旧格式迁移、
 * 提交时机和完整提交条件都在这里定义。协调器按 `key` 注册实现，因此同一 key
 * 的适配器必须同构（同一 pending 键、同一 wire 语义、同一完整提交条件）；
 * 页面重挂载可以用新实例替换实现，但队列与状态不会因此重置。
 */
export interface ConfigPersistenceAdapter<TDraft, TWire = unknown> {
  /** 服务端配置 key（如 `combat-tasks`），同时是协调器中的唯一身份。 */
  readonly key: string
  readonly pendingKey: string
  /**
   * 编辑到提交的延迟。`0` 表示每次编辑立即入队（automation 的事件触发策略）；
   * 大于 0 表示去抖，只提交最后一次编辑（combat/roguelike 的 300ms 策略）。
   * 无论哪种策略，提交都在同一队列中串行。
   */
  readonly commitDelayMs?: number
  /**
   * 编辑到本地草稿写入的延迟，默认 `0`（立即写入）。较大的草稿在连续输入时
   * 反复序列化与 `localStorage.setItem` 会阻塞主线程；设置该值后只写最后一次
   * 草稿，并在提交、`flush`、`dispose` 或页面卸载前强制落盘。
   */
  readonly localWriteDelayMs?: number
  readonly restoredMessage?: string
  readonly formatFailure?: (message: string) => string

  /** draft → 服务端 wire 载荷。不得包含只属于界面的字段。 */
  encodeDraft(draft: TDraft): TWire
  /**
   * 服务端载荷 → draft；同时承担旧格式迁移与形状校验。
   * 返回 null 表示该载荷不可用，协调器随后回退到本地草稿。
   */
  decodeDraft(payload: unknown): TDraft | null
  /**
   * 读取本设备草稿。缺失、单个损坏键清理后都应返回 null，而不是抛出；
   * 返回 null 且存在 pending 标记时，协调器会把标记视为无草稿可恢复。
   */
  readLocalDraft(): TDraft | null
  /** 写入本设备草稿，必须与 `readLocalDraft` 对称。 */
  writeLocalDraft(draft: TDraft): void
  /** 完整提交；只有整份配置（含域内附带的写入，如 schedule）全部成功才返回 ok。 */
  commit(wire: TWire): Promise<ConfigCommitResult>
  /** 读取服务端配置；应在 signal 中止时停止继续处理响应。 */
  fetch(options: { signal: AbortSignal }): Promise<ConfigLoadResult>
  /** 草稿等价判断（默认对 wire 做 JSON 序列化），用于跳过重复提交。 */
  fingerprint?(draft: TDraft): string
}

/**
 * 同步状态：`queued` 表示草稿已接受、等待去抖或队列；`saving` 表示当前草稿
 * 正在提交；`failed` 表示当前草稿未能完整持久化（含挂载时恢复的旧草稿）。
 */
export type ConfigSyncState = 'idle' | 'queued' | 'saving' | 'failed'

/**
 * 读取状态：`idle` 表示尚未开始，`loading` 表示请求或本地恢复进行中，
 * `ready` 表示已有可用草稿，`failed` 表示读取失败且没有可回退草稿。
 */
export type ConfigLoadState = 'idle' | 'loading' | 'ready' | 'failed'

export interface ConfigCoordinatorState<TDraft> {
  /** 最近一次接受或加载的草稿；首次加载完成前为 null。 */
  readonly draft: TDraft | null
  /** 是否已有可用草稿（服务端、本地回退或恢复的未同步草稿）。读取失败仍为 false。 */
  readonly hydrated: boolean
  readonly pending: boolean
  readonly syncState: ConfigSyncState
  /** 最近一次同步失败的可展示原因；完整提交成功后清空。 */
  readonly error: string | null
  readonly loadState: ConfigLoadState
  /** 最近一次读取失败的可展示原因；开始新的读取时清空。 */
  readonly loadError: string | null
  /** 每次接受新草稿递增；用于页面判断编辑与提交的对应关系。 */
  readonly revision: number
  readonly lastSavedAt: number | null
}

export type ConfigReloadReason =
  | 'loaded'
  /** 未确认的本地草稿优先，未读取服务端。 */
  | 'local-draft'
  | 'skipped'
  /** 加载期间出现新草稿或新加载，本次结果被丢弃。 */
  | 'stale'
  /** 服务端读取失败且没有可回退的草稿；下次 hydrate 会重试。 */
  | 'failed'

export interface ConfigReloadOutcome {
  readonly reason: ConfigReloadReason
}

/**
 * 单个配置 key 的协调通道。同一协调器对同一 key 始终返回同一通道，
 * 因此状态、队列和定时器跨页面挂载复用。
 */
export interface ConfigChannel<TDraft> {
  readonly key: string
  readonly getState: () => ConfigCoordinatorState<TDraft>
  readonly subscribe: (listener: () => void) => () => void
  /** 首次加载；已加载时返回 `skipped`。 */
  readonly hydrate: () => Promise<ConfigReloadOutcome>
  /** 重新读取；`force` 绕过已加载守卫，但不覆盖未确认的本地草稿。 */
  readonly reload: (options?: { force?: boolean }) => Promise<ConfigReloadOutcome>
  /** 接受一份新草稿：写本地、生成新 revision/token，并按适配器策略安排提交。 */
  readonly setDraft: (draft: TDraft) => void
  /** 立即提交当前草稿并等待结果；返回当前 revision 是否已被确认。 */
  readonly commitNow: () => Promise<boolean>
  /** 立即触发待提交的草稿并等待队列空闲。 */
  readonly flush: () => Promise<void>
  /** 立即把待写入的本地草稿落盘；页面卸载或隐藏前调用。 */
  readonly flushLocalDraft: () => void
  /** 停止定时器与在途加载，不清除草稿或 pending 标记；待写入草稿先落盘。 */
  readonly dispose: () => void
}

export const DEFAULT_RESTORED_MESSAGE = '上次更改已保存在此设备，但尚未同步到服务器。'
export const DEFAULT_LOAD_FAILURE_MESSAGE = '无法读取配置，请稍后重试'
const DEFAULT_FAILURE_PREFIX = '配置已保存在此设备，但尚未同步到服务器'

interface CommitSnapshot<TDraft> {
  readonly revision: number
  readonly draft: TDraft
  readonly token: string
}

interface ConfigKeyStateOptions<TDraft, TWire> {
  adapter: ConfigPersistenceAdapter<TDraft, TWire>
  storage: ConfigKeyStorage
  clock: () => number
  nextToken: () => string
}

function createNoopStorage(): ConfigKeyStorage {
  return {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  }
}

function toSafeStorage(target: ConfigKeyStorage | null): ConfigKeyStorage {
  if (!target) return createNoopStorage()
  return {
    getItem(key) {
      try {
        return target.getItem(key)
      } catch {
        return null
      }
    },
    setItem(key, value) {
      try {
        target.setItem(key, value)
      } catch {
        // pending 标记写不进去时，本次会话仍按内存状态提交。
      }
    },
    removeItem(key) {
      try {
        target.removeItem(key)
      } catch {
        // 忽略存储失败；内存状态已经先被清除。
      }
    },
  }
}

/** 默认键值存储：浏览器 localStorage；没有 localStorage 的环境退化为 no-op。 */
export function createConfigKeyStorage(storage?: Storage | null): ConfigKeyStorage {
  const target = storage === undefined
    ? (typeof localStorage === 'undefined' ? null : localStorage)
    : storage
  return toSafeStorage(target)
}

class ConfigKeyState<TDraft, TWire> implements ConfigChannel<TDraft> {
  readonly key: string

  private adapter: ConfigPersistenceAdapter<TDraft, TWire>
  private readonly storage: ConfigKeyStorage
  private readonly clock: () => number
  private readonly nextToken: () => string
  private readonly listeners = new Set<() => void>()

  private state: ConfigCoordinatorState<TDraft> = Object.freeze({
    draft: null as TDraft | null,
    hydrated: false,
    pending: false,
    syncState: 'idle' as ConfigSyncState,
    error: null,
    loadState: 'idle' as ConfigLoadState,
    loadError: null,
    revision: 0,
    lastSavedAt: null,
  })

  private draft: TDraft | null = null
  private hydrated = false
  private pending = false
  private syncState: ConfigSyncState = 'idle'
  private error: string | null = null
  private loadState: ConfigLoadState = 'idle'
  private loadError: string | null = null
  private revision = 0
  private lastSavedAt: number | null = null

  private token: string | null = null
  private fingerprint: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private localWriteTimer: ReturnType<typeof setTimeout> | null = null
  private pendingLocalDraft: TDraft | null = null
  private queueTail: Promise<void> = Promise.resolve()
  private loadSequence = 0
  private loadAbort: AbortController | null = null
  private inflightLoad: Promise<ConfigReloadOutcome> | null = null

  constructor(options: ConfigKeyStateOptions<TDraft, TWire>) {
    this.adapter = options.adapter
    this.key = options.adapter.key
    this.storage = options.storage
    this.clock = options.clock
    this.nextToken = options.nextToken
  }

  updateAdapter(adapter: ConfigPersistenceAdapter<TDraft, TWire>): void {
    if (adapter.pendingKey !== this.adapter.pendingKey) {
      throw new Error(
        `配置协调器不接受同一 key 的异构适配器：${this.key} 的 pending 键为 `
        + `${this.adapter.pendingKey}，收到 ${adapter.pendingKey}`,
      )
    }
    this.adapter = adapter
  }

  readonly getState = (): ConfigCoordinatorState<TDraft> => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly hydrate = (): Promise<ConfigReloadOutcome> => this.reload()

  readonly reload = (options: { force?: boolean } = {}): Promise<ConfigReloadOutcome> => {
    const force = options.force === true
    if (this.hydrated && !force && this.loadState !== 'failed') {
      return Promise.resolve({ reason: 'skipped' })
    }
    if (this.inflightLoad && !force) return this.inflightLoad

    this.loadState = 'loading'
    this.loadError = null
    this.publish()

    const run = this.loadDraft()
    this.inflightLoad = run
    const clear = () => {
      if (this.inflightLoad === run) this.inflightLoad = null
    }
    void run.then(clear, clear)
    return run
  }

  readonly setDraft = (draft: TDraft): void => {
    const fingerprint = this.fingerprintOf(draft)
    // 页面常从表单状态派生草稿；内容等价时不重复入队，也不刷新 pending 令牌。
    if (fingerprint !== null && this.fingerprint === fingerprint) return

    this.draft = draft
    this.fingerprint = fingerprint
    this.revision += 1
    this.token = this.nextToken()
    this.pending = true
    this.syncState = 'queued'

    this.scheduleLocalDraftWrite(draft)
    this.storage.setItem(this.adapter.pendingKey, this.token)
    this.publish()
    this.scheduleCommit()
  }

  readonly commitNow = async (): Promise<boolean> => {
    if (this.draft === null) return false
    const revision = this.revision
    this.cancelScheduledCommit()
    this.flushLocalDraftWrite()
    // 只等待本次尝试：同一 key 后续 revision 的提交由它们自己排，不能阻塞重试结果。
    if (this.pending && this.token !== null) {
      await this.enqueueCommit()
    }
    return this.revision === revision && !this.pending
  }

  readonly flush = async (): Promise<void> => {
    this.flushLocalDraftWrite()
    if (this.timer !== null) {
      this.cancelScheduledCommit()
      void this.enqueueCommit()
    }
    await this.queueTail
  }

  readonly flushLocalDraft = (): void => {
    this.flushLocalDraftWrite()
  }

  readonly dispose = (): void => {
    this.flushLocalDraftWrite()
    this.cancelScheduledCommit()
    this.abortLoad()
  }

  private async loadDraft(): Promise<ConfigReloadOutcome> {
    const storedToken = this.readPendingToken()
    if (storedToken !== null) {
      let localDraft: TDraft | null
      try {
        localDraft = this.adapter.readLocalDraft()
      } catch {
        // 有标记但读不出草稿时不能换成服务端副本，否则会静默丢掉本设备编辑。
        this.failLoad(DEFAULT_LOAD_FAILURE_MESSAGE)
        return { reason: 'failed' }
      }

      if (localDraft !== null) {
        // 本设备未确认的草稿按定义比服务端副本新，不读取服务端。
        // 本会话已有未确认草稿时以内存为准；否则采用存储里的草稿（跨会话、其它写入者或残留标记）。
        if (!this.pending) {
          this.draft = localDraft
          this.fingerprint = this.fingerprintOf(localDraft)
          this.token = storedToken
          this.pending = true
          this.syncState = 'failed'
          this.error = this.adapter.restoredMessage ?? DEFAULT_RESTORED_MESSAGE
        }
        this.hydrated = true
        this.markLoaded()
        this.publish()
        return { reason: 'local-draft' }
      }

      // 标记指向的草稿已损坏：删标记后继续读服务端，与既有页面的回退一致。
      this.storage.removeItem(this.adapter.pendingKey)
    }

    this.abortLoad()
    const controller = new AbortController()
    this.loadAbort = controller
    const sequence = ++this.loadSequence
    const startingRevision = this.revision

    let decoded: TDraft | null = null
    let loadFailureMessage: string | null = null
    try {
      const result = await this.adapter.fetch({ signal: controller.signal })
      if (result.ok) decoded = this.decodeDraft(result.payload)
      else loadFailureMessage = result.message
    } catch (error) {
      // 读取失败与载荷不可用同样回退本地草稿。
      loadFailureMessage = error instanceof Error && error.message ? error.message : null
    } finally {
      if (this.loadAbort === controller) this.loadAbort = null
    }

    if (sequence !== this.loadSequence || controller.signal.aborted) {
      return { reason: 'stale' }
    }

    if (this.revision !== startingRevision || this.readPendingToken() !== null) {
      // 编辑已经发生：保留编辑，别把迟到的服务端副本写回页面。
      if (this.draft !== null) {
        this.hydrated = true
        this.markLoaded()
        this.publish()
      }
      return { reason: 'stale' }
    }

    if (decoded !== null) {
      this.adopt(decoded)
      this.hydrated = true
      this.publish()
      return { reason: 'loaded' }
    }

    let localDraft: TDraft | null
    try {
      localDraft = this.adapter.readLocalDraft()
    } catch {
      this.failLoad(DEFAULT_LOAD_FAILURE_MESSAGE)
      return { reason: 'failed' }
    }
    if (localDraft !== null) {
      this.adopt(localDraft)
      this.hydrated = true
      this.publish()
      return { reason: 'loaded' }
    }

    // 没有可用草稿：不标记 hydrated，下次 hydrate（如 Activity 恢复）会重试。
    this.failLoad(loadFailureMessage ?? DEFAULT_LOAD_FAILURE_MESSAGE)
    return { reason: 'failed' }
  }

  private adopt(draft: TDraft): void {
    this.draft = draft
    this.fingerprint = this.fingerprintOf(draft)
    this.token = null
    this.pending = false
    this.syncState = 'idle'
    this.error = null
    this.markLoaded()
    this.cancelScheduledLocalWrite()
    this.writeLocalDraft(draft)
  }

  private markLoaded(): void {
    this.loadState = 'ready'
    this.loadError = null
  }

  private failLoad(message: string): void {
    if (this.draft !== null) {
      this.hydrated = true
      this.markLoaded()
      this.publish()
      return
    }
    this.loadState = 'failed'
    this.loadError = message
    this.publish()
  }

  private scheduleLocalDraftWrite(draft: TDraft): void {
    const delay = this.adapter.localWriteDelayMs ?? 0
    if (delay <= 0) {
      this.writeLocalDraft(draft)
      return
    }
    this.cancelScheduledLocalWrite()
    this.pendingLocalDraft = draft
    this.localWriteTimer = setTimeout(() => {
      this.localWriteTimer = null
      this.flushLocalDraftWrite()
    }, delay)
  }

  private flushLocalDraftWrite(): void {
    this.cancelScheduledLocalWrite()
    const draft = this.pendingLocalDraft
    this.pendingLocalDraft = null
    if (draft !== null) this.writeLocalDraft(draft)
  }

  private cancelScheduledLocalWrite(): void {
    if (this.localWriteTimer === null) return
    clearTimeout(this.localWriteTimer)
    this.localWriteTimer = null
  }

  private scheduleCommit(): void {
    this.cancelScheduledCommit()
    const delay = this.adapter.commitDelayMs ?? 0
    if (delay <= 0) {
      void this.enqueueCommit()
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.enqueueCommit()
    }, delay)
  }

  private cancelScheduledCommit(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }

  private enqueueCommit(): Promise<void> {
    const snapshot = this.captureCommit()
    if (!snapshot) return this.queueTail

    const run = () => this.performCommit(snapshot)
    const attempt = this.queueTail.then(run, run)
    this.queueTail = attempt.then(() => undefined, () => undefined)
    return attempt
  }

  private captureCommit(): CommitSnapshot<TDraft> | null {
    if (this.draft === null || !this.pending || this.token === null) return null
    return { revision: this.revision, draft: this.draft, token: this.token }
  }

  private async performCommit(snapshot: CommitSnapshot<TDraft>): Promise<void> {
    // 入队后草稿可能又变了：旧快照无需发起请求，提交由新 revision 自己排。
    if (!this.isCurrentCommit(snapshot)) return

    this.syncState = 'saving'
    this.publish()

    // 提交前必须先落盘最新草稿：pending 标记已同步写入，本地副本不能落后。
    this.flushLocalDraftWrite()

    try {
      const wire = this.adapter.encodeDraft(snapshot.draft)
      const result = await this.adapter.commit(wire)
      if (!result.ok) throw new Error(result.message)

      // 旧提交即使成功也不能确认新草稿：保留新令牌与 pending 标记。
      if (!this.isCurrentCommit(snapshot)) return

      this.storage.removeItem(this.adapter.pendingKey)
      this.token = null
      this.pending = false
      this.syncState = 'idle'
      this.error = null
      this.lastSavedAt = this.clock()
      this.publish()
    } catch (error) {
      if (!this.isCurrentCommit(snapshot)) return
      this.syncState = 'failed'
      this.error = this.describeFailure(error)
      this.publish()
    }
  }

  private isCurrentCommit(snapshot: CommitSnapshot<TDraft>): boolean {
    return this.revision === snapshot.revision
      && this.token === snapshot.token
      && this.readPendingToken() === snapshot.token
  }

  private describeFailure(error: unknown): string {
    const detail = error instanceof Error && error.message
      ? error.message
      : '暂时无法连接服务器'
    return this.adapter.formatFailure
      ? this.adapter.formatFailure(detail)
      : `${DEFAULT_FAILURE_PREFIX}：${detail}`
  }

  private fingerprintOf(draft: TDraft): string | null {
    try {
      if (this.adapter.fingerprint) return this.adapter.fingerprint(draft)
      const wire = this.adapter.encodeDraft(draft)
      return wire === undefined ? null : JSON.stringify(wire)
    } catch {
      return null
    }
  }

  private decodeDraft(payload: unknown): TDraft | null {
    try {
      return this.adapter.decodeDraft(payload)
    } catch {
      return null
    }
  }

  private writeLocalDraft(draft: TDraft): void {
    try {
      this.adapter.writeLocalDraft(draft)
    } catch {
      // 本地回写失败不阻断内存状态与提交；下次挂载按 pending 标记处理。
    }
  }

  private readPendingToken(): string | null {
    return this.storage.getItem(this.adapter.pendingKey)
  }

  private abortLoad(): void {
    const controller = this.loadAbort
    if (!controller) return
    this.loadAbort = null
    controller.abort()
  }

  private publish(): void {
    this.state = Object.freeze({
      draft: this.draft,
      hydrated: this.hydrated,
      pending: this.pending,
      syncState: this.syncState,
      error: this.error,
      loadState: this.loadState,
      loadError: this.loadError,
      revision: this.revision,
      lastSavedAt: this.lastSavedAt,
    })
    for (const listener of this.listeners) listener()
  }
}

export interface UserConfigCoordinatorOptions {
  /** 键值存储；默认 localStorage。`null` 表示只保留内存状态（测试或存储不可用）。 */
  storage?: ConfigKeyStorage | null
  now?: () => number
}

/** 排空指定配置通道后的结果；`pendingKeys` 是仍未完整提交的配置 key。 */
export interface ConfigSettleResult {
  readonly pendingKeys: readonly string[]
}

/**
 * 应用级协调器。按 key 保存通道，因此提交队列、pending 标记与草稿状态
 * 都不依赖某一个页面实例的生命周期。
 */
export class UserConfigCoordinator {
  private readonly storage: ConfigKeyStorage
  private readonly clock: () => number
  private readonly channels = new Map<string, ConfigKeyState<any, any>>()
  private tokenSequence = 0

  constructor(options: UserConfigCoordinatorOptions = {}) {
    this.storage = options.storage === undefined
      ? createConfigKeyStorage()
      : toSafeStorage(options.storage)
    this.clock = options.now ?? Date.now
  }

  channel<TDraft, TWire>(adapter: ConfigPersistenceAdapter<TDraft, TWire>): ConfigChannel<TDraft> {
    const existing = this.channels.get(adapter.key)
    if (existing) {
      existing.updateAdapter(adapter)
      return existing
    }
    const created = new ConfigKeyState<TDraft, TWire>({
      adapter,
      storage: this.storage,
      clock: this.clock,
      nextToken: () => this.nextToken(),
    })
    this.channels.set(adapter.key, created)
    return created
  }

  /** 停止全部通道的定时器与在途加载；用于测试隔离或应用级销毁。 */
  dispose(): void {
    for (const channel of this.channels.values()) channel.dispose()
    this.channels.clear()
  }

  /**
   * 等待指定 key 当前已入队的提交全部结束。
   *
   * 用于“另一个域即将写入同一服务端文件”前的写入屏障：调用方先让在途保存
   * 落盘，再发出会改写该文件的请求，避免旧保存后到覆盖新内容。
   *
   * 不仅检查内存中的通道，也检查已知 key 的持久化 pending token：上一次会话
   * 保存失败留下的草稿可能没有挂载任何页面，但同样会在之后重试时覆盖外部写入。
   * 不触发已失败草稿的自动重试，也不创建尚未挂载的通道；`pendingKeys` 返回
   * 仍未完整提交的 key，调用方据此拒绝继续。
   */
  async settle(keys: readonly string[]): Promise<ConfigSettleResult> {
    const channels = keys
      .map(key => this.channels.get(key))
      .filter((channel): channel is ConfigKeyState<any, any> => Boolean(channel))
    await Promise.all(channels.map(channel => channel.flush()))

    const pending = new Set(
      channels
        .filter(channel => channel.getState().pending)
        .map(channel => channel.key),
    )
    for (const key of keys) {
      if (pending.has(key)) continue
      const pendingKey = USER_CONFIG_PENDING_KEYS[key as UserConfigKey]
      if (pendingKey && this.storage.getItem(pendingKey) !== null) pending.add(key)
    }
    return { pendingKeys: [...pending] }
  }

  private nextToken(): string {
    this.tokenSequence += 1
    return `${this.clock()}-${this.tokenSequence}`
  }
}

export const userConfigCoordinator = new UserConfigCoordinator()
