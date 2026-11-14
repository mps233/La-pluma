import { Check, ChevronDown, ChevronUp, ListChecks, LoaderCircle, RotateCcw, SkipForward, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/components'
import { firstErrorLine } from '../model/copilotDetail'
import type { CopilotQueueEntry } from '../model/copilotQueue'
import { COPILOT_DETAIL_LAYER_ID, type CombatCopilotQueueProjection } from './combatPanelTypes'
import { describeQueueRowState, describeQueueSource, describeQueueTitle } from './copilotQueuePresentation'

function submitsAsSet(
  entries: readonly CopilotQueueEntry[],
  selected: ReadonlySet<string>,
  setId: string | null,
): boolean {
  if (!setId) return false
  const indexes: number[] = []
  for (const entry of entries) {
    if (!selected.has(entry.id)) continue
    if (entry.setId !== setId || entry.setItemIndex === undefined) return false
    if (indexes.length && entry.setItemIndex <= indexes[indexes.length - 1]!) return false
    indexes.push(entry.setItemIndex)
  }
  return indexes.length > 0
}

interface CombatCopilotQueuePanelProps {
  queue: CombatCopilotQueueProjection
  detailEntryId: string | null
  onOpenDetail: (entryId: string) => void
}

export default function CombatCopilotQueuePanel({ queue, detailEntryId, onOpenDetail }: CombatCopilotQueuePanelProps) {
  const { entries, selected } = queue
  const checkedCount = entries.filter(entry => selected.has(entry.id)).length
  const locked = queue.isRunning || queue.isSubmitting
  const waitingForNext = queue.queueRun?.isWaiting === true
  const nextEntry = queue.queueRun?.nextEntry
  const nextHasBothModes = nextEntry?.mode && queue.queueRun?.taskResults.some(entry => (
    entry.clientId === nextEntry.clientId && entry.mode !== null && entry.mode !== nextEntry.mode
  ))
  const nextModeLabel = nextHasBothModes ? `（${nextEntry.mode === 'raid' ? '突袭' : '普通'}）` : ''
  const failurePolicy = queue.queueRun?.failurePolicy ?? queue.failurePolicy
  const failedEntries = queue.queueRun?.isTerminal
    ? entries.filter(entry => queue.queueRun?.statuses.get(entry.id)?.status === 'failed')
    : []

  return (
    <section
      className="combat-copilot-panel combat-copilot-mine"
      aria-label="作业队列"
    >
      <header className="combat-copilot-panel-head">
        <div className="combat-copilot-panel-title">
          <ListChecks size={16} className="brand-text" aria-hidden="true" />
          <h5>作业队列</h5>
          <span className="combat-copilot-kicker">共 {entries.length} 项</span>
        </div>

        <div className="combat-copilot-panel-actions">
          <button
            type="button"
            onClick={queue.onClear}
            disabled={locked || entries.length === 0}
            className="combat-copilot-text-action"
          >
            清空
          </button>
        </div>
      </header>

      {entries.length === 0 ? (
        <EmptyState
          compact
          className="combat-copilot-empty"
          icon={<ListChecks size={24} strokeWidth={1.7} />}
          title="队列为空"
          description="从作业链接、关卡搜索或本地文件加入作业；输入作业集链接会自动展开到队列。"
        />
      ) : (
        <>
          <p className="combat-copilot-mine-summary">
            已勾选 {checkedCount} / {entries.length} 项，
            {submitsAsSet(entries, selected, queue.setId)
              ? '按作业集顺序执行，可查看逐项状态。'
              : `按队列顺序执行，失败${failurePolicy === 'stop' ? '即停' : '后继续'}，可查看逐项状态。`}
          </p>
          {(waitingForNext || failedEntries.length > 0) && (
            <div className="combat-copilot-panel-actions px-3 pb-2">
              {waitingForNext && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={queue.onContinueQueue}
                    disabled={!queue.automationAvailable || queue.isContinuing}
                    aria-busy={queue.isContinuing || undefined}
                    title={!queue.automationAvailable ? queue.unavailableMessage : undefined}
                  >
                    {queue.isContinuing
                      ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在开始</>
                      : `开始下一项${nextModeLabel}`}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={queue.onSkipEntry}
                    disabled={!queue.automationAvailable || queue.isSkipping}
                    aria-busy={queue.isSkipping || undefined}
                    title={!queue.automationAvailable ? queue.unavailableMessage : undefined}
                  >
                    {queue.isSkipping
                      ? <><LoaderCircle className="animate-spin" aria-hidden="true" />正在跳过</>
                      : (
                        <>
                          <SkipForward size={14} aria-hidden="true" />
                          跳过此项
                        </>
                      )}
                  </Button>
                </>
              )}
              {failedEntries.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={queue.onRetryFailed}
                  disabled={locked || !queue.automationAvailable}
                  title={!queue.automationAvailable ? queue.unavailableMessage : undefined}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  重试失败项
                </Button>
              )}
            </div>
          )}
          <div role="list" aria-label="作业队列" className="combat-copilot-mine-list">
            {entries.map((entry, index) => {
              const checked = selected.has(entry.id)
              const title = describeQueueTitle(entry)
              const expanded = detailEntryId === entry.id
              const state = describeQueueRowState(entry, queue)
              const errorLine = firstErrorLine(state.error)

              return (
                <div
                  key={entry.id}
                  role="listitem"
                  data-copilot-set-item-index={entry.setItemIndex}
                  className="combat-copilot-mine-row"
                >
                  <button
                    type="button"
                    onClick={() => queue.onToggle(entry.id)}
                    disabled={locked}
                    aria-pressed={checked}
                    aria-label={`${checked ? '取消选择' : '选择'}队列第 ${index + 1} 项 ${title}`}
                    className="combat-copilot-mine-check"
                  >
                    <span className={`combat-copilot-mine-check-box${checked ? ' is-selected' : ''}`}>
                      {checked && <Check size={12} strokeWidth={3} aria-hidden="true" />}
                    </span>
                  </button>

                  <span className="combat-copilot-mine-marker" aria-hidden="true">{index + 1}</span>

                  <button
                    type="button"
                    onClick={() => onOpenDetail(entry.id)}
                    aria-expanded={expanded}
                    aria-controls={expanded ? COPILOT_DETAIL_LAYER_ID : undefined}
                    aria-haspopup="dialog"
                    aria-label={`查看队列第 ${index + 1} 项详情 ${title}`}
                    className="combat-copilot-mine-body"
                  >
                    <span className="combat-copilot-mine-title">{title}</span>
                    <span className="combat-copilot-mine-meta">
                      <span className="combat-copilot-mine-tag">{describeQueueSource(entry)}</span>
                      {entry.stage && <span>{entry.stage}</span>}
                      {entry.source === 'file' && entry.fileName && <span>{entry.fileName}</span>}
                      {entry.completedModes?.map(mode => (
                        <span key={mode} className="combat-copilot-mine-tag is-complete">
                          {mode === 'raid' ? '突袭已完成' : '普通已完成'}
                        </span>
                      ))}
                      {errorLine && <span className="form-error-text">{errorLine}</span>}
                    </span>
                  </button>

                  <span className="combat-copilot-mine-status">{state.label}</span>

                  <div className="combat-copilot-mine-actions">
                    <Button
                      size="icon"
                      variant="ghost"
                      title={`上移第 ${index + 1} 项`}
                      aria-label={`上移第 ${index + 1} 项 ${title}`}
                      disabled={locked || index === 0}
                      onClick={() => queue.onMove(entry.id, 'up')}
                    >
                      <ChevronUp size={16} aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title={`下移第 ${index + 1} 项`}
                      aria-label={`下移第 ${index + 1} 项 ${title}`}
                      disabled={locked || index === entries.length - 1}
                      onClick={() => queue.onMove(entry.id, 'down')}
                    >
                      <ChevronDown size={16} aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title={`删除第 ${index + 1} 项`}
                      aria-label={`删除第 ${index + 1} 项 ${title}`}
                      disabled={locked}
                      onClick={() => queue.onRemove(entry.id)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
