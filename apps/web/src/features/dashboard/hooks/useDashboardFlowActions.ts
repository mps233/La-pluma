import { useCallback, useRef, useState } from 'react'
import { EXECUTION_NOTICE_ID, notify } from '@/shared/notifications'
import { loadUserConfig } from '@/features/user-config'
import { useDashboardExecution } from './useDashboardExecution'
import { useDashboardServiceStatus } from './useDashboardServiceStatus'

export interface DashboardFlowActionsOptions {
  refreshDashboard: () => Promise<void>
  onMissingFlow: () => void
}

export function useDashboardFlowActions({ refreshDashboard, onMissingFlow }: DashboardFlowActionsOptions) {
  const { serviceStatus, isAvailable } = useDashboardServiceStatus()
  const connectionChecking = serviceStatus === 'unknown' || serviceStatus === 'checking'
  const {
    status,
    isBusy,
    observationError,
    startFlow,
  } = useDashboardExecution({ notify })

  const [quickStartLoading, setQuickStartLoading] = useState(false)
  // 点击可能在重渲染前重复触发：执行意图只允许一个在途，避免第二个提交或提前解锁。
  const quickStartInFlightRef = useRef(false)

  const unavailableMessage = serviceStatus === 'offline'
    ? '当前网络已断开，恢复连接后再试。'
    : '后端服务暂不可用，请重试连接。'

  const runTodayFlow = useCallback(async () => {
    if (quickStartInFlightRef.current) return
    if (!isAvailable) {
      notify(unavailableMessage, 'warning', { id: EXECUTION_NOTICE_ID })
      return
    }
    quickStartInFlightRef.current = true
    setQuickStartLoading(true)
    try {
      const configResult = await loadUserConfig('automation-tasks')
      const savedFlow = Array.isArray(configResult?.data?.taskFlow) ? configResult.data.taskFlow : []
      if (!configResult.success || savedFlow.length === 0) {
        notify('还没有配置今日流程，先去日常页保存任务流。', 'warning', { id: EXECUTION_NOTICE_ID })
        onMissingFlow()
        return
      }

      const outcome = await startFlow(savedFlow)
      notify(outcome.message, outcome.type, { id: EXECUTION_NOTICE_ID })
      if (outcome.ok) await refreshDashboard()
    } catch (error) {
      notify((error as Error)?.message || '今日流程启动失败', 'error', { id: EXECUTION_NOTICE_ID })
    } finally {
      quickStartInFlightRef.current = false
      setQuickStartLoading(false)
    }
  }, [isAvailable, onMissingFlow, refreshDashboard, startFlow, unavailableMessage])

  return {
    status,
    isBusy,
    observationError,
    isAvailable,
    connectionChecking,
    quickStartLoading,
    runTodayFlow,
  }
}
