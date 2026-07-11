/**
 * Store 状态类型定义
 */

import type { TaskFlow, ScheduleStatus } from './api'

// Task Execution Store
export interface TaskExecutionState {
  isRunning: boolean
  currentTask: string | null
  currentStep: number
  progress: number
  error: string | null
  scheduleStatus: ScheduleStatus | null
  
  // Actions
  startTask: (taskId: string) => void
  stopTask: () => void
  updateProgress: (step: number, progress: number) => void
  setError: (error: string | null) => void
  updateScheduleStatus: (status: ScheduleStatus) => void
  reset: () => void
}

// Task Configuration Store
export interface TaskConfigState {
  automationTasks: TaskFlow[]
  combatTasks: Record<string, any>
  roguelikeTasks: Record<string, any>
  scheduleEnabled: boolean
  scheduleTimes: string[]
  
  // Actions
  setAutomationTasks: (tasks: TaskFlow[]) => void
  setCombatTasks: (tasks: Record<string, any>) => void
  setRoguelikeTasks: (tasks: Record<string, any>) => void
  setSchedule: (enabled: boolean, times: string[]) => void
  loadConfig: (type: string) => Promise<void>
  saveConfig: (type: string) => Promise<void>
}

// UI Store
export interface UIState {
  theme: 'light' | 'dark' | 'system'
  activeTab: string
  modals: Record<string, boolean>
  
  // Actions
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  setActiveTab: (tab: string) => void
  openModal: (modalId: string) => void
  closeModal: (modalId: string) => void
}
