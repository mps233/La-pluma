import { describe, expect, it } from 'vitest'
import type { RoguelikeAdvancedParams, RoguelikeTaskInputs } from '../types'
import { validateRoguelikeTaskInput, validateRoguelikeTaskInputError } from './roguelikeValidation'

const validateError = (
  taskId: string,
  taskInputs: RoguelikeTaskInputs,
  advancedParams: RoguelikeAdvancedParams = {},
) => validateRoguelikeTaskInputError(taskId, taskInputs, advancedParams)

describe('validateRoguelikeTaskInputError', () => {
  it('maps an empty theme to the theme field', () => {
    expect(validateError('roguelike', {})).toEqual({ key: 'theme', message: '请输入主题名称' })
    expect(validateError('roguelike', { roguelike: '   ' }))
      .toEqual({ key: 'theme', message: '请输入主题名称' })
  })

  it('maps an unknown theme to the theme field', () => {
    expect(validateError('roguelike', { roguelike: 'Unknown' })).toEqual({
      key: 'theme',
      message: '未知主题「Unknown」，支持：Phantom、Mizuki、Sami、Sarkaz、JieGarden、BlackFlow',
    })
  })

  it('maps effective select, number and list errors to their option keys', () => {
    expect(validateError('roguelike', { roguelike: 'Sami' }, {
      roguelike: { squad: '蓝图测绘分队' },
    })).toEqual({
      key: 'squad',
      message: '起始分队「蓝图测绘分队」不在当前主题的可选范围内，请重新选择',
    })
    expect(validateError('roguelike', { roguelike: 'Sarkaz' }, {
      roguelike: { startCount: '1.5' },
    })).toEqual({ key: 'startCount', message: '运行次数需为整数' })
    expect(validateError('roguelike', { roguelike: 'BlackFlow' }, {
      roguelike: { mode: '30003', blackflowStartAnimals: '不存在的动物' },
    })).toEqual({ key: 'blackflowStartAnimals', message: '开局动物组合「不存在的动物」不是可选值' })
    expect(validateError('roguelike', { roguelike: 'Sami' }, {
      roguelike: { mode: '10001' },
    })).toEqual({ key: 'mode', message: '模式「10001」不在当前主题的可选范围内，请重新选择' })
  })

  it('maps the mode-specific requirements to their fields', () => {
    expect(validateError('roguelike', { roguelike: 'Sami' }, {
      roguelike: { mode: '5' },
    })).toEqual({
      key: 'expectedCollapsalParadigms',
      message: '刷坍缩范式模式需要填写期望坍缩范式',
    })
    expect(validateError('roguelike', { roguelike: 'JieGarden' }, {
      roguelike: { mode: '20001' },
    })).toEqual({
      key: 'findPlayTimeTarget',
      message: '刷常乐节点模式需要选择目标常乐节点',
    })
  })

  it('maps the reclamation crafting requirements to their fields', () => {
    expect(validateError('reclamation', { reclamation: 'Tales' }, {
      reclamation: { numBatches: '16' },
    })).toEqual({
      key: 'toolsToCraft',
      message: '请填写「制作工具名称」：留空时 maa-cli 会默认制作 16 批荧光棒',
    })
    expect(validateError('reclamation', { reclamation: 'Tales' }, {
      reclamation: { toolsToCraft: '荧光棒' },
    })).toEqual({
      key: 'numBatches',
      message: '请填写「批次数」：留空时 maa-cli 会默认制作 16 批',
    })
  })

  it('maps a cultivation target outside its strategy to the cultivation field', () => {
    expect(validateError('roguelike', { roguelike: 'BlackFlow' }, {
      roguelike: { mode: '0', blackflowStrategy: 'burn', blackflowCultivationTarget: 'swaddled_cat' },
    })).toEqual({
      key: 'blackflowCultivationTarget',
      message: '培育目标动物仅在黑流策略为培育襁褓动物时生效，请调整策略或清空该字段',
    })
  })

  it('returns null for valid input and unknown tasks', () => {
    expect(validateError('roguelike', { roguelike: 'Phantom' })).toBeNull()
    expect(validateError('reclamation', { reclamation: 'Tales' }, { reclamation: { mode: '0' } }))
      .toBeNull()
    expect(validateError('unknown', {})).toBeNull()
  })
})

describe('validateRoguelikeTaskInput', () => {
  it('returns the message of the structured error', () => {
    expect(validateRoguelikeTaskInput('roguelike', {})).toBe('请输入主题名称')
    expect(validateRoguelikeTaskInput('roguelike', { roguelike: 'Sami' }, {
      roguelike: { mode: '5' },
    })).toBe('刷坍缩范式模式需要填写期望坍缩范式')
    expect(validateRoguelikeTaskInput('roguelike', { roguelike: 'Phantom' })).toBeNull()
  })
})
