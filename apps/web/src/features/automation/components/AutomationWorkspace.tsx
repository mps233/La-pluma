import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getErrorMessage, isRecord } from '@/shared/api'
import { BREAKPOINTS } from '@/shared/lib/breakpoints'
import { useReducedMotion } from 'framer-motion'
import { ConfigLoadCard } from '@/shared/components'
import { DeviceMonitorLayout } from '@/features/device-mirror'
import { dismissNotice, notify } from '@/shared/notifications'
import { useAutomationAvailability } from '@/features/runtime-status'
import { useUserConfig } from '@/features/user-config'
import { useResourceInvalidation, type ResourceInvalidation } from '@/features/resource-invalidation'
import { testConnection as testAdbConnection } from '@/features/settings'
import AutomationTaskEditor from './AutomationTaskEditor'
import AutomationTaskFlowPanel from './AutomationTaskFlowPanel'
import AutomationScheduleCard from './AutomationScheduleCard'
import NotificationSettings from './NotificationSettings'
import { AVAILABLE_TASKS } from './automationTaskCatalog'
import { useAutomationExecution } from '../hooks/useAutomationExecution'
import { useTaskFlowSorting } from '../hooks/useTaskFlowSorting'
import {
  automationConfigAdapter,
  createDefaultAutomationDraft,
  toPersistedTaskFlow,
  toPersistedTaskFlowItem,
} from '../model/automationConfig'
import {
  createDefaultScheduleEntries,
  normalizeScheduleEntries,
  type ScheduleTimeEntry,
} from '../model/automationSchedule'
import {
  addTaskToFlow as appendTaskToFlow,
  findTaskFlowValidationFailure,
  insertTaskFlowItem,
  removeTaskFlowItem,
  toggleTaskFlowItemEnabled,
  updateTaskFlowParams,
} from '../model/taskFlowCommands'
import {
  resolveFlowTaskExecutionState,
  selectFlowCurrentStep,
  selectFlowDisplaySummary,
  selectFlowTaskResults,
} from '../model/flowExecution'
import type {
  AutomationAvailableTask,
  ConnectionTestStatus,
  TaskFlowItem,
  TaskParamKey,
  TaskParamValue,
} from '../types'

/** 养成为任务流程或定时配置发布失效；页面据此强制重读同一协调器通道。 */
const AUTOMATION_RESOURCE_SCOPES = ['automation-config', 'automation-schedule'] as const
const AUTOMATION_CONFIG_NOTICE_ID = 'automation-config-save'
const AUTOMATION_CONNECTION_NOTICE_ID = 'automation-connection-test'
const AUTOMATION_DELETED_TASK_NOTICE_ID = 'automation-deleted-task'
const AUTOMATION_RESTORE_BLOCKED_NOTICE_ID = 'automation-restore-blocked'

interface DeletedTaskSnapshot {
  task: TaskFlowItem
  index: number
}

const isConnectionTestStatus = (value: unknown): value is ConnectionTestStatus => (
  isRecord(value) && typeof value.success === 'boolean' && typeof value.message === 'string'
)

export default function AutomationWorkspace() {
  const shouldReduceMotion = useReducedMotion()
  const { isAvailable: automationAvailable, unavailableMessage } = useAutomationAvailability()
  const {
    isRunning,
    isStopping,
    isSubmitting,
    run,
    progress: executionProgress,
    summary: executionSummary,
    scheduleSummary: executionScheduleSummary,
    submitFlow,
    stop: stopTaskFlow,
  } = useAutomationExecution({ notify })

  const showSuccess = (msg: string) => {
    notify(msg, 'success')
  }
  const showError = (msg: string) => {
    notify(msg, 'error')
  }

  const {
    draft: configDraft,
    syncState: configSyncState,
    error: configSyncError,
    loadState: configLoadState,
    loadError: configLoadError,
    update: updateConfig,
    channel: configChannel,
    retry: retryConfigSave,
    reload: reloadConfig,
  } = useUserConfig(automationConfigAdapter)

  // 协调器持有 task flow 与 schedule 的唯一草稿；页面只派生图标/参数表单等展示字段。
  const taskFlow = useMemo<TaskFlowItem[]>(() => (
    (configDraft?.taskFlow ?? []).map(item => {
      const commandId = item.commandId || item.id.split('-')[0]
      const originalTask = AVAILABLE_TASKS.find(task => task.id === item.commandId || task.id === commandId)
      return {
        ...item,
        icon: originalTask?.icon,
        paramFields: originalTask?.paramFields ?? [],
      }
    })
  ), [configDraft?.taskFlow])
  const scheduleEnabled = configDraft?.schedule.enabled ?? false
  const scheduleEntries = configDraft?.schedule.entries ?? createDefaultScheduleEntries()
  const isRetryingConfigSave = configSyncState === 'saving'
  const isFlowEditingLocked = isSubmitting || isRunning

  const currentDraft = () => configChannel.getState().draft ?? createDefaultAutomationDraft()

  const handleRetryConfigSave = async () => {
    if (isRetryingConfigSave) return
    await retryConfigSave()
  }
  const retryConfigSaveRef = useRef(handleRetryConfigSave)
  retryConfigSaveRef.current = handleRetryConfigSave

  useEffect(() => {
    if (!configSyncError) {
      dismissNotice(AUTOMATION_CONFIG_NOTICE_ID)
      return
    }
    notify(configSyncError, 'error', {
      id: AUTOMATION_CONFIG_NOTICE_ID,
      action: {
        label: '重新同步',
        onClick: () => {
          void retryConfigSaveRef.current()
        },
      },
    })
  }, [configSyncError])

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<Record<string, ConnectionTestStatus>>({})
  const [testingConnectionTaskId, setTestingConnectionTaskId] = useState<string | null>(null)
  const connectionTestInFlightRef = useRef(false)
  const connectionTestAbortRef = useRef<AbortController | null>(null)
  const connectionTestMountedRef = useRef(true)
  const editorColumnRef = useRef<HTMLDivElement>(null)
  const isFlowEditingLockedRef = useRef(isFlowEditingLocked)
  isFlowEditingLockedRef.current = isFlowEditingLocked

  // 拖拽期间只渲染本地预览，松手时才把最终顺序作为一次编辑写入协调器。
  const commitTaskFlowOrder = useCallback((nextFlow: TaskFlowItem[]) => {
    if (isFlowEditingLockedRef.current) return
    const current = configChannel.getState().draft ?? createDefaultAutomationDraft()
    updateConfig({ ...current, taskFlow: toPersistedTaskFlow(nextFlow) })
  }, [configChannel, updateConfig])
  const sorting = useTaskFlowSorting({
    flow: taskFlow,
    disabled: isFlowEditingLocked,
    onCommit: commitTaskFlowOrder,
  })
  const displayedTaskFlow = sorting.displayedFlow

  const activeTaskId = selectedTaskId && displayedTaskFlow.some(task => task.id === selectedTaskId)
    ? selectedTaskId
    : displayedTaskFlow[0]?.id ?? null
  const displaySummary = selectFlowDisplaySummary({
    summary: executionSummary,
    scheduleSummary: executionScheduleSummary,
    isRunning,
    isSubmitting,
  })
  const taskResults = selectFlowTaskResults(displayedTaskFlow, {
    isRunning,
    isSubmitting,
    progress: executionProgress,
    displaySummary,
  })
  const currentStep = selectFlowCurrentStep(displayedTaskFlow, executionProgress, isRunning)
  const executionView = { isRunning, taskResults, currentStep }
  const activeTaskIndex = displayedTaskFlow.findIndex(task => task.id === activeTaskId)
  const activeTask = activeTaskIndex >= 0 ? displayedTaskFlow[activeTaskIndex] ?? null : null
  const activeTaskIsCurrent = activeTask !== null
    && resolveFlowTaskExecutionState(activeTask, activeTaskIndex, executionView) === 'running'

  const selectTaskForEditing = (taskId: string) => {
    if (isFlowEditingLockedRef.current) return
    setSelectedTaskId(taskId)
    if (!window.matchMedia?.(`(width < ${BREAKPOINTS.workbench}px)`).matches) return

    window.requestAnimationFrame(() => {
      editorColumnRef.current?.scrollIntoView({
        behavior: shouldReduceMotion ? 'auto' : 'smooth',
        block: 'start',
      })
    })
  }

  useEffect(() => {
    connectionTestMountedRef.current = true
    setTestingConnectionTaskId(null)
    return () => {
      connectionTestMountedRef.current = false
      const connectionController = connectionTestAbortRef.current
      connectionController?.abort()
      if (connectionTestAbortRef.current === connectionController) {
        connectionTestAbortRef.current = null
        connectionTestInFlightRef.current = false
      }
    }
  }, [])

  const addTaskToFlow = (task: AutomationAvailableTask) => {
    if (isFlowEditingLocked) return
    const current = currentDraft()
    const added = appendTaskToFlow(current.taskFlow, task)

    updateConfig({ ...current, taskFlow: added.flow })
    setSelectedTaskId(added.task.id)
  }

  const removeTaskFromFlow = (index: number) => {
    if (isFlowEditingLocked) return
    const current = currentDraft()
    const removedTask = current.taskFlow[index]
    if (!removedTask) return
    const newFlow = removeTaskFlowItem(current.taskFlow, index)
    if (removedTask.id === activeTaskId) {
      setSelectedTaskId(newFlow[Math.min(index, newFlow.length - 1)]?.id ?? null)
    }
    const removedDisplayTask = taskFlow[index]
    if (removedDisplayTask) {
      const snapshot = { task: removedDisplayTask, index }
      notify(`已删除“${removedDisplayTask.name}”`, 'info', {
        id: AUTOMATION_DELETED_TASK_NOTICE_ID,
        action: { label: '恢复', onClick: () => restoreDeletedTask(snapshot) },
      })
    }
    updateConfig({ ...current, taskFlow: newFlow })
  }

  const restoreDeletedTask = (snapshot: DeletedTaskSnapshot) => {
    if (isFlowEditingLockedRef.current) {
      notify('执行或启动期间不能恢复已删除的任务', 'warning', {
        id: AUTOMATION_RESTORE_BLOCKED_NOTICE_ID,
      })
      return
    }
    const current = currentDraft()
    const newFlow = insertTaskFlowItem(
      current.taskFlow,
      toPersistedTaskFlowItem(snapshot.task),
      snapshot.index,
    )
    updateConfig({ ...current, taskFlow: newFlow })
    setSelectedTaskId(snapshot.task.id)
    dismissNotice(AUTOMATION_DELETED_TASK_NOTICE_ID)
  }

  const toggleTaskEnabled = (index: number) => {
    if (isFlowEditingLocked) return
    const current = currentDraft()
    if (!current.taskFlow[index]) return
    updateConfig({ ...current, taskFlow: toggleTaskFlowItemEnabled(current.taskFlow, index) })
  }

  const updateTaskParam = (index: number, key: TaskParamKey, value: TaskParamValue) => {
    if (isFlowEditingLocked) return
    const current = currentDraft()
    if (!current.taskFlow[index]) return

    updateConfig({
      ...current,
      taskFlow: updateTaskFlowParams(current.taskFlow, index, key, value),
    })
  }

  const testConnection = async (taskId: string) => {
    if (connectionTestInFlightRef.current) return

    const controller = new AbortController()
    const startedAt = Date.now()
    const waitForStableFeedback = async () => {
      const remaining = 450 - (Date.now() - startedAt)
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining))
    }
    connectionTestInFlightRef.current = true
    connectionTestAbortRef.current = controller
    setTestingConnectionTaskId(taskId)
    setConnectionStatus(prev => {
      const next = { ...prev }
      delete next[taskId]
      return next
    })

    try {
      const result = await testAdbConnection(undefined, undefined, controller.signal)
      await waitForStableFeedback()
      if (controller.signal.aborted) return
      const payload = isConnectionTestStatus(result.data) ? result.data : undefined
      const success = Boolean(result.success && payload?.success)
      const message = payload?.message || getErrorMessage(result)
      setConnectionStatus(prev => ({
        ...prev,
        [taskId]: {
          success,
          message,
        },
      }))
      notify(message, success ? 'success' : 'error', { id: AUTOMATION_CONNECTION_NOTICE_ID })
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return
      await waitForStableFeedback()
      if (controller.signal.aborted) return
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      setConnectionStatus(prev => ({
        ...prev,
        [taskId]: {
          success: false,
          message: errorMessage,
        }
      }))
      notify(errorMessage, 'error', { id: AUTOMATION_CONNECTION_NOTICE_ID })
    } finally {
      if (connectionTestAbortRef.current === controller) {
        connectionTestInFlightRef.current = false
        connectionTestAbortRef.current = null
        if (connectionTestMountedRef.current) setTestingConnectionTaskId(null)
      }
    }
  }

  const updateSchedule = (next: { enabled?: boolean; entries?: ScheduleTimeEntry[] }) => {
    const current = currentDraft()
    updateConfig({
      ...current,
      schedule: {
        enabled: next.enabled ?? current.schedule.enabled,
        entries: normalizeScheduleEntries(next.entries ?? current.schedule.entries),
      },
    })
  }

  const executeTaskFlow = async () => {
    if (!automationAvailable) {
      void showError(unavailableMessage)
      return
    }

    const invalidTask = findTaskFlowValidationFailure(displayedTaskFlow)
    if (invalidTask) {
      setSelectedTaskId(invalidTask.taskId)
      void showError(invalidTask.message)
      return
    }

    await submitFlow(displayedTaskFlow)
  }

  // 养成计划或队列同步成功后，经资源失效端口通知本页。应用计划前 training 已
  // 通过同一配置协调协议排空本页的在途保存；这里再等到通道空闲后强制重读，
  // 以免外部写入早于本页仍在途的旧保存。仍有 pending 失败草稿时保留本地并提示。
  const handleAutomationInvalidation = async (invalidation: ResourceInvalidation) => {
    const state = configChannel.getState()
    if (state.pending) await configChannel.flush()
    const outcome = await reloadConfig({ force: true })
    const detail = isRecord(invalidation.detail) ? invalidation.detail : null
    const stageCount = typeof detail?.stageCount === 'number' && Number.isFinite(detail.stageCount)
      ? detail.stageCount
      : null
    if (outcome.reason === 'loaded') {
      notify(
        stageCount === null ? '智能养成计划已更新' : `智能养成计划已更新：${stageCount} 个关卡`,
        'success',
      )
    } else if (outcome.reason === 'local-draft' || outcome.reason === 'stale') {
      notify('检测到本设备有未同步的流程编辑，已保留本地草稿；养成计划更新未覆盖本地配置', 'warning')
    } else if (outcome.reason === 'failed') {
      notify('自动化配置刷新失败，请稍后重试', 'warning')
    }
  }

  // Effect 内订阅；Activity 隐藏时注销，恢复时由 hook 补发一次 activity-resume。
  useResourceInvalidation(AUTOMATION_RESOURCE_SCOPES, invalidation => {
    void handleAutomationInvalidation(invalidation)
  })

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (!document.hidden) {
        await reloadConfig()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [reloadConfig])

  if (configLoadState !== 'ready') {
    return (
      <DeviceMonitorLayout variant="standard">
        <ConfigLoadCard
          failed={configLoadState === 'failed'}
          title="自动化配置"
          loadingMessage="正在读取自动化配置…"
          failedMessage="自动化配置暂时不可用"
          error={configLoadError}
          onRetry={() => void reloadConfig({ force: true })}
        />
      </DeviceMonitorLayout>
    )
  }

  return (
    <DeviceMonitorLayout
        variant="workbench"
        sequence={(
          <AutomationTaskFlowPanel
            tasks={displayedTaskFlow}
            activeTaskId={activeTaskId}
            execution={{
              isRunning,
              isStopping,
              isSubmitting,
              automationAvailable,
              unavailableMessage,
              taskResults,
              currentStep,
              displaySummary,
              runId: run?.runId ?? null,
              onExecute: executeTaskFlow,
              onStop: stopTaskFlow,
            }}
            sorting={{
              draggedIndex: sorting.draggedIndex,
              announcement: sorting.announcement,
              disabled: isFlowEditingLocked,
              registerItem: sorting.registerItem,
              onPointerDown: sorting.handlePointerDown,
              onKeyDown: sorting.handleKeyDown,
            }}
            onSelectTask={selectTaskForEditing}
            onAddTask={addTaskToFlow}
            onRemoveTask={removeTaskFromFlow}
            onToggleTask={toggleTaskEnabled}
          />
        )}
        editor={(
          <AutomationTaskEditor
            task={activeTask}
            taskIndex={activeTaskIndex}
            isEditingLocked={isFlowEditingLocked}
            isCurrentTask={activeTaskIsCurrent}
            connectionStatus={connectionStatus}
            testingConnectionTaskId={testingConnectionTaskId}
            containerRef={editorColumnRef}
            onToggleEnabled={toggleTaskEnabled}
            onUpdateParam={updateTaskParam}
            onTestConnection={testConnection}
            onSuccess={showSuccess}
            onError={showError}
          />
        )}
        support={(
          <>
            <AutomationScheduleCard
              enabled={scheduleEnabled}
              entries={scheduleEntries}
              disabled={isRunning}
              onChange={updateSchedule}
              onError={showError}
            />

            <NotificationSettings />
          </>
        )}
    />
  )
}
