/**
 * Store 状态类型定义
 */

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
