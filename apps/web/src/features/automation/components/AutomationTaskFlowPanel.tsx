import { useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle,
  Check,
  ClipboardList,
  GripVertical,
  ListPlus,
  LoaderCircle,
  Minus,
  Play,
  Square,
  Trash2,
} from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { EmptyState, SmoothPanel, Switch } from '@/shared/components'
import AutomationTaskPicker from './AutomationTaskPicker'
import AutomationExecutionSummary from './AutomationExecutionSummary'
import {
  describeFlowTaskExecutionState,
  resolveFlowTaskExecutionState,
} from '../model/flowExecution'
import type { AutomationTaskFlowPanelProps } from './automationPanelTypes'

export default function AutomationTaskFlowPanel({
  tasks,
  activeTaskId,
  execution,
  sorting,
  lastDeletedTaskName,
  onSelectTask,
  onAddTask,
  onRemoveTask,
  onToggleTask,
  onRestoreDeletedTask,
}: AutomationTaskFlowPanelProps) {
  const shouldReduceMotion = useReducedMotion()
  const taskPickerRegionRef = useRef<HTMLDivElement>(null)
  const executionView = {
    isRunning: execution.isRunning,
    taskResults: execution.taskResults,
    currentStep: execution.currentStep,
  }
  const enabledCount = tasks.filter(task => task.enabled).length

  return (
    <div className="automation-sequence-column">
      <SmoothPanel
        className="automation-sequence-panel"
        surfaceClassName="automation-sequence-surface"
      >
        <div className="automation-flow-header">
          <div className="min-w-0">
            <h3>
              <ClipboardList size={16} strokeWidth={1.8} aria-hidden="true" />
              <span>任务流程</span>
            </h3>
          </div>
          <span className="automation-flow-summary">
            {enabledCount}/{tasks.length}
          </span>
          <span className="sr-only" aria-live="polite">{sorting.announcement}</span>
        </div>

        {tasks.length === 0 ? (
          <EmptyState
            className="automation-sequence-empty"
            compact
            icon={<ListPlus size={20} strokeWidth={1.8} />}
            title="流程为空"
            description="使用下方入口添加任务"
          />
        ) : (
          <div className="automation-sequence-list">
            {tasks.map((task, index) => {
              const executionState = resolveFlowTaskExecutionState(task, index, executionView)
              const isCurrentStep = executionState === 'running'
              const isCompletedStep = executionState === 'success'
              const isSelectedTask = activeTaskId === task.id

              return (
                <motion.div
                  key={task.id}
                  layout={!shouldReduceMotion}
                  ref={(node) => {
                    sorting.registerItem(task.id, node)
                  }}
                  className={`automation-sequence-item${isSelectedTask ? ' is-selected' : ''}${isCurrentStep ? ' is-current' : ''}${isCompletedStep ? ' is-completed' : ''}${executionState === 'failed' ? ' is-failed' : ''}${executionState === 'skipped' || executionState === 'stopped' ? ' is-skipped' : ''}${!task.enabled ? ' is-disabled' : ''}${sorting.draggedIndex === index ? ' is-dragging' : ''}`}
                  data-selected={isSelectedTask ? 'true' : 'false'}
                  data-execution-state={isCompletedStep ? 'completed' : executionState === 'pending' && execution.isRunning ? 'idle' : executionState}
                >
                <button
                  type="button"
                  onPointerDown={(event) => sorting.onPointerDown(event, task.id)}
                  onKeyDown={(event) => sorting.onKeyDown(event, task.id)}
                  className={`automation-sequence-drag min-h-11 min-w-11 touch-none${execution.isRunning ? ' is-placeholder' : ''}`}
                  title={execution.isRunning ? '执行期间不能排序' : '拖动排序，或使用上下方向键调整'}
                  aria-label={`调整${task.name}顺序，当前第 ${index + 1} 位`}
                  disabled={execution.isRunning}
                >
                  <GripVertical size={16} strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  className="automation-sequence-select"
                  onClick={() => onSelectTask(task.id)}
                  aria-controls="automation-task-editor"
                  aria-pressed={isSelectedTask}
                  aria-current={isCurrentStep ? 'step' : undefined}
                >
                  <span className="automation-sequence-node" aria-hidden="true">
                    <span>
                        {isCompletedStep
                          ? <Check size={11} strokeWidth={2.8} />
                          : isCurrentStep
                            ? <LoaderCircle className="automation-sequence-progress" size={13} strokeWidth={2.3} />
                          : executionState === 'failed'
                            ? <AlertTriangle size={12} strokeWidth={2} />
                          : executionState === 'skipped' || executionState === 'stopped'
                            ? <Minus size={12} strokeWidth={2} />
                          : String(index + 1).padStart(2, '0')}
                    </span>
                  </span>
                  <span className="automation-sequence-copy">
                    <strong data-automation-sequence-name>{task.name}</strong>
                    <small data-automation-sequence-state-label>{describeFlowTaskExecutionState(executionState, execution.isRunning) || task.description}</small>
                  </span>
                </button>
                <span className="automation-sequence-enabled">
                  <Switch
                    compact
                    checked={task.enabled}
                    onChange={() => onToggleTask(index)}
                    disabled={execution.isRunning}
                    label={`${task.name}启用状态`}
                  />
                </span>
                {execution.isRunning && isCompletedStep ? (
                  <span className="automation-completed-mark" role="img" aria-label="已完成" title="已完成">
                    <Check size={13} strokeWidth={2.6} aria-hidden="true" />
                  </span>
                ) : !isCurrentStep ? (
                  <button
                    type="button"
                    onClick={() => onRemoveTask(index)}
                    disabled={execution.isRunning}
                    className="automation-sequence-delete min-h-11 min-w-11"
                    title="删除任务"
                    aria-label={`删除${task.name}`}
                  >
                    <Trash2 size={14} strokeWidth={1.9} />
                  </button>
                ) : null}
                </motion.div>
              )
            })}
          </div>
        )}

        {lastDeletedTaskName && (
          <div className="mx-3.5 flex min-h-11 items-center justify-between gap-3.5 border-t border-border text-xs text-muted-foreground sm:mx-4" role="status">
            <span className="min-w-0 truncate">已删除“{lastDeletedTaskName}”</span>
            <button
              type="button"
              onClick={onRestoreDeletedTask}
              disabled={execution.isRunning}
              className="min-h-11 shrink-0 px-2 font-medium text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              恢复
            </button>
          </div>
        )}

        <div ref={taskPickerRegionRef} className="automation-sequence-footer">
            <AutomationTaskPicker
              flow={tasks}
              disabled={execution.isRunning}
              onAddTask={onAddTask}
              regionRef={taskPickerRegionRef}
            />
            <Button
              onClick={execution.onExecute}
              disabled={!execution.automationAvailable || execution.isRunning || execution.isSubmitting || enabledCount === 0}
              title={!execution.automationAvailable ? execution.unavailableMessage : undefined}
              aria-busy={execution.isRunning || execution.isSubmitting || undefined}
              data-status-key={execution.isRunning || execution.isSubmitting ? 'running' : 'ready'}
              className={`automation-run-button w-full justify-center whitespace-nowrap${execution.isRunning ? ' is-running' : ''}`}
            >
              {execution.isRunning || execution.isSubmitting
                ? <><LoaderCircle className="animate-spin" aria-hidden="true" />{execution.isRunning ? '执行中' : '正在启动'}</>
                : (
                  <>
                    <Play size={16} fill="currentColor" aria-hidden="true" />
                    立即执行
                  </>
                )}
            </Button>
            {execution.isRunning && (
              <Button
                onClick={execution.onStop}
                disabled={execution.isStopping}
                aria-busy={execution.isStopping || undefined}
                data-status-key={execution.isStopping ? 'stopping' : 'stop-ready'}
                variant={execution.isStopping ? 'secondary' : 'destructive'}
                className={`automation-stop-button w-full justify-center${execution.isStopping ? ' is-stopping' : ''}`}
              >
                {execution.isStopping
                  ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在终止</>
                  : (
                    <>
                      <Square size={14} fill="currentColor" aria-hidden="true" />
                      终止执行
                    </>
                  )}
              </Button>
            )}
        </div>

        <AutomationExecutionSummary
          summary={execution.displaySummary}
          runId={execution.runId}
        />
      </SmoothPanel>
    </div>
  )
}
