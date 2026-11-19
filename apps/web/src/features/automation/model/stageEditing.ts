import type { StageConfig } from '../types'

export type StageList = Array<string | StageConfig>

export interface StageGroups {
  pinned: StageConfig[]
  smart: StageConfig[]
  normal: StageList
  blank: StageList
}

const isStageObject = (stage: string | StageConfig): stage is StageConfig => typeof stage !== 'string'

const hasStageText = (stage: string | StageConfig): boolean => (
  typeof stage === 'string' ? stage.trim() !== '' : Boolean(stage.stage?.trim())
)

/** 按编辑顺序归类；同时带 `pinned` 与 `smart` 的异常形状只归入置顶。 */
export function splitStagesForEditing(stages: readonly (string | StageConfig)[]): StageGroups {
  return {
    pinned: stages.filter((stage): stage is StageConfig => (
      hasStageText(stage) && isStageObject(stage) && stage.pinned === true
    )),
    smart: stages.filter((stage): stage is StageConfig => (
      hasStageText(stage) && isStageObject(stage) && stage.pinned !== true && stage.smart === true
    )),
    normal: stages.filter(stage => (
      hasStageText(stage)
      && (typeof stage === 'string' || (isStageObject(stage) && !stage.pinned && !stage.smart))
    )),
    blank: stages.filter(stage => !hasStageText(stage)),
  }
}

/** 拼接分组；长度与多重集合与分组输入一致。 */
export function flattenStagesForEditing(groups: StageGroups): StageList {
  return [...groups.pinned, ...groups.smart, ...groups.normal, ...groups.blank]
}

/** 每次返回新的空白行，避免草稿共享可变对象。 */
export function createEmptyStage(): StageConfig {
  return { stage: '', times: '' }
}

/** 草稿缺失时的展示列表；空数组保持为空，交由“添加关卡”继续输入。 */
export function resolveStageList(stages?: StageList): StageList {
  return stages ?? [createEmptyStage()]
}

/** 智能养成关卡的展示判定；不把负结果收窄成 `string`，编辑函数仍需处理对象形状。 */
export function isSmartStage(stage: string | StageConfig): boolean {
  return typeof stage === 'object' && stage.smart === true
}

/** 最后一个带养成干员信息的智能关卡；旧关卡没有该字段时回退空列表。 */
export function findTrainingOperators(stages: readonly (string | StageConfig)[]): string[] {
  const smartStages = stages.filter((stage): stage is StageConfig => isSmartStage(stage))
  return [...smartStages]
    .reverse()
    .find(stage => stage.trainingOperators && stage.trainingOperators.length > 0)
    ?.trainingOperators ?? []
}

/** 置顶/取消置顶；智能关卡与缺失索引返回原数组引用。 */
export function toggleStagePinned(stages: StageList, index: number): StageList {
  const currentStage = stages[index]
  if (!currentStage || isSmartStage(currentStage)) return stages

  const nextStages = [...stages]
  nextStages[index] = typeof currentStage === 'string'
    ? { stage: currentStage, times: '', pinned: true }
    : { ...currentStage, pinned: !currentStage.pinned }
  return nextStages
}

/** 修改关卡名；字符串行升级为对象形状并补全次数。缺失索引返回原数组引用。 */
export function setStageName(stages: StageList, index: number, stage: string): StageList {
  const currentStage = stages[index]
  if (!currentStage) return stages

  const nextStages = [...stages]
  nextStages[index] = typeof currentStage === 'string'
    ? { stage, times: '' }
    : { ...currentStage, stage }
  return nextStages
}

/** 修改执行次数；字符串行升级为对象形状。缺失索引返回原数组引用。 */
export function setStageTimes(stages: StageList, index: number, times: string): StageList {
  const currentStage = stages[index]
  if (!currentStage) return stages

  const nextStages = [...stages]
  nextStages[index] = typeof currentStage === 'string'
    ? { stage: currentStage, times }
    : { ...currentStage, times }
  return nextStages
}

/** 按步进调整次数，最低为 0；智能关卡不参与次数编辑。 */
export function stepStageTimes(stages: StageList, index: number, delta: number): StageList {
  const currentStage = stages[index]
  if (!currentStage || isSmartStage(currentStage)) return stages

  const currentValue = typeof currentStage === 'string' ? 0 : (Number(currentStage.times) || 0)
  return setStageTimes(stages, index, Math.max(0, currentValue + delta).toString())
}

/** 删除一行；删空后保留一个空白输入行。 */
export function removeStageAt(stages: StageList, index: number): StageList {
  const nextStages = stages.filter((_, stageIndex) => stageIndex !== index)
  return nextStages.length > 0 ? nextStages : [createEmptyStage()]
}

/** 移除智能养成关卡；保留置顶与普通关卡，空结果回退空白行。 */
export function removeSmartStages(stages: StageList): StageList {
  const { pinned, normal } = splitStagesForEditing(stages)
  const nextStages: StageList = [...pinned, ...normal]
  return nextStages.length > 0 ? nextStages : [createEmptyStage()]
}

/** 在置顶之后、普通关卡之前插入智能养成关卡；空结果回退空白行。 */
export function insertSmartStages(stages: StageList, generated: readonly StageConfig[]): StageList {
  const { pinned, normal } = splitStagesForEditing(stages)
  const nextStages: StageList = [...pinned, ...generated, ...normal]
  return nextStages.length > 0 ? nextStages : [createEmptyStage()]
}

export interface SmartStagePlanEntry {
  stage: string
  totalTimes: number
}

/** 把训练计划的关卡映射为智能养成关卡；次数与干员信息沿用计划结果。 */
export function buildSmartStages(
  planStages: readonly SmartStagePlanEntry[],
  operatorNames: readonly string[],
): StageConfig[] {
  return planStages.map(entry => ({
    stage: entry.stage,
    times: entry.totalTimes.toString(),
    smart: true,
    trainingOperators: [...operatorNames],
  }))
}
