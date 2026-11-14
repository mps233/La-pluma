import { Button } from '@/shared/components'
import type { CopilotSetView } from '../model/copilotSetView'
import type { CopilotSetInfo } from '../types'
import CombatCopilotQueueSummary from './CombatCopilotQueueSummary'

interface CombatCopilotSetPanelProps {
  preview: CopilotSetInfo
  view: CopilotSetView
  isRunning: boolean
  isResetting: boolean
  onOpenReset: () => void
}

export default function CombatCopilotSetPanel({
  preview,
  view,
  isRunning,
  isResetting,
  onOpenReset,
}: CombatCopilotSetPanelProps) {
  return (
    <section className="combat-copilot-detail-content" aria-label="作业集摘要">
      {preview.copilots?.length ? (
        <>
          <CombatCopilotQueueSummary preview={preview} view={view} />
          {!isRunning && (
            <Button
              onClick={onOpenReset}
              disabled={isResetting}
              variant="secondary"
              size="sm"
              className="min-h-11 justify-self-start"
            >
              {isResetting ? '重置中...' : '重置进度'}
            </Button>
          )}
        </>
      ) : (
        <p className="combat-copilot-summary-note">{preview.note ?? '暂无作业明细'}</p>
      )}
    </section>
  )
}
