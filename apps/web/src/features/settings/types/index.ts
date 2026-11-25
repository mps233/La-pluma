/** maa-cli `[connection].preset` 的受支持取值；`PlayTools` 读取时归一为 `PlayCover`。 */
export const MAA_CONNECTION_PRESETS = ['ADB', 'MuMuPro', 'PlayCover', 'Waydroid', 'Androws'] as const
export type MaaConnectionPreset = (typeof MAA_CONNECTION_PRESETS)[number]

/** maa-cli `[instance_options].touch_mode` 的受支持取值。 */
export const MAA_TOUCH_MODES = ['Adb', 'MiniTouch', 'MaaTouch', 'MacPlayTools', 'MaaFwAdb'] as const
export type MaaTouchMode = (typeof MAA_TOUCH_MODES)[number]

export interface MaaConnectionConfig {
  adb_path: string
  address: string
  config: string
  preset: MaaConnectionPreset
  auto_reconnect?: boolean
  /** MAA profile 的 connection 段可能包含本页不展示的选项，保存时原样回写。 */
  [key: string]: unknown
}

export interface MaaInstanceOptions {
  touch_mode: MaaTouchMode
  deployment_with_pause: boolean
  adb_lite_enabled: boolean
  kill_adb_on_exit: boolean
  /** MAA profile 的 instance_options 段同样可能包含未知选项。 */
  [key: string]: unknown
}

export const RESOURCE_SOURCE_TYPES = ['git', 'mirrorchyan'] as const
export type ResourceSourceType = (typeof RESOURCE_SOURCE_TYPES)[number]

export const GIT_BACKENDS = ['git', 'libgit2'] as const
export type GitBackend = (typeof GIT_BACKENDS)[number]

/** maa-cli Secret 在 cli.toml 中的形态；页面只回显形态，不回显明文。 */
export type ResourceSecretKind = 'none' | 'prompt' | 'plain' | 'env' | 'command'

export interface ResourceGitSource {
  backend: GitBackend
  readonly url: string
  branch: string | null
}

export interface ResourceMirrorChyanSource {
  cdkKind: ResourceSecretKind
  checkInterval: number
}

/** 服务端资源源视图（`GET /agent/config/resource-source`）。 */
export interface ResourceSourceConfig {
  autoUpdate: boolean
  warnOnUpdateFailure: boolean
  source: ResourceSourceType
  git: ResourceGitSource
  mirrorchyan: ResourceMirrorChyanSource
}

/**
 * 页面草稿：CDK 留空时保留已保存的值，除非显式选择清除。
 */
export interface ResourceSourceDraft {
  autoUpdate: boolean
  warnOnUpdateFailure: boolean
  source: ResourceSourceType
  git: {
    backend: GitBackend
  }
  mirrorchyan: {
    cdk: string
    cdkKind: ResourceSecretKind
    clearCdk: boolean
    checkInterval: number
  }
  [key: string]: unknown
}

export interface AutoUpdateConfig {
  enabled: boolean
  time: string
  updateCore: boolean
  updateCli: boolean
}

export type UpdateChannelScope = 'core' | 'cli'

export const CORE_UPDATE_CHANNELS = ['stable', 'beta', 'alpha'] as const
export type CoreUpdateChannel = (typeof CORE_UPDATE_CHANNELS)[number]

export const CLI_UPDATE_CHANNELS = ['stable', 'beta', 'nightly'] as const
export type CliUpdateChannel = (typeof CLI_UPDATE_CHANNELS)[number]

export const CORE_UPDATE_CHANNEL_LABELS = {
  stable: '正式版',
  beta: 'Beta',
  alpha: 'Alpha',
} as const satisfies Record<CoreUpdateChannel, string>

export const CLI_UPDATE_CHANNEL_LABELS = {
  stable: '正式版',
  beta: 'Beta',
  nightly: 'Nightly',
} as const satisfies Record<CliUpdateChannel, string>

export interface UpdateChannels {
  core: CoreUpdateChannel
  cli: CliUpdateChannel
}
