import { Check, Package } from 'lucide-react'
import { Disclosure, EmptyState } from '@/shared/components'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Progress } from '@/shared/ui/progress'
import { Skeleton } from '@/shared/ui/skeleton'
import { summarizeTargetMaterials } from '../model/materials'
import { MaterialTable, MaterialTree } from './MaterialViews'
import type { TrainingQueueItem } from '../types'

export interface TrainingMaterialsPanelProps {
  target: TrainingQueueItem | null
  queuePending: boolean
  queueError: string | null
}

export default function TrainingMaterialsPanel({ target, queuePending, queueError }: TrainingMaterialsPanelProps) {
  const summary = summarizeTargetMaterials(target)
  const progress = Math.min(100, Math.max(0, summary.progress))

  return (
    <Card role="region" aria-labelledby="training-materials-title" className="min-w-0 gap-0 p-0!">
      <CardHeader className="px-4 py-4">
        <CardTitle id="training-materials-title" role="heading" aria-level={2} className="text-lg font-semibold">{summary.title}</CardTitle>
        <CardDescription>{summary.subtitle}</CardDescription>
        {target && <CardAction><span className="training-progress-value">{summary.progress}%<small>材料筹备进度</small></span></CardAction>}
      </CardHeader>
      <CardContent className="p-0">
        {queuePending ? (
          <div className="training-state" aria-busy="true">
            <div className="flex w-full max-w-sm flex-col gap-3" aria-hidden="true">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
            <span className="sr-only">正在读取材料筹备进度</span>
          </div>
        ) : queueError ? (
          <div className="training-state" role="status">
            <p className="text-sm text-muted-foreground">队列读取失败，暂时无法显示材料进度。</p>
          </div>
        ) : target ? (
          <>
            <Progress value={progress} aria-label="当前目标材料筹备进度" className="mx-4 mb-3" />
            {summary.missingMaterials.length > 0
              ? <MaterialTable materials={summary.missingMaterials} />
              : (
                  <EmptyState
                    compact
                    icon={<Check size={22} aria-hidden="true" />}
                    title="当前目标材料已集齐"
                    description="可在游戏内完成养成。"
                  />
                )}
            {summary.materials.length > 0 && (
              <Disclosure
                label="查看全部材料与合成需求"
                className="rounded-none border-x-0 border-b-0 border-t px-4 pb-2 pt-0"
                summaryClassName="min-h-12 font-normal text-muted-foreground"
                contentClassName="mt-0 gap-0 border-t-0 pt-0"
              >
                <MaterialTree nodes={summary.materials} />
              </Disclosure>
            )}
          </>
        ) : (
          <div className="training-state">
            <EmptyState compact icon={<Package size={24} aria-hidden="true" />} title="还没有需要筹备的材料。" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
