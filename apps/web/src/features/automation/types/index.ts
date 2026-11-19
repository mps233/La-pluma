import type { ReactNode } from 'react'

export type TaskCommandId = 'startup' | 'fight' | 'infrast' | 'recruit' | 'mall' | 'award' | 'operprogress' | 'switchtheme' | 'closedown'

export type TaskParamFieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'multi-stages'
  | 'star-select'
  | 'facility-select'
  | 'infrast-schedule'
  | 'oper-progress-plans'
  | 'theme-list'

export interface OperProgressPlan {
  role?: string
  name: string
  elite?: number
  skill_level?: number
  skill_mastery?: [number, number, number]
}

export interface TaskParamField {
  key: TaskParamKey
  label: string
  type: TaskParamFieldType
  placeholder?: string
  helper?: string
  helperPlacement?: 'below' | 'tooltip'
  options?: Array<{ value: string; label: string }> | string[]
  step?: string
  min?: string
  max?: string
  timesPlaceholder?: string
  visibleWhen?: { key: TaskParamKey; value: string | number | boolean }
  hiddenWhen?: { key: TaskParamKey; value: string | number | boolean }
}

export interface StageConfig {
  stage: string
  times?: string
  pinned?: boolean
  smart?: boolean
  trainingOperators?: string[]
}

export interface TaskParams {
  plans?: OperProgressPlan[]
  themes?: string[]
  clientType?: string
  adbPath?: string
  address?: string
  accountName?: string
  start_game_enabled?: boolean
  recognizeDepotBeforeClose?: boolean
  recognizeOperBoxBeforeClose?: boolean

  stage?: string
  stages?: Array<string | StageConfig>
  medicine?: number | string
  medicineExpireDays?: number | string
  /** @deprecated Migrated to medicineExpireDays when loading saved tasks. */
  expiringMedicine?: number | string
  stone?: number | string
  series?: number | string
  times?: string
  drops?: string | Record<string, number | string>
  DrGrandet?: boolean
  report_to_penguin?: boolean
  penguin_id?: string
  report_to_yituliu?: boolean
  yituliu_id?: string

  mode?: string
  facility?: string[]
  drones?: string
  threshold?: string
  replenish?: boolean
  filename?: string
  plan_index?: number | string
  continue_training?: boolean
  dorm_notstationed_enabled?: boolean
  dorm_trust_enabled?: boolean
  reception_message_board?: boolean
  reception_clue_exchange?: boolean
  reception_send_clue?: boolean

  refresh?: boolean
  force_refresh?: boolean
  select?: number[]
  confirm?: number[]
  first_tags?: string | string[]
  extra_tags_mode?: number | string
  set_time?: boolean
  expedite?: boolean
  expedite_times?: number
  preserve_tags?: string | string[]
  level3_recruitment_permit_reserve?: number | string
  recruitment_time?: Record<string, number | string>
  /** @deprecated Migrated to preserve_tags when loading saved tasks. */
  skip_robot?: boolean

  visit_friends?: boolean
  shopping?: boolean
  buy_first?: string
  blacklist?: string
  force_shopping_if_credit_full?: boolean
  only_buy_discount?: boolean
  reserve_max_credit?: boolean
  credit_fight?: boolean
  formation_index?: number | string

  award?: boolean
  mail?: boolean
  recruit?: boolean
  orundum?: boolean
  mining?: boolean
  specialaccess?: boolean
  signinevent?: boolean
}

export type TaskParamKey = keyof TaskParams
export type TaskParamValue = TaskParams[TaskParamKey]

export interface TaskFlowWireItem {
  id: string
  name: string
  commandId: TaskCommandId
  taskType?: string
  params: TaskParams
  enabled: boolean
  description?: string
  defaultParams?: TaskParams
}

export interface AutomationAvailableTask {
  id: TaskCommandId
  name: string
  icon: ReactNode
  description: string
  defaultParams: TaskParams
  paramFields: TaskParamField[]
  taskType?: string
}

export interface TaskFlowItem {
  name: string
  icon: ReactNode
  description: string
  defaultParams: TaskParams
  paramFields: TaskParamField[]
  taskType?: string

  id: string
  commandId: TaskCommandId
  params: TaskParams
  enabled: boolean
}

export interface ConnectionTestStatus {
  success: boolean
  message: string
}
