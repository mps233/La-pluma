import type { KeyboardEvent, PointerEvent } from 'react'
import type { AutomationAvailableTask, TaskFlowItem } from '../types'
import type { AutomationExecutionSummary } from '../model/automationRun'
import type { TaskExecutionResult } from '../utils/automationTaskProgress'

/** 只读执行投影：来源是 task-execution 控制器，不包含任何可写字段。 */
export interface AutomationFlowExecutionProjection {
  isRunning: boolean
  isStopping: boolean
  isSubmitting: boolean
  automationAvailable: boolean
  unavailableMessage: string
  taskResults: TaskExecutionResult[]
  currentStep: number
  /** 最近一次可展示的执行摘要（本页 run 终态优先，空闲时回退流程投影）。 */
  displaySummary: AutomationExecutionSummary | null
  /** 本页持有 run 的身份；用于把内容相同的新一次执行识别为新的摘要。 */
  runId: string | null
  onExecute: () => void
  onStop: () => void
}

export interface AutomationFlowSortingProjection {
  draggedIndex: number | null
  announcement: string
  disabled: boolean
  registerItem: (taskId: string, node: HTMLDivElement | null) => void
  onPointerDown: (event: PointerEvent<HTMLButtonElement>, taskId: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, taskId: string) => void
}

export interface AutomationTaskFlowPanelProps {
  tasks: TaskFlowItem[]
  activeTaskId: string | null
  execution: AutomationFlowExecutionProjection
  sorting: AutomationFlowSortingProjection
  onSelectTask: (taskId: string) => void
  onAddTask: (task: AutomationAvailableTask) => void
  onRemoveTask: (index: number) => void
  onToggleTask: (index: number) => void
}
