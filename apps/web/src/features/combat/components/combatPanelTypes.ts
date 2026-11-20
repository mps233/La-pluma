/**
 * 作业面板的共享 props 契约
 *
 * 搜索词与识别方式通过会话存储传递，工作区不订阅，避免输入推动大列表重渲染。
 */

import type {
  AdvancedValues,
} from '../model/combatCommands'
import type { CopilotPreviewMode } from '../model/copilotPreview'
import type { CopilotQueueRunProjection } from '../model/copilotQueueRun'
import type { CopilotSetItemStatus } from '../model/copilotSetRun'
import type { CopilotQueueEntry, CopilotQueueMoveDirection } from '../model/copilotQueue'
import type { CopilotQueueFailurePolicy } from '../api'
import type { PanelStateStore } from '../model/panelState'
import type { CopilotDetailTarget } from '../model/copilotDetail'
import type {
  CopilotMatchMode,
  CopilotRaid,
  CopilotSearchOrder,
  CopilotSearchResult,
  CopilotSetExecutionMode,
  CopilotSetInfo,
  CopilotStageCandidate,
  FormationMode,
  ParadoxSearchResult,
} from '../types'
import type { CopilotSearchRequest } from '../model/copilotDiscovery'
import type { OperatorFilterOption, OperatorSelection } from '../model/operatorFilter'

export interface CombatExecutionActions {
  automationAvailable: boolean
  unavailableMessage: string
  isRunning: boolean
  isStopping: boolean
  isSubmitting: boolean
  isContinuing: boolean
  onExecute: () => void
  onStop: () => void
}

/** 作业集卡片额外暴露下一关；服务端持有等待态。 */
export interface CombatCopilotExecutionActions extends CombatExecutionActions {
  isWaitingForNext: boolean
  onStartNext: () => void
}

export interface CombatCopilotConfig {
  input: string
  advanced: AdvancedValues
  formationMode: FormationMode
  raid: CopilotRaid
  setExecutionMode: CopilotSetExecutionMode
  onInputChange: (value: string) => void
  onAdvancedChange: (key: string, value: string | number | boolean) => void
  onFormationChange: (mode: FormationMode) => void
  onSetExecutionModeChange: (mode: CopilotSetExecutionMode) => void
}

export interface CombatCopilotPreviewProjection {
  info: CopilotSetInfo | null
  loading: boolean
  /** 详情在途时先用列表条目渲染的目标；响应到达或失败后清空。 */
  pendingTarget: CopilotDetailTarget | null
  modeStore: PanelStateStore<CopilotPreviewMode>
  onPreview: () => void
  onCancel: () => void
}

export type CombatCopilotDetailSelection = { type: 'preview' } | { type: 'queue'; id: string }

export const COPILOT_DETAIL_LAYER_ID = 'combat-copilot-detail-panel'
export const COPILOT_DISCOVERY_DIALOG_ID = 'combat-copilot-discovery-dialog'

export interface CombatCopilotFileImportProjection {
  isImporting: boolean
  onImport: (file: File) => void
}

export interface CombatCopilotSelectionProjection {
  isResetting: boolean
  onOpenReset: () => void
}

export interface CombatCopilotQueueProjection {
  entries: readonly CopilotQueueEntry[]
  selected: ReadonlySet<string>
  setId: string | null
  itemStatuses: ReadonlyMap<number, CopilotSetItemStatus>
  itemErrors: ReadonlyMap<number, string>
  submittedEntryIds: ReadonlySet<string>
  queueRun: CopilotQueueRunProjection | null
  failurePolicy: CopilotQueueFailurePolicy
  isRunning: boolean
  isSubmitting: boolean
  isContinuing: boolean
  isSkipping: boolean
  isAdding: boolean
  automationAvailable: boolean
  unavailableMessage: string
  onToggle: (id: string) => void
  onRemove: (id: string) => void
  onMove: (id: string, direction: CopilotQueueMoveDirection) => void
  onClear: () => void
  onAddCurrent: () => void
  onContinueQueue: () => void
  onSkipEntry: () => void
  onRetryFailed: () => void
}

export type CombatCopilotDiscoveryView = 'grid' | 'list'

export interface CombatCopilotMatchSettings {
  enabled: boolean
  modes: readonly CopilotMatchMode[]
}

export interface CombatCopilotSearchProjection {
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  keywordStore: PanelStateStore<string>
  levelStore: PanelStateStore<string>
  operatorStore: PanelStateStore<OperatorSelection>
  operatorFilterEnabledStore: PanelStateStore<boolean>
  operatorFilterRememberStore: PanelStateStore<boolean>
  orderStore: PanelStateStore<CopilotSearchOrder>
  matchStore: PanelStateStore<CombatCopilotMatchSettings>
  viewStore: PanelStateStore<CombatCopilotDiscoveryView>
  stages: readonly CopilotStageCandidate[]
  stagesLoading: boolean
  stagesError: string | null
  operators: readonly OperatorFilterOption[]
  operatorsLoading: boolean
  operatorsError: string | null
  ownedOperatorNames: ReadonlySet<string>
  result: CopilotSearchResult | null
  searching: boolean
  refreshing: boolean
  error: string | null
  addingUri: string | null
  onSearch: (request: CopilotSearchRequest) => void
  onRetrySearch: () => void
  /** 取指定页但不改动当前基础结果；失败返回 null。 */
  onLoadMore: (request: CopilotSearchRequest) => Promise<CopilotSearchResult | null>
  onCancel: () => void
  onPreviewUri: (uri: string) => void
  onAddToQueue: (uri: string) => void
  onRetryData: () => void
}

export interface CombatParadoxSearchProjection {
  nameStore: PanelStateStore<string>
  result: ParadoxSearchResult | null
  searching: boolean
  onSearch: (name: string) => void
  onCancel: () => void
  onSelectUri: (uri: string) => void
}
