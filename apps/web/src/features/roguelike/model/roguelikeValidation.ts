import type { RoguelikeAdvancedParams, RoguelikeAdvancedValues, RoguelikeTaskInputs } from '../types'
import {
  getRoguelikeAdvancedOptions,
  getRoguelikeListError,
  getRoguelikeNumberError,
  getThemesForTask,
  isKnownRoguelikeTheme,
  isRoguelikeOptionValueValid,
  pickAdvancedValue,
  readActiveRoguelikeOptions,
  resolveModeValue,
  splitRoguelikeListValue,
} from './roguelikeTasks'

export interface RoguelikeFieldError {
  key: string
  message: string
}

function findInvalidOptionValue(
  taskId: string,
  theme: string,
  advanced: RoguelikeAdvancedValues,
): RoguelikeFieldError | null {
  for (const { option, value } of readActiveRoguelikeOptions(taskId, theme, advanced)) {
    if (option.type === 'number') {
      const error = getRoguelikeNumberError(option, value)
      if (error) return { key: option.key, message: error }
      continue
    }

    if (option.type === 'list') {
      const error = getRoguelikeListError(option, value)
      if (error) return { key: option.key, message: error }
      continue
    }

    if (option.type !== 'select') continue
    if (isRoguelikeOptionValueValid(option, theme, value, taskId)) continue
    return {
      key: option.key,
      message: `${option.label}「${String(value)}」不在当前主题的可选范围内，请重新选择`,
    }
  }
  return null
}

function pickOptionValue(
  taskId: string,
  theme: string,
  advanced: RoguelikeAdvancedValues,
  key: string,
): string {
  const option = getRoguelikeAdvancedOptions(taskId).find(candidate => candidate.key === key)
  if (!option) return ''
  const value = pickAdvancedValue(option, advanced, theme, taskId)
  return value === undefined || value === false ? '' : String(value)
}

function listValue(advanced: RoguelikeAdvancedValues, key: string): string[] {
  return splitRoguelikeListValue(advanced[key])
}

/** 执行前校验；返回首个无效字段及其消息，null 表示可以提交。 */
export function validateRoguelikeTaskInputError(
  taskId: string,
  taskInputs: RoguelikeTaskInputs,
  advancedParams: RoguelikeAdvancedParams = {},
): RoguelikeFieldError | null {
  if (taskId !== 'roguelike' && taskId !== 'reclamation') return null
  if (!(taskInputs[taskId] || '').trim()) return { key: 'theme', message: '请输入主题名称' }

  const theme = (taskInputs[taskId] || '').trim()
  if (!isKnownRoguelikeTheme(taskId, theme)) {
    return {
      key: 'theme',
      message: `未知主题「${theme}」，支持：${getThemesForTask(taskId).join('、')}`,
    }
  }

  const advanced = advancedParams[taskId] ?? {}
  const invalidValue = findInvalidOptionValue(taskId, theme, advanced)
  if (invalidValue) return invalidValue

  if (taskId !== 'roguelike') {
    if (resolveModeValue('reclamation', theme, advanced) !== '1') return null
    if (!pickOptionValue('reclamation', theme, advanced, 'toolsToCraft')) {
      return {
        key: 'toolsToCraft',
        message: '请填写「制作工具名称」：留空时 maa-cli 会默认制作 16 批荧光棒',
      }
    }
    if (!pickOptionValue('reclamation', theme, advanced, 'numBatches')) {
      return {
        key: 'numBatches',
        message: '请填写「批次数」：留空时 maa-cli 会默认制作 16 批',
      }
    }
    return null
  }

  const mode = resolveModeValue('roguelike', theme, advanced)
  if (mode === '5' && listValue(advanced, 'expectedCollapsalParadigms').length === 0) {
    return { key: 'expectedCollapsalParadigms', message: '刷坍缩范式模式需要填写期望坍缩范式' }
  }
  if (mode === '20001' && !pickOptionValue('roguelike', theme, advanced, 'findPlayTimeTarget')) {
    return { key: 'findPlayTimeTarget', message: '刷常乐节点模式需要选择目标常乐节点' }
  }
  if (mode === '0') {
    const strategy = pickOptionValue('roguelike', theme, advanced, 'blackflowStrategy')
    const cultivationTarget = pickOptionValue('roguelike', theme, advanced, 'blackflowCultivationTarget')
    if (cultivationTarget && strategy !== 'baby_animal') {
      return {
        key: 'blackflowCultivationTarget',
        message: '培育目标动物仅在黑流策略为培育襁褓动物时生效，请调整策略或清空该字段',
      }
    }
  }
  return null
}

/** 执行前校验；返回 null 表示可以提交。 */
export function validateRoguelikeTaskInput(
  taskId: string,
  taskInputs: RoguelikeTaskInputs,
  advancedParams: RoguelikeAdvancedParams = {},
): string | null {
  return validateRoguelikeTaskInputError(taskId, taskInputs, advancedParams)?.message ?? null
}
