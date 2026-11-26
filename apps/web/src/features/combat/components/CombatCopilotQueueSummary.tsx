import { Badge } from '@/shared/ui/badge'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/shared/ui/item'
import { Progress } from '@/shared/ui/progress'
import { InlineAlert } from '@/shared/components'
import type { CopilotSetView } from '../model/copilotSetView'
import type { CopilotSetInfo } from '../types'

interface CombatCopilotQueueSummaryProps {
  preview: CopilotSetInfo
  view: CopilotSetView
}

export default function CombatCopilotQueueSummary({
  preview,
  view,
}: CombatCopilotQueueSummaryProps) {
  const { total, completed, pending, failed, stopped, skipped } = view.progress
  const nextIndex = view.resumeIndex
  const nextCopilot = nextIndex >= 0 ? preview.copilots?.[nextIndex] ?? null : null
  const waitingTotal = Math.max(preview.copilots?.length ?? 0, view.activeSetRun?.itemCount ?? 0)
  const historyCompleted = view.historyCompletedIndexes.size
  const runSuccess = [...view.runCompletedIndexes]
    .filter(index => !view.historyCompletedIndexes.has(index))
    .length
  const activeRun = view.activeSetRun
  const summaryErrors = activeRun?.summaryErrors ?? []
  const failures = activeRun
    ? summaryErrors.length > 0 ? summaryErrors : activeRun.failures
    : []

  return (
    <div className="combat-copilot-summary">
      <div className="combat-copilot-summary-head">
        <div className="combat-copilot-summary-copy">
          <span className="combat-copilot-summary-label">历史续跑进度</span>
          <span className="combat-copilot-summary-title">
            {nextCopilot ? `下次从第 ${nextIndex + 1} 关继续` : '没有待续跑的作业'}
          </span>
          <span className="combat-copilot-summary-meta">
            {view.attemptedCount > 0 ? `本次已执行 ${view.attemptedCount} 个` : `共 ${total} 个作业（含历史通关）`}
          </span>
        </div>
        <div className="combat-copilot-summary-chips">
          <Badge variant="secondary" className="border-transparent bg-primary-soft text-primary-strong">
            待 {pending}
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">本次成功 {runSuccess}</Badge>
          <Badge variant="outline" className="text-muted-foreground">历史已通关 {historyCompleted}</Badge>
          <Badge
            variant={failed > 0 ? 'destructive' : 'outline'}
            className={failed > 0 ? 'border-destructive/30' : 'text-muted-foreground'}
          >
            失败 {failed}
          </Badge>
          {stopped > 0 && (
            <Badge variant="outline" className="text-muted-foreground">已终止 {stopped}</Badge>
          )}
          {skipped > 0 && (
            <Badge variant="outline" className="text-tertiary">跳过 {skipped}</Badge>
          )}
        </div>
      </div>

      <Progress
        value={total > 0 ? (completed / total) * 100 : 0}
        aria-label="作业集进度"
        className="w-full"
      />

      {failures.length > 0 && (
        <InlineAlert tone="error" title="失败原因">
          <ItemGroup className="gap-2">
            {failures.map((failure, index) => (
              <Item
                key={`${failure.itemIndex ?? 'unknown'}-${index}`}
                role="listitem"
                size="xs"
                variant="muted"
                className="rounded-none border-0 px-2 py-1.5"
              >
                <ItemContent className="gap-0.5">
                  <ItemTitle className="text-[0.75rem]">
                    {failure.stage
                      ?? (failure.itemIndex !== null ? `第 ${failure.itemIndex + 1} 个作业` : '未知阶段')}
                  </ItemTitle>
                  <ItemDescription className="text-[0.75rem] whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {failure.error}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        </InlineAlert>
      )}

      {nextCopilot ? (
        <div className="combat-copilot-resume">
          <span className="combat-copilot-resume-label">续跑目标</span>
          <span className="combat-copilot-resume-uri">prts://{nextCopilot.id}</span>
          <span className="combat-copilot-resume-name">
            {nextCopilot.stage || nextCopilot.name || `第 ${nextIndex + 1} 关`}
          </span>
        </div>
      ) : (
        <p className="combat-copilot-summary-note">需要重打时点击“重置进度”。</p>
      )}

      {view.waitingEntry && (
        <div className="combat-copilot-waiting">
          <div className="combat-copilot-waiting-head">
            <Badge variant="secondary" className="bg-primary-soft text-primary-strong">下一关</Badge>
            <span className="combat-copilot-waiting-index">
              第 {(view.waitingEntryIndex ?? 0) + 1} / {waitingTotal} 关
            </span>
            <span className="combat-copilot-waiting-uri">
              prts://{view.waitingCopilot?.id ?? view.waitingEntry.copilotId}
            </span>
          </div>
          <p className="combat-copilot-waiting-name">
            {view.waitingCopilot?.name || `作业 #${view.waitingEntry.copilotId ?? ''}`}
          </p>
          {(view.waitingCopilot?.stage || view.waitingEntry.stage) && (
            <p className="combat-copilot-waiting-stage">
              {view.waitingCopilot?.stage || view.waitingEntry.stage}
            </p>
          )}
          <p className="combat-copilot-waiting-hint">请在游戏中进入下一关界面后点击「开始下一关」。</p>
        </div>
      )}
    </div>
  )
}
