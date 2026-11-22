import { useRef } from 'react'
import { ArrowDown, ArrowUp, ArrowUpToLine, ClipboardList, LoaderCircle, Plus, Trash2, UserRoundSearch } from 'lucide-react'
import { getOperatorAvatarUrl, useItemIconCacheVersion } from '@/features/game-data'
import { Button } from '@/shared/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Progress } from '@/shared/ui/progress'
import { EmptyState, Loading } from '@/shared/components'
import { getQueueMaterials, selectMissingMaterials } from '../model/materials'
import TrainingLoadError from './TrainingLoadError'
import TrainingUndoToast from './TrainingUndoToast'
import type { TrainingQueueItem } from '../types'

export interface RemovedTrainingQueueItem {
  item: TrainingQueueItem
  index: number
}

export interface TrainingQueuePanelProps {
  queue: TrainingQueueItem[]
  loading: boolean
  /** 首次读取失败；有快照时为空，改由 `uncertain`/`refreshError` 表达。 */
  error: string | null
  uncertain: string | null
  refreshError: boolean
  operationError: string | null
  busy: boolean
  pendingRemoveOperatorIds: ReadonlySet<string>
  pendingUndoOperatorIds: ReadonlySet<string>
  recentlyRemoved: RemovedTrainingQueueItem | null
  onRemove: (operatorId: string) => Promise<boolean>
  onReorder: (operatorId: string, destination: number) => Promise<boolean>
  onUndo: () => Promise<boolean>
  onDismissUndo: () => void
  /** 首次读取失败后的重试：只重读队列。 */
  onRetryLoad: () => void
  /** 刷新失败警告里的重新加载：先作废旧计划再重读。 */
  onReload: () => void
  onOpenPicker: () => void
}

export default function TrainingQueuePanel({
  queue,
  loading,
  error,
  uncertain,
  refreshError,
  operationError,
  busy,
  pendingRemoveOperatorIds,
  pendingUndoOperatorIds,
  recentlyRemoved,
  onRemove,
  onReorder,
  onUndo,
  onDismissUndo,
  onRetryLoad,
  onReload,
  onOpenPicker,
}: TrainingQueuePanelProps) {
  const queueHeadingRef = useRef<HTMLDivElement>(null)
  const itemIconVersion = useItemIconCacheVersion()
  const focusHeading = () => queueHeadingRef.current?.focus({ preventScroll: true })

  const handleRemove = async (operatorId: string) => {
    if (await onRemove(operatorId)) focusHeading()
  }

  const handleReorder = async (operatorId: string, destination: number) => {
    if (await onReorder(operatorId, destination)) focusHeading()
  }

  const handleUndo = async () => {
    if (await onUndo()) focusHeading()
  }

  return (
    <>
      <Card role="region" aria-labelledby="training-queue-title" className="min-w-0 gap-0 p-0!">
        <CardHeader className="px-4 py-4">
          <CardTitle ref={queueHeadingRef} tabIndex={-1} id="training-queue-title" role="heading" aria-level={2} className="text-lg font-semibold">
            养成队列
          </CardTitle>
          <CardAction>
            <Button size="icon" variant="ghost" aria-label="添加干员" title="添加干员" onClick={onOpenPicker}>
              <Plus size={16} aria-hidden="true" />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          {operationError && <div role="alert" className="training-feedback status-danger mx-4">{operationError}</div>}
          {refreshError && !error && <div role="alert" className="training-feedback status-warning mx-4"><span>{uncertain ?? '队列已更新，但刷新失败。重新加载后再预览计划。'}</span><Button variant="ghost" onClick={onReload} disabled={busy}>重新加载</Button></div>}
          {loading ? <div className="training-state"><Loading text="正在读取养成队列..." /></div> : error ? <TrainingLoadError title="养成队列加载失败" description={error} onRetry={onRetryLoad} /> : queue.length === 0 ? (
            <div className="training-state"><EmptyState compact icon={<ClipboardList size={24} />} title="养成队列还是空的" description="添加需要筹备材料的干员，按目标安排刷图。" /></div>
          ) : <ol className="training-queue-list">
            {queue.map((item, index) => <li key={item.operatorId} className="training-queue-row">
              <div className="training-queue-identity">
                <span className="training-queue-rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="training-avatar"><UserRoundSearch size={22} aria-hidden="true" /><img src={getOperatorAvatarUrl(item.operatorId, 'base', itemIconVersion)} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><h3 className="training-operator-name" data-training-operator-name>{item.operator.name}</h3>{index === 0 && <span className="training-current-label">当前</span>}</div>
                  <p className="training-queue-meta">精{item.currentElite} → 精{item.targetElite}<span>{selectMissingMaterials(getQueueMaterials(item)).length} 种缺口</span></p>
                  <div className="training-row-progress"><Progress value={Math.min(100, Math.max(0, item.progress ?? 0))} aria-label={`${item.operator.name}材料筹备进度`} className="w-20 shrink-0" /><span>{item.progress ?? 0}%</span></div>
                </div>
              </div>
              <div className="training-queue-actions">
                {index > 0 && <Button variant="ghost" disabled={busy} onClick={() => void handleReorder(item.operatorId, 0)} aria-label={`将${item.operator.name}设为当前`}><ArrowUpToLine size={15} aria-hidden="true" />设为当前</Button>}
                <div className="flex items-center">
                  <Button size="icon" variant="ghost" disabled={busy || index === 0} onClick={() => void handleReorder(item.operatorId, index - 1)} aria-label={`上移${item.operator.name}`} title="上移"><ArrowUp size={16} aria-hidden="true" /></Button>
                  <Button size="icon" variant="ghost" disabled={busy || index === queue.length - 1} onClick={() => void handleReorder(item.operatorId, index + 1)} aria-label={`下移${item.operator.name}`} title="下移"><ArrowDown size={16} aria-hidden="true" /></Button>
                  <Button size="icon" variant="ghost" disabled={busy} onClick={() => void handleRemove(item.operatorId)} aria-label={`移除${item.operator.name}`} aria-busy={pendingRemoveOperatorIds.has(item.operatorId) || undefined} title="移除" className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/10">{pendingRemoveOperatorIds.has(item.operatorId) ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}</Button>
                </div>
              </div>
            </li>)}
          </ol>}
        </CardContent>
      </Card>
      {recentlyRemoved && <TrainingUndoToast key={recentlyRemoved.item.operatorId} name={recentlyRemoved.item.operator.name} pending={pendingUndoOperatorIds.has(recentlyRemoved.item.operatorId)} onUndo={() => void handleUndo()} onDismiss={onDismissUndo} />}
    </>
  )
}
