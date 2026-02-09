/**
 * Task Configuration Store - 管理任务配置
 */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { TaskConfigState } from '@/types/store'
import { createErrorHandler, withErrorHandling } from './errorHandler'

const handleError = createErrorHandler('TaskConfigStore')

export const useTaskConfigStore = create<TaskConfigState>()(
  devtools(
    persist(
      (set, get) => ({
        // State
        automationTasks: [],
        combatTasks: {},
        roguelikeTasks: {},
        scheduleEnabled: false,
        scheduleTimes: ['08:00', '14:00', '20:00'],
        
        // Actions
        setAutomationTasks: (tasks) => set({ automationTasks: tasks }),
        
        setCombatTasks: (tasks) => set({ combatTasks: tasks }),
        
        setRoguelikeTasks: (tasks) => set({ roguelikeTasks: tasks }),
        
        setSchedule: (enabled, times) => set({ 
          scheduleEnabled: enabled,
          scheduleTimes: times
        }),
        
        loadConfig: async (type) => {
          await withErrorHandling(
            async () => {
              const response = await fetch(`/api/maa/load-user-config?type=${type}`)
              const result = await response.json()
              
              if (result.success && result.data) {
                switch (type) {
                  case 'automation-tasks':
                    set({ automationTasks: result.data.taskFlow || [] })
                    break
                  case 'combat-tasks':
                    set({ combatTasks: result.data })
                    break
                  case 'roguelike-tasks':
                    set({ roguelikeTasks: result.data })
                    break
                }
              }
            },
            handleError,
            'loadConfig',
            undefined
          )
        },
        
        saveConfig: async (type) => {
          await withErrorHandling(
            async () => {
              const state = get()
              let data: any
              
              switch (type) {
                case 'automation-tasks':
                  data = { taskFlow: state.automationTasks }
                  break
                case 'combat-tasks':
                  data = state.combatTasks
                  break
                case 'roguelike-tasks':
                  data = state.roguelikeTasks
                  break
              }
              
              const response = await fetch('/api/maa/save-user-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, data })
              })
              
              const result = await response.json()
              if (!result.success) {
                throw new Error(result.error || '保存配置失败')
              }
            },
            handleError,
            'saveConfig',
            undefined
          )
        }
      }),
      {
        name: 'task-config-storage',
        version: 1,
        // 持久化任务配置
        partialize: (state) => ({
          automationTasks: state.automationTasks,
          combatTasks: state.combatTasks,
          roguelikeTasks: state.roguelikeTasks,
          scheduleEnabled: state.scheduleEnabled,
          scheduleTimes: state.scheduleTimes
        }),
        // 版本迁移
        migrate: (persistedState: any, version: number) => {
          if (version === 0) {
            // 从 v0 迁移到 v1
            return {
              ...persistedState,
              scheduleEnabled: persistedState.scheduleEnabled ?? false,
              scheduleTimes: persistedState.scheduleTimes ?? ['08:00', '14:00', '20:00']
            }
          }
          return persistedState
        }
      }
    ),
    { name: 'TaskConfigStore' }
  )
)
