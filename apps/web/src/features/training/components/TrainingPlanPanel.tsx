import { useState } from 'react'
import { Check, LoaderCircle, Sparkles } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
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
  currentTarget: TrainingQueueItem | null
  onGenerate: (mode: TrainingPlanMode) => void
  onApply: () => void | Promise<void>
  onRetrySync: () => void | Promise<void>
  onReload: () => void
  onInvalidate: () => void
}

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
  currentTarget,
  onGenerate,
  onApply,
  onRetrySync,
  onReload,
  onInvalidate,
}: TrainingPlanPanelProps) {
  const [planMode, setPlanMode] = useState<TrainingPlanMode>('current')
  const today = summarizeTodayPlan(plan)
  const currentMissingCount = summarizeTargetMaterials(currentTarget).missingMaterials.length
  const previewAvailable = canGenerateTrainingPlan({ hasQueue, busy, refreshFailed })
  const applyAvailable = canApplyTrainingPlan({
    hasPlan: Boolean(plan),
    busy,
    refreshFailed,
    basisCurrent,
  })

  return (
    <section className="training-surface" aria-labelledby="training-plan-title">
      <div className="training-section-heading"><div><h2 id="training-plan-title">刷图计划</h2><p>先预览，再应用到任务流程</p></div><Sparkles size={20} className="text-tertiary" aria-hidden="true" /></div>
      <div className="training-plan-controls"><Select value={planMode} onValueChange={(mode, details) => { if (details.reason !== 'none' && mode !== null) { setPlanMode(mode as TrainingPlanMode); onInvalidate(); } }} disabled={busy} items={[{ value: 'current', label: '仅当前目标' }, { value: 'all', label: '全部队列' }]}><SelectTrigger aria-label="计划范围"><SelectValue /></SelectTrigger><SelectContent>{[{ value: 'current', label: '仅当前目标' }, { value: 'all', label: '全部队列' }].map(item => (<SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>))}</SelectContent></Select><Button onClick={() => onGenerate(planMode)} disabled={!previewAvailable || generating} aria-busy={generating || undefined} variant={plan && basisCurrent ? 'secondary' : 'default'}>{generating ? <><LoaderCircle className="animate-spin" aria-hidden="true" />计算中</> : <><Sparkles size={16} aria-hidden="true" />预览刷图计划</>}</Button></div>
      {error && <div role="alert" className="training-feedback status-danger">{error}</div>}
      {warning && <div role="alert" className="training-feedback status-warning"><span>{warning}</span><Button variant="ghost" onClick={onReload} disabled={busy}>重新加载</Button></div>}
      {plan && basisCurrent ? <>
        <div className="training-plan-overview"><div><h3>{getPlanFocusName(plan, currentTarget)}</h3><p>今日可刷 {today.openStageCount} 个关卡 · {today.runCount} 次{today.sanity > 0 ? ` · 约 ${today.sanity} 理智` : ''}</p><p>完整计划约 {plan.totalSanity ?? 0} 理智（含未开放关卡）</p></div></div>
        {!!plan.warnings?.length && <div role="note" className="training-plan-warnings status-warning">{plan.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
        {today.stages.length > 0 ? <div className="training-stage-list">{today.stages.map((stage, index) => <div key={`${stage.stage}-${index}`} className="training-stage-row" data-training-stage-row><div><strong>{stage.stage}</strong><p>{stage.materials?.map(material => `${material.name} ×${material.count ?? material.needed ?? 0}`).join('、') || '今日可直接推进'}</p></div><span className="tabular-nums font-semibold">×{stage.totalTimes ?? 0}</span></div>)}</div> : <p className="training-inline-empty">{currentMissingCount === 0 ? '当前材料已齐，无需刷取。' : '今天没有可直接推进的开放关卡，查看详情安排后续刷取。'}</p>}
        <div className="training-apply"><Button onClick={() => void onApply()} disabled={!applyAvailable || !today.openStageCount || applying} aria-busy={applying || undefined} className="w-full">{applying ? <><LoaderCircle className="animate-spin" aria-hidden="true" />应用中</> : <><Check size={16} aria-hidden="true" />应用到{flowSync.flowName}</>}</Button><p>写入{flowSync.taskName ? `「${flowSync.taskName}」` : '作战任务'}的智能养成关卡，保留普通关卡。</p></div>
        <details className="training-disclosure"><summary>查看完整材料、未开放关卡与计算详情</summary>
          {!!plan.closedStages?.length && <div className="training-closed-stages"><h3>今日未开放</h3>{plan.closedStages.map((stage, index) => <p key={`${stage.stage}-${index}`}><strong>{stage.stage}</strong><span>{stage.totalTimes ?? 0} 次 · 等待开放</span></p>)}</div>}
          {!!plan.materialHierarchy?.length && <><h3 className="mt-4 font-semibold">计划材料需求</h3><MaterialTree nodes={plan.materialHierarchy} /></>}
          {!!plan.stages?.length && <div className="training-closed-stages"><h3>完整关卡列表</h3>{plan.stages.map((stage, index) => <p key={`${stage.stage}-${index}`}><strong>{stage.stage}</strong><span>{stage.totalTimes ?? 0} 次 · {stage.isOpen === false ? '未开放' : '今日开放'}</span></p>)}</div>}
        </details>
      </> : !error && <p className="training-plan-placeholder">{queueLength ? '队列变更后需重新预览，确保计划与当前目标一致。' : '选择养成目标后，即可计算材料缺口与推荐关卡。'}</p>}
      <div className={`training-sync-status ${flowSync.status === 'failed' ? 'status-warning' : ''}`} role="status">
        <div>{flowSync.status === 'failed' ? <><strong>队列已更新，任务流程同步失败</strong><p>{flowSync.error || '请重试同步，避免流程使用旧关卡。'}</p></> : flowSync.status === 'synced' ? <><strong>已同步到{flowSync.flowName}</strong><p>队列变更会自动同步智能养成关卡，删空后清理。</p></> : <p>尚未应用到{flowSync.flowName}。添加干员与预览不会修改流程。</p>}</div>
        {flowSync.status === 'failed' && <Button variant="secondary" onClick={() => void onRetrySync()} disabled={busy || syncing} aria-busy={syncing || undefined}>{syncing ? <><LoaderCircle className="animate-spin" aria-hidden="true" />同步中</> : '重试同步'}</Button>}
      </div>
    </section>
  )
}
