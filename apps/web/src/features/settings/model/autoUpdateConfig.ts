// 自动更新是“保存用户配置 + 应用服务端调度”的完整提交：读取先走服务端 auto-update，
// 失败回退本机草稿；保存由自动保存调度触发，两步都成功才算成功，调度失败不回滚配置。
// 读取携带开始时的 revision 与 touched 守卫；保存期间允许编辑，响应仅 revision 未变时才确认。

import {
  getErrorMessage,
  isRecord,
  type ApiResponse,
} from '@/shared/api'
import { loadUserConfig, saveUserConfig } from '@/features/user-config'
import { setupAutoUpdate } from '../api'
import type { AutoUpdateConfig } from '../types'
import {
  DEFAULT_AUTO_UPDATE_CONFIG,
  isValidUpdateTime,
  normalizeAutoUpdateConfig,
} from './configNormalization'

export const AUTO_UPDATE_STORAGE_KEY = 'autoUpdateConfig'

export const INVALID_UPDATE_TIME_MESSAGE =
  '更新时间格式无效，请输入 00:00 到 23:59 之间的时间'

export interface AutoUpdateFeedback {
  readonly type: 'success' | 'error' | 'warning'
  readonly message: string
}

export interface AutoUpdateConfigState {
  readonly draft: AutoUpdateConfig
  readonly dirty: boolean
  readonly saving: boolean
  readonly feedback: AutoUpdateFeedback | null
}

export type AutoUpdateLoadStatus = 'loaded' | 'local-fallback' | 'failed' | 'empty'

export interface AutoUpdateLoadOutcome {
  readonly status: AutoUpdateLoadStatus
  readonly feedback: AutoUpdateFeedback | null
}

export type AutoUpdateSaveStatus =
  | 'saved'
  | 'superseded'
  | 'failed'
  | 'invalid'
  | 'ignored'

export interface AutoUpdateSaveOutcome {
  readonly status: AutoUpdateSaveStatus
  readonly feedback: AutoUpdateFeedback | null
}

export interface AutoUpdateConfigOwnerOptions {
  readonly loadConfig?: () => Promise<ApiResponse>
  readonly saveConfig?: (config: AutoUpdateConfig) => Promise<ApiResponse>
  readonly applySchedule?: (config: AutoUpdateConfig) => Promise<ApiResponse>
  readonly readLocal?: () => string | null
  readonly writeLocal?: (value: string) => void
}

const initialState = (): AutoUpdateConfigState => ({
  draft: { ...DEFAULT_AUTO_UPDATE_CONFIG },
  dirty: false,
  saving: false,
  feedback: null,
})

const readStoredConfig = (): string | null => localStorage.getItem(AUTO_UPDATE_STORAGE_KEY)

const writeStoredConfig = (value: string): void => {
  localStorage.setItem(AUTO_UPDATE_STORAGE_KEY, value)
}

const isSchedulerResult = (value: unknown): value is { success?: boolean; message?: string } => (
  isRecord(value) && !Array.isArray(value)
)

/**
 * 模块级自动更新草稿所有者。
 *
 * 寿命不跟随页面：Activity 隐藏只清理 Effects，已发出的保存继续完成；真正的
 * 页面重挂载仍能看到未保存草稿，读取守卫保证不会用旧副本覆盖它。测试或明确的
 * 全局重置使用 `reset()`。
 */
export class AutoUpdateConfigOwner {
  private readonly loadConfig: NonNullable<AutoUpdateConfigOwnerOptions['loadConfig']>
  private readonly saveConfig: NonNullable<AutoUpdateConfigOwnerOptions['saveConfig']>
  private readonly applySchedule: NonNullable<AutoUpdateConfigOwnerOptions['applySchedule']>
  private readonly readLocal: NonNullable<AutoUpdateConfigOwnerOptions['readLocal']>
  private readonly writeLocal: NonNullable<AutoUpdateConfigOwnerOptions['writeLocal']>

  private state: AutoUpdateConfigState = initialState()
  private readonly listeners = new Set<() => void>()
  /** 本次所有者生命周期内是否出现过编辑；迟到读取不得覆盖它。 */
  private touched = false
  private revision = 0

  constructor(options: AutoUpdateConfigOwnerOptions = {}) {
    this.loadConfig = options.loadConfig ?? (() => loadUserConfig('auto-update'))
    this.saveConfig = options.saveConfig ?? (config => saveUserConfig('auto-update', config))
    this.applySchedule = options.applySchedule ?? (config => setupAutoUpdate(config))
    this.readLocal = options.readLocal ?? readStoredConfig
    this.writeLocal = options.writeLocal ?? writeStoredConfig
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState = (): AutoUpdateConfigState => this.state

  /** 仅用于测试与明确的全局重置；正常页面生命周期不调用。 */
  reset(): void {
    this.state = initialState()
    this.touched = false
    this.revision = 0
    this.notify()
  }

  /**
   * 读取服务端策略；失败时回退本设备上次保存的草稿。
   *
   * 页面每次真正挂载调用一次（Activity 恢复不重读）；读取期间出现编辑或
   * 保存时，服务端与本地副本都不会写回草稿。
   */
  async load(): Promise<AutoUpdateLoadOutcome> {
    const readRevision = this.revision
    let serverError: string | null = null

    try {
      const serverConfig = await this.loadConfig()
      const normalized = normalizeAutoUpdateConfig(serverConfig.data)
      if (serverConfig.success && normalized) {
        if (!this.touched && this.revision === readRevision) {
          this.state = {
            ...this.state,
            draft: normalized,
            dirty: false,
            // 服务端副本已采用：此前的读取回退/保存反馈不再代表当前状态。
            feedback: null,
          }
          this.writeLocal(JSON.stringify(normalized))
          this.notify()
        }
        return { status: 'loaded', feedback: null }
      }

      if (!serverConfig.success) {
        serverError = `自动更新设置读取失败: ${getErrorMessage(serverConfig)}`
      }
    } catch (error) {
      serverError = `自动更新设置读取失败: ${(error as Error).message}`
    }

    try {
      const saved = this.readLocal()
      if (saved) {
        const config = normalizeAutoUpdateConfig(JSON.parse(saved))
        if (config && !this.touched && this.revision === readRevision) {
          this.state = {
            ...this.state,
            draft: config,
            dirty: true,
          }
          this.notify()
        }

        if (config) {
          const message = serverError
            ? `${serverError}，已显示此设备上次保存的设置，修改后将自动同步`
            : '已载入此设备上次保存的自动更新设置，修改后将自动同步'
          return this.setFeedback('local-fallback', { type: 'warning', message })
        }
      }
    } catch (error) {
      const message = `自动更新设置读取失败: ${(error as Error).message}`
      return this.setFeedback('failed', { type: 'error', message })
    }

    if (serverError) {
      return this.setFeedback('failed', { type: 'error', message: serverError })
    }
    return { status: 'empty', feedback: null }
  }

  /** 接受一次策略编辑；内容未变化的编辑不推进 revision，也不触发自动保存。 */
  update(patch: Partial<AutoUpdateConfig>): void {
    const next = { ...this.state.draft, ...patch }
    if (
      next.enabled === this.state.draft.enabled
      && next.time === this.state.draft.time
      && next.updateCore === this.state.draft.updateCore
      && next.updateCli === this.state.draft.updateCli
    ) return
    this.touched = true
    this.revision += 1
    this.state = {
      ...this.state,
      draft: next,
      dirty: true,
      feedback: null,
    }
    this.writeLocal(JSON.stringify(next))
    this.notify()
  }

  /**
   * 显式保存当前策略，先写用户配置，再应用服务端调度。
   *
   * 保存期间允许继续编辑；响应返回时只有 revision 未变才把当前草稿标记为
   * 已保存，否则返回 `superseded`。保存进行中再次调用返回 `ignored`。
   */
  async save(): Promise<AutoUpdateSaveOutcome> {
    if (this.state.saving) {
      return { status: 'ignored', feedback: null }
    }

    const config = { ...this.state.draft }
    if (config.enabled && !isValidUpdateTime(config.time)) {
      return this.finish('invalid', { type: 'error', message: INVALID_UPDATE_TIME_MESSAGE })
    }

    const savedRevision = this.revision
    this.state = {
      ...this.state,
      saving: true,
      feedback: null,
    }
    this.notify()

    try {
      const saveResult = await this.saveConfig(config)
      if (!saveResult.success) {
        return this.finish('failed', {
          type: 'error',
          message: `自动更新设置保存失败: ${getErrorMessage(saveResult)}`,
        })
      }

      const result = await this.applySchedule(config)
      const schedulerResult = isSchedulerResult(result.data) ? result.data : null
      const schedulerSucceeded = result.success
        && (!config.enabled || schedulerResult?.success !== false)

      if (schedulerSucceeded) {
        if (savedRevision === this.revision) {
          const message = config.enabled
            ? `自动更新已启用，每天 ${config.time} 执行`
            : '自动更新已禁用'
          this.writeLocal(JSON.stringify(config))
          // 已确认的保存使此前的读取令牌失效，并允许下一次显式读取采用
          // 服务端副本（真正重挂载仍会读一次）。
          this.touched = false
          this.revision += 1
          this.state = {
            ...this.state,
            dirty: false,
          }
          return this.finish('saved', { type: 'success', message })
        }

        return this.finish('superseded', {
          type: 'warning',
          message: '此前设置已保存，当前更改尚未保存',
        })
      }

      return this.finish('failed', {
        type: 'error',
        message: `自动更新设置应用失败: ${schedulerResult?.message || getErrorMessage(result)}`,
      })
    } catch (error) {
      return this.finish('failed', {
        type: 'error',
        message: `自动更新设置保存失败: ${(error as Error).message}`,
      })
    }
  }

  private finish(
    status: Exclude<AutoUpdateSaveStatus, 'ignored'>,
    feedback: AutoUpdateFeedback,
  ): AutoUpdateSaveOutcome {
    this.state = {
      ...this.state,
      saving: false,
      feedback,
    }
    this.notify()
    return { status, feedback }
  }

  private setFeedback(
    status: AutoUpdateLoadStatus,
    feedback: AutoUpdateFeedback,
  ): AutoUpdateLoadOutcome {
    this.state = {
      ...this.state,
      feedback,
    }
    this.notify()
    return { status, feedback }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

export const settingsAutoUpdateOwner = new AutoUpdateConfigOwner()
