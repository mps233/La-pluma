import { describe, expect, it } from 'vitest'
import type { RoguelikeAdvancedParams, RoguelikeAdvancedValues } from '../types'
import {
  DEFAULT_RECLAMATION_MODE,
  DEFAULT_ROGUELIKE_MODE,
  ROGUELIKE_TASKS,
  ROGUELIKE_THEME_PRESETS,
  buildRoguelikeCommandParams,
  getRoguelikeAdvancedOptions,
  getRoguelikeOptionChoices,
  isRoguelikeOptionVisible,
  normalizeRoguelikeAdvancedParams,
  normalizeRoguelikeModeForKnownTheme,
  normalizeRoguelikeModeForTheme,
  resolveRoguelikeAdvancedValue,
  splitRoguelikeListValue,
} from './roguelikeTasks'
import { buildRoguelikeExecutionPlan, requiresRoguelikeDynamicTask } from './roguelikeExecution'
import { validateRoguelikeTaskInput } from './roguelikeValidation'

const option = (key: string, taskId = 'roguelike') =>
  getRoguelikeAdvancedOptions(taskId).find(candidate => candidate.key === key)!

describe('roguelike task catalog', () => {
  it('keeps both modes and their execution commands', () => {
    expect(DEFAULT_ROGUELIKE_MODE).toBe('roguelike')
    expect(ROGUELIKE_TASKS.map(task => ({
      id: task.id,
      name: task.name,
      command: task.command,
    }))).toEqual([
      { id: 'roguelike', name: '集成战略', command: 'roguelike' },
      { id: 'reclamation', name: '生息演算', command: 'reclamation' },
    ])
  })

  it('provides the theme presets shown for each mode', () => {
    expect(ROGUELIKE_THEME_PRESETS.roguelike.map(theme => theme.value))
      .toEqual(['Phantom', 'Mizuki', 'Sami', 'Sarkaz', 'JieGarden', 'BlackFlow'])
    expect(ROGUELIKE_THEME_PRESETS.reclamation).toEqual([
      { value: 'Tales', label: '沙洲遗闻' },
      { value: 'RelaunchAnchor', label: '重启锚点' },
    ])
  })

  it('keeps the advanced option tables and their CLI parameters', () => {
    expect(getRoguelikeAdvancedOptions('roguelike').map(entry => [entry.key, entry.param]))
      .toEqual([
        ['mode', '--mode'],
        ['difficulty', '--difficulty'],
        ['squad', '--squad'],
        ['roles', '--roles'],
        ['coreChar', '--core-char'],
        ['startCount', '--start-count'],
        ['investmentsCount', '--investments-count'],
        ['startFoldartals', '--start-foldartals'],
        ['expectedCollapsalParadigms', '--expected-collapsal-paradigms'],
        ['useSupport', '--use-support'],
        ['useNonfriendSupport', '--use-nonfriend-support'],
        ['disableInvestment', '--disable-investment'],
        ['investmentWithMoreScore', '--investment-with-more-score'],
        ['noStopWhenInvestmentFull', '--no-stop-when-investment-full'],
        ['startWithEliteTwo', '--start-with-elite-two'],
        ['onlyStartWithEliteTwo', '--only-start-with-elite-two'],
        ['stopAtBoss', '--stop-at-final-boss'],
        ['stopAtMaxLevel', undefined],
        ['refreshTraderWithDice', '--refresh-trader-with-dice'],
        ['useFoldartal', '--use-foldartal'],
        ['firstFloorFoldartal', undefined],
        ['monthlySquadAutoIterate', undefined],
        ['monthlySquadCheckComms', undefined],
        ['deepExplorationAutoIterate', undefined],
        ['collectibleModeShopping', undefined],
        ['collectibleModeSquad', undefined],
        ['findPlayTimeTarget', undefined],
        ['blackflowStrategy', undefined],
        ['blackflowCultivationTarget', undefined],
        ['blackflowStartAnimals', undefined],
        ['blackflowStartRewards', undefined],
        ['startWithSeed', '--start-with-seed'],
      ])
    expect(getRoguelikeAdvancedOptions('reclamation').map(entry => [entry.key, entry.param]))
      .toEqual([
        ['mode', '-m'],
        ['toolsToCraft', '-C'],
        ['incrementMode', '--increment-mode'],
        ['numBatches', '--num-craft-batches'],
        ['clearStore', undefined],
      ])
    expect(getRoguelikeAdvancedOptions('unknown')).toEqual([])
  })

  it('names the roguelike mode options after their MaaCore behavior', () => {
    const mode = option('mode')
    expect(getRoguelikeOptionChoices(mode, 'Phantom')).toEqual([
      { value: '0', label: '刷分模式' },
      { value: '1', label: '刷源石锭' },
      { value: '4', label: '刷开局' },
      { value: '6', label: '刷月度小队' },
      { value: '7', label: '刷深入调查' },
    ])
    expect((getRoguelikeOptionChoices(mode, 'Sami') ?? []).map(choice => choice.value))
      .toEqual(['0', '1', '4', '5', '6', '7'])
    expect((getRoguelikeOptionChoices(mode, 'Sarkaz') ?? []).map(choice => choice.value))
      .toEqual(['0', '1', '4', '6', '7', '10001'])
    expect((getRoguelikeOptionChoices(mode, 'JieGarden') ?? []).map(choice => choice.value))
      .toEqual(['0', '1', '4', '6', '7', '20001'])
    expect((getRoguelikeOptionChoices(mode, 'BlackFlow') ?? []).map(choice => choice.value))
      .toEqual(['0', '1', '30001', '30003'])
    expect((getRoguelikeOptionChoices(mode, 'BlackFlow') ?? []).map(choice => choice.label))
      .toEqual(['刷分模式', '刷源石锭', '刷襁褓动物', '刷开局（保留目标局）'])
  })

  it('offers the reclamation modes of both themes', () => {
    const mode = option('mode', 'reclamation')
    expect((getRoguelikeOptionChoices(mode, 'Tales', 'reclamation') ?? []).map(choice => choice.value))
      .toEqual(['0', '1'])
    expect((getRoguelikeOptionChoices(mode, 'RelaunchAnchor', 'reclamation') ?? []).map(choice => choice.value))
      .toEqual(['16', '32', '48'])
    expect(getRoguelikeOptionChoices(mode, 'RelaunchAnchor', 'reclamation')?.[0]?.label)
      .toContain('RA-1')
  })

  it('declares the reclamation mode default and its startup hint', () => {
    const reclamationMode = option('mode', 'reclamation')
    expect(reclamationMode.defaultValue).toBe(DEFAULT_RECLAMATION_MODE)
    expect(DEFAULT_RECLAMATION_MODE).toBe('1')
    expect(reclamationMode.hint).toContain('存档')
    expect(reclamationMode.hint).toContain('开始演算')
    expect(reclamationMode.hint).toContain('驻扎地')

    // 集成战略的 CLI 默认与界面首项一致，保持省略而不声明默认值。
    expect(option('mode').defaultValue).toBeUndefined()
  })

  it('defaults the starting roles to a combination that covers the common core operators', () => {
    const roles = option('roles')
    expect(roles.defaultValue).toBe('稳扎稳打')
    const choices = getRoguelikeOptionChoices(roles, 'Sarkaz') ?? []
    expect(choices[0]).toEqual({ value: '稳扎稳打', label: '稳扎稳打（重装、术师、狙击）' })
    expect(choices.map(choice => choice.value))
      .toEqual(['稳扎稳打', '先手必胜', '取长补短', '随心所欲'])
    expect(getRoguelikeOptionChoices(roles, 'JieGarden')?.map(choice => choice.value))
      .toEqual(['稳扎稳打', '先手必胜', '取长补短', '灵活部署', '坚不可摧', '随心所欲'])
  })

  it('offers theme squads plus the shared pool without duplicates', () => {
    const squads = getRoguelikeOptionChoices(option('squad'), 'Sarkaz') ?? []
    expect(squads[0]).toEqual({ value: '', label: '默认（指挥分队）' })
    const values = squads.map(choice => choice.value)
    expect(values).toContain('蓝图测绘分队')
    expect(values).toContain('指挥分队')
    expect(values).toContain('高规格分队')
    expect(new Set(values).size).toBe(values.length)

    expect(getRoguelikeOptionChoices(option('squad'), 'JieGarden')?.map(choice => choice.value))
      .toContain('特勤分队')
  })

  it('matches theme choices after trimming the theme input', () => {
    const mode = option('mode')
    expect(getRoguelikeOptionChoices(mode, ' Sami ')).toHaveLength(6)
    expect(getRoguelikeOptionChoices(option('squad'), 'Sarkaz ')).toContainEqual({
      value: '蓝图测绘分队',
      label: '蓝图测绘分队',
    })
  })

  it('lists numeric difficulty only for themes that have one', () => {
    const difficulty = option('difficulty')
    expect(difficulty.themes).not.toContain('Phantom')
    const choices = getRoguelikeOptionChoices(difficulty, 'Sami') ?? []
    expect(choices[0]).toEqual({ value: '-1', label: '不切换（沿用游戏内难度）' })
    expect(choices.map(choice => choice.value)).toContain('15')
    expect(choices[choices.length - 1]).toEqual({ value: '0', label: '0（最低）' })
  })
})

describe('isRoguelikeOptionVisible', () => {
  it('ties theme-specific switches to the active theme', () => {
    expect(isRoguelikeOptionVisible(option('useFoldartal'), 'roguelike', 'Sami', {})).toBe(true)
    expect(isRoguelikeOptionVisible(option('useFoldartal'), 'roguelike', 'Sarkaz', {})).toBe(false)
    expect(isRoguelikeOptionVisible(option('refreshTraderWithDice'), 'roguelike', 'Mizuki', {})).toBe(true)
    expect(isRoguelikeOptionVisible(option('startWithSeed'), 'roguelike', 'Sarkaz', {
      mode: '1',
      squad: '点刺成锭分队',
    })).toBe(true)
    expect(isRoguelikeOptionVisible(option('startWithSeed'), 'roguelike', 'Sarkaz', {
      mode: '1',
      squad: '后勤分队',
    })).toBe(true)
    expect(isRoguelikeOptionVisible(option('startWithSeed'), 'roguelike', 'Sarkaz', {
      mode: '1',
      squad: '指挥分队',
    })).toBe(false)
    expect(isRoguelikeOptionVisible(option('startWithSeed'), 'roguelike', 'Sarkaz', {
      mode: '0',
      squad: '点刺成锭分队',
    })).toBe(false)
    expect(isRoguelikeOptionVisible(option('startWithSeed'), 'roguelike', 'Sami', {
      mode: '1',
      squad: '点刺成锭分队',
    })).toBe(false)
    expect(isRoguelikeOptionVisible(option('difficulty'), 'roguelike', 'Phantom', {})).toBe(false)
  })

  it('ties mode-specific fields to the resolved mode', () => {
    expect(isRoguelikeOptionVisible(option('expectedCollapsalParadigms'), 'roguelike', 'Sami', { mode: '5' }))
      .toBe(true)
    expect(isRoguelikeOptionVisible(option('expectedCollapsalParadigms'), 'roguelike', 'Sami', { mode: '0' }))
      .toBe(false)
    expect(isRoguelikeOptionVisible(option('startWithEliteTwo'), 'roguelike', 'Sarkaz', { mode: '4' })).toBe(true)
    expect(isRoguelikeOptionVisible(option('startWithEliteTwo'), 'roguelike', 'Sarkaz', { mode: '0' })).toBe(false)
    expect(isRoguelikeOptionVisible(option('stopAtBoss'), 'roguelike', 'Sarkaz', {})).toBe(true)
    expect(isRoguelikeOptionVisible(option('stopAtBoss'), 'roguelike', 'Sarkaz', { mode: '1' })).toBe(false)
  })

  it('ties the starting foldartals to the Sami collectible mode and squad', () => {
    const foldartals = option('startFoldartals')
    expect(isRoguelikeOptionVisible(foldartals, 'roguelike', 'Sami', {
      mode: '4',
      squad: '生活至上分队',
    })).toBe(true)
    expect(isRoguelikeOptionVisible(foldartals, 'roguelike', 'Sami', {
      mode: '4',
      squad: '指挥分队',
    })).toBe(false)
    expect(isRoguelikeOptionVisible(foldartals, 'roguelike', 'Sami', {
      mode: '0',
      squad: '生活至上分队',
    })).toBe(false)
    expect(isRoguelikeOptionVisible(foldartals, 'roguelike', 'Sarkaz', {
      mode: '4',
      squad: '生活至上分队',
    })).toBe(false)
  })

  it('ties reclamation tool crafting fields to mode 1', () => {
    for (const key of ['toolsToCraft', 'numBatches']) {
      expect(isRoguelikeOptionVisible(option(key, 'reclamation'), 'reclamation', 'Tales', { mode: '1' }))
        .toBe(true)
      expect(isRoguelikeOptionVisible(option(key, 'reclamation'), 'reclamation', 'Tales', { mode: '0' }))
        .toBe(false)
    }
  })

  it('ties the investment score option to the investment mode', () => {
    const moreScore = option('investmentWithMoreScore')
    expect(isRoguelikeOptionVisible(moreScore, 'roguelike', 'Sarkaz', { mode: '1' })).toBe(true)
    expect(isRoguelikeOptionVisible(moreScore, 'roguelike', 'Sarkaz', { mode: '0' })).toBe(false)
    expect(isRoguelikeOptionVisible(moreScore, 'roguelike', 'Sarkaz', { mode: '4' })).toBe(false)
    expect(isRoguelikeOptionVisible(moreScore, 'roguelike', 'Sarkaz', {
      mode: '1',
      disableInvestment: true,
    })).toBe(false)
  })

  it('follows the field a switch depends on, including the default-off case', () => {
    const investmentsCount = option('investmentsCount')
    expect(isRoguelikeOptionVisible(investmentsCount, 'roguelike', 'Sarkaz', {})).toBe(true)
    expect(isRoguelikeOptionVisible(investmentsCount, 'roguelike', 'Sarkaz', { disableInvestment: true }))
      .toBe(false)

    const onlyEliteTwo = option('onlyStartWithEliteTwo')
    expect(isRoguelikeOptionVisible(onlyEliteTwo, 'roguelike', 'Sarkaz', { mode: '4' })).toBe(false)
    expect(isRoguelikeOptionVisible(onlyEliteTwo, 'roguelike', 'Sarkaz', {
      mode: '4',
      startWithEliteTwo: true,
    })).toBe(true)

    const nonfriendSupport = option('useNonfriendSupport')
    expect(isRoguelikeOptionVisible(nonfriendSupport, 'roguelike', 'Sarkaz', {})).toBe(false)
    expect(isRoguelikeOptionVisible(nonfriendSupport, 'roguelike', 'Sarkaz', { useSupport: true })).toBe(true)
  })
})

describe('buildRoguelikeCommandParams', () => {
  it('appends configured values in option order and always writes the role default', () => {
    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Phantom' },
      {
        roguelike: {
          mode: '1',
          squad: '指挥分队',
          coreChar: '',
          startCount: 3,
          useSupport: true,
          stopAtBoss: false,
        },
      },
    )).toBe('Phantom --mode 1 --squad 指挥分队 --roles 稳扎稳打 --start-count 3 --use-support')
  })

  it('writes the core operator as one unchanged Chinese name value', () => {
    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Phantom' },
      { roguelike: { coreChar: '维什戴尔' } },
    )).toBe('Phantom --roles 稳扎稳打 --core-char 维什戴尔')
  })

  it('omits empty values, unchecked checkboxes and fields the theme does not support', () => {
    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sarkaz' },
      {
        roguelike: {
          mode: '',
          useSupport: false,
          useFoldartal: true,
          refreshTraderWithDice: true,
        },
      },
    )).toBe('Sarkaz --roles 稳扎稳打')
  })

  it('keeps fields the active theme supports', () => {
    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sami' },
      { roguelike: { useFoldartal: true, difficulty: '6' } },
    )).toBe('Sami --difficulty 6 --roles 稳扎稳打 --use-foldartal')
  })

  it('joins a negative difficulty to the option name as one CLI token', () => {
    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sarkaz' },
      { roguelike: { difficulty: '-1' } },
    )).toBe('Sarkaz --difficulty=-1 --roles 稳扎稳打')
  })

  it('keeps zero and positive difficulty as separate value tokens', () => {
    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sarkaz' },
      { roguelike: { difficulty: '0' } },
    )).toBe('Sarkaz --difficulty 0 --roles 稳扎稳打')

    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sarkaz' },
      { roguelike: { difficulty: '18' } },
    )).toBe('Sarkaz --difficulty 18 --roles 稳扎稳打')
  })

  it('passes the specified seed as an option value', () => {
    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sarkaz' },
      { roguelike: { mode: '1', squad: '点刺成锭分队', startWithSeed: '2b3c4d,rogue_1,120' } },
    )).toBe('Sarkaz --mode 1 --squad 点刺成锭分队 --roles 稳扎稳打 --start-with-seed 2b3c4d,rogue_1,120')
  })

  it('writes starting foldartals only for the Sami collectible squad', () => {
    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sami' },
      { roguelike: { mode: '4', squad: '生活至上分队', startFoldartals: '英雄，大地' } },
    )).toBe('Sami --mode 4 --squad 生活至上分队 --roles 稳扎稳打 --start-foldartals 英雄 --start-foldartals 大地')

    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sami' },
      { roguelike: { mode: '4', squad: '指挥分队', startFoldartals: '英雄' } },
    )).toBe('Sami --mode 4 --squad 指挥分队 --roles 稳扎稳打')

    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sami' },
      { roguelike: { mode: '0', squad: '生活至上分队', startFoldartals: '英雄' } },
    )).toBe('Sami --mode 0 --squad 生活至上分队 --roles 稳扎稳打')
  })

  it('does not write select values outside the active theme choices', () => {
    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sami' },
      { roguelike: { squad: '蓝图测绘分队', difficulty: '18' } },
    )).toBe('Sami --roles 稳扎稳打')

    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sarkaz' },
      { roguelike: { roles: '灵活部署' } },
    )).toBe('Sarkaz')
  })

  it('writes integer options and drops malformed numbers', () => {
    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sarkaz' },
      { roguelike: { startCount: ' 3 ', investmentsCount: 2 } },
    )).toBe('Sarkaz --roles 稳扎稳打 --start-count 3 --investments-count 2')

    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sarkaz' },
      { roguelike: { startCount: '1.5', investmentsCount: '2' } },
    )).toBe('Sarkaz --roles 稳扎稳打 --investments-count 2')

    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sarkaz' },
      { roguelike: { startCount: '-1' } },
    )).toBe('Sarkaz --roles 稳扎稳打')
  })

  it('writes list fields once per value', () => {
    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sami' },
      { roguelike: { mode: '5', expectedCollapsalParadigms: '目空一些，图像损坏' } },
    )).toBe('Sami --mode 5 --roles 稳扎稳打 --expected-collapsal-paradigms 目空一些 --expected-collapsal-paradigms 图像损坏')
  })

  it('writes the investment score option only in the investment mode', () => {
    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sarkaz' },
      { roguelike: { mode: '1', investmentWithMoreScore: true } },
    )).toBe('Sarkaz --mode 1 --roles 稳扎稳打 --investment-with-more-score')

    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sarkaz' },
      { roguelike: { mode: '0', investmentWithMoreScore: true } },
    )).toBe('Sarkaz --mode 0 --roles 稳扎稳打')
  })

  it('passes the monthly squad and deep exploration modes to the CLI', () => {
    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Mizuki' },
      { roguelike: { mode: '6' } },
    )).toBe('Mizuki --mode 6 --roles 稳扎稳打')

    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sarkaz' },
      { roguelike: { mode: '7' } },
    )).toBe('Sarkaz --mode 7 --roles 稳扎稳打')
  })

  it('keeps mode-specific switches out of other modes', () => {
    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sarkaz' },
      { roguelike: { mode: '4', startWithEliteTwo: true, onlyStartWithEliteTwo: true, stopAtBoss: true } },
    )).toBe('Sarkaz --mode 4 --roles 稳扎稳打 --start-with-elite-two --only-start-with-elite-two')

    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Sarkaz' },
      { roguelike: { stopAtBoss: true } },
    )).toBe('Sarkaz --roles 稳扎稳打 --stop-at-final-boss')
  })

  it('still passes mode 4 as --mode 4 under its new name', () => {
    expect(buildRoguelikeCommandParams(
      'roguelike',
      { roguelike: 'Phantom' },
      { roguelike: { mode: '4', squad: '突击战术分队' } },
    )).toBe('Phantom --mode 4 --squad 突击战术分队 --roles 稳扎稳打')
  })

  it('builds reclamation commands with its own parameters', () => {
    expect(buildRoguelikeCommandParams(
      'reclamation',
      { reclamation: 'Tales' },
      { reclamation: { mode: '1', toolsToCraft: '荧光棒', numBatches: 2 } },
    )).toBe('Tales -m 1 -C 荧光棒 --num-craft-batches 2')
  })

  it('omits the tool crafting fields in reclamation mode 0', () => {
    expect(buildRoguelikeCommandParams(
      'reclamation',
      { reclamation: 'Tales' },
      { reclamation: { mode: '0', toolsToCraft: '荧光棒', numBatches: 2 } },
    )).toBe('Tales -m 0')
  })

  it('always writes the reclamation mode, falling back to the declared default', () => {
    const build = (advancedParams: Parameters<typeof buildRoguelikeCommandParams>[2]) =>
      buildRoguelikeCommandParams('reclamation', { reclamation: 'Tales' }, advancedParams)

    expect(build({})).toBe('Tales -m 1')
    expect(build({ reclamation: { toolsToCraft: '' } })).toBe('Tales -m 1')
    expect(build({ reclamation: { mode: '' } })).toBe('Tales -m 1')
    expect(build({ reclamation: { mode: '0' } })).toBe('Tales -m 0')
    expect(build({ reclamation: { mode: '1' } })).toBe('Tales -m 1')
    expect(build({ reclamation: { mode: 0 } })).toBe('Tales -m 0')
  })

  it('does not mutate the inputs it receives', () => {
    const taskInputs = { roguelike: 'Phantom' }
    const advancedParams = { roguelike: { mode: '1' } }

    buildRoguelikeCommandParams('roguelike', taskInputs, advancedParams)

    expect(taskInputs).toEqual({ roguelike: 'Phantom' })
    expect(advancedParams).toEqual({ roguelike: { mode: '1' } })
  })
})

describe('resolveRoguelikeAdvancedValue', () => {
  it('resolves a missing or empty value to the declared default', () => {
    expect(resolveRoguelikeAdvancedValue(option('mode', 'reclamation'), {}))
      .toBe(DEFAULT_RECLAMATION_MODE)
    expect(resolveRoguelikeAdvancedValue(option('mode', 'reclamation'), { mode: '' }))
      .toBe(DEFAULT_RECLAMATION_MODE)
    expect(resolveRoguelikeAdvancedValue(option('roles'), {})).toBe('稳扎稳打')
  })

  it('keeps an explicit value over the declared default', () => {
    expect(resolveRoguelikeAdvancedValue(option('mode', 'reclamation'), { mode: '0' })).toBe('0')
    expect(resolveRoguelikeAdvancedValue(option('roles'), { roles: '先手必胜' })).toBe('先手必胜')
  })

  it('keeps the first choice of the active theme for selects without a declared default', () => {
    expect(resolveRoguelikeAdvancedValue(option('mode'), {}, 'Sarkaz')).toBe('0')
    expect(resolveRoguelikeAdvancedValue(option('difficulty'), {}, 'Sarkaz')).toBe('-1')
    expect(resolveRoguelikeAdvancedValue(option('squad'), {})).toBe('')
  })
})

describe('splitRoguelikeListValue', () => {
  it('splits on common separators and drops empty items', () => {
    expect(splitRoguelikeListValue('英雄,大地、目空一些；图像损坏  '))
      .toEqual(['英雄', '大地', '目空一些', '图像损坏'])
    expect(splitRoguelikeListValue('')).toEqual([])
    expect(splitRoguelikeListValue(undefined)).toEqual([])
  })
})

describe('normalizeRoguelikeAdvancedParams', () => {
  it('fills declared defaults without overriding explicit values', () => {
    expect(normalizeRoguelikeAdvancedParams({}))
      .toEqual({ roguelike: { roles: '稳扎稳打' }, reclamation: { mode: '1' } })
    expect(normalizeRoguelikeAdvancedParams({ reclamation: { mode: '' } }))
      .toEqual({ roguelike: { roles: '稳扎稳打' }, reclamation: { mode: '1' } })
    expect(normalizeRoguelikeAdvancedParams({ reclamation: { mode: '0' } }))
      .toEqual({ roguelike: { roles: '稳扎稳打' }, reclamation: { mode: '0' } })
    expect(normalizeRoguelikeAdvancedParams({ roguelike: { roles: '取长补短' } }))
      .toEqual({ roguelike: { roles: '取长补短' }, reclamation: { mode: '1' } })
    expect(normalizeRoguelikeAdvancedParams({ roguelike: { mode: '1' } }))
      .toEqual({ roguelike: { mode: '1', roles: '稳扎稳打' }, reclamation: { mode: '1' } })
  })

  it('returns the same reference when the draft is already normalized', () => {
    const advancedParams = { roguelike: { roles: '稳扎稳打' }, reclamation: { mode: '1' } }
    expect(normalizeRoguelikeAdvancedParams(advancedParams)).toBe(advancedParams)
  })

  it('does not mutate the inputs it receives', () => {
    const advancedParams = { roguelike: { mode: '1' } }

    normalizeRoguelikeAdvancedParams(advancedParams)

    expect(advancedParams).toEqual({ roguelike: { mode: '1' } })
  })
})

describe('normalizeRoguelikeModeForTheme', () => {
  it('drops a mode the new theme does not support and keeps the rest', () => {
    expect(normalizeRoguelikeModeForTheme('roguelike', 'Sarkaz', {
      roguelike: { mode: '5', expectedCollapsalParadigms: '目空一些', squad: '蓝图测绘分队' },
    })).toEqual({
      roguelike: { mode: '0', expectedCollapsalParadigms: '目空一些', squad: '蓝图测绘分队' },
    })
  })

  it('keeps a supported mode and untouched drafts', () => {
    const supported = { roguelike: { mode: '5' } }
    expect(normalizeRoguelikeModeForTheme('roguelike', 'Sami', supported)).toBe(supported)

    const talesModeZero = { reclamation: { mode: '0' } }
    expect(normalizeRoguelikeModeForTheme('reclamation', 'Tales', talesModeZero)).toBe(talesModeZero)

    const relaunchMode = { reclamation: { mode: '32' } }
    expect(normalizeRoguelikeModeForTheme('reclamation', 'RelaunchAnchor', relaunchMode)).toBe(relaunchMode)

    const untouched = { roguelike: { mode: '4' } }
    expect(normalizeRoguelikeModeForTheme('reclamation', 'Tales', untouched)).toBe(untouched)
  })

  it('resets an unsupported reclamation mode to the declared default instead of the first choice', () => {
    const draft = { reclamation: { mode: '16', toolsToCraft: '荧光棒' } }

    expect(normalizeRoguelikeModeForTheme('reclamation', 'Tales', draft))
      .toEqual({ reclamation: { mode: '1', toolsToCraft: '荧光棒' } })
    expect(draft).toEqual({ reclamation: { mode: '16', toolsToCraft: '荧光棒' } })
  })

  it.each([
    ['roguelike', 'Phantom', '5', '0'],
    ['roguelike', 'Mizuki', '5', '0'],
    ['roguelike', 'Sami', '10001', '0'],
    ['roguelike', 'Sarkaz', '5', '0'],
    ['roguelike', 'JieGarden', '5', '0'],
    ['roguelike', 'BlackFlow', '5', '0'],
    ['reclamation', 'Tales', '16', '1'],
    ['reclamation', 'RelaunchAnchor', '0', '16'],
    ['reclamation', 'RelaunchAnchor', '1', '16'],
  ] as const)(
    'resets %s mode when switching to the %s theme',
    (taskId, theme, mode, expectedMode) => {
      const retained: RoguelikeAdvancedValues = taskId === 'reclamation'
        ? { toolsToCraft: '荧光棒' }
        : { startCount: '3' }
      const draft: RoguelikeAdvancedParams = { [taskId]: { ...retained, mode } }

      expect(normalizeRoguelikeModeForTheme(taskId, theme, draft))
        .toEqual({ [taskId]: { ...retained, mode: expectedMode } })
      expect(draft).toEqual({ [taskId]: { ...retained, mode } })
    },
  )
})

describe('normalizeRoguelikeModeForKnownTheme', () => {
  it('leaves the draft untouched while the theme is unknown or still being typed', () => {
    const roguelikeDraft: RoguelikeAdvancedParams = {
      roguelike: { mode: '5', expectedCollapsalParadigms: '目空一些' },
    }
    for (const theme of ['', '   ', 'S', 'Sark']) {
      expect(normalizeRoguelikeModeForKnownTheme('roguelike', theme, roguelikeDraft))
        .toBe(roguelikeDraft)
    }

    const reclamationDraft: RoguelikeAdvancedParams = { reclamation: { mode: '1' } }
    expect(normalizeRoguelikeModeForKnownTheme('reclamation', 'Relaunch', reclamationDraft))
      .toBe(reclamationDraft)
  })

  it('normalizes the mode once the theme is known', () => {
    const draft: RoguelikeAdvancedParams = {
      roguelike: { mode: '5', expectedCollapsalParadigms: '目空一些' },
    }
    expect(normalizeRoguelikeModeForKnownTheme('roguelike', 'Sarkaz', draft)).toEqual({
      roguelike: { mode: '0', expectedCollapsalParadigms: '目空一些' },
    })
    expect(draft).toEqual({ roguelike: { mode: '5', expectedCollapsalParadigms: '目空一些' } })

    const relaunch: RoguelikeAdvancedParams = { reclamation: { mode: '1' } }
    expect(normalizeRoguelikeModeForKnownTheme('reclamation', 'RelaunchAnchor', relaunch))
      .toEqual({ reclamation: { mode: '16' } })
    expect(relaunch).toEqual({ reclamation: { mode: '1' } })
  })

  it('keeps a supported mode and untouched drafts by reference', () => {
    const supported: RoguelikeAdvancedParams = { roguelike: { mode: '5' } }
    expect(normalizeRoguelikeModeForKnownTheme('roguelike', 'Sami', supported)).toBe(supported)

    const untouched: RoguelikeAdvancedParams = { roguelike: { mode: '4' } }
    expect(normalizeRoguelikeModeForKnownTheme('reclamation', 'Tales', untouched)).toBe(untouched)
  })
})

describe('validateRoguelikeTaskInput', () => {
  it('requires a non-empty theme for both modes', () => {
    expect(validateRoguelikeTaskInput('roguelike', {})).toBe('请输入主题名称')
    expect(validateRoguelikeTaskInput('roguelike', { roguelike: '   ' })).toBe('请输入主题名称')
    expect(validateRoguelikeTaskInput('reclamation', { reclamation: '' })).toBe('请输入主题名称')
  })

  it('rejects select values outside the active theme choices', () => {
    expect(validateRoguelikeTaskInput(
      'roguelike',
      { roguelike: 'Sami' },
      { roguelike: { squad: '蓝图测绘分队' } },
    )).toBe('起始分队「蓝图测绘分队」不在当前主题的可选范围内，请重新选择')
    expect(validateRoguelikeTaskInput(
      'roguelike',
      { roguelike: 'Sarkaz' },
      { roguelike: { roles: '灵活部署' } },
    )).toBe('开局职业组「灵活部署」不在当前主题的可选范围内，请重新选择')
    expect(validateRoguelikeTaskInput(
      'roguelike',
      { roguelike: 'Sami' },
      { roguelike: { difficulty: '18' } },
    )).toBe('难度「18」不在当前主题的可选范围内，请重新选择')
  })

  it('ignores invalid values of fields hidden by the active theme', () => {
    expect(validateRoguelikeTaskInput(
      'roguelike',
      { roguelike: 'Phantom' },
      { roguelike: { difficulty: '18' } },
    )).toBeNull()
    expect(validateRoguelikeTaskInput(
      'roguelike',
      { roguelike: 'Sami' },
      { roguelike: { squad: '永恒狩猎分队' } },
    )).toBeNull()
  })

  it('rejects non-integer and out-of-range numbers', () => {
    const inputs = { roguelike: 'Sarkaz' }
    expect(validateRoguelikeTaskInput('roguelike', inputs, { roguelike: { startCount: '1.5' } }))
      .toBe('运行次数需为整数')
    expect(validateRoguelikeTaskInput('roguelike', inputs, { roguelike: { startCount: '1e3' } }))
      .toBe('运行次数需为整数')
    expect(validateRoguelikeTaskInput('roguelike', inputs, { roguelike: { startCount: '-1' } }))
      .toBe('运行次数需在 1–2147483647 之间')
    expect(validateRoguelikeTaskInput('roguelike', inputs, { roguelike: { startCount: '0' } }))
      .toBe('运行次数需在 1–2147483647 之间')
    expect(validateRoguelikeTaskInput('roguelike', inputs, { roguelike: { startCount: '2147483648' } }))
      .toBe('运行次数需在 1–2147483647 之间')
    expect(validateRoguelikeTaskInput('roguelike', inputs, { roguelike: { investmentsCount: '2.5' } }))
      .toBe('投资次数需为整数')

    expect(validateRoguelikeTaskInput('roguelike', inputs, { roguelike: { startCount: '3' } }))
      .toBeNull()
    expect(validateRoguelikeTaskInput('roguelike', inputs, { roguelike: { startCount: '' } }))
      .toBeNull()
    expect(validateRoguelikeTaskInput('roguelike', inputs, { roguelike: { startCount: '   ' } }))
      .toBeNull()
  })

  it('validates the reclamation batch count only in mode 1', () => {
    const inputs = { reclamation: 'Tales' }
    expect(validateRoguelikeTaskInput('reclamation', inputs, {
      reclamation: { mode: '1', numBatches: '0' },
    })).toBe('批次数需在 1–2147483647 之间')
    expect(validateRoguelikeTaskInput('reclamation', inputs, {
      reclamation: { mode: '1', numBatches: '2.5' },
    })).toBe('批次数需为整数')
    expect(validateRoguelikeTaskInput('reclamation', inputs, {
      reclamation: { mode: '0', numBatches: '0' },
    })).toBeNull()
  })

  it('requires the expected collapsal paradigms in mode 5', () => {
    const inputs = { roguelike: 'Sami' }
    expect(validateRoguelikeTaskInput('roguelike', inputs, { roguelike: { mode: '5' } }))
      .toBe('刷坍缩范式模式需要填写期望坍缩范式')
    expect(validateRoguelikeTaskInput('roguelike', inputs, {
      roguelike: { mode: '5', expectedCollapsalParadigms: '目空一些' },
    })).toBeNull()
    expect(validateRoguelikeTaskInput('roguelike', inputs, { roguelike: { mode: '0' } })).toBeNull()
  })

  it('accepts a configured theme and leaves unknown tasks to the caller', () => {
    expect(validateRoguelikeTaskInput('roguelike', { roguelike: 'Phantom' })).toBeNull()
    expect(validateRoguelikeTaskInput('reclamation', { reclamation: 'Tales' }, {
      reclamation: { toolsToCraft: '荧光棒', numBatches: '16' },
    })).toBeNull()
    expect(validateRoguelikeTaskInput('unknown', {})).toBeNull()
  })

  it('requires an explicit reclamation crafting configuration in mode 1', () => {
    const inputs = { reclamation: 'Tales' }
    expect(validateRoguelikeTaskInput('reclamation', inputs, {
      reclamation: { numBatches: '16' },
    })).toBe('请填写「制作工具名称」：留空时 maa-cli 会默认制作 16 批荧光棒')
    expect(validateRoguelikeTaskInput('reclamation', inputs, {
      reclamation: { toolsToCraft: '荧光棒' },
    })).toBe('请填写「批次数」：留空时 maa-cli 会默认制作 16 批')
    expect(validateRoguelikeTaskInput('reclamation', inputs, {
      reclamation: { toolsToCraft: '荧光棒', numBatches: '16' },
    })).toBeNull()
    expect(validateRoguelikeTaskInput('reclamation', inputs, {
      reclamation: { mode: '0' },
    })).toBeNull()
  })
})

describe('advanced themes and modes', () => {
  it('resolves the reclamation mode default per theme', () => {
    expect(resolveRoguelikeAdvancedValue(option('mode', 'reclamation'), {}, '', 'reclamation')).toBe('1')
    expect(resolveRoguelikeAdvancedValue(
      option('mode', 'reclamation'),
      {},
      'RelaunchAnchor',
      'reclamation',
    )).toBe('16')
    expect(resolveRoguelikeAdvancedValue(
      option('mode', 'reclamation'),
      { mode: '32' },
      'RelaunchAnchor',
      'reclamation',
    )).toBe('32')
  })

  it('fills the theme-appropriate reclamation default when normalizing an old draft', () => {
    expect(normalizeRoguelikeAdvancedParams({}, { reclamation: 'RelaunchAnchor' }))
      .toEqual({ roguelike: { roles: '稳扎稳打' }, reclamation: { mode: '16' } })
    expect(normalizeRoguelikeAdvancedParams({ reclamation: { mode: '48' } }, { reclamation: 'RelaunchAnchor' }))
      .toEqual({ roguelike: { roles: '稳扎稳打' }, reclamation: { mode: '48' } })
  })

  it('shows the black-flow mode fields only for the black-flow theme and modes', () => {
    const strategy = option('blackflowStrategy')
    expect(isRoguelikeOptionVisible(strategy, 'roguelike', 'BlackFlow', { mode: '0' })).toBe(true)
    expect(isRoguelikeOptionVisible(strategy, 'roguelike', 'Sarkaz', { mode: '0' })).toBe(false)

    const animals = option('blackflowStartAnimals')
    expect(isRoguelikeOptionVisible(animals, 'roguelike', 'BlackFlow', { mode: '30003' })).toBe(true)
    expect(isRoguelikeOptionVisible(animals, 'roguelike', 'BlackFlow', { mode: '30001' })).toBe(false)

    const playtime = option('findPlayTimeTarget')
    expect(isRoguelikeOptionVisible(playtime, 'roguelike', 'JieGarden', { mode: '20001' })).toBe(true)
    expect(isRoguelikeOptionVisible(playtime, 'roguelike', 'JieGarden', { mode: '0' })).toBe(false)
  })

  it('gates the new switches by mode', () => {
    expect(isRoguelikeOptionVisible(option('stopAtMaxLevel'), 'roguelike', 'Sarkaz', {})).toBe(true)
    expect(isRoguelikeOptionVisible(option('monthlySquadAutoIterate'), 'roguelike', 'Sarkaz', { mode: '6' }))
      .toBe(true)
    expect(isRoguelikeOptionVisible(option('monthlySquadAutoIterate'), 'roguelike', 'Sarkaz', { mode: '0' }))
      .toBe(false)
    expect(isRoguelikeOptionVisible(option('firstFloorFoldartal'), 'roguelike', 'Sami', {})).toBe(true)
    expect(isRoguelikeOptionVisible(option('firstFloorFoldartal'), 'roguelike', 'Sarkaz', {})).toBe(false)
    expect(isRoguelikeOptionVisible(option('clearStore', 'reclamation'), 'reclamation', 'Tales', { mode: '0' }))
      .toBe(true)
    expect(isRoguelikeOptionVisible(option('clearStore', 'reclamation'), 'reclamation', 'Tales', { mode: '1' }))
      .toBe(false)
  })
})

describe('dynamic task execution plan', () => {
  it('keeps the CLI command while every field has a CLI parameter', () => {
    const plan = buildRoguelikeExecutionPlan('roguelike', { roguelike: 'Sami' }, {
      roguelike: { mode: '5', expectedCollapsalParadigms: '目空一些' },
    })

    expect(plan).toEqual({
      command: 'roguelike',
      params: 'Sami --mode 5 --roles 稳扎稳打 --expected-collapsal-paradigms 目空一些',
      taskConfig: null,
    })
    expect(requiresRoguelikeDynamicTask('roguelike', { roguelike: 'Sami' }, {
      roguelike: { mode: '5', expectedCollapsalParadigms: '目空一些' },
    })).toBe(false)
  })

  it('carries the core operator name through the dynamic task as a string', () => {
    const plan = buildRoguelikeExecutionPlan('roguelike', { roguelike: 'BlackFlow' }, {
      roguelike: { coreChar: '维什戴尔' },
    })

    expect(plan.command).toBe('run')
    expect(plan.taskConfig?.params).toMatchObject({ core_char: '维什戴尔' })
  })

  it('switches to a dynamic task for the black-flow theme', () => {
    const plan = buildRoguelikeExecutionPlan('roguelike', { roguelike: 'BlackFlow' }, {})

    expect(plan.command).toBe('run')
    expect(plan.params).toBe('roguelike')
    expect(plan.taskConfig).toEqual({
      name: '集成战略',
      type: 'Roguelike',
      params: {
        theme: 'BlackFlow',
        roles: '稳扎稳打',
        stop_when_investment_full: true,
      },
    })
  })

  it('carries the black-flow start-run parameters as a dynamic task', () => {
    const plan = buildRoguelikeExecutionPlan('roguelike', { roguelike: 'BlackFlow' }, {
      roguelike: {
        mode: '30003',
        blackflowStartAnimals: '襁褓猫,swaddled_dog',
        blackflowStartRewards: '未编号物,调查预付款',
      },
    })

    expect(plan.command).toBe('run')
    expect(plan.taskConfig?.params).toMatchObject({
      theme: 'BlackFlow',
      mode: 30003,
      blackflow_start_animals: ['swaddled_cat', 'swaddled_dog'],
      blackflow_start_rewards: 1 + 2,
      roles: '稳扎稳打',
    })
  })

  it('writes the required empty start-run values for mode 30003', () => {
    const plan = buildRoguelikeExecutionPlan('roguelike', { roguelike: 'BlackFlow' }, {
      roguelike: { mode: '30003' },
    })

    expect(plan.taskConfig?.params).toMatchObject({
      mode: 30003,
      blackflow_start_animals: [],
      blackflow_start_rewards: 0,
    })
  })

  it('switches to a dynamic task for Core-only roguelike modes', () => {
    const plan = buildRoguelikeExecutionPlan('roguelike', { roguelike: 'JieGarden' }, {
      roguelike: { mode: '20001', findPlayTimeTarget: '2', stopAtMaxLevel: true },
    })

    expect(plan.command).toBe('run')
    expect(plan.taskConfig?.params).toMatchObject({
      theme: 'JieGarden',
      mode: 20001,
      find_playTime_target: 2,
      stop_at_max_level: true,
      roles: '稳扎稳打',
      stop_when_investment_full: true,
    })
    expect(plan.taskConfig?.params).not.toHaveProperty('find_play_time_target')
  })

  it('switches to a dynamic task for Core-only switches on CLI themes', () => {
    const plan = buildRoguelikeExecutionPlan('roguelike', { roguelike: 'Sarkaz' }, {
      roguelike: { stopAtMaxLevel: true },
    })

    expect(plan.command).toBe('run')
    expect(plan.taskConfig?.params.stop_at_max_level).toBe(true)
    expect(plan.taskConfig?.params.theme).toBe('Sarkaz')
  })

  it('uses the CLI with the new increment mode and multiple crafting tools', () => {
    const plan = buildRoguelikeExecutionPlan('reclamation', { reclamation: 'Tales' }, {
      reclamation: { mode: '1', toolsToCraft: '荧光棒，发电机', incrementMode: '1', numBatches: 2 },
    })

    expect(plan).toEqual({
      command: 'reclamation',
      params: 'Tales -m 1 -C 荧光棒 -C 发电机 --increment-mode 1 --num-craft-batches 2',
      taskConfig: null,
    })
  })

  it('switches to a dynamic task for the relaunch anchor theme and clear-store mode', () => {
    const relaunch = buildRoguelikeExecutionPlan('reclamation', { reclamation: 'RelaunchAnchor' }, {})
    expect(relaunch.command).toBe('run')
    expect(relaunch.taskConfig).toEqual({
      name: '生息演算',
      type: 'Reclamation',
      params: { theme: 'RelaunchAnchor', mode: 16 },
    })

    const clearStore = buildRoguelikeExecutionPlan('reclamation', { reclamation: 'Tales' }, {
      reclamation: { mode: '0', clearStore: true },
    })
    expect(clearStore.command).toBe('run')
    expect(clearStore.taskConfig?.params).toEqual({ theme: 'Tales', mode: 0, clear_store: true })
  })

  it('keeps the CLI for reclamation mode 1 while no Core-only switch is set', () => {
    expect(requiresRoguelikeDynamicTask('reclamation', { reclamation: 'Tales' }, {
      reclamation: { mode: '1', incrementMode: '0' },
    })).toBe(false)
  })
})

describe('advanced theme and mode validation', () => {
  it('rejects unknown themes with the supported list', () => {
    expect(validateRoguelikeTaskInput('roguelike', { roguelike: 'Unknown' }))
      .toBe('未知主题「Unknown」，支持：Phantom、Mizuki、Sami、Sarkaz、JieGarden、BlackFlow')
    expect(validateRoguelikeTaskInput('reclamation', { reclamation: 'Fire' }))
      .toBe('未知主题「Fire」，支持：Tales、RelaunchAnchor')
  })

  it('rejects mode values outside the active theme choices', () => {
    expect(validateRoguelikeTaskInput('roguelike', { roguelike: 'Sami' }, {
      roguelike: { mode: '10001' },
    })).toBe('模式「10001」不在当前主题的可选范围内，请重新选择')
    expect(validateRoguelikeTaskInput('reclamation', { reclamation: 'RelaunchAnchor' }, {
      reclamation: { mode: '1' },
    })).toBe('模式「1」不在当前主题的可选范围内，请重新选择')
  })

  it('requires the target node for the playtime mode', () => {
    expect(validateRoguelikeTaskInput('roguelike', { roguelike: 'JieGarden' }, {
      roguelike: { mode: '20001' },
    })).toBe('刷常乐节点模式需要选择目标常乐节点')
    expect(validateRoguelikeTaskInput('roguelike', { roguelike: 'JieGarden' }, {
      roguelike: { mode: '20001', findPlayTimeTarget: '3' },
    })).toBeNull()
  })

  it('validates the black-flow animal and reward lists', () => {
    expect(validateRoguelikeTaskInput('roguelike', { roguelike: 'BlackFlow' }, {
      roguelike: { mode: '30003', blackflowStartAnimals: '不存在的动物' },
    })).toBe('开局动物组合「不存在的动物」不是可选值')
    expect(validateRoguelikeTaskInput('roguelike', { roguelike: 'BlackFlow' }, {
      roguelike: { mode: '30003', blackflowStartAnimals: '襁褓猫,襁褓狗,襁褓三头犬' },
    })).toBe('开局动物组合最多选择 2 项')
    expect(validateRoguelikeTaskInput('roguelike', { roguelike: 'BlackFlow' }, {
      roguelike: { mode: '30003', blackflowStartAnimals: '襁褓羽蛇,襁褓羽蛇' },
    })).toBe('开局动物组合最多包含一项襁褓羽蛇')
    expect(validateRoguelikeTaskInput('roguelike', { roguelike: 'BlackFlow' }, {
      roguelike: { mode: '30003', blackflowStartAnimals: '襁褓猫', blackflowStartRewards: '不存在的奖励' },
    })).toBe('开局奖励「不存在的奖励」不是可选值')
  })

  it('rejects the cultivation target outside the cultivation strategy', () => {
    expect(validateRoguelikeTaskInput('roguelike', { roguelike: 'BlackFlow' }, {
      roguelike: { mode: '0', blackflowStrategy: 'burn', blackflowCultivationTarget: 'swaddled_cat' },
    })).toBe('培育目标动物仅在黑流策略为培育襁褓动物时生效，请调整策略或清空该字段')
    expect(validateRoguelikeTaskInput('roguelike', { roguelike: 'BlackFlow' }, {
      roguelike: { mode: '0', blackflowCultivationTarget: 'swaddled_dog' },
    })).toBe('培育目标动物仅在黑流策略为培育襁褓动物时生效，请调整策略或清空该字段')
    expect(validateRoguelikeTaskInput('roguelike', { roguelike: 'BlackFlow' }, {
      roguelike: { mode: '0', blackflowStrategy: 'baby_animal', blackflowCultivationTarget: 'swaddled_dog' },
    })).toBeNull()
    expect(validateRoguelikeTaskInput('roguelike', { roguelike: 'BlackFlow' }, {
      roguelike: { mode: '30001', blackflowCultivationTarget: 'swaddled_dog' },
    })).toBeNull()
  })

  it('rejects invalid increment mode values left in old drafts', () => {
    expect(validateRoguelikeTaskInput('reclamation', { reclamation: 'Tales' }, {
      reclamation: { mode: '1', incrementMode: '2' },
    })).toBe('加号点击方式「2」不在当前主题的可选范围内，请重新选择')
  })
})
