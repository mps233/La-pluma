import type { RefObject } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { EmptyState } from '@/shared/components'
import { Card } from '@/shared/ui/card'
import { Switch } from '@/shared/ui/switch'
import AutomationTaskField from './AutomationTaskField'
import FightAdvancedSettings from './FightAdvancedSettings'
import InfrastAdvancedSettings from './InfrastAdvancedSettings'
import RecruitAdvancedSettings from './RecruitAdvancedSettings'
import StartupConnectionTest from './StartupConnectionTest'
import type { ConnectionTestStatus, TaskFlowItem, TaskParamKey, TaskParamValue } from '../types'

interface AutomationTaskEditorProps {
  task: TaskFlowItem | null
  taskIndex: number
  isEditingLocked: boolean
  isCurrentTask: boolean
  connectionStatus: Record<string, ConnectionTestStatus>
  testingConnectionTaskId: string | null
  containerRef: RefObject<HTMLDivElement | null>
  onToggleEnabled: (taskIndex: number) => void
  onUpdateParam: (taskIndex: number, key: TaskParamKey, value: TaskParamValue) => void
  onTestConnection: (taskId: string) => void
  onSuccess: (message: string) => void
  onError: (message: string) => void
}

export default function AutomationTaskEditor({
  task,
  taskIndex,
  isEditingLocked,
  isCurrentTask,
  connectionStatus,
  testingConnectionTaskId,
  containerRef,
  onToggleEnabled,
  onUpdateParam,
  onTestConnection,
  onSuccess,
  onError,
}: AutomationTaskEditorProps) {
  const usesWideFieldLabels = task?.commandId === 'recruit'

  return (
    <div ref={containerRef} id="automation-task-editor" className="automation-editor-column" tabIndex={-1} data-monitor-area="editor">
      <Card className="automation-editor-panel gap-0 p-0!">
        <div className="automation-editor-heading">
          <div>
            <h3><span>任务配置</span></h3>
          </div>
          {task && (
            <span>{String(taskIndex + 1).padStart(2, '0')}</span>
          )}
        </div>
        {!task ? (
          <EmptyState
            className="automation-editor-empty"
            compact
            icon={<SlidersHorizontal size={22} strokeWidth={1.7} />}
            title="暂无可配置任务"
            description="先从任务流程中添加一个任务"
          />
        ) : (
          <div className="automation-editor-content">
            <div
              key={task.id}
              className={`automation-task-editor${isCurrentTask ? ' is-current' : ''}${!task.enabled ? ' is-disabled' : ''}`}
            >
              <div className="automation-flow-card-header">
                <div className="automation-flow-card-identity">
                  <span className="automation-flow-sequence">{String(taskIndex + 1).padStart(2, '0')}</span>
                  <span className="automation-flow-task-name">
                    <strong>{task.name}</strong>
                    <small>{isCurrentTask ? '正在执行' : task.taskType || task.commandId}</small>
                  </span>
                </div>
                <div className="automation-flow-card-controls">
                  <Switch
                    checked={task.enabled}
                    onCheckedChange={() => onToggleEnabled(taskIndex)}
                    disabled={isEditingLocked}
                    aria-label={`${task.name}启用状态`}
                  />
                </div>
              </div>

              {task.paramFields && task.paramFields.length > 0 && (
                <div className={`automation-param-fields${usesWideFieldLabels ? ' has-wide-field-labels' : ''}`}>
                  {task.paramFields.map(field => (
                    <AutomationTaskField
                      key={field.key}
                      task={task}
                      field={field}
                      taskIndex={taskIndex}
                      isEditingLocked={isEditingLocked}
                      onUpdateParam={onUpdateParam}
                      onSuccess={onSuccess}
                      onError={onError}
                    />
                  ))}
                </div>
              )}

              {task.commandId === 'fight' && (
                <FightAdvancedSettings
                  task={task}
                  taskIndex={taskIndex}
                  disabled={isEditingLocked || !task.enabled}
                  onUpdateParam={onUpdateParam}
                />
              )}

              {task.commandId === 'infrast' && (
                <InfrastAdvancedSettings
                  task={task}
                  taskIndex={taskIndex}
                  disabled={isEditingLocked || !task.enabled}
                  onUpdateParam={onUpdateParam}
                />
              )}

              {task.commandId === 'recruit' && (
                <RecruitAdvancedSettings
                  task={task}
                  taskIndex={taskIndex}
                  disabled={isEditingLocked || !task.enabled}
                  onUpdateParam={onUpdateParam}
                />
              )}

              {task.commandId === 'startup' && (
                <StartupConnectionTest
                  taskId={task.id}
                  enabled={task.enabled}
                  isEditingLocked={isEditingLocked}
                  testingTaskId={testingConnectionTaskId}
                  feedback={connectionStatus[task.id]}
                  onTestConnection={onTestConnection}
                />
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
