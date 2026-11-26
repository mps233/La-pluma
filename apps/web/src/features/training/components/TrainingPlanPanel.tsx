import { useState } from 'react'
import { Check, LoaderCircle, Sparkles } from 'lucide-react'
import { Disclosure, EmptyState, InlineAlert } from '@/shared/components'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from '@/shared/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Skeleton } from '@/shared/ui/skeleton'
import { summarizeTargetMaterials } from '../model/materials'
import {
  getPlanFocusName,
  summarizeTodayPlan,
} from '../model/planDisplay'
import { canApplyTrainingPlan, canGenerateTrainingPlan } from '../model/planValidity'
import { MaterialTree } from './MaterialViews'
import type {
  TrainingFlowSync,
  TrainingPlan,
  TrainingPlanMode,
  TrainingQueueItem,
} from '../types'

export interface TrainingPlanPanelProps {
  plan: TrainingPlan | null
  basisCurrent: boolean
  error: string | null
  warning: string | null
  flowSync: TrainingFlowSync
  generating: boolean
  applying: boolean
  syncing: boolean
  busy: boolean
  hasQueue: boolean
  refreshFailed: boolean
  queueLength: number
  queuePending: boolean
  queueError: string | null
  currentTarget: TrainingQueueItem | null
  settingsReady: boolean
  onGenerate: (mode: TrainingPlanMode) => void
  onApply: () => void | Promise<void>
  onRetrySync: () => void | Promise<void>
  onReload: () => void
  onInvalidate: () => void
}

const PLAN_MODE_ITEMS = [
  { value: 'current', label: '仅当前目标' },
  { value: 'all', label: '全部队列' },
]

export default function TrainingPlanPanel({
  plan,
  basisCurrent,
  error,
  warning,
  flowSync,
  generating,
  applying,
  syncing,
  busy,
  hasQueue,
  refreshFailed,
  queueLength,
  queuePending,
  queueError,
  currentTarget,
  settingsReady,
  onGenerate,
  onApply,
  onRetrySync,
  onReload,
  onInvalidate,
}: TrainingPlanPanelProps) {
  const [planMode, setPlanMode] = useState<TrainingPlanMode>('current')
  const today = summarizeTodayPlan(plan)
  const currentMissingCount = summarizeTargetMaterials(currentTarget).missingMaterials.length
  const previewAvailable = settingsReady && canGenerateTrainingPlan({ hasQueue, busy, refreshFailed })
  const applyAvailable = settingsReady && canApplyTrainingPlan({
    hasPlan: Boolean(plan),
    busy,
    refreshFailed,
    basisCurrent,
  })

  return (
    <Card role="region" aria-labelledby="training-plan-title" className="min-w-0 gap-0 p-0!">
      <CardHeader className="px-4 py-4">
        <CardTitle id="training-plan-title" role="heading" aria-level={2} className="text-lg font-semibold">刷图计划</CardTitle>
        <CardDescription>先预览，再应用到任务流程</CardDescription>
        <CardAction><Sparkles size={20} className="text-tertiary" aria-hidden="true" /></CardAction>
      </CardHeader>
      <CardContent className="p-0">
        <FieldGroup className="training-plan-controls grid gap-2">
          <Field className="min-w-0 gap-0">
            <FieldLabel htmlFor="training-plan-scope" className="sr-only">计划范围</FieldLabel>
            <Select
              value={planMode}
              onValueChange={(mode, details) => {
                if (details.reason !== 'none' && mode !== null) {
                  setPlanMode(mode as TrainingPlanMode)
                  onInvalidate()
                }
              }}
              disabled={busy}
              items={PLAN_MODE_ITEMS}
            >
              <SelectTrigger id="training-plan-scope" aria-label="计划范围" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLAN_MODE_ITEMS.map(item => (
                  <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button
            onClick={() => onGenerate(planMode)}
            disabled={!previewAvailable || generating}
            aria-busy={generating || undefined}
            variant={plan && basisCurrent ? 'secondary' : 'default'}
          >
            {generating
              ? <><LoaderCircle className="animate-spin" aria-hidden="true" />计算中</>
              : <><Sparkles size={16} aria-hidden="true" />预览刷图计划</>}
          </Button>
        </FieldGroup>
        {error && <InlineAlert tone="error" className="mx-4 mb-3">{error}</InlineAlert>}
        {warning && (
          <InlineAlert
            tone="warning"
            className="mx-4 mb-3"
            action={<Button variant="secondary" size="sm" onClick={onReload} disabled={busy}>重新加载</Button>}
          >
            {warning}
          </InlineAlert>
        )}
        {plan && basisCurrent ? <>
          <Field className="gap-2 border-t border-border p-4">
            <FieldTitle role="heading" aria-level={3} className="text-base font-semibold text-foreground">{getPlanFocusName(plan, currentTarget)}</FieldTitle>
            <FieldDescription className="text-sm leading-6">今日可刷 {today.openStageCount} 个关卡 · {today.runCount} 次{today.sanity > 0 ? ` · 约 ${today.sanity} 理智` : ''}</FieldDescription>
            <FieldDescription className="text-sm leading-6">完整计划约 {plan.totalSanity ?? 0} 理智（含未开放关卡）</FieldDescription>
          </Field>
          {!!plan.warnings?.length && (
            <div role="note" className="training-plan-warnings status-warning flex flex-col gap-1.5">
              {plan.warnings.map((planWarning, index) => <p key={index}>{planWarning}</p>)}
            </div>
          )}
          {today.stages.length > 0 ? (
            <div className="training-stage-list">
              {today.stages.map((stage, index) => (
                <div key={`${stage.stage}-${index}`} className="training-stage-row" data-training-stage-row>
                  <div>
                    <strong>{stage.stage}</strong>
                    <p>{stage.materials?.map(material => `${material.name} ×${material.count ?? material.needed ?? 0}`).join('、') || '今日可直接推进'}</p>
                  </div>
                  <Badge variant="secondary" className="tabular-nums">×{stage.totalTimes ?? 0}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              icon={currentMissingCount === 0
                ? <Check size={22} aria-hidden="true" />
                : <Sparkles size={22} aria-hidden="true" />}
              title={currentMissingCount === 0 ? '当前材料已齐，无需刷取。' : '今天没有可直接推进的开放关卡'}
              description={currentMissingCount === 0 ? undefined : '查看详情安排后续刷取。'}
            />
          )}
          <Field className="gap-2 p-4">
            <Button
              onClick={() => void onApply()}
              disabled={!applyAvailable || !today.openStageCount || applying}
              aria-busy={applying || undefined}
              aria-label={`应用到${flowSync.flowName}`}
              className="w-full min-w-0"
            >
              {applying
                ? <><LoaderCircle className="animate-spin" aria-hidden="true" />应用中</>
                : <><Check size={16} aria-hidden="true" /><span className="min-w-0 truncate">应用到{flowSync.flowName}</span></>}
            </Button>
            <FieldDescription className="text-center text-xs leading-6">
              写入{flowSync.taskName ? `「${flowSync.taskName}」` : '作战任务'}的智能养成关卡，保留普通关卡。
            </FieldDescription>
          </Field>
          <Disclosure
            label="查看完整材料、未开放关卡与计算详情"
            className="rounded-none border-x-0 border-b-0 border-t px-4 pb-2 pt-0"
            summaryClassName="min-h-12 font-normal text-muted-foreground"
            contentClassName="mt-0 gap-0 border-t-0 pt-0"
          >
            {!!plan.closedStages?.length && (
              <div className="training-closed-stages">
                <h3 className="text-base font-semibold text-foreground">今日未开放</h3>
                {plan.closedStages.map((stage, index) => (
                  <p key={`${stage.stage}-${index}`}>
                    <strong>{stage.stage}</strong>
                    <span>{stage.totalTimes ?? 0} 次 · 等待开放</span>
                  </p>
                ))}
              </div>
            )}
            {!!plan.materialHierarchy?.length && (
              <>
                <h3 className="mt-4 text-base font-semibold text-foreground">计划材料需求</h3>
                <MaterialTree nodes={plan.materialHierarchy} />
              </>
            )}
            {!!plan.stages?.length && (
              <div className="training-closed-stages">
                <h3 className="text-base font-semibold text-foreground">完整关卡列表</h3>
                {plan.stages.map((stage, index) => (
                  <p key={`${stage.stage}-${index}`}>
                    <strong>{stage.stage}</strong>
                    <span>{stage.totalTimes ?? 0} 次 · {stage.isOpen === false ? '未开放' : '今日开放'}</span>
                  </p>
                ))}
              </div>
            )}
          </Disclosure>
        </> : queuePending ? (
          <div className="training-state border-t border-border" aria-busy="true">
            <div className="flex w-full max-w-sm flex-col gap-3" aria-hidden="true">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
            <span className="sr-only">正在读取养成队列</span>
          </div>
        ) : queueError ? (
          <div className="training-state border-t border-border" role="status">
            <p className="text-sm text-muted-foreground">队列读取失败，暂时无法预览刷图计划。</p>
          </div>
        ) : !error && (
          <div className="training-state border-t border-border">
            <EmptyState
              compact
              icon={<Sparkles size={22} aria-hidden="true" />}
              title={queueLength ? '需要重新预览刷图计划' : '还没有刷图计划'}
              description={queueLength
                ? '队列变更后需重新预览，确保计划与当前目标一致。'
                : '选择养成目标后，即可计算材料缺口与推荐关卡。'}
            />
          </div>
        )}
        <div className={`training-sync-status ${flowSync.status === 'failed' ? 'status-warning' : ''}`} role="status">
          <div>{flowSync.status === 'failed' ? <><strong>队列已更新，任务流程同步失败</strong><p>{flowSync.error || '请重试同步，避免流程使用旧关卡。'}</p></> : flowSync.status === 'synced' ? <><strong>已同步到{flowSync.flowName}</strong><p>队列变更会自动同步智能养成关卡，删空后清理。</p></> : <p>尚未应用到{flowSync.flowName}。添加干员与预览不会修改流程。</p>}</div>
          {flowSync.status === 'failed' && <Button variant="secondary" onClick={() => void onRetrySync()} disabled={busy || syncing} aria-busy={syncing || undefined}>{syncing ? <><LoaderCircle className="animate-spin" aria-hidden="true" />同步中</> : '重试同步'}</Button>}
        </div>
      </CardContent>
    </Card>
  )
}
