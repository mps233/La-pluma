import { useState } from 'react'
import { CircleMinus, CirclePlus, GraduationCap, ListPlus, LoaderCircle, Minus, Pin, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { HintTooltip } from '@/shared/components'
import { Input } from '@/shared/ui/input'
import { generateTrainingPlan } from '@/features/training'
import { loadUserConfig } from '@/features/user-config'
import type { StageConfig, TaskFlowItem, TaskParamField } from '../types'
import {
  buildSmartStages,
  countConfiguredStages,
  findTrainingOperators,
  insertSmartStages,
  isSmartStage,
  removeSmartStages,
  removeStageAt,
  resolveStageList,
  setStageName,
  setStageTimes,
  stepStageTimes,
  toggleStagePinned,
} from '../model/stageEditing'

interface AutomationStageEditorProps {
  field: TaskParamField
  fieldId: string
  task: TaskFlowItem
  taskIndex: number
  isRunning: boolean
  hint?: string
  onUpdate: (taskIndex: number, key: string, value: Array<string | StageConfig>) => void
  onSuccess: (message: string) => void
  onError: (message: string) => void
}

const stageSuggestions = [
  ['1-7', '固源岩'],
  ['4-6', '酮凝集'],
  ['S4-1', '聚酸酯'],
  ['S5-9', '异铁'],
  ['CE-6', '龙门币'],
  ['LS-6', '作战记录'],
  ['AP-5', '采购凭证'],
  ['CA-5', '技巧概要'],
  ['SK-5', '碳'],
  ['PR-A-2', '重装/医疗芯片组'],
  ['PR-B-2', '狙击/术师芯片组'],
  ['PR-C-2', '先锋/辅助芯片组'],
  ['PR-D-2', '近卫/特种芯片组'],
  ['Annihilation', '剿灭'],
  ...Array.from({ length: 10 }, (_, index) => [`HD-${index + 1}`, '活动']),
] as const

export default function AutomationStageEditor({
  field,
  fieldId,
  task,
  taskIndex,
  isRunning,
  hint,
  onUpdate,
  onSuccess,
  onError,
}: AutomationStageEditorProps) {
  const [isSmartStageLoading, setIsSmartStageLoading] = useState(false)
  const stages = resolveStageList(task.params.stages)
  const controlsDisabled = isRunning || !task.enabled
  const stageControlsDisabled = controlsDisabled || isSmartStageLoading
  const smartStages = stages.filter(isSmartStage)
  const hasSmartStages = smartStages.length > 0
  const validStageCount = countConfiguredStages(stages)
  const trainingOperators = findTrainingOperators(stages)
  const smartStageDescription = hasSmartStages
    ? trainingOperators.length > 0
      ? `正在养成：${trainingOperators.join('、')}`
      : `已加入 ${smartStages.length} 个关卡`
    : '根据养成队列自动生成刷取关卡'

  const updateStages = (nextStages: Array<string | StageConfig>) => {
    // 无变化的编辑不写入草稿：模型对不可达的无效索引返回原引用。
    if (nextStages === stages) return
    onUpdate(taskIndex, 'stages', nextStages)
  }

  const togglePinned = (stageIndex: number) => {
    updateStages(toggleStagePinned(stages, stageIndex))
  }

  const updateStageName = (stageIndex: number, stage: string) => {
    updateStages(setStageName(stages, stageIndex, stage))
  }

  const updateStageTimes = (stageIndex: number, times: string) => {
    updateStages(setStageTimes(stages, stageIndex, times))
  }

  const adjustStageTimes = (stageIndex: number, delta: number) => {
    updateStages(stepStageTimes(stages, stageIndex, delta))
  }

  const deleteStage = (stageIndex: number) => {
    updateStages(removeStageAt(stages, stageIndex))
  }

  const toggleSmartStages = async () => {
    if (isSmartStageLoading) return
    setIsSmartStageLoading(true)

    try {
      if (hasSmartStages) {
        updateStages(removeSmartStages(stages))
        onSuccess('已移除智能养成关卡')
        return
      }

      const queueResult = await loadUserConfig('training-queue')
      if (!queueResult.success || !queueResult.data?.queue?.length) {
        onError('智能养成队列为空，请先添加干员')
        return
      }

      const planResult = await generateTrainingPlan({ mode: 'current' })
      if (!planResult.success || !planResult.data) {
        onError('生成刷取计划失败')
        return
      }

      const plan = planResult.data
      if (!plan.stages?.length) {
        onSuccess('当前干员材料已集齐！')
        return
      }

      const operatorNames = plan.operators?.map((operator: { name: string }) => operator.name) || []
      const generatedStages = buildSmartStages(plan.stages, operatorNames)
      updateStages(insertSmartStages(stages, generatedStages))
      onSuccess(`已添加智能养成计划：${generatedStages.length} 个关卡`)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      onError(`操作失败: ${errorMessage}`)
    } finally {
      setIsSmartStageLoading(false)
    }
  }

  return (
    <fieldset className="automation-stage-editor">
      <legend className="sr-only">{field.label}计划</legend>
      <div className="automation-stage-editor-header">
        <div className="automation-stage-editor-title">
          <label htmlFor={`${fieldId}-0`}>{field.label}计划</label>
          <span>{validStageCount > 0 ? `${validStageCount} 个关卡` : '尚未配置'}</span>
          {hint && <HintTooltip id={`${fieldId}-hint`} label={`${field.label}计划`} hint={hint} />}
        </div>
      </div>

      <div className="automation-stage-list">
        {stages.map((stageItem, stageIndex) => {
          const isSmartStageRow = isSmartStage(stageItem)
          const isPinnedStage = typeof stageItem === 'object' && stageItem.pinned === true
          const stageName = typeof stageItem === 'string' ? stageItem : stageItem.stage
          const stageTimes = typeof stageItem === 'string' ? '' : (stageItem.times || '')
          const canDeleteStage = stages.length > 1 && !isSmartStageRow
          const suggestionsId = `${fieldId}-${stageIndex}-suggestions`

          return (
            <div
              key={stageIndex}
              className={`automation-stage-item${isSmartStageRow ? ' is-smart' : ''}${isPinnedStage ? ' is-pinned' : ''}`}
              data-automation-stage-kind={isSmartStageRow ? 'smart' : 'manual'}
            >
              <div className="automation-stage-row">
                {isSmartStageRow ? (
                  <span className="automation-stage-kind" title="智能养成关卡" aria-label={`智能养成关卡：${field.label} ${stageIndex + 1}`}>
                    <GraduationCap size={17} strokeWidth={1.9} aria-hidden="true" />
                  </span>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => togglePinned(stageIndex)}
                    disabled={stageControlsDisabled}
                    className={`automation-stage-pin min-h-11 min-w-11${isPinnedStage ? ' is-active' : ''}`}
                    title={isPinnedStage ? '取消置顶' : '置顶'}
                    aria-label={`${isPinnedStage ? '取消置顶' : '置顶'}：${field.label} ${stageIndex + 1}`}
                  >
                    <Pin size={16} strokeWidth={1.9} aria-hidden="true" />
                  </Button>
                )}

                <Input
                  id={`${fieldId}-${stageIndex}`}
                  type="text"
                  autoComplete="off"
                  list={suggestionsId}
                  aria-label={stageIndex === 0 ? undefined : `${field.label} ${stageIndex + 1}`}
                  value={stageName}
                  onChange={event => updateStageName(stageIndex, event.target.value)}
                  placeholder={field.placeholder}
                  disabled={stageControlsDisabled || isSmartStageRow}
                  className="automation-stage-name-input h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent px-1.5 shadow-none md:text-sm focus-visible:ring-0"
                  data-automation-stage-name
                />
                <datalist id={suggestionsId}>
                  {stageSuggestions.map(([value, description]) => (
                    <option key={value} value={value}>{`${value} (${description})`}</option>
                  ))}
                </datalist>

                <div className="automation-stage-times">
                  <Input
                    id={`${fieldId}-${stageIndex}-times`}
                    type="number"
                    autoComplete="off"
                    aria-label={`${field.label} ${stageIndex + 1} 执行次数`}
                    value={stageTimes}
                    onChange={event => updateStageTimes(stageIndex, event.target.value)}
                    placeholder="0"
                    disabled={stageControlsDisabled || isSmartStageRow}
                    min="0"
                    className="h-full min-w-0 rounded-none border-0 bg-transparent px-1 text-center shadow-none focus-visible:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span aria-hidden="true">次</span>
                </div>

                {!isSmartStageRow && (
                  <div className="automation-stage-stepper hidden min-[900px]:flex">
                    <button
                      type="button"
                      onClick={() => adjustStageTimes(stageIndex, -1)}
                      disabled={stageControlsDisabled || Number(stageTimes) <= 0}
                      aria-label={`减少${field.label} ${stageIndex + 1} 的执行次数`}
                    >
                      <Minus size={14} strokeWidth={2.1} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustStageTimes(stageIndex, 1)}
                      disabled={stageControlsDisabled}
                      aria-label={`增加${field.label} ${stageIndex + 1} 的执行次数`}
                    >
                      <Plus size={14} strokeWidth={2.1} aria-hidden="true" />
                    </button>
                  </div>
                )}

                {canDeleteStage && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteStage(stageIndex)}
                    disabled={stageControlsDisabled}
                    className="automation-stage-delete min-h-11 min-w-11"
                    title="删除此关卡"
                    aria-label={`删除${field.label} ${stageIndex + 1}`}
                  >
                    <Trash2 size={16} strokeWidth={1.9} aria-hidden="true" />
                  </Button>
                )}
              </div>
            </div>
          )
        })}

        <Button
          variant="ghost"
          onClick={() => updateStages([...stages, { stage: '', times: '' }])}
          disabled={stageControlsDisabled}
          className="automation-stage-add w-full"
        >
          <ListPlus size={17} strokeWidth={1.9} aria-hidden="true" />
          添加关卡
        </Button>
      </div>

      <div className={`automation-smart-stage-entry${hasSmartStages ? ' is-active' : ''}`}>
        <span className="automation-smart-stage-icon" aria-hidden="true">
          <GraduationCap size={19} strokeWidth={1.8} />
        </span>
        <div className="automation-smart-stage-copy">
          <strong>智能养成关卡</strong>
          <span title={smartStageDescription}>{smartStageDescription}</span>
        </div>
        <Button
          variant={hasSmartStages ? 'ghost' : 'secondary'}
          onClick={() => void toggleSmartStages()}
          disabled={controlsDisabled || isSmartStageLoading}
          aria-busy={isSmartStageLoading || undefined}
          aria-pressed={hasSmartStages}
          aria-label={hasSmartStages ? '移除智能养成关卡' : '加入智能养成关卡'}
          className="automation-smart-stage-action"
        >
          {isSmartStageLoading
            ? <><LoaderCircle className="animate-spin" aria-hidden="true" />{hasSmartStages ? '移除中' : '同步中'}</>
            : (
              <>
                {hasSmartStages
                  ? <CircleMinus size={16} strokeWidth={1.9} aria-hidden="true" />
                  : <CirclePlus size={16} strokeWidth={1.9} aria-hidden="true" />}
                {hasSmartStages ? '移除' : '加入'}
              </>
            )}
        </Button>
      </div>
    </fieldset>
  )
}
