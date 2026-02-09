/**
 * Task Execution Store - 管理任务执行状态
 */

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { TaskExecutionState } from '@/types/store'

export const useTaskExecutionStore = create<TaskExecutionState>()(
  devtools(
    (set) => ({
      // State
      isRunning: false,
      currentTask: null,
      currentStep: -1,
      progress: 0,
      error: null,
      scheduleStatus: null,
      
      // Actions
      startTask: (taskId) => set({ 
        isRunning: true, 
        currentTask: taskId,
        currentStep: 0,
        progress: 0,
        error: null
      }),
      
      stopTask: () => set({ 
        isRunning: false,
        currentTask: null,
        currentStep: -1,
        progress: 0
      }),
      
      updateProgress: (step, progress) => set({ 
        currentStep: step,
        progress
      }),
      
      setError: (error) => set({ error }),
      
      updateScheduleStatus: (status) => set({ scheduleStatus: status }),
      
      reset: () => set({
        isRunning: false,
        currentTask: null,
        currentStep: -1,
        progress: 0,
        error: null,
        scheduleStatus: null
      })
    }),
    { name: 'TaskExecutionStore' }
  )
)
