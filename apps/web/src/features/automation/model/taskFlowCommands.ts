import type {
  AutomationAvailableTask,
  StageConfig,
  TaskFlowItem,
  TaskParamKey,
  TaskParams,
  TaskParamValue,
} from '../types'
import { parseDropTargets } from './dropTargets'
import { flattenStagesForEditing, splitStagesForEditing } from './stageEditing'
import { placeClosedownLast } from './taskFlowSort'
import {
  validateFightMedicineExpireDays,
  validateFightSeries,
  validateOperProgressPlans,
  validateRecruitExtraTagsMode,
  validateRecruitPermitReserve,
  validateThemes,
} from './gameTaskParams'

/**
 * 流程条目：草稿态没有界面字段，展示态可以带上；两种形状都能传入模型。
 */
export type TaskFlowEntry = Omit<TaskFlowItem, 'icon' | 'paramFields'> & {
  icon?: TaskFlowItem['icon']
  paramFields?: TaskFlowItem['paramFields']
}

export interface AddTaskFlowResult {
  task: TaskFlowEntry
  flow: TaskFlowEntry[]
}

export interface TaskFlowValidationFailure {
  taskId: string
  message: string
}

/** `commandId` 优先，缺失时回退到 `${commandId}-${时间戳}` 的 id 前缀。 */
export function resolveTaskCommandId(task: { id: string; commandId?: string }): string {
  return task.commandId || task.id.split('-')[0] || ''
}

/** 校验时同时接受 `commandId` 与 id 前缀，兼容旧草稿。 */
const matchesCommand = (task: { id: string; commandId?: string }, commandId: string) => (
  task.commandId === commandId || task.id.split('-')[0] === commandId
)

/**
 * 添加任务：复制默认参数生成新 id，关闭游戏继承启动游戏的客户端类型。
 *
 * 非关闭游戏任务会重新经过 `placeClosedownLast`，关闭游戏任务直接追加到末尾。
 */
export function addTaskToFlow(
  flow: readonly TaskFlowEntry[],
  definition: AutomationAvailableTask,
  now: number = Date.now(),
): AddTaskFlowResult {
  // 界面字段不进入草稿或 wire；其余字段（含 defaultParams）保持迁移前的持久化形状。
  const { icon: _icon, paramFields: _paramFields, ...definitionFields } = definition
  const task: TaskFlowEntry = {
    ...definitionFields,
    id: `${definition.id}-${now}`,
    commandId: definition.id,
    params: { ...definition.defaultParams },
    enabled: true,
  }

  if (matchesCommand(task, 'closedown')) {
    const startupTask = flow.find(item => matchesCommand(item, 'startup'))
    if (startupTask) task.params.clientType = startupTask.params.clientType || 'Official'
  }

  return {
    task,
    flow: matchesCommand(task, 'closedown')
      ? [...flow, task]
      : placeClosedownLast([...flow, task]),
  }
}

/** 按删除时的索引恢复任务；索引越界时夹取到有效范围。 */
export function insertTaskFlowItem(
  flow: readonly TaskFlowEntry[],
  task: TaskFlowEntry,
  index: number,
): TaskFlowEntry[] {
  const insertionIndex = Math.max(0, Math.min(index, flow.length))
  const restoredFlow = [...flow]
  restoredFlow.splice(insertionIndex, 0, task)
  return placeClosedownLast(restoredFlow)
}

export function removeTaskFlowItem(
  flow: readonly TaskFlowEntry[],
  index: number,
): TaskFlowEntry[] {
  return flow.filter((_, itemIndex) => itemIndex !== index)
}

/** 切换启用状态；越界索引返回原数组引用。 */
export function toggleTaskFlowItemEnabled<T extends TaskFlowEntry>(
  flow: T[],
  index: number,
): T[] {
  if (!flow[index]) return flow
  return flow.map((task, taskIndex) => (
    taskIndex === index ? { ...task, enabled: !task.enabled } : task
  ))
}

/**
 * 关卡编辑顺序：置顶 → 智能养成 → 普通 → 空白输入行。
 *
 * 分组规则由 `stageEditing.splitStagesForEditing` 与任务编辑面板共用，
 * 每个条目只归类一次；组内保持原顺序，输出长度与多重集合和输入一致。
 * 同时带 `pinned` 与 `smart` 的异常形状按置顶处理（编辑路径不会产生该形状）。
 */
export function orderStagesForEditing(
  stages: Array<string | StageConfig>,
): Array<string | StageConfig> {
  return flattenStagesForEditing(splitStagesForEditing(stages))
}

export function setTaskParam(
  params: TaskParams,
  key: TaskParamKey,
  value: TaskParamValue,
): TaskParams {
  return { ...params, [key]: value }
}

/**
 * 更新单个任务的参数。
 *
 * - `stages` 数组先经过分组排序，空白行保留在末尾供继续输入；
 * - `clientType` 变化时同步另一端的启动/关闭游戏任务，与迁移前一致；
 * - 任务索引不存在时返回原数组引用。
 */
export function updateTaskFlowParams<T extends TaskFlowEntry>(
  flow: T[],
  index: number,
  key: TaskParamKey,
  value: TaskParamValue,
): T[] {
  const currentTask = flow[index]
  if (!currentTask) return flow

  const nextValue = key === 'stages' && Array.isArray(value)
    ? orderStagesForEditing(value as Array<string | StageConfig>)
    : value
  const nextParams = setTaskParam(currentTask.params ?? {}, key, nextValue)
  const syncsConnectionType = key === 'clientType'

  return flow.map((task, taskIndex) => {
    if (taskIndex === index) return { ...task, params: nextParams }
    // 启动/关闭游戏共用客户端类型；只处理带显式 commandId 的条目，与迁移前一致。
    if (
      syncsConnectionType
      && (
        (currentTask.commandId === 'startup' && task.commandId === 'closedown')
        || (currentTask.commandId === 'closedown' && task.commandId === 'startup')
      )
    ) {
      return { ...task, params: setTaskParam(task.params ?? {}, key, value) }
    }
    return task
  })
}

/**
 * 执行前校验：自定义换班缺少排班文件优先于掉落目标格式。
 *
 * 返回第一个无效任务，页面据此选中编辑器并提示；全部有效返回 null。
 */
export function findTaskFlowValidationFailure(
  flow: readonly TaskFlowEntry[],
): TaskFlowValidationFailure | null {
  const invalidInfrast = flow.find(task => (
    task.enabled
    && task.taskType === 'Infrast'
    && Number(task.params.mode) === 10000
    && !String(task.params.filename || '').trim()
  ))
  if (invalidInfrast) {
    return { taskId: invalidInfrast.id, message: '自定义换班需要填写排班文件路径' }
  }

  const invalidFightDrops = flow.find(task => (
    task.enabled
    && resolveTaskCommandId(task) === 'fight'
    && parseDropTargets(task.params.drops) === null
  ))
  if (invalidFightDrops) {
    return {
      taskId: invalidFightDrops.id,
      message: '掉落目标格式应为物品 ID=数量，多个目标用逗号分隔',
    }
  }

  for (const task of flow) {
    if (!task.enabled) continue
    const commandId = resolveTaskCommandId(task)
    const message = commandId === 'operprogress' || task.taskType === 'OperProgress'
      ? validateOperProgressPlans(task.params.plans)
      : commandId === 'switchtheme' || task.taskType === 'SwitchTheme'
        ? validateThemes(task.params.themes)
        : commandId === 'fight'
          ? validateFightSeries(task.params.series) ?? validateFightMedicineExpireDays(task.params.medicineExpireDays)
          : commandId === 'recruit' || task.taskType === 'Recruit'
            ? validateRecruitPermitReserve(task.params.level3_recruitment_permit_reserve)
              ?? validateRecruitExtraTagsMode(task.params.extra_tags_mode)
            : null
    if (message) return { taskId: task.id, message }
  }

  return null
}
