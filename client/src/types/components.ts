/**
 * 组件 Props 类型定义
 */

import type { ReactNode } from 'react'
import type { TaskFlow } from './api'

// Common Component Props
export interface PageHeaderProps {
  icon?: ReactNode
  title: string
  subtitle?: string
  gradientFrom?: string
  gradientVia?: string
  gradientTo?: string
  rightContent?: ReactNode
}

export interface StatusIndicatorProps {
  isActive: boolean
  message?: string
  activeText?: string
  inactiveText?: string
  activeColor?: string
  inactiveColor?: string
}

export interface ButtonProps {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
  className?: string
  type?: 'button' | 'submit' | 'reset'
  gradientFrom?: string
  gradientTo?: string
}

export interface InputProps {
  label?: string
  value: string | number
  onChange: (value: string) => void
  placeholder?: string
  hint?: string
  error?: string
  disabled?: boolean
  type?: 'text' | 'number' | 'password' | 'email'
  icon?: ReactNode
  className?: string
}

export interface SelectProps {
  label?: string
  value: string | number
  onChange: (value: string) => void
  options: Array<{ value: string | number; label: string }>
  disabled?: boolean
  hint?: string
  error?: string
  className?: string
}

export interface CheckboxProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  color?: string
  className?: string
}

export interface CardProps {
  children: ReactNode
  className?: string
  animated?: boolean
  delay?: number
}

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  closeOnEscape?: boolean
  closeOnOverlayClick?: boolean
}

export interface LoadingProps {
  text?: string
  size?: 'sm' | 'md' | 'lg'
  color?: string
}

// Task Component Props
export interface TaskCardProps {
  task: TaskFlow
  isActive: boolean
  isRunning: boolean
  onEdit: (task: TaskFlow) => void
  onDelete: (taskId: string) => void
  onToggle: (taskId: string) => void
  onTest?: (taskId: string) => Promise<void>
}

export interface TaskFlowEditorProps {
  tasks: TaskFlow[]
  availableTasks: AvailableTask[]
  onTasksChange: (tasks: TaskFlow[]) => void
  onTaskAdd: (taskType: string) => void
  onTaskRemove: (taskId: string) => void
  onTaskReorder: (fromIndex: number, toIndex: number) => void
}

export interface AvailableTask {
  type: string
  name: string
  description: string
  icon: ReactNode
  defaultParams: Record<string, any>
}

export interface ScheduleConfigProps {
  enabled: boolean
  times: string[]
  onEnabledChange: (enabled: boolean) => void
  onTimesChange: (times: string[]) => void
}

// ============================================
// AutomationTasks Component Types
// ============================================

export type TaskCommandId = 'startup' | 'fight' | 'infrast' | 'recruit' | 'mall' | 'award' | 'closedown'

export type TaskParamFieldType = 
  | 'text' 
  | 'number' 
  | 'select' 
  | 'checkbox' 
  | 'multi-stages' 
  | 'stage-with-times'
  | 'star-select' 
  | 'facility-select'

export interface TaskParamField {
  key: string
  label: string
  type: TaskParamFieldType
  placeholder?: string
  helper?: string
  options?: Array<{ value: string; label: string }> | string[]
  step?: string
  min?: string
  max?: string
  timesPlaceholder?: string
}

export interface StageConfig {
  stage: string
  times?: string
  pinned?: boolean
  smart?: boolean
  trainingOperators?: string[]
}

export interface TaskParams {
  // 启动游戏
  clientType?: string
  adbPath?: string
  address?: string
  accountName?: string
  
  // 理智作战
  stage?: string
  stages?: Array<string | StageConfig>
  medicine?: number | string
  expiringMedicine?: number | string
  stone?: number | string
  series?: number | string
  times?: string
  
  // 基建
  mode?: string
  facility?: string[]
  drones?: string
  threshold?: string
  replenish?: boolean
  
  // 公招
  refresh?: boolean
  select?: number[]
  confirm?: number[]
  set_time?: boolean
  expedite?: boolean
  expedite_times?: number
  skip_robot?: boolean
  
  // 信用收支
  shopping?: boolean
  buy_first?: string
  blacklist?: string
  force_shopping_if_credit_full?: boolean
  
  // 领取奖励
  award?: boolean
  mail?: boolean
  recruit?: boolean
  orundum?: boolean
  mining?: boolean
  specialaccess?: boolean
  
  // 其他
  [key: string]: any
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
  // 从 AutomationAvailableTask 继承的属性
  name: string
  icon: ReactNode
  description: string
  defaultParams: TaskParams
  paramFields: TaskParamField[]
  taskType?: string
  
  // TaskFlowItem 特有的属性
  id: string // 唯一标识符（如 "startup-1234567890"）
  commandId: TaskCommandId // 任务命令 ID
  params: TaskParams
  enabled: boolean
}

export interface ConnectionTestStatus {
  success: boolean
  message: string
}

export interface ScheduleExecutionStatus {
  isRunning: boolean
  currentStep: number
  currentTask: string
  currentTaskId?: string
  message?: string
}

export interface AutomationTasksProps {
  // 目前没有 props，但定义接口以备将来扩展
}

// ============================================
// RoguelikeTasks Component Types
// ============================================

export interface RoguelikeTasksProps {
  // 目前没有 props，但定义接口以备将来扩展
}

export interface RoguelikeTask {
  id: string
  name: string
  command: string
  placeholder: string
  icon: string
  hasAdvanced: boolean
  description: string
}

export interface RoguelikeAdvancedOption {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'checkbox'
  param: string
  placeholder?: string
  options?: Array<{ value: string; label: string }>
}

export interface RoguelikeTaskInputs {
  [taskId: string]: string
}

export interface RoguelikeAdvancedParams {
  [taskId: string]: {
    [key: string]: string | number | boolean
  }
}

// ============================================
// CombatTasks Component Types
// ============================================

export interface CombatTasksProps {
  // 目前没有 props，但定义接口以备将来扩展
}

export interface CombatTask {
  id: string
  name: string
  command: string
  placeholder: string
  icon: ReactNode
  hasAdvanced: boolean
  description: string
}

export interface CombatAdvancedOption {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'checkbox'
  param: string
  placeholder?: string
  options?: Array<{ value: string; label: string }>
}

export interface CombatTaskInputs {
  [taskId: string]: string
}

export interface CombatAdvancedParams {
  [taskId: string]: {
    [key: string]: string | number | boolean
  }
}

export interface AutoFormationConfig {
  [taskId: string]: boolean
}

export interface CopilotSetInfo {
  type: 'single' | 'set'
  id: string
  name: string
  stage?: string
  operators?: string
  note?: string
  autoAddS?: boolean
}

export interface CopilotSearchResult {
  stage: string
  copilots: Array<{
    id: string
    uri: string
    views: number
    hotScore: number
  }>
  recommended?: {
    uri: string
  }
}

export interface ParadoxSearchResult {
  operator: string
  copilots: Array<{
    id: string
    uri: string
    views: number
    hotScore: number
  }>
  recommended?: {
    uri: string
  }
}

// ============================================
// ConfigManager Component Types
// ============================================

export interface ConfigManagerProps {
  // 目前没有 props，但定义接口以备将来扩展
}

export interface MaaConnectionConfig {
  adb_path: string
  address: string
  config: string
}

export interface AutoUpdateConfig {
  enabled: boolean
  time: string
  updateCore: boolean
  updateCli: boolean
}

export interface ConfigSection {
  id: 'connection' | 'resource' | 'instance'
  name: string
  icon: string
}

export interface UpdateStatus {
  core: boolean
  cli: boolean
}

// ============================================
// LogViewer Component Types
// ============================================

export interface LogViewerProps {
  // 目前没有 props，但定义接口以备将来扩展
}

export interface LogEntry {
  time: string
  level: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'
  message: string
}

export interface LogFile {
  name: string
  path: string
  size: number
  modified: string
}

// ============================================
// DropRecords Component Types
// ============================================

export interface DropRecordsProps {
  dropData: DropData | null
  dropStatistics: DropStatistics | null
  dropDays: number
  setDropDays: (days: number) => void
  onRefresh: () => void
}

export interface DropData {
  // 今日掉落数据结构（根据实际 API 返回调整）
  [key: string]: any
}

export interface DropStatistics {
  total: {
    sanity: number
    battles: number
    medicine: number
    stone: number
  }
  items: {
    [itemName: string]: {
      count: number
      iconId?: string
    }
  }
  stages: {
    [stageName: string]: {
      battles: number
      sanity: number
      items: {
        [itemName: string]: number
      }
    }
  }
  dailyTrend?: any[]
  dateRange: {
    start: string
    end: string
    days: number
  }
}

// ============================================
// MaaControl Component Types
// ============================================
// DataStatistics 组件类型
// ============================================

export interface DataStatisticsProps {}

// 仓库数据 (组件专用,包含详细的 items 数组)
export interface DepotItem {
  id: string;
  name: string;
  iconId: string;
  count: number;
  classifyType: string;
}

export interface DepotDataDetailed {
  itemCount: number;
  items: DepotItem[];
  path?: string;
  timestamp: string;
}

// 干员数据 (组件专用,包含详细信息)
export interface OperatorDetailed {
  id: string;
  name: string;
  rarity: number;
  profession: string;
  position?: string;
  level: number;
  elite: number;
  potential: number;
  currentElite?: number;
  hasMaterialData?: boolean;
}

export interface OperBoxData {
  operCount: number;
  data: OperatorDetailed[];
  path?: string;
  timestamp: string;
}

// 筛选状态
export type FilterRarity = 'all' | '1' | '2' | '3' | '4' | '5' | '6';
export type FilterElite = 'all' | '0' | '1' | '2';
export type FilterPotential = 'all' | '1' | '2' | '3' | '4' | '5' | '6';
export type FilterOwnership = 'all' | 'owned' | 'unowned';
export type FilterProfession = 'all' | 'PIONEER' | 'WARRIOR' | 'TANK' | 'SNIPER' | 'CASTER' | 'MEDIC' | 'SUPPORT' | 'SPECIAL';
export type SortBy = 'default' | 'level' | 'rarity' | 'potential';
export type ActiveTask = 'depot' | 'operbox' | null;
export type ActiveTab = 'operbox' | 'depot' | 'drops';
export type OpenMenu = 'ownership' | 'rarity' | 'profession' | 'elite' | 'potential' | 'sort' | null;

// ============================================

export interface MaaControlProps {
  // 目前没有 props，但定义接口以备将来扩展
}

export interface MaaTask {
  id: string
  name: string
  command: string
  placeholder: string
  icon: string
  supportsDryRun?: boolean
  hasAdvanced?: boolean
}

export interface MaaTaskCategory {
  name: string
  icon: string
  description: string
  tasks: MaaTask[]
}

export interface MaaAdvancedOption {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'checkbox'
  param: string
  placeholder?: string
  options?: Array<{ value: string; label: string }>
}

export interface MaaTaskInputs {
  [taskId: string]: string
}

export interface MaaDryRunMode {
  [taskId: string]: boolean
}

export interface MaaShowAdvanced {
  [taskId: string]: boolean
}

export interface MaaAdvancedParams {
  [taskId: string]: {
    [key: string]: string | number | boolean
  }
}

export interface MaaCopilotSetInfo {
  type: 'single' | 'set'
  id: string
  name: string
  stage?: string
  operators?: string
  note?: string
  autoAddS?: boolean
}

// ============================================
// OperatorTraining Component Types
// ============================================

export interface OperatorTrainingProps {}

// 材料节点（层级结构）
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

// 干员训练信息
export interface TrainingOperator {
  id: string
  name: string
  rarity: number
  profession: string
  currentElite: number
  currentLevel?: number
  targetElite: number
  hasMaterialData?: boolean
  materials?: MaterialNode[]
  progress?: number
}

// 训练队列项
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
  progress: number
  isComplete?: boolean
  settings?: {
    useMedicine?: number
    useStone?: number
    autoSwitch?: boolean
    notifyOnComplete?: boolean
  }
}

// 训练设置
export interface TrainingSettings {
  useMedicine: number
  useStone: number
  autoSwitch: boolean
  notifyOnComplete: boolean
}

// 训练计划
export interface TrainingPlan {
  mode: 'current' | 'all'
  operators?: Array<{
    id: string
    name: string
    rarity: number
    currentElite: number
    targetElite: number
  }>
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
      needed: number
    }>
  }>
  totalSanity?: number
  estimatedTime?: string
  warnings?: string[]
  summary?: {
    totalStages: number
    totalTimes: number
    totalSanity: number
  }
}

// 筛选条件
export interface TrainingFilters {
  rarity: string
  profession: string
  needsElite2: boolean
}

// 活动标签页
export type TrainingActiveTab = 'operators' | 'queue' | 'plan'

// 计划模式
export type TrainingPlanMode = 'current' | 'all'

// 打开的菜单
export type TrainingOpenMenu = 'rarity' | 'profession' | null

// 材料层级节点组件 Props
export interface MaterialHierarchyNodeProps {
  node: MaterialNode
  depth?: number
}
