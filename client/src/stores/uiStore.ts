/**
 * UI Store - 管理主题、模态框等 UI 状态
 */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { UIState } from '@/types/store'

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        // State
        theme: 'dark',
        activeTab: 'automation',
        modals: {},
        
        // Actions
        setTheme: (theme) => {
          set({ theme })
          // 更新 DOM
          if (typeof document !== 'undefined') {
            const root = document.documentElement
            
            if (theme === 'system') {
              // 跟随系统主题
              const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
              root.classList.toggle('dark', isDark)
            } else {
              // 使用指定主题
              root.classList.toggle('dark', theme === 'dark')
            }
          }
        },
        
        setActiveTab: (tab) => set({ activeTab: tab }),
        
        openModal: (modalId) => set((state) => ({
          modals: { ...state.modals, [modalId]: true }
        })),
        
        closeModal: (modalId) => set((state) => ({
          modals: { ...state.modals, [modalId]: false }
        }))
      }),
      {
        name: 'ui-storage',
        // 只持久化主题和活动标签
        partialize: (state) => ({
          theme: state.theme,
          activeTab: state.activeTab
        })
      }
    ),
    { name: 'UIStore' }
  )
)

// 初始化主题
if (typeof document !== 'undefined') {
  const theme = useUIStore.getState().theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
}
