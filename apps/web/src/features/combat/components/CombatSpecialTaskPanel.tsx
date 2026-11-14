import { Card } from '@/shared/components'
import type { AdvancedValues } from '../model/combatCommands'
import { splitCopilotInputToArgs } from '../utils/copilotUri'
import type { CombatTask } from '../types'
import CombatAdvancedFields from './CombatAdvancedFields'
import CombatParadoxSearchPanel from './CombatParadoxSearchPanel'
import CombatTaskHeading from './CombatTaskHeading'
import type {
  CombatExecutionActions,
  CombatParadoxSearchProjection,
} from './combatPanelTypes'

interface CombatSpecialTaskPanelProps {
  task: CombatTask
  input: string
  advanced: AdvancedValues
  onInputChange: (value: string) => void
  onAdvancedChange: (key: string, value: string | number | boolean) => void
  paradoxSearch?: CombatParadoxSearchProjection
  execution: CombatExecutionActions
}

export default function CombatSpecialTaskPanel({
  task,
  input,
  advanced,
  onInputChange,
  onAdvancedChange,
  paradoxSearch,
  execution,
}: CombatSpecialTaskPanelProps) {
  const taskUris = splitCopilotInputToArgs(input)
  const isParadox = task.id === 'paradoxcopilot'
  const isSss = task.id === 'ssscopilot'
  const recommendedParadox = paradoxSearch?.result?.copilots?.[0]

  return (
    <Card
      smoothCorners
      className="combat-task-card p-0!"
    >
      <CombatTaskHeading
        task={task}
        buttonClassName="combat-task-run-button min-h-11 px-4 text-sm sm:px-5"
        automationAvailable={execution.automationAvailable}
        unavailableMessage={execution.unavailableMessage}
        isRunning={execution.isRunning}
        isStopping={execution.isStopping}
        isSubmitting={execution.isSubmitting}
        onExecute={execution.onExecute}
        onStop={execution.onStop}
      />

      <div className="combat-special-layout">
        <div className="min-w-0 space-y-3.5">
          <div className="combat-workspace-section">
            <div className="mb-3 flex items-center justify-between gap-3.5">
              <h5 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <svg className="h-4 w-4 brand-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>作业输入</span>
              </h5>
              <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] ${isSss && taskUris.length > 1 ? 'bg-rose-500/10 text-rose-500 dark:text-rose-300' : 'brand-chip'}`}>
                {isSss ? `${taskUris.length}/1 URI` : `${taskUris.length} 个 URI`}
              </span>
            </div>
            <label htmlFor={`combat-${task.id}-uris`} className="sr-only">
              {task.name}作业链接或本地路径
            </label>
            <textarea
              id={`combat-${task.id}-uris`}
              name={`maa-${task.id}-uris`}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={
                isSss
                  ? `${task.placeholder}\n一次只支持一个 SSS 作业 URI`
                  : `${task.placeholder}\n支持多行，每行一个作业 URI`
              }
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              rows={isSss ? 4 : 5}
              className="app-native-control w-full resize-none rounded-lg px-4 py-3 font-mono text-sm font-medium text-foreground control-surface focus:outline-hidden focus:ring-2 focus:ring-primary-soft"
            />
            {isSss && taskUris.length > 1 && (
              <div className="mt-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-500 dark:text-rose-300">
                保全派驻当前只会执行一个 SSS 作业 URI。
              </div>
            )}
          </div>

          {task.hasAdvanced && (
            <div className="combat-workspace-section">
              <h5 className="mb-2 text-sm font-semibold text-foreground">高级设置</h5>
              <CombatAdvancedFields
                taskId={task.id}
                advanced={advanced}
                onChange={onAdvancedChange}
              />
            </div>
          )}
        </div>

        <div className="space-y-3 xl:sticky xl:top-4">
          {isParadox && paradoxSearch ? (
            <CombatParadoxSearchPanel {...paradoxSearch} />
          ) : (
            <div className="combat-workspace-section">
              <h5 className="mb-3 text-sm font-semibold text-foreground">执行概览</h5>
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card text-xs">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-tertiary">作业数量</span>
                  <span className={taskUris.length > 1 ? 'text-rose-500 dark:text-rose-300' : 'text-foreground'}>{taskUris.length || 0}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-tertiary">循环次数</span>
                  <span className="text-foreground">{advanced.loopTimes || '1'}</span>
                </div>
              </div>
            </div>
          )}

          <div className="combat-workspace-section">
            <h5 className="mb-3 text-sm font-semibold text-foreground">参数概览</h5>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-3.5">
                <span className="text-tertiary">命令</span>
                <span className="font-mono brand-text">{task.command}</span>
              </div>
              <div className="flex items-center justify-between gap-3.5">
                <span className="text-tertiary">输入</span>
                <span className="text-foreground">{taskUris.length ? `${taskUris.length} 项` : '待填写'}</span>
              </div>
              {isParadox && (
                <div className="flex items-center justify-between gap-3.5">
                  <span className="text-tertiary">队列策略</span>
                  <span className="text-foreground">
                    {advanced.executionStrategy === 'stop' ? '失败停止' : '失败继续'}
                  </span>
                </div>
              )}
              {isParadox && recommendedParadox && (
                <div className="rounded-lg border border-border bg-card px-3 py-2">
                  <div className="mb-1 text-tertiary">当前推荐</div>
                  <div className="truncate font-mono brand-text">{recommendedParadox.uri}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
