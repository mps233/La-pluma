export interface MaterialNode {
  id: string
  name: string
  iconId?: string
  count: number
  have: number
  needed: number
  stillNeeded: number
  children?: MaterialNode[]
}

/** 干员拥有状态：`unknown` 表示识别未确认，不能当作已确认未拥有。 */
export type TrainingOwnership = 'owned' | 'unowned' | 'unknown'

export type TrainingDisabledReason =
  | 'unowned'
  | 'unrecognized'
  | 'missing_material_data'
  | 'already_elite2'

export interface TrainingOperator {
  id: string
  name: string
  rarity: number
  profession: string
  currentElite: number
  currentLevel?: number
  targetElite: number
  owned?: boolean
  ownership?: TrainingOwnership
  hasMaterialData?: boolean
  canTrain?: boolean
  disabledReason?: TrainingDisabledReason | null
  trainingStatus?: 'trainable' | TrainingDisabledReason
  materials?: MaterialNode[]
  progress?: number
}

/** 识别完整度：`missing` 表示尚未识别，`partial` 表示存在未确认项。 */
export type OperatorRecognitionStatus = 'complete' | 'partial' | 'missing'

export interface OperatorRecognitionSummary {
  status: OperatorRecognitionStatus
  recognizedAt: string | null
  total: number
  owned: number
  unknown: number
  missing: string[]
}

/** 候选列表端点载荷：`operators` 之外的识别概要由同一响应返回。 */
export interface TrainingCandidatePayload {
  operators?: TrainingOperator[]
  recognition?: OperatorRecognitionSummary
}

export interface TrainingQueueItem {
  operatorId: string
  operator: {
    name: string
    rarity: number
    profession: string
  }
  currentElite: number
  targetElite: number
  materials: MaterialNode[]
  lmd?: { needed: number; have: number; stillNeeded: number }
  progress: number
  isComplete?: boolean
  settings?: {
    useMedicine?: number
    useStone?: number
    autoSwitch?: boolean
    notifyOnComplete?: boolean
  }
}

export interface TrainingSettings {
  useMedicine: number
  useStone: number
  autoSwitch: boolean
  notifyOnComplete: boolean
}

export interface TrainingFlowSync {
  status: 'not_applied' | 'synced' | 'failed'
  flowName: string
  taskName?: string
  error?: string
  syncedRevision?: string
}

export interface TrainingQueueSnapshot {
  queue: TrainingQueueItem[]
  settings?: TrainingSettings
  revision?: string
  lastUpdated?: string
  gameDate?: string
  clientType?: string
  flowSync?: TrainingFlowSync
  /**
   * 仅在队列写入成功、但写后刷新失败时由领域命令写入。
   * 下一次权威读取会返回不带该字段的快照，从而清除不确定状态。
   */
  uncertain?: string
}

export interface TrainingQueueMutationData {
  queueUpdated?: boolean
  queueRevision?: string
  flowSync?: TrainingFlowSync
  flowName?: string
  taskName?: string
}

export interface TrainingPlan {
  queueRevision?: string
  mode: 'current' | 'all'
  operators?: Array<{
    id: string
    name: string
    rarity: number
    currentElite: number
    targetElite: number
  }>
  focusOperator?: {
    id: string
    name: string
    rarity: number
  } | null
  materials?: Array<{
    id: string
    name: string
    count: number
  }>
  materialHierarchy?: MaterialNode[]
  stages?: Array<{
    stage: string
    stageName?: string
    totalTimes?: number
    sanityPerRun?: number
    isOpen?: boolean
    materials?: Array<{
      name: string
      needed?: number
      count?: number
    }>
  }>
  openStages?: Array<{
    stage: string
    totalTimes?: number
    isOpen?: boolean
    materials?: Array<{
      name: string
      needed?: number
      count?: number
    }>
  }>
  closedStages?: Array<{
    stage: string
    totalTimes?: number
    isOpen?: boolean
    materials?: Array<{
      name: string
      needed?: number
      count?: number
    }>
  }>
  totalSanity?: number
  estimatedTime?: number
  warnings?: string[]
  summary?: {
    totalStages?: number
    totalTimes?: number
    totalSanity?: number
    backlogCount?: number
    openStageCount?: number
    closedStageCount?: number
    gameDate?: string
    clientType?: string
    todayOpenResourceStages?: Array<{
      stage: string
      name: string
      isOpen: boolean
    }>
    todayClosedResourceStages?: Array<{
      stage: string
      name: string
      isOpen: boolean
    }>
  }
}

/** 干员选择器的统一行：只用于展示与身份写回，不携带任务参数。 */
export interface OperatorPickerOption {
  id: string
  name: string
  rarity: number
  profession?: string
  elite?: number
  level?: number
}

/** 选择器默认排序方向：精英阶段优先、同精英内按等级。 */
export type OperatorSortDirection = 'asc' | 'desc'

export interface TrainingFilters {
  rarity: string
  needsElite2: boolean
  status: 'trainable' | 'owned' | 'all'
}

export interface TrainingStatusCounts {
  trainable: number
  owned: number
  all: number
}

export type TrainingPlanMode = 'current' | 'all'

export interface MaterialHierarchyNodeProps {
  node: MaterialNode
  depth?: number
}
