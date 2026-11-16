import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getErrorMessage, isRecord } from '@/shared/api'
import { BREAKPOINTS } from '@/shared/lib/breakpoints'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle,
  Cable,
  CheckCircle2,
  ChevronDown,
  Info,
  LoaderCircle,
  Minus,
  Plus,
  SlidersHorizontal,
} from 'lucide-react'
import { DeviceMonitorPanel } from '@/features/device-mirror'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Switch } from '@/shared/ui/switch'
import { Card } from '@/shared/ui/card'
import { EmptyState, FieldHint } from '@/shared/components'
import { notify } from '@/shared/notifications'
import { useAutomationAvailability } from '@/features/runtime-status'
import { useUserConfig } from '@/features/user-config'
import { useResourceInvalidation, type ResourceInvalidation } from '@/features/resource-invalidation'
import { testConnection as testAdbConnection } from '@/features/settings'
import AutomationStageEditor from './AutomationStageEditor'
import InfrastScheduleField from './InfrastScheduleField'
import OperProgressPlansEditor from './OperProgressPlansEditor'
import ThemeListEditor from './ThemeListEditor'
import AutomationTaskFlowPanel from './AutomationTaskFlowPanel'
import AutomationScheduleCard from './AutomationScheduleCard'
import NotificationSettings from './NotificationSettings'
import {
  AutomationCheckboxField,
  AutomationFieldLabel,
  AutomationFieldLegend,
} from './AutomationFieldControls'
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
  RECRUITMENT_TIME_MAX,
  RECRUITMENT_TIME_MIN,
  RECRUITMENT_TIME_STEP,
  normalizeRecruitmentTime,
} from '../model/taskParamRules'
import { resolveFieldHelperTooltip } from '../model/taskFieldHelper'
import {
  resolveFlowTaskExecutionState,
  selectFlowCurrentStep,
  selectFlowDisplaySummary,
  selectFlowTaskResults,
} from '../model/flowExecution'
import type { AutomationAvailableTask, ConnectionTestStatus, TaskFlowItem, TaskParamField } from '../types'

/** 养成为任务流程或定时配置发布失效；页面据此强制重读同一协调器通道。 */
const AUTOMATION_RESOURCE_SCOPES = ['automation-config', 'automation-schedule'] as const

interface SelectFieldItem {
  value: string
  label: string
}

const asSelectItems = (options: TaskParamField['options']): SelectFieldItem[] => {
  const items: SelectFieldItem[] = []
  for (const option of options ?? []) {
    items.push(typeof option === 'object' ? option : { value: option, label: option })
  }
  return items
}

function SelectField({
  id,
  items,
  value,
  disabled,
  onValueChange,
  className,
  'aria-label': ariaLabel,
}: {
  id?: string
  items: SelectFieldItem[]
  value?: string | null
  disabled?: boolean
  onValueChange: (value: string) => void
  className?: string
  'aria-label'?: string
}) {
  return (
    <Select items={items} value={value} onValueChange={(next, details) => { if (details.reason === 'none' || next === null) return; onValueChange(next) }} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={className ?? 'w-full'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(item => (
          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

interface DeletedTaskSnapshot {
  task: TaskFlowItem
  index: number
}

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

  const currentDraft = () => configChannel.getState().draft ?? createDefaultAutomationDraft()

  const handleRetryConfigSave = async () => {
    if (isRetryingConfigSave) return
    const saved = await retryConfigSave()
    if (saved) notify('自动化配置已同步', 'success')
  }

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [lastDeletedTask, setLastDeletedTask] = useState<DeletedTaskSnapshot | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<Record<string, ConnectionTestStatus>>({})
  const [testingConnectionTaskId, setTestingConnectionTaskId] = useState<string | null>(null)
  const connectionTestInFlightRef = useRef(false)
  const connectionTestAbortRef = useRef<AbortController | null>(null)
  const connectionTestMountedRef = useRef(true)
  const editorColumnRef = useRef<HTMLDivElement>(null)

  // 拖拽期间只渲染本地预览，松手时才把最终顺序作为一次编辑写入协调器。
  const commitTaskFlowOrder = useCallback((nextFlow: TaskFlowItem[]) => {
    const current = configChannel.getState().draft ?? createDefaultAutomationDraft()
    updateConfig({ ...current, taskFlow: toPersistedTaskFlow(nextFlow) })
  }, [configChannel, updateConfig])
  const sorting = useTaskFlowSorting({
    flow: taskFlow,
    disabled: isRunning,
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

  const selectTaskForEditing = (taskId: string) => {
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
    const current = currentDraft()
    const added = appendTaskToFlow(current.taskFlow, task)

    updateConfig({ ...current, taskFlow: added.flow })
    setSelectedTaskId(added.task.id)
  }

  const removeTaskFromFlow = (index: number) => {
    const current = currentDraft()
    const removedTask = current.taskFlow[index]
    if (!removedTask) return
    const newFlow = removeTaskFlowItem(current.taskFlow, index)
    if (removedTask.id === activeTaskId) {
      setSelectedTaskId(newFlow[Math.min(index, newFlow.length - 1)]?.id ?? null)
    }
    const removedDisplayTask = taskFlow[index]
    if (removedDisplayTask) setLastDeletedTask({ task: removedDisplayTask, index })
    updateConfig({ ...current, taskFlow: newFlow })
  }

  const restoreDeletedTask = () => {
    if (!lastDeletedTask || isRunning) return
    const current = currentDraft()
    const newFlow = insertTaskFlowItem(
      current.taskFlow,
      toPersistedTaskFlowItem(lastDeletedTask.task),
      lastDeletedTask.index,
    )
    updateConfig({ ...current, taskFlow: newFlow })
    setSelectedTaskId(lastDeletedTask.task.id)
    setLastDeletedTask(null)
  }

  const toggleTaskEnabled = (index: number) => {
    const current = currentDraft()
    if (!current.taskFlow[index]) return
    updateConfig({ ...current, taskFlow: toggleTaskFlowItemEnabled(current.taskFlow, index) })
  }

  const updateTaskParam = (index: number, key: string, value: any) => {
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
      const payload = result.data as ConnectionTestStatus | undefined
      const success = Boolean(result.success && payload?.success)
      setConnectionStatus(prev => ({
        ...prev,
        [taskId]: {
          success,
          message: payload?.message || getErrorMessage(result),
        },
      }))
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

  return (
    <>
      {configSyncError && (
        <div
          role="alert"
          className="status-warning flex min-h-11 flex-wrap items-center justify-between gap-3.5 rounded-lg px-3 py-2 text-sm leading-5"
        >
          <span className="min-w-0 flex-1">{configSyncError}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleRetryConfigSave()}
            disabled={isRetryingConfigSave}
            aria-busy={isRetryingConfigSave || undefined}
            className="min-h-11 shrink-0"
          >
            {isRetryingConfigSave
              ? <><LoaderCircle className="animate-spin" aria-hidden="true" />同步中</>
              : '重新同步'}
          </Button>
        </div>
      )}

      <div className="automation-workspace-grid">
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
            disabled: isRunning,
            registerItem: sorting.registerItem,
            onPointerDown: sorting.handlePointerDown,
            onKeyDown: sorting.handleKeyDown,
          }}
          lastDeletedTaskName={lastDeletedTask?.task.name ?? null}
          onSelectTask={selectTaskForEditing}
          onAddTask={addTaskToFlow}
          onRemoveTask={removeTaskFromFlow}
          onToggleTask={toggleTaskEnabled}
          onRestoreDeletedTask={restoreDeletedTask}
        />

        <div ref={editorColumnRef} id="automation-task-editor" className="automation-editor-column" tabIndex={-1}>
          <Card className="automation-editor-panel gap-0 p-0!">
            <div className="automation-editor-heading">
              <div>
                <h3><SlidersHorizontal size={16} strokeWidth={1.8} aria-hidden="true" /><span>任务配置</span></h3>
              </div>
              {activeTaskId && (
                <span>{String(displayedTaskFlow.findIndex(task => task.id === activeTaskId) + 1).padStart(2, '0')}</span>
              )}
            </div>
            {!activeTaskId ? (
              <EmptyState
                className="automation-editor-empty"
                compact
                icon={<SlidersHorizontal size={22} strokeWidth={1.7} />}
                title="暂无可配置任务"
                description="先从任务流程中添加一个任务"
              />
            ) : (
              <div className="automation-editor-content">
                {displayedTaskFlow.filter(task => task.id === activeTaskId).map((task) => {
                  const index = displayedTaskFlow.findIndex(item => item.id === task.id)
                  const isCurrentTask = resolveFlowTaskExecutionState(task, index, executionView) === 'running'
                  const connectionFeedback = connectionStatus[task.id]
                  const isTestingConnection = testingConnectionTaskId === task.id
                  const parameterFields = task.paramFields ?? []
                  const usesGroupedParameterRows = parameterFields.length > 0 && parameterFields.every(field => (
                    field.type === 'select' || field.type === 'text' || field.type === 'number'
                  ))
                  // 公招的「3 星保留招聘许可」标签连同图标超过 5rem 标签列，只有该卡片需要加宽列。
                  const usesWideFieldLabels = task.commandId === 'recruit'

                  return (
                  <div
                    key={task.id}
                    className={`automation-task-editor${isCurrentTask ? ' is-current' : ''}${!task.enabled ? ' is-disabled' : ''}`}
                  >
                    <div className="automation-flow-card-header">
                      <div className="automation-flow-card-identity">
                        <span className="automation-flow-sequence">{String(index + 1).padStart(2, '0')}</span>
                        <span className="automation-flow-task-name">
                          <strong>{task.name}</strong>
                          <small>{isCurrentTask ? '正在执行' : task.taskType || task.commandId}</small>
                        </span>
                      </div>
                      <div className="automation-flow-card-controls">
                        <Switch
                          checked={task.enabled}
                          onCheckedChange={() => toggleTaskEnabled(index)}
                          disabled={isRunning}
                          aria-label={`${task.name}启用状态`}
                        />
                      </div>
                    </div>

                    {task.paramFields && task.paramFields.length > 0 && (
                      <div className={`automation-param-fields${usesGroupedParameterRows ? ' is-grouped' : ''}${usesWideFieldLabels ? ' has-wide-field-labels' : ''}`}>
                        {task.paramFields.map((field) => {
                          if (field.visibleWhen && String(task.params[field.visibleWhen.key] ?? '') !== String(field.visibleWhen.value)) {
                            return null
                          }
                          if (field.hiddenWhen && String(task.params[field.hiddenWhen.key] ?? '') === String(field.hiddenWhen.value)) {
                            return null
                          }
                          const fieldId = `automation-${task.id}-${field.key}`
                          const helperTooltip = resolveFieldHelperTooltip(field)
                          return (
                          <div key={field.key} className={`automation-param-field is-${field.type}`}>
                            {field.type === 'oper-progress-plans' ? (
                              <OperProgressPlansEditor plans={task.params.plans ?? []} disabled={isRunning || !task.enabled} onChange={plans => updateTaskParam(index, 'plans', plans)} />
                            ) : field.type === 'theme-list' ? (
                              <ThemeListEditor themes={task.params.themes ?? []} disabled={isRunning || !task.enabled} onChange={themes => updateTaskParam(index, 'themes', themes)} />
                            ) : field.type === 'infrast-schedule' ? (
                              <InfrastScheduleField
                                fieldId={fieldId}
                                filename={typeof task.params.filename === 'string' ? task.params.filename : ''}
                                planIndex={task.params.plan_index ?? 0}
                                disabled={isRunning || !task.enabled}
                                onChange={(key, value) => updateTaskParam(index, key, value)}
                              />
                            ) : field.type === 'checkbox' ? (
                              <AutomationCheckboxField
                                id={fieldId}
                                label={field.label}
                                checked={task.params[field.key] || false}
                                disabled={isRunning || !task.enabled}
                                hint={helperTooltip}
                                onChange={(checked) => updateTaskParam(index, field.key, checked)}
                              />
                            ) : field.type === 'multi-stages' ? (
                              <AutomationStageEditor
                                field={field}
                                fieldId={fieldId}
                                task={task}
                                taskIndex={index}
                                isRunning={isRunning}
                                hint={helperTooltip}
                                onUpdate={updateTaskParam}
                                onSuccess={showSuccess}
                                onError={showError}
                              />
                            ) : field.type === 'stage-with-times' ? (
                              <div className="flex items-center space-x-2">
                                <label htmlFor={fieldId} className="automation-field-label w-20 whitespace-nowrap">{field.label}</label>
                                <div className="automation-composite-control flex items-center flex-1 max-w-70">
                                  <Input
                                    id={fieldId}
                                    type="text"
                                    autoComplete="off"
                                    value={task.params[field.key] || ''}
                                    onChange={(e) => updateTaskParam(index, field.key, e.target.value)}
                                    placeholder={field.placeholder}
                                    disabled={isRunning || !task.enabled}
                                    className="h-full flex-1 rounded-none border-0 bg-transparent px-3 focus-visible:ring-0 min-w-0"
                                  />
                                  <div className="w-px h-6 bg-white/20"></div>
                                  <Input
                                    id={`${fieldId}-times`}
                                    type="number"
                                    autoComplete="off"
                                    aria-label={`${field.label}执行次数`}
                                    value={task.params.times || ''}
                                    onChange={(e) => updateTaskParam(index, 'times', e.target.value)}
                                    placeholder=""
                                    disabled={isRunning || !task.enabled}
                                    min="0"
                                    className="h-full w-16 rounded-none border-0 bg-transparent px-2 text-center focus-visible:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                  />
                                  <div className="hidden flex-col self-stretch overflow-hidden border-l border-white/10 workbench:flex">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const currentValue = Number(task.params.times) || 0;
                                        updateTaskParam(index, 'times', (currentValue + 1).toString());
                                      }}
                                      disabled={isRunning || !task.enabled}
                                      className="flex-1 px-1.5 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center rounded-tr-xl"
                                      aria-label={`增加${field.label}执行次数`}
                                    >
                                      <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                                      </svg>
                                    </button>
                                    <div className="w-full h-px bg-white/10"></div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const currentValue = Number(task.params.times) || 0;
                                        if (currentValue > 0) {
                                          updateTaskParam(index, 'times', (currentValue - 1).toString());
                                        }
                                      }}
                                      disabled={isRunning || !task.enabled}
                                      className="flex-1 px-1.5 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center rounded-br-xl"
                                      aria-label={`减少${field.label}执行次数`}
                                    >
                                      <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : field.type === 'star-select' ? (
                              <fieldset>
                                <AutomationFieldLegend label={field.label} hintId={`${fieldId}-hint`} hint={helperTooltip} />
                                <div className="flex items-center space-x-2 flex-wrap">
                                  {[3, 4, 5, 6].map(star => {
                                    const currentValue = Array.isArray(task.params[field.key]) ? task.params[field.key] : [];
                                    const isChecked = currentValue.includes(star);
                                    const optionId = `${fieldId}-${star}`
                                    return (
                                      <label key={star} className="group flex min-h-11 cursor-pointer items-center space-x-1 text-sm text-gray-700 dark:text-gray-300">
                                        <Checkbox
                                          id={optionId}
                                          checked={isChecked}
                                          onCheckedChange={(checked) => {
                                            const newValue = checked
                                              ? [...currentValue, star].sort()
                                              : currentValue.filter((s: number) => s !== star);
                                            updateTaskParam(index, field.key, newValue);
                                          }}
                                          disabled={isRunning || !task.enabled}
                                        />
                                        <span className="group-hover:text-primary transition-colors flex items-center space-x-1">
                                          <span>{star}</span>
                                          <svg className="w-3.5 h-3.5 brand-text" fill="currentColor" viewBox="0 0 20 20">
                                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                          </svg>
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                                {task.id === 'recruit' && field.key === 'select' && Array.isArray(task.params.select) && task.params.select.includes(6) && (
                                  <div className="mt-2 rounded-xl px-3 py-2 text-xs brand-chip">
                                    已开启 6 星自动公招：遇到高级资深干员等高价值标签时，会优先保留并自动选择。
                                  </div>
                                )}
                              </fieldset>
                            ) : field.type === 'facility-select' ? (
                              <fieldset>
                                <legend className="automation-field-label mb-2 block">{field.label}</legend>
                                <div className="grid grid-cols-2 gap-2">
                                  {[
                                    { value: 'Mfg', label: '制造站' },
                                    { value: 'Trade', label: '贸易站' },
                                    { value: 'Power', label: '发电站' },
                                    { value: 'Control', label: '控制中枢' },
                                    { value: 'Reception', label: '会客室' },
                                    { value: 'Office', label: '办公室' },
                                    { value: 'Recycle', label: '回收站' },
                                    { value: 'Dorm', label: '宿舍' },
                                    { value: 'Processing', label: '加工站' },
                                    { value: 'Training', label: '训练室' },
                                    { value: 'AssistantChange', label: '副手换人' }
                                  ].map(facility => {
                                    const currentValue = Array.isArray(task.params[field.key]) ? task.params[field.key] : [];
                                    const isChecked = currentValue.includes(facility.value);
                                    const optionId = `${fieldId}-${facility.value}`
                                    return (
                                      <label key={facility.value} className="group flex min-h-11 cursor-pointer items-center space-x-1 text-sm text-gray-700 dark:text-gray-300">
                                        <Checkbox
                                          id={optionId}
                                          checked={isChecked}
                                          onCheckedChange={(checked) => {
                                            const newValue = checked
                                              ? [...currentValue, facility.value]
                                              : currentValue.filter((f: string) => f !== facility.value);
                                            updateTaskParam(index, field.key, newValue);
                                          }}
                                          disabled={isRunning || !task.enabled}
                                        />
                                        <span className="group-hover:text-primary transition-colors">{facility.label}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </fieldset>
                            ) : field.type === 'select' ? (
                              <div className="automation-field-row">
                                <AutomationFieldLabel htmlFor={fieldId} label={field.label} hint={helperTooltip} />
                                <SelectField
                                  id={fieldId}
                                  items={asSelectItems(field.options)}
                                  value={task.params[field.key] || (asSelectItems(field.options)[0]?.value ?? '')}
                                  disabled={isRunning || !task.enabled}
                                  onValueChange={(value) => updateTaskParam(index, field.key, value)}
                                />
                              </div>
                            ) : (
                              <div className="automation-field-row">
                                <AutomationFieldLabel htmlFor={fieldId} label={field.label} hint={helperTooltip} />
                                {field.type === 'number' ? (
                                  <div className="number-input-wrapper flex-1">
                                    <Input
                                      id={fieldId}
                                      type="number"
                                      autoComplete="off"
                                      value={task.params[field.key] || ''}
                                      onChange={(e) => updateTaskParam(index, field.key, e.target.value)}
                                      placeholder={field.placeholder}
                                      step={field.step}
                                      min={field.min}
                                      max={field.max}
                                      disabled={isRunning || !task.enabled}
                                      className="min-w-0"
                                    />
                                    <div className="number-input-controls hidden workbench:flex">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const currentValue = Number(task.params[field.key]) || 0;
                                          const step = Number(field.step) || 1;
                                          const min = field.min !== undefined ? Number(field.min) : -Infinity;
                                          const newValue = Math.max(currentValue - step, min);
                                          updateTaskParam(index, field.key, newValue.toString());
                                        }}
                                        disabled={isRunning || !task.enabled}
                                        aria-label={`减少${field.label}`}
                                      >
                                        <Minus size={14} strokeWidth={2.2} aria-hidden="true" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const currentValue = Number(task.params[field.key]) || 0;
                                          const step = Number(field.step) || 1;
                                          const max = field.max !== undefined ? Number(field.max) : Infinity;
                                          const newValue = Math.min(currentValue + step, max);
                                          updateTaskParam(index, field.key, newValue.toString());
                                        }}
                                        disabled={isRunning || !task.enabled}
                                        aria-label={`增加${field.label}`}
                                      >
                                        <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <Input
                                    id={fieldId}
                                    type={field.type}
                                    autoComplete="off"
                                    value={task.params[field.key] || ''}
                                    onChange={(e) => updateTaskParam(index, field.key, e.target.value)}
                                    placeholder={field.placeholder}
                                    step={field.step}
                                    min={field.min}
                                    max={field.max}
                                    disabled={isRunning || !task.enabled}
                                  />
                                )}
                              </div>
                            )}
                            {field.helper && !helperTooltip && (
                              <p className="automation-field-helper">
                                <Info size={13} strokeWidth={1.8} aria-hidden="true" />
                                <span>{field.helper}</span>
                              </p>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    )}

                    {task.commandId === 'fight' && (
                      <details className="group mt-3 rounded-lg border border-border bg-muted px-3 py-2">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3.5 text-sm font-medium text-gray-700 marker:hidden dark:text-gray-200 [&::-webkit-details-marker]:hidden">
                          <span className="flex items-center gap-2">
                            <SlidersHorizontal size={15} strokeWidth={1.9} />
                            高级设置
                          </span>
                          <ChevronDown size={15} strokeWidth={2} className="transition-transform group-open:rotate-180" />
                        </summary>

                        <div className="mt-3 space-y-3 border-t border-border pt-3">
                          <div className="flex items-center gap-2">
                            <span className="flex w-24 shrink-0 items-center gap-1">
                              <label htmlFor={`${task.id}-fight-client-type`} className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">闪退重启:</label>
                              <FieldHint id={`${task.id}-fight-client-type-hint`} label="闪退重启" hint="选择客户端后，游戏闪退时会自动重新启动。" />
                            </span>
                            <SelectField
                              id={`${task.id}-fight-client-type`}
                              className="w-full min-w-0 flex-1"
                              items={[
                                { value: '', label: '不启用' },
                                { value: 'Official', label: '官服' },
                                { value: 'Bilibili', label: 'B服' },
                                { value: 'YoStarEN', label: '美服' },
                                { value: 'YoStarJP', label: '日服' },
                                { value: 'YoStarKR', label: '韩服' },
                                { value: 'Txwy', label: '繁中服' },
                              ]}
                              value={task.params.clientType || ''}
                              disabled={isRunning || !task.enabled}
                              onValueChange={(value) => updateTaskParam(index, 'clientType', value)}
                            />
                          </div>

                          <div className="flex items-center gap-1">
                            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                              <Checkbox
                                checked={Boolean(task.params.DrGrandet)}
                                onCheckedChange={(checked) => updateTaskParam(index, 'DrGrandet', checked)}
                                disabled={isRunning || !task.enabled}
                              />
                              <span>葛朗台碎石模式</span>
                            </label>
                            <FieldHint id={`${task.id}-dr-grandet-hint`} label="葛朗台碎石模式" hint="使用源石前等待自然恢复 1 点理智，尽量减少碎石浪费。" />
                          </div>

                          <section className="space-y-2 border-t border-border pt-3">
                            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                              <Checkbox
                                checked={Boolean(task.params.report_to_penguin)}
                                onCheckedChange={(checked) => updateTaskParam(index, 'report_to_penguin', checked)}
                                disabled={isRunning || !task.enabled}
                              />
                              汇报掉落至企鹅物流
                            </label>
                            {task.params.report_to_penguin && (
                              <div className="flex items-center gap-2 pl-6">
                                <label htmlFor={`${task.id}-penguin-id`} className="w-20 shrink-0 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">用户 ID:</label>
                                <Input
                                  id={`${task.id}-penguin-id`}
                                  type="text"
                                  autoComplete="off"
                                  value={task.params.penguin_id || ''}
                                  onChange={(e) => updateTaskParam(index, 'penguin_id', e.target.value)}
                                  placeholder="留空则匿名汇报"
                                  disabled={isRunning || !task.enabled}
                                  className="min-w-0 flex-1"
                                />
                              </div>
                            )}
                          </section>

                          <section className="space-y-2 border-t border-border pt-3">
                            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                              <Checkbox
                                checked={Boolean(task.params.report_to_yituliu)}
                                onCheckedChange={(checked) => updateTaskParam(index, 'report_to_yituliu', checked)}
                                disabled={isRunning || !task.enabled}
                              />
                              汇报掉落至一图流
                            </label>
                            {task.params.report_to_yituliu && (
                              <div className="flex items-center gap-2 pl-6">
                                <label htmlFor={`${task.id}-yituliu-id`} className="w-20 shrink-0 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">用户 ID:</label>
                                <Input
                                  id={`${task.id}-yituliu-id`}
                                  type="text"
                                  autoComplete="off"
                                  value={task.params.yituliu_id || ''}
                                  onChange={(e) => updateTaskParam(index, 'yituliu_id', e.target.value)}
                                  placeholder="留空则匿名汇报"
                                  disabled={isRunning || !task.enabled}
                                  className="min-w-0 flex-1"
                                />
                              </div>
                            )}
                          </section>
                        </div>
                      </details>
                    )}

                    {task.commandId === 'infrast' && (
                      <details className="group mt-3 rounded-lg border border-border bg-muted px-3 py-2">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3.5 text-sm font-medium text-gray-700 marker:hidden dark:text-gray-200 [&::-webkit-details-marker]:hidden">
                          <span className="flex items-center gap-2">
                            <SlidersHorizontal size={15} strokeWidth={1.9} />
                            高级设置
                          </span>
                          <ChevronDown size={15} strokeWidth={2} className="transition-transform group-open:rotate-180" />
                        </summary>

                        <div className="mt-3 space-y-3 border-t border-border pt-3">
                          {Array.isArray(task.params.facility) && task.params.facility.includes('Dorm') && (
                            <section className="space-y-2">
                              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">宿舍</h4>
                              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                <Checkbox
                                  checked={Boolean(task.params.dorm_notstationed_enabled)}
                                  onCheckedChange={(checked) => updateTaskParam(index, 'dorm_notstationed_enabled', checked)}
                                  disabled={isRunning || !task.enabled}
                                />
                                使用“未进驻”筛选
                              </label>
                              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                <Checkbox
                                  checked={Boolean(task.params.dorm_trust_enabled)}
                                  onCheckedChange={(checked) => updateTaskParam(index, 'dorm_trust_enabled', checked)}
                                  disabled={isRunning || !task.enabled}
                                />
                                空位补入未满信赖干员
                              </label>
                            </section>
                          )}

                          {Array.isArray(task.params.facility) && task.params.facility.includes('Reception') && (
                            <section className="space-y-2 border-t border-border pt-3">
                              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">会客室</h4>
                              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                <Checkbox
                                  checked={Boolean(task.params.reception_message_board)}
                                  onCheckedChange={(checked) => updateTaskParam(index, 'reception_message_board', checked)}
                                  disabled={isRunning || !task.enabled}
                                />
                                领取信息板信用
                              </label>
                              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                <Checkbox
                                  checked={Boolean(task.params.reception_clue_exchange)}
                                  onCheckedChange={(checked) => updateTaskParam(index, 'reception_clue_exchange', checked)}
                                  disabled={isRunning || !task.enabled}
                                />
                                发起线索交流
                              </label>
                              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                <Checkbox
                                  checked={Boolean(task.params.reception_send_clue)}
                                  onCheckedChange={(checked) => updateTaskParam(index, 'reception_send_clue', checked)}
                                  disabled={isRunning || !task.enabled}
                                />
                                自动赠送线索
                              </label>
                            </section>
                          )}

                          {Array.isArray(task.params.facility) && task.params.facility.includes('Training') && (
                            <section className="space-y-2 border-t border-border pt-3">
                              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">训练室</h4>
                              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                <Checkbox
                                  checked={Boolean(task.params.continue_training)}
                                  onCheckedChange={(checked) => updateTaskParam(index, 'continue_training', checked)}
                                  disabled={isRunning || !task.enabled}
                                />
                                完成后继续专精
                              </label>
                            </section>
                          )}
                        </div>
                      </details>
                    )}

                    {task.commandId === 'recruit' && (
                      <details className="group mt-3 rounded-lg border border-border bg-muted px-3 py-2">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3.5 text-sm font-medium text-gray-700 marker:hidden dark:text-gray-200 [&::-webkit-details-marker]:hidden">
                          <span className="flex items-center gap-2">
                            <SlidersHorizontal size={15} strokeWidth={1.9} />
                            高级设置
                          </span>
                          <ChevronDown size={15} strokeWidth={2} className="transition-transform group-open:rotate-180" />
                        </summary>

                        <div className="mt-3 space-y-3 border-t border-border pt-3">
                          <div className="flex items-center gap-2">
                            <span className="flex w-32 shrink-0 items-center gap-1">
                              <label htmlFor={`${task.id}-extra-tags-mode`} className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">多选 Tag 策略:</label>
                              <FieldHint
                                id={`${task.id}-extra-tags-mode-hint`}
                                label="多选 Tag 策略"
                                hint="默认行为只选能组成有效组合的 Tag；“选 3 个 Tags”会尽量凑满 3 个；“尽量多选高星 Tag 组合”优先保留高星组合，可能包含冲突标签。"
                              />
                            </span>
                            <SelectField
                              id={`${task.id}-extra-tags-mode`}
                              className="w-full min-w-0 flex-1"
                              items={[
                                { value: '0', label: '默认行为' },
                                { value: '1', label: '选 3 个 Tags' },
                                { value: '2', label: '尽量多选高星 Tag 组合' },
                              ]}
                              value={String(task.params.extra_tags_mode ?? 0)}
                              disabled={isRunning || !task.enabled}
                              onValueChange={(value) => updateTaskParam(index, 'extra_tags_mode', Number(value))}
                            />
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="flex w-32 shrink-0 items-center gap-1">
                              <label htmlFor={`${task.id}-first-tags`} className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">三星首选:</label>
                              <FieldHint
                                id={`${task.id}-first-tags-hint`}
                                label="三星首选"
                                hint="仅在三星组合中优先选择，多个标签用逗号分隔。"
                              />
                            </span>
                            <Input
                              id={`${task.id}-first-tags`}
                              type="text"
                              autoComplete="off"
                              value={Array.isArray(task.params.first_tags) ? task.params.first_tags.join(',') : (task.params.first_tags || '')}
                              onChange={(e) => updateTaskParam(index, 'first_tags', e.target.value)}
                              placeholder="近卫干员,治疗"
                              disabled={isRunning || !task.enabled}
                              className="min-w-0 flex-1"
                            />
                          </div>

                          <fieldset>
                            <legend className="mb-2 block text-sm text-gray-600 dark:text-gray-400">
                              <span className="inline-flex items-center gap-1">
                                招募时长:
                                <FieldHint
                                  id={`${task.id}-recruitment-time-hint`}
                                  label="招募时长"
                                  hint="可设置 60 至 540 分钟，按 10 分钟调整；五星和六星固定为 540 分钟。"
                                />
                              </span>
                            </legend>
                            <div className="automation-recruitment-time-list">
                              {[3, 4].map(star => {
                                const key = String(star)
                                const recruitmentTimeId = `${task.id}-recruitment-time-${star}`
                                const recruitmentTime = task.params.recruitment_time || { '3': 540, '4': 540 }
                                return (
                                  <label key={star} htmlFor={recruitmentTimeId} className="automation-recruitment-time-row">
                                    <span className="shrink-0 text-sm font-medium text-gray-700 dark:text-gray-200">{star} 星</span>
                                    <Input
                                      id={recruitmentTimeId}
                                      type="number"
                                      autoComplete="off"
                                      value={recruitmentTime[key] ?? 540}
                                      onChange={(e) => updateTaskParam(index, 'recruitment_time', { ...recruitmentTime, [key]: e.target.value })}
                                      onBlur={(e) => updateTaskParam(index, 'recruitment_time', {
                                        ...recruitmentTime,
                                        [key]: normalizeRecruitmentTime(e.target.value),
                                      })}
                                      min={RECRUITMENT_TIME_MIN}
                                      max={RECRUITMENT_TIME_MAX}
                                      step={RECRUITMENT_TIME_STEP}
                                      disabled={isRunning || !task.enabled}
                                      className="min-w-0 flex-1 border-0 bg-transparent text-right dark:bg-transparent focus-visible:ring-0"
                                    />
                                    <span className="shrink-0 text-xs text-gray-400">分钟</span>
                                  </label>
                                )
                              })}
                            </div>
                          </fieldset>
                        </div>
                      </details>
                    )}

                    {task.commandId === 'startup' && (
                      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-white/10">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => void testConnection(task.id)}
                          disabled={isRunning || !task.enabled || testingConnectionTaskId !== null || isTestingConnection}
                          data-status-key={isTestingConnection ? 'testing' : connectionFeedback?.success ? 'success' : connectionFeedback ? 'error' : 'idle'}
                          aria-busy={isTestingConnection || undefined}
                          className={`automation-test-connection w-full${isTestingConnection ? ' is-testing' : ''}`}
                        >
                          {isTestingConnection
                            ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在检查</>
                            : (
                              <>
                                {connectionFeedback?.success
                                  ? <CheckCircle2 size={16} strokeWidth={2.2} aria-hidden="true" />
                                  : connectionFeedback
                                    ? <AlertTriangle size={16} strokeWidth={2.2} aria-hidden="true" />
                                    : <Cable size={16} strokeWidth={2.1} aria-hidden="true" />}
                                {connectionFeedback ? '重新测试' : '测试连接'}
                              </>
                            )}
                        </Button>

                        <AnimatePresence initial={false}>
                          {connectionFeedback && (
                            <motion.div
                              key={task.id}
                              initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, height: 0, y: -6 }}
                              animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, height: 'auto', y: 0 }}
                              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, height: 0, y: -4 }}
                              transition={{ duration: shouldReduceMotion ? 0.08 : 0.18, ease: 'easeOut' }}
                              className={`app-info-card mt-3 flex min-w-0 items-start gap-2 overflow-hidden text-sm ${connectionFeedback.success ? 'status-success' : 'status-danger'}`}
                              role={connectionFeedback.success ? 'status' : 'alert'}
                              aria-live={connectionFeedback.success ? 'polite' : undefined}
                            >
                              {connectionFeedback.success
                                ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" strokeWidth={2.2} aria-hidden="true" />
                                : <AlertTriangle size={18} className="mt-0.5 shrink-0" strokeWidth={2.2} aria-hidden="true" />}
                              <span className="min-w-0 wrap-break-word leading-5">{connectionFeedback.message}</span>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>

        <div className="automation-support-column">
          <div className="automation-monitor-column">
            <DeviceMonitorPanel
              className="automation-monitor-panel"
            />
          </div>

          <AutomationScheduleCard
            enabled={scheduleEnabled}
            entries={scheduleEntries}
            disabled={isRunning}
            onChange={updateSchedule}
            onError={showError}
          />

          <NotificationSettings />
        </div>
      </div>
    </>
  )
}
