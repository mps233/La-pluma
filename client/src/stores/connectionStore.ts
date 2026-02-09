/**
 * Connection Store - 管理 ADB 连接状态和配置
 */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { ConnectionState } from '@/types/store'
import { createErrorHandler } from './errorHandler'

const handleError = createErrorHandler('ConnectionStore')

export const useConnectionStore = create<ConnectionState>()(
  devtools(
    persist(
      (set, get) => ({
        // State
        status: 'disconnected',
        adbPath: '/opt/homebrew/bin/adb',
        address: '127.0.0.1:16384',
        clientType: 'Official',
        lastTestTime: null,
        
        // Actions
        testConnection: async () => {
          set({ status: 'connecting' })
          try {
            const { adbPath, address } = get()
            
            // 调用后端 API 测试连接
            const response = await fetch('/api/maa/test-connection', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ adbPath, address })
            })
            
            const result = await response.json()
            const success = result.success
            
            set({ 
              status: success ? 'connected' : 'disconnected',
              lastTestTime: Date.now()
            })
            
            return success
          } catch (error) {
            handleError(error as Error, 'testConnection')
            set({ status: 'disconnected' })
            return false
          }
        },
        
        updateConfig: (config) => set((state) => ({
          ...state,
          ...config
        })),
        
        setStatus: (status) => set({ status })
      }),
      {
        name: 'connection-storage',
        // 持久化连接配置
        partialize: (state) => ({
          adbPath: state.adbPath,
          address: state.address,
          clientType: state.clientType
        })
      }
    ),
    { name: 'ConnectionStore' }
  )
)
