import {
  MAA_CLI_I32_MAX,
  MAA_CLI_I32_MIN,
  RECLAMATION_THEMES,
  ROGUELIKE_THEMES,
  getRoguelikeAdvancedOptions,
  getRoguelikeOptionChoices,
} from './roguelikeOptions'
import type {
  RoguelikeAdvancedOption,
  RoguelikeAdvancedParams,
  RoguelikeAdvancedValues,
  RoguelikeMode,
  RoguelikeTask,
  RoguelikeTaskInputs,
} from '../types'

export { getRoguelikeAdvancedOptions, getRoguelikeOptionChoices } from './roguelikeOptions'

export const DEFAULT_ROGUELIKE_MODE: RoguelikeMode = 'roguelike'

export const ROGUELIKE_TASKS: readonly RoguelikeTask[] = [
  {
    id: 'roguelike',
    name: '集成战略',
    command: 'roguelike',
    placeholder: '输入主题代号',
    icon: 'Map',
  },
  {
    id: 'reclamation',
    name: '生息演算',
    command: 'reclamation',
    placeholder: '输入主题代号',
    icon: 'Plant',
  },
]

export { DEFAULT_RECLAMATION_MODE, ROGUELIKE_THEME_PRESETS } from './roguelikeOptionCatalog'
export type { RoguelikeThemePreset } from './roguelikeOptionCatalog'

/** 主题代号是否属于该任务已知的主题目录；隐藏字段与命令构造都以它为准。 */
export function isKnownRoguelikeTheme(taskId: string, theme: string): boolean {
  const themes = taskId === 'reclamation' ? RECLAMATION_THEMES : ROGUELIKE_THEMES
  return themes.includes(theme.trim())
}

export function getThemesForTask(taskId: string): readonly string[] {
  return taskId === 'reclamation' ? RECLAMATION_THEMES : ROGUELIKE_THEMES
}

export function getTaskDefinition(taskId: string): RoguelikeTask {
  return ROGUELIKE_TASKS.find(task => task.id === taskId) ?? ROGUELIKE_TASKS[0]!
}

/** select 的默认值不在当前主题候选表内时回落到首项（如重启锚点没有模式 1）。 */
function resolveOptionDefault(
  option: RoguelikeAdvancedOption,
  theme: string,
  taskId: string,
): string | undefined {
  if (option.defaultValue === undefined) return undefined
  if (option.type !== 'select') return option.defaultValue
  const choices = getRoguelikeOptionChoices(option, theme, taskId) ?? []
  if (choices.some(choice => choice.value === option.defaultValue)) return option.defaultValue
  return choices[0]?.value
}

export function pickAdvancedValue(
  option: RoguelikeAdvancedOption,
  advanced: RoguelikeAdvancedValues,
  theme = '',
  taskId = 'roguelike',
): string | number | boolean | undefined {
  const value = advanced[option.key]
  if (value === undefined || value === '') return resolveOptionDefault(option, theme, taskId)
  return value
}

/**
 * 字段的显示值：先按默认值解析，再回落到当前主题下 select 的首项。
 * 命令构造不使用首项回落——未声明默认值的字段保持省略。
 */
export function resolveRoguelikeAdvancedValue(
  option: RoguelikeAdvancedOption,
  advanced: RoguelikeAdvancedValues,
  theme = '',
  taskId = 'roguelike',
): string | number | boolean | undefined {
  return pickAdvancedValue(option, advanced, theme, taskId)
    ?? getRoguelikeOptionChoices(option, theme, taskId)?.[0]?.value
}

/** 下拉字段的取值是否属于当前主题的候选表；非下拉字段不做取值约束。 */
export function isRoguelikeOptionValueValid(
  option: RoguelikeAdvancedOption,
  theme: string,
  value: string | number | boolean,
  taskId = 'roguelike',
): boolean {
  if (option.type !== 'select') return true
  const choices = getRoguelikeOptionChoices(option, theme, taskId)
  if (!choices) return true
  return choices.some(choice => choice.value === String(value))
}

export function getRoguelikeNumberError(
  option: RoguelikeAdvancedOption,
  value: string | number | boolean,
): string | null {
  const text = String(value).trim()
  if (text === '') return null
  if (!/^[+-]?\d+$/.test(text)) return `${option.label}需为整数`

  const parsed = Number(text)
  const min = option.numberRange?.min ?? MAA_CLI_I32_MIN
  const max = option.numberRange?.max ?? MAA_CLI_I32_MAX
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return `${option.label}需在 ${min}–${max} 之间`
  }
  return null
}

export function resolveListChoice(option: RoguelikeAdvancedOption, item: string): string | null {
  const choice = option.listChoices?.find(candidate => (
    candidate.value === item || candidate.label === item
  ))
  return choice ? choice.value : null
}

export function getRoguelikeListError(
  option: RoguelikeAdvancedOption,
  value: string | number | boolean,
): string | null {
  const items = splitRoguelikeListValue(value)
  if (option.listChoices) {
    for (const item of items) {
      if (!resolveListChoice(option, item)) return `${option.label}「${item}」不是可选值`
    }
  }
  if (option.listMaxItems !== undefined && items.length > option.listMaxItems) {
    return `${option.label}最多选择 ${option.listMaxItems} 项`
  }
  if (option.key === 'blackflowStartAnimals') {
    const serpents = items.filter(item => resolveListChoice(option, item) === 'swaddled_feathered_serpent')
    if (serpents.length > 1) return `${option.label}最多包含一项襁褓羽蛇`
  }
  return null
}

export function resolveModeValue(taskId: string, theme: string, advanced: RoguelikeAdvancedValues): string {
  const modeOption = getRoguelikeAdvancedOptions(taskId).find(option => option.key === 'mode')
  if (!modeOption) return ''
  const value = resolveRoguelikeAdvancedValue(modeOption, advanced, theme, taskId)
  return value === undefined ? '' : String(value)
}

export function isRoguelikeOptionVisible(
  option: RoguelikeAdvancedOption,
  taskId: string,
  theme: string,
  advanced: RoguelikeAdvancedValues,
): boolean {
  const normalizedTheme = theme.trim()
  if (option.themes && !option.themes.includes(normalizedTheme)) return false

  if (option.modes && !option.modes.includes(resolveModeValue(taskId, normalizedTheme, advanced))) {
    return false
  }

  const requires = option.requires
  if (!requires) return true

  const target = getRoguelikeAdvancedOptions(taskId).find(candidate => candidate.key === requires.key)
  if (!target) return true
  const value = resolveRoguelikeAdvancedValue(target, advanced, normalizedTheme, taskId)

  if (requires.oneOf) return requires.oneOf.includes(String(value ?? ''))
  if (typeof requires.equals === 'boolean') return Boolean(value) === requires.equals
  if (typeof requires.equals === 'string') return String(value ?? '') === requires.equals
  return Boolean(value)
}

export interface RoguelikeActiveOption {
  readonly option: RoguelikeAdvancedOption
  readonly value: string | number | boolean
}

/** 当前主题与模式下生效且已填写的字段；命令构造、动态任务与执行前校验共用同一口径。 */
export function readActiveRoguelikeOptions(
  taskId: string,
  theme: string,
  advanced: RoguelikeAdvancedValues,
): RoguelikeActiveOption[] {
  const active: RoguelikeActiveOption[] = []
  for (const option of getRoguelikeAdvancedOptions(taskId)) {
    if (!isRoguelikeOptionVisible(option, taskId, theme, advanced)) continue
    const value = pickAdvancedValue(option, advanced, theme, taskId)
    if (value === undefined || value === '' || value === false) continue
    active.push({ option, value })
  }
  return active
}

/**
 * 主题输入是自由文本，输入过程中会经过 `S`、`Sark` 等未知中间态。
 * 只有确认主题属于当前任务的目录时才归一化模式，否则保留草稿并在执行前由校验拒绝。
 */
export function normalizeRoguelikeModeForKnownTheme(
  taskId: string,
  theme: string,
  advancedParams: RoguelikeAdvancedParams,
): RoguelikeAdvancedParams {
  if (!isKnownRoguelikeTheme(taskId, theme)) return advancedParams
  return normalizeRoguelikeModeForTheme(taskId, theme, advancedParams)
}

/**
 * 主题切换后把当前主题不再支持的模式重置为该主题声明的默认模式；没有默认值时才回落到首项
 * （集成战略的刷坍缩范式只对萨米开放，沙洲遗闻的默认模式是 `1` 而首项是 `0`）。
 * 其余字段保留原值；仍生效但越界的下拉值交由执行前校验拒绝。
 */
export function normalizeRoguelikeModeForTheme(
  taskId: string,
  theme: string,
  advancedParams: RoguelikeAdvancedParams,
): RoguelikeAdvancedParams {
  const modeOption = getRoguelikeAdvancedOptions(taskId).find(option => option.key === 'mode')
  if (!modeOption) return advancedParams

  const advanced = advancedParams[taskId] ?? {}
  const mode = resolveModeValue(taskId, theme, advanced)
  if (!mode) return advancedParams

  const choices = getRoguelikeOptionChoices(modeOption, theme, taskId) ?? []
  if (choices.some(choice => choice.value === mode)) return advancedParams
  const fallback = resolveOptionDefault(modeOption, theme, taskId) ?? choices[0]?.value ?? ''
  return { ...advancedParams, [taskId]: { ...advanced, mode: fallback } }
}

/** 列表参数按逗号、顿号、分号与空白切分；空串与重复分隔符不产生参数。 */
export function splitRoguelikeListValue(value: unknown): string[] {
  if (typeof value !== 'string' && typeof value !== 'number') return []
  return String(value)
    .split(/[，,、;；\s]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

/**
 * 补齐声明了默认值但缺失或为空的字段。返回新对象，且只在确有补齐时复制；
 * 不修改入参，无变化时返回原引用以便草稿等价判断保持稳定。
 * 传入任务输入时按当前主题解析默认值，旧草稿没有模式字段也能落到该主题的合法首项。
 */
export function normalizeRoguelikeAdvancedParams(
  advancedParams: RoguelikeAdvancedParams,
  taskInputs: RoguelikeTaskInputs = {},
): RoguelikeAdvancedParams {
  let normalized: RoguelikeAdvancedParams | null = null

  for (const { id: taskId } of ROGUELIKE_TASKS) {
    const defaults = getRoguelikeAdvancedOptions(taskId)
      .filter(option => option.defaultValue !== undefined)
    if (defaults.length === 0) continue

    const theme = (taskInputs[taskId] || '').trim()
    const current = advancedParams[taskId]
    let taskValues: RoguelikeAdvancedValues | null = null
    for (const option of defaults) {
      const value = current?.[option.key]
      if (value !== undefined && value !== '') continue
      const resolved = resolveOptionDefault(option, theme, taskId)
      if (resolved === undefined) continue
      if (taskValues === null) taskValues = { ...current }
      taskValues[option.key] = resolved
    }
    if (taskValues === null) continue

    if (normalized === null) normalized = { ...advancedParams }
    normalized[taskId] = taskValues
  }

  return normalized ?? advancedParams
}

const NEGATIVE_INTEGER = /^-\d+$/

/** clap 会把空格分隔的负数当成未知选项，数字取值出现负数时改用 `=` 连成单 token。 */
function appendOptionValue(params: string, param: string, value: string): string {
  return NEGATIVE_INTEGER.test(value) ? `${params} ${param}=${value}` : `${params} ${param} ${value}`
}

/**
 * 拼接执行参数：主题代号在前，字段按字段表顺序追加。
 * 空字符串、未勾选的 checkbox、未设置的字段、当前主题/模式不适用的字段、
 * 越界的下拉值与非法整数不写入；声明了默认值的字段在缺失或为空时解析为默认值并始终写入。
 * 只能通过动态任务下发的字段（没有 CLI 参数名）不写进命令行。
 */
export function buildRoguelikeCommandParams(
  taskId: string,
  taskInputs: RoguelikeTaskInputs,
  advancedParams: RoguelikeAdvancedParams,
): string {
  const theme = taskInputs[taskId] || ''
  const advanced = advancedParams[taskId] || {}
  let params = theme

  for (const { option, value } of readActiveRoguelikeOptions(taskId, theme, advanced)) {
    if (!option.param) continue
    if (option.type === 'select' && !isRoguelikeOptionValueValid(option, theme, value, taskId)) continue

    if (option.type === 'checkbox') {
      if (value === true) params += ` ${option.param}`
      continue
    }

    if (option.type === 'number') {
      if (getRoguelikeNumberError(option, value)) continue
      const numeric = String(value).trim()
      if (numeric === '') continue
      params = appendOptionValue(params, option.param, numeric)
      continue
    }

    if (option.type === 'list') {
      if (getRoguelikeListError(option, value)) continue
      for (const item of splitRoguelikeListValue(value)) params += ` ${option.param} ${item}`
      continue
    }

    if (option.type === 'select') {
      params = appendOptionValue(params, option.param, String(value))
      continue
    }

    params += ` ${option.param} ${value}`
  }

  return params
}
