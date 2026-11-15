import { useRef } from 'react'
import { ArrowDown, ArrowUp, ArrowUpToLine, ClipboardList, Plus, Trash2, UserRoundSearch } from 'lucide-react'
import { getOperatorAvatarUrl, useItemIconCacheVersion } from '@/features/game-data'
import { Button } from '@/shared/ui/button'
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
  pendingOperatorIds: ReadonlySet<string>
  queueMutationPending: boolean
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
  pendingOperatorIds,
  queueMutationPending,
  recentlyRemoved,
  onRemove,
  onReorder,
  onUndo,
  onDismissUndo,
  onRetryLoad,
  onReload,
  onOpenPicker,
}: TrainingQueuePanelProps) {
  const queueHeadingRef = useRef<HTMLHeadingElement>(null)
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
      <section className="training-queue-section training-surface" aria-labelledby="training-queue-title">
        <div className="training-section-heading">
          <div><h2 ref={queueHeadingRef} tabIndex={-1} id="training-queue-title">养成队列 <span className="text-muted-foreground font-normal">{queue.length}</span></h2></div>
          <ClipboardList size={20} className="text-tertiary" aria-hidden="true" />
        </div>
        {operationError && <div role="alert" className="training-feedback status-danger">{operationError}</div>}
        {refreshError && !error && <div role="alert" className="training-feedback status-warning"><span>{uncertain ?? '队列已更新，但刷新失败。重新加载后再预览计划。'}</span><Button variant="ghost" onClick={onReload} disabled={busy}>重新加载</Button></div>}
        {loading ? <div className="training-state"><Loading text="正在读取养成队列..." /></div> : error ? <TrainingLoadError title="养成队列加载失败" description={error} onRetry={onRetryLoad} /> : queue.length === 0 ? (
          <div className="training-state"><EmptyState compact icon={<ClipboardList size={24} />} title="养成队列还是空的" description="添加需要筹备材料的干员，按目标安排刷图。" /><Button onClick={onOpenPicker} variant="secondary"><Plus size={17} aria-hidden="true" />选择干员</Button></div>
        ) : <ol className="training-queue-list">
          {queue.map((item, index) => <li key={item.operatorId} className={`training-queue-row ${index === 0 ? 'is-current' : ''}`}>
            <div className="training-queue-identity">
              <span className="training-queue-rank">{String(index + 1).padStart(2, '0')}</span>
              <span className="training-avatar"><UserRoundSearch size={22} aria-hidden="true" /><img src={getOperatorAvatarUrl(item.operatorId, 'base', itemIconVersion)} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><h3 className="training-operator-name" data-training-operator-name>{item.operator.name}</h3>{index === 0 && <span className="training-current-label">当前</span>}</div>
                <p className="training-queue-meta">精{item.currentElite} → 精{item.targetElite}<span>{selectMissingMaterials(getQueueMaterials(item)).length} 种缺口</span></p>
                <div className="training-row-progress"><span className="training-progress-track" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, item.progress ?? 0))}%` }} /></span><span>{item.progress ?? 0}%</span><span className="sr-only">材料筹备进度</span></div>
              </div>
            </div>
            <div className="training-queue-actions">
              {index > 0 && <Button variant="ghost" disabled={busy} onClick={() => void handleReorder(item.operatorId, 0)} aria-label={`将${item.operator.name}设为当前`}><ArrowUpToLine size={15} aria-hidden="true" />设为当前</Button>}
              <div className="flex items-center">
                <Button size="icon" variant="ghost" disabled={busy || index === 0} onClick={() => void handleReorder(item.operatorId, index - 1)} aria-label={`上移${item.operator.name}`} title="上移"><ArrowUp size={16} aria-hidden="true" /></Button>
                <Button size="icon" variant="ghost" disabled={busy || index === queue.length - 1} onClick={() => void handleReorder(item.operatorId, index + 1)} aria-label={`下移${item.operator.name}`} title="下移"><ArrowDown size={16} aria-hidden="true" /></Button>
                <Button size="icon" variant="ghost" disabled={busy} onClick={() => void handleRemove(item.operatorId)} aria-label={`移除${item.operator.name}`} title="移除" className="training-remove">{pendingOperatorIds.has(item.operatorId) ? <span className="h-4 w-4 motion-safe:animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}</Button>
              </div>
            </div>
          </li>)}
        </ol>}
        {queue.length > 0 && <div className="training-queue-footer"><span className="text-xs text-muted-foreground">进度仅表示材料筹备情况</span><Button variant="ghost" onClick={onOpenPicker}><Plus size={15} aria-hidden="true" />继续添加</Button></div>}
      </section>
      {recentlyRemoved && <TrainingUndoToast key={recentlyRemoved.item.operatorId} name={recentlyRemoved.item.operator.name} pending={queueMutationPending} onUndo={() => void handleUndo()} onDismiss={onDismissUndo} />}
    </>
  )
}
