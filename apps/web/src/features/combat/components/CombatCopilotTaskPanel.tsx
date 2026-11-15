import { Card } from '@/shared/ui/card'
import { useResolvedCopilotDetailTarget } from '../hooks/useResolvedCopilotDetailTarget'
import type { CopilotDetailTarget } from '../model/copilotDetail'
import type { CopilotSetView } from '../model/copilotSetView'
import type { CombatTask, CopilotSetInfo } from '../types'
import CombatCopilotDetailLayer from './CombatCopilotDetailLayer'
import CombatCopilotQueuePanel from './CombatCopilotQueuePanel'
import CombatCopilotSetPanel from './CombatCopilotSetPanel'
import CombatCopilotSourceBar from './CombatCopilotSourceBar'
import CombatSettingsPanel from './CombatSettingsPanel'
import CombatTaskHeading from './CombatTaskHeading'
import type {
  CombatCopilotConfig,
  CombatCopilotDetailSelection,
  CombatCopilotExecutionActions,
  CombatCopilotFileImportProjection,
  CombatCopilotPreviewProjection,
  CombatCopilotQueueProjection,
  CombatCopilotSearchProjection,
  CombatCopilotSelectionProjection,
} from './combatPanelTypes'
import { buildQueueDetailTarget } from './copilotQueuePresentation'

interface CombatCopilotTaskPanelProps {
  task: CombatTask
  config: CombatCopilotConfig
  preview: CombatCopilotPreviewProjection
  fileImport: CombatCopilotFileImportProjection
  view: CopilotSetView
  selection: CombatCopilotSelectionProjection
  queue: CombatCopilotQueueProjection
  search: CombatCopilotSearchProjection
  execution: CombatCopilotExecutionActions
  detail: CombatCopilotDetailSelection | null
  onOpenQueueDetail: (id: string) => void
  onCloseDetail: () => void
}

function buildPreviewDetailTarget(preview: CopilotSetInfo): CopilotDetailTarget {
  if (preview.type === 'set') {
    return {
      title: preview.name,
      uri: `prts://s${preview.id}`,
      ...(preview.details ? { details: preview.details } : {}),
    }
  }
  return {
    title: preview.name,
    ...(preview.details ? { details: preview.details } : {}),
    stage: preview.stage,
    stageId: preview.stageId,
    uri: `prts://${preview.id}`,
    sourceLabel: '链接',
    operators: preview.operatorDetails,
    groups: preview.groupNames,
    recommendedMode: preview.recommendedMode,
  }
}

export default function CombatCopilotTaskPanel({
  task,
  config,
  preview,
  fileImport,
  view,
  selection,
  queue,
  search,
  execution,
  detail,
  onOpenQueueDetail,
  onCloseDetail,
}: CombatCopilotTaskPanelProps) {
  const previewInfo = detail?.type === 'preview' ? preview.info : null
  const pendingTarget = detail?.type === 'preview' ? preview.pendingTarget : null
  const queueEntry = detail?.type === 'queue' ? queue.entries.find(entry => entry.id === detail.id) : undefined
  const baseDetailTarget = previewInfo
    ? buildPreviewDetailTarget(previewInfo)
    : pendingTarget ?? (queueEntry ? buildQueueDetailTarget(queueEntry, queue) : null)
  const detailTarget = useResolvedCopilotDetailTarget(baseDetailTarget)
  const detailLoading = detail?.type === 'preview' && previewInfo === null && preview.loading

  return (
    <Card
      className="combat-task-card gap-0 p-0!"
    >
      <CombatTaskHeading
        task={task}
        buttonClassName="combat-task-run-button min-h-11 px-4 text-sm sm:px-6"
        automationAvailable={execution.automationAvailable}
        unavailableMessage={execution.unavailableMessage}
        isRunning={execution.isRunning}
        isStopping={execution.isStopping}
        isSubmitting={execution.isSubmitting}
        isWaitingForNext={execution.isWaitingForNext}
        isContinuing={execution.isContinuing}
        onExecute={execution.onExecute}
        onStop={execution.onStop}
        onStartNext={execution.onStartNext}
      />

      <CombatCopilotSourceBar
        input={config.input}
        isLoading={preview.loading}
        isAddingToQueue={queue.isAdding}
        previewModeStore={preview.modeStore}
        search={search}
        fileImport={fileImport}
        onInputChange={config.onInputChange}
        onPreview={preview.onPreview}
        onAddToQueue={queue.onAddCurrent}
        onCancelPreview={preview.onCancel}
      />

      <div className="combat-copilot-body">
        <div className="combat-copilot-queue-column">
          <CombatCopilotQueuePanel
            queue={queue}
            detailEntryId={queueEntry?.id ?? null}
            onOpenDetail={onOpenQueueDetail}
          />
        </div>

        <div className="combat-copilot-params">
          <CombatSettingsPanel
            task={task}
            formationMode={config.formationMode}
            raid={config.raid}
            setExecutionMode={config.setExecutionMode}
            advanced={config.advanced}
            onFormationChange={config.onFormationChange}
            onRaidChange={value => config.onAdvancedChange('raid', value)}
            onSetExecutionModeChange={config.onSetExecutionModeChange}
            onAdvancedChange={config.onAdvancedChange}
          />
        </div>
      </div>

      <CombatCopilotDetailLayer
        target={detailTarget}
        loading={detailLoading}
        onClose={onCloseDetail}
        stacked={search.isOpen}
      >
        {previewInfo?.type === 'set' && (
          <CombatCopilotSetPanel
            preview={previewInfo}
            view={view}
            isRunning={execution.isRunning}
            isResetting={selection.isResetting}
            onOpenReset={selection.onOpenReset}
          />
        )}
      </CombatCopilotDetailLayer>
    </Card>
  )
}
