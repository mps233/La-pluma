/** 作业页的三种入口；模式切换不写入配置。 */
export type CombatMode = 'copilot' | 'ssscopilot' | 'paradoxcopilot'

export interface CombatTask {
  id: string
  name: string
  command: string
  placeholder: string
  hasAdvanced: boolean
}

export interface CombatAdvancedOption {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'checkbox'
  param: string
  placeholder?: string
  helper?: string
  options?: Array<{ value: string; label: string }>
}

export interface CombatTaskInputs {
  [taskId: string]: string
}

/** 作业集执行方式；`app` 是旧值，仅在加载时迁移为 `cli`。 */
export type CopilotSetExecutionMode = 'app' | 'manual' | 'cli'

export type CopilotDifficulty = 'normal' | 'raid' | 'both'

export type CopilotRaid = CopilotDifficulty | 'auto'

/** 作业站搜索排序；服务端按同名 `orderBy` 参数透传。 */
export type CopilotSearchOrder = 'hot' | 'latest' | 'views'

/** 作业与当前持有干员的匹配结论；服务端匹配未接入前只在响应里透传。 */
export type CopilotMatchMode = 'ready' | 'borrow' | 'train' | 'check' | 'blocked'

export interface CopilotMatchSummary {
  mode: CopilotMatchMode
  missing: string[]
  training: string[]
  check: string[]
  totalSlots: number
}

export type CopilotSetSelections = Record<string, number[]>

export interface CombatAdvancedParams {
  [taskId: string]: {
    [key: string]: string | number | boolean
  }
}

export type FormationMode = 'auto' | 'on' | 'off'

export interface AutoFormationConfig {
  [taskId: string]: boolean | FormationMode
}

export interface CopilotDetailOperator {
  name: string
  group?: string
  elite?: number | null
  level?: number | null
  skillLevel?: number | null
  module?: string | null
}

export interface CopilotDetail {
  readonly title: string
  readonly recommendedMode?: CopilotDifficulty
  /** 展示用关卡代号；服务端未提供解析结果时回退为作业内容里的 `stage_name`。 */
  readonly stage?: string
  /** 作业内容里的原始关卡标识（通常是内部 stageId）。 */
  readonly stageId?: string
  readonly operators: string
  readonly operatorDetails?: CopilotDetailOperator[]
  readonly groupNames?: string[]
  /** 预设编队作业：没有固定干员与干员组，关卡以 `_s<数字>` 结尾。 */
  readonly presetFormation?: boolean
  /** 作业站 `doc.details` 原文；只有作者填写且非空白时才存在。 */
  readonly details?: string
}

export interface CopilotInfoPayload {
  /** PRTS 的 `status_code`；非 200 表示作业不存在或代理拒绝。 */
  readonly statusCode: number | null
  readonly detail: CopilotDetail | null
}

export interface CopilotSetPayload {
  readonly statusCode: number | null
  readonly ids: readonly number[]
}

export interface CopilotPlanPayload {
  readonly setId: string
  readonly name: string
  readonly items: readonly CopilotSetItem[]
}

export interface CopilotSetItem {
  id: number
  name?: string
  stage?: string
  stageId?: string
  /** 关卡理智消耗；资源数据缺失时为 null。 */
  apCost?: number | null
  operators?: string
  operatorDetails?: CopilotDetailOperator[]
  groupNames?: string[]
  /** 作业站 `doc.details` 原文：作者填写的说明与攻略链接。 */
  details?: string
  uri?: string
  presetFormation?: boolean
  supportsRaid?: boolean
  recommendedMode?: CopilotDifficulty
  completedModes?: Array<'normal' | 'raid'>
}

export interface CopilotSetInfo {
  type: 'single' | 'set'
  id: string
  name: string
  stage?: string
  stageId?: string
  operators?: string
  operatorDetails?: CopilotDetailOperator[]
  groupNames?: string[]
  /** 作业站 `doc.details` 原文：作者填写的说明与攻略链接。 */
  details?: string
  note?: string
  recommendedMode?: CopilotDifficulty
  autoAddS?: boolean
  presetFormation?: boolean
  copilots?: CopilotSetItem[]
  currentIndex?: number
}

export interface CopilotSearchItem {
  id: string
  uri: string
  views: number
  hotScore: number
  /** 作业内容里的原始关卡标识，与关卡筛选使用的 stageId 同源。 */
  stageName?: string
  stageId?: string
  stageCode?: string
  stageLabel?: string
  title?: string
  uploader?: string
  uploadTime?: string
  operators?: string[]
  /** 服务端按当前持有快照给出的匹配结论；未接入时省略。 */
  match?: CopilotMatchSummary
  /** 作者填写的说明与攻略链接，列表条目自带，点开卡片时无需再取详情。 */
  details?: string
  /** 每名干员的练度要求；与卡片只显示名字的 `operators` 同源。 */
  operatorDetails?: CopilotDetailOperator[]
  groupNames?: string[]
  recommendedMode?: CopilotDifficulty
}

export interface CopilotSearchResult {
  keyword?: string
  stage: string
  stageId?: string
  orderBy?: CopilotSearchOrder
  page?: number
  limit?: number
  total?: number
  hasNext?: boolean
  copilots: CopilotSearchItem[]
  recommended?: {
    uri: string
  }
}

/** 作业站关卡目录条目：`stageId` 是查询作业时使用的内部标识，`code` 是玩家可见代号。 */
export interface CopilotStageCandidate {
  stageId: string
  code: string
  name: string
  category: string
  zone: string
}

export interface ParadoxSearchResult {
  operator: string
  copilots: CopilotSearchItem[]
  recommended?: {
    uri: string
  }
}
