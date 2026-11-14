import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { PageHeader } from '@/shared/components'
import { FloatingStatusIndicator, useStatusStore } from '@/features/runtime-status'
import { useResourceInvalidation } from '@/features/resource-invalidation'
import { gameDataKeys } from '@/features/game-data'
import { DeviceMonitorLayout } from '@/features/device-mirror'
import { trainingKeys } from '../model/queryKeys'
import { trainingQueueQueryOptions } from '../model/queries'
import {
  isTrainingQueueMutationInvalidation,
  type TrainingQueueCommandOutcome,
} from '../model/queueCommands'
import { isTrainingPlanBasisCurrent } from '../model/planValidity'
import {
  TRAINING_SETTINGS_FAILURE_MESSAGE,
  isTrainingSettingsInvalidation,
} from '../model/settingsCommands'
import { useTrainingPlan } from '../hooks/useTrainingPlan'
import { useTrainingQueueCommands } from '../hooks/useTrainingQueueCommands'
import { useTrainingSettings } from '../hooks/useTrainingSettings'
import OperatorPicker from './OperatorPicker'
import TrainingMaterialsPanel from './TrainingMaterialsPanel'
import TrainingPlanPanel from './TrainingPlanPanel'
import TrainingQueuePanel, { type RemovedTrainingQueueItem } from './TrainingQueuePanel'
import TrainingSettingsPanel from './TrainingSettingsPanel'
import type {
  TrainingOperator,
  TrainingPlanMode,
  TrainingQueueItem,
  TrainingSettings,
} from '../types'

const EMPTY_TRAINING_QUEUE: TrainingQueueItem[] = []
const TRAINING_RESOURCE_SCOPES = [
  'depot',
  'operbox',
  'catalog',
  'materials',
  'training-queue',
  'training-plan',
] as const

export default function TrainingWorkspace() {
  const setStatusMessage = useStatusStore(state => state.setMessage)
  const queryClient = useQueryClient()
  const {
    settings,
    revision: settingsRevision,
    update: updateSettings,
  } = useTrainingSettings()

  const queueOptions = useMemo(() => trainingQueueQueryOptions(), [])
  const queueQuery = useQuery(queueOptions)
  const queueSnapshot = queueQuery.data
  const queue = queueSnapshot?.queue ?? EMPTY_TRAINING_QUEUE
  // 首次读取失败后重试期间保持加载态，避免错误页与请求进度同时出现。
  const queueLoading = queueQuery.isPending
    || (queueQuery.isFetching && !queueSnapshot && queueQuery.isError)
  const queueError = queueQuery.isError && !queueSnapshot
    ? (queueQuery.error instanceof Error && queueQuery.error.message
        ? queueQuery.error.message
        : '养成队列加载失败，请稍后重试')
    : null
  const queueUncertain = queueSnapshot?.uncertain ?? null
  const refreshError = Boolean(queueUncertain)
    || (queueQuery.isError && Boolean(queueSnapshot))

  const {
    plan,
    basis: planBasis,
    error: planError,
    warning: planWarning,
    flowSync,
    generating,
    applying,
    syncing,
    generate: generatePlan,
    apply: applyPlan,
    retrySync: retryFlowSync,
    reload: reloadQueue,
    invalidate: invalidatePlan,
    recordFlowSync,
  } = useTrainingPlan({ queueSnapshot })
  const {
    pendingOperatorIds,
    queueMutationPending,
    run: runQueueCommand,
  } = useTrainingQueueCommands()

  const [selectorOpen, setSelectorOpen] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [recentlyRemoved, setRecentlyRemoved] = useState<RemovedTrainingQueueItem | null>(null)

  const showSuccess = (msg: string) => {
    setStatusMessage(msg, 'success')
  }
  const showError = (msg: string) => {
    setStatusMessage(msg, 'error')
  }

  // 识别、材料刷新与资源更新可能来自本页之外。候选列表与计数按资源作用域
  // 失效领域 query，计划前提变化时作废旧计划；队列写入的权威快照已由领域
  // 命令写入，因此忽略本页自己发布的队列失效。
  useResourceInvalidation(TRAINING_RESOURCE_SCOPES, invalidation => {
    if (isTrainingQueueMutationInvalidation(invalidation)) return
    // 设置所有者已在编辑时按 revision 作废旧计划；它自己的成功发布不再重复
    // 清空用户在该写入期间重新生成的预览。外部 `training-plan` 仍会作废。
    if (isTrainingSettingsInvalidation(invalidation)) return
    const { resources } = invalidation
    const touchesPlan = resources.some(resource => (
      resource === 'depot' || resource === 'materials' || resource === 'training-plan'
    ))
    const touchesQueue = resources.some(resource => (
      resource === 'depot' || resource === 'materials' || resource === 'training-queue'
    ))
    const touchesOperators = resources.some(resource => (
      resource === 'depot' || resource === 'operbox' || resource === 'catalog' || resource === 'materials'
    ))

    if (touchesPlan) invalidatePlan()
    if (touchesQueue) void reloadQueue()
    if (touchesOperators) {
      // 候选/计数复用 game-data 的共享快照；先失效来源 key，再失效领域 query，
      // 否则重取候选时仍会读到旧的目录/持有干员缓存。
      if (resources.includes('catalog')) {
        void queryClient.invalidateQueries({ queryKey: gameDataKeys.resource('catalog') })
      }
      if (resources.includes('operbox')) {
        void queryClient.invalidateQueries({ queryKey: gameDataKeys.resource('operbox') })
      }
      void queryClient.invalidateQueries({ queryKey: trainingKeys.resource('candidates') })
      void queryClient.invalidateQueries({ queryKey: trainingKeys.resource('counts') })
    }
  })

  // 命令失败保留原队列并展示可重试错误；写入成功（含写后刷新失败）才推进 UI。
  const settleQueueOutcome = (
    outcome: TrainingQueueCommandOutcome,
  ): Extract<TrainingQueueCommandOutcome, { status: 'applied' | 'uncertain' }> | null => {
    if (outcome.status === 'ignored') return null
    if (outcome.status === 'failed') {
      setOperationError(outcome.message)
      showError(outcome.message)
      // 命令开始时会取消在途读取；若当时还没有快照，失败后重新建立首屏读取。
      if (!queueSnapshot) void queueQuery.refetch()
      return null
    }
    recordFlowSync(outcome.flowSync)
    if (outcome.status === 'uncertain') setStatusMessage(outcome.message, 'warning')
    else if (outcome.message) showSuccess(outcome.message)
    return outcome
  }

  const queueOperatorIds = useMemo(
    () => new Set(queue.map(item => item.operatorId)),
    [queue],
  )

  const handleAddToQueue = async (operator: TrainingOperator) => {
    if (queueOperatorIds.has(operator.id)) return
    setRecentlyRemoved(null)
    setOperationError(null)
    invalidatePlan()
    const outcome = await runQueueCommand({ type: 'add', operator })
    settleQueueOutcome(outcome)
  }

  const handleRemoveFromQueue = async (operatorId: string): Promise<boolean> => {
    if (!queueOperatorIds.has(operatorId)) return false
    setOperationError(null)
    invalidatePlan()
    const outcome = await runQueueCommand({ type: 'remove', operatorId })
    const settled = settleQueueOutcome(outcome)
    if (!settled?.removed) return false
    setRecentlyRemoved(settled.removed)
    return true
  }

  const handleUndoRemove = async (): Promise<boolean> => {
    const snapshot = recentlyRemoved
    if (!snapshot) return false
    setOperationError(null)
    // 撤销同样是队列写入：开始时立即作废旧预览，不依赖写后 revision 兜底。
    invalidatePlan()
    const outcome = await runQueueCommand({
      type: 'undo',
      item: snapshot.item,
      index: snapshot.index,
    })
    const settled = settleQueueOutcome(outcome)
    if (!settled) return false
    setRecentlyRemoved(null)
    return true
  }

  const handleReorder = async (operatorId: string, destination: number): Promise<boolean> => {
    const index = queue.findIndex(item => item.operatorId === operatorId)
    if (
      index < 0
      || index === destination
      || destination < 0
      || destination >= queue.length
    ) return false
    setOperationError(null)
    invalidatePlan()
    const outcome = await runQueueCommand({ type: 'reorder', operatorId, destination })
    const settled = settleQueueOutcome(outcome)
    if (!settled) return false
    setRecentlyRemoved(null)
    return true
  }

  // 可生成/可应用条件与版本前提由领域所有者再次校验；这里的值只驱动按钮状态。
  const handleGeneratePlan = (mode: TrainingPlanMode) => {
    void generatePlan(mode)
  }

  const handleApplyPlan = async () => {
    const outcome = await applyPlan()
    if (outcome.status === 'applied') {
      showSuccess(`养成计划已应用到${outcome.flowName}`)
    } else if (outcome.status === 'partial') {
      setStatusMessage(outcome.message, 'warning')
    }
  }

  const handleRetrySync = async () => {
    const outcome = await retryFlowSync()
    if (outcome.status === 'partial') setStatusMessage(outcome.message, 'warning')
  }

  const handleUpdateSettings = (newSettings: TrainingSettings) => {
    // 编辑立即作废旧计划：即使随后写入失败，旧计划也不能继续被应用。
    invalidatePlan()
    void updateSettings(newSettings).then(outcome => {
      if (outcome.status === 'failed' && !outcome.superseded) {
        showError(TRAINING_SETTINGS_FAILURE_MESSAGE)
      }
    })
  }

  const busy = queueMutationPending || generating || applying || syncing
  const planBasisCurrent = Boolean(plan && planBasis
    && isTrainingPlanBasisCurrent(planBasis, {
      queueRevision: queueSnapshot?.revision ?? null,
      settingsRevision,
    }))
  const currentTarget = queue[0] ?? null

  return (
    <>
      <PageHeader title="养成材料筹备" subtitle="管理材料目标并安排刷取计划；游戏内培养请在日常中添加任务" actions={<><FloatingStatusIndicator /><Button onClick={() => setSelectorOpen(true)}><Plus size={17} aria-hidden="true" />添加干员</Button></>} />
      <DeviceMonitorLayout>
        <div className="training-workspace-grid">
          <TrainingQueuePanel
            queue={queue}
            loading={queueLoading}
            error={queueError}
            uncertain={queueUncertain}
            refreshError={refreshError}
            operationError={operationError}
            busy={busy}
            pendingOperatorIds={pendingOperatorIds}
            queueMutationPending={queueMutationPending}
            recentlyRemoved={recentlyRemoved}
            onRemove={handleRemoveFromQueue}
            onReorder={handleReorder}
            onUndo={handleUndoRemove}
            onDismissUndo={() => setRecentlyRemoved(null)}
            onRetryLoad={() => void reloadQueue()}
            onReload={() => { invalidatePlan(); void reloadQueue() }}
            onOpenPicker={() => setSelectorOpen(true)}
          />

          <div className="training-detail-column">
            <TrainingMaterialsPanel target={currentTarget} />

            <TrainingPlanPanel
              plan={plan}
              basisCurrent={planBasisCurrent}
              error={planError}
              warning={planWarning}
              flowSync={flowSync}
              generating={generating}
              applying={applying}
              syncing={syncing}
              busy={busy}
              hasQueue={queue.length > 0 && !queueError}
              refreshFailed={refreshError}
              queueLength={queue.length}
              currentTarget={currentTarget}
              onGenerate={handleGeneratePlan}
              onApply={handleApplyPlan}
              onRetrySync={handleRetrySync}
              onReload={() => void reloadQueue()}
              onInvalidate={invalidatePlan}
            />
          </div>
        </div>

        <TrainingSettingsPanel settings={settings} onUpdate={handleUpdateSettings} />
      </DeviceMonitorLayout>

      <OperatorPicker
        isOpen={selectorOpen}
        onClose={() => setSelectorOpen(false)}
        queueOperatorIds={queueOperatorIds}
        queueLength={queue.length}
        busy={busy}
        operationError={operationError}
        pendingOperatorIds={pendingOperatorIds}
        onAdd={handleAddToQueue}
      />
    </>
  )
}
