import { describe, expect, it } from 'vitest'
import { DEFAULT_COPILOT_MATCH_MODES } from '../model/copilotDiscovery'
import type { CopilotSearchItem, CopilotStageCandidate } from '../types'
import {
  buildCopilotDiscoveryDetailTarget,
  deriveCopilotStageOption,
  describeCopilotStage,
  filterCopilotSearchItems,
  formatCopilotHotScore,
  formatCopilotUploadTime,
  hasCopilotSearchCriteria,
  stripCopilotStageSuffix,
} from './copilotDiscoveryPresentation'

const item = (overrides: Partial<CopilotSearchItem>): CopilotSearchItem => ({
  id: '1',
  uri: 'prts://1',
  views: 0,
  hotScore: 0,
  ...overrides,
})

describe('describeCopilotStage', () => {
  it('prefers the player-facing code and label', () => {
    expect(describeCopilotStage({
      stageCode: '1-7',
      stageLabel: '暴君',
      stageId: 'main_01-07',
      stageName: '暴君',
    })).toEqual({ code: '1-7', label: '暴君' })
  })

  it('falls back to the stage id when the resolved fields are empty strings', () => {
    expect(describeCopilotStage({
      stageCode: '',
      stageLabel: '',
      stageId: 'main_01-07',
      stageName: '',
    })).toEqual({ code: 'main_01-07', label: null })
  })

  it.each(['#f#', '#n#', '#s'])('strips the internal %s suffix from stage names', (suffix) => {
    expect(describeCopilotStage({ stageName: `main_01-07${suffix}` }))
      .toEqual({ code: 'main_01-07', label: null })
    expect(describeCopilotStage({ stageName: `main_01-07${suffix}  ` }))
      .toEqual({ code: 'main_01-07', label: null })
    expect(stripCopilotStageSuffix(`暴君${suffix}`)).toBe('暴君')
  })

  it('keeps a display name as the label when a code is available', () => {
    expect(describeCopilotStage({ stageCode: '1-7', stageName: '暴君#f#' }))
      .toEqual({ code: '1-7', label: '暴君' })
  })

  it('does not repeat the same value as code and label', () => {
    expect(describeCopilotStage({ stageName: 'main_01-07#f#' }))
      .toEqual({ code: 'main_01-07', label: null })
  })
})

describe('deriveCopilotStageOption', () => {
  const candidate = (overrides: Partial<CopilotStageCandidate>): CopilotStageCandidate => ({
    stageId: '',
    code: '',
    name: '',
    category: '',
    zone: '',
    ...overrides,
  })

  it('collapses a rune stage whose code, name and zone repeat the stage id', () => {
    expect(deriveCopilotStageOption(candidate({
      stageId: 'level_rune_10-02',
      code: 'level_rune_10-02',
      name: 'level_rune_10-02',
      category: '危机合约',
      zone: 'level_rune_10-02',
    }))).toEqual({ code: 'level_rune_10-02', name: '', zone: '' })
  })

  it('keeps the zone of a crisis stage while dropping the repeated name', () => {
    expect(deriveCopilotStageOption(candidate({
      stageId: 'level_crisis_v2_01-05',
      code: 'level_crisis_v2_01-05',
      name: 'level_crisis_v2_01-05',
      category: '危机合约',
      zone: '浊燃作战',
    }))).toEqual({ code: 'level_crisis_v2_01-05', name: '', zone: '浊燃作战' })
  })

  it('keeps distinct code, name and zone fields', () => {
    expect(deriveCopilotStageOption(candidate({
      stageId: 'a001_01',
      code: 'GT-1',
      name: '日正当中',
      category: '活动关卡',
      zone: '骑兵与猎人',
    }))).toEqual({ code: 'GT-1', name: '日正当中', zone: '骑兵与猎人' })
  })

  it('falls back to the stage id and category while trimming blanks', () => {
    expect(deriveCopilotStageOption(candidate({
      stageId: 'main_01-07',
      code: ' ',
      name: '暴君',
      category: ' 主线 ',
      zone: '',
    }))).toEqual({ code: 'main_01-07', name: '暴君', zone: '主线' })
  })
})

describe('filterCopilotSearchItems', () => {
  const ready = item({ id: 'ready', match: { mode: 'ready', missing: [], training: [], check: [], totalSlots: 1 } })
  const borrow = item({ id: 'borrow', match: { mode: 'borrow', missing: ['陈'], training: [], check: [], totalSlots: 1 } })
  const unknown = item({ id: 'unknown' })

  it('returns every item while matching is disabled', () => {
    expect(filterCopilotSearchItems([ready, borrow, unknown], {
      enabled: false,
      modes: ['ready'],
    }).map(entry => entry.id)).toEqual(['ready', 'borrow', 'unknown'])
  })

  it('filters by mode but keeps jobs without match data visible', () => {
    expect(filterCopilotSearchItems([ready, borrow, unknown], {
      enabled: true,
      modes: ['ready'],
    }).map(entry => entry.id)).toEqual(['ready', 'unknown'])
  })

  it('drops every recognized mode when none is selected', () => {
    expect(filterCopilotSearchItems([ready, borrow, unknown], {
      enabled: true,
      modes: [],
    }).map(entry => entry.id)).toEqual(['unknown'])
  })

  it('treats the default modes as ready, borrow, train and check', () => {
    expect(DEFAULT_COPILOT_MATCH_MODES).toEqual(['ready', 'borrow', 'train', 'check'])
  })
})

describe('formatCopilotHotScore', () => {
  it.each([
    [0, '0'],
    [4.5, '4.5'],
    [9, '9'],
    [98, '98'],
    [16853.43055304006, '16853.4'],
    [Number.NaN, '0'],
    [Number.POSITIVE_INFINITY, '0'],
    [Number.NEGATIVE_INFINITY, '0'],
    [-0, '0'],
    [-1, '0'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatCopilotHotScore(value)).toBe(expected)
  })
})

describe('formatCopilotUploadTime', () => {
  it('formats a timestamp as a local short date', () => {
    expect(formatCopilotUploadTime(new Date(2026, 2, 4, 12).toISOString())).toBe('2026-03-04')
  })

  it('returns null for missing or invalid values', () => {
    expect(formatCopilotUploadTime(undefined)).toBeNull()
    expect(formatCopilotUploadTime('')).toBeNull()
    expect(formatCopilotUploadTime('not-a-date')).toBeNull()
  })
})

describe('buildCopilotDiscoveryDetailTarget', () => {
  it('projects the list entry into a full detail target', () => {
    expect(buildCopilotDiscoveryDetailTarget(item({
      id: '9',
      uri: 'prts://9',
      title: '时间啊，向前！',
      stageCode: 'TL-EX-8',
      stageLabel: '静谧黑暗',
      stageId: 'act55side_ex08',
      details: '作者：萨拉托加',
      recommendedMode: 'both',
      groupNames: ['输出组'],
      operatorDetails: [
        { name: '圣聆初雪', group: '输出组', elite: 2, level: 60, skillLevel: 10, module: '-1' },
      ],
    }))).toEqual({
      title: '时间啊，向前！',
      details: '作者：萨拉托加',
      stage: 'TL-EX-8',
      stageId: 'act55side_ex08',
      uri: 'prts://9',
      sourceLabel: '链接',
      operators: [
        { name: '圣聆初雪', group: '输出组', elite: 2, level: 60, skillLevel: 10, module: '-1' },
      ],
      groups: ['输出组'],
      recommendedMode: 'both',
    })
  })

  it('falls back to bare operator names and omits facts the entry lacks', () => {
    const target = buildCopilotDiscoveryDetailTarget(item({
      title: '  ',
      operators: ['阿米娅', '凯尔希'],
    }))
    expect(target).toEqual({
      title: '作业 1',
      uri: 'prts://1',
      sourceLabel: '链接',
      operators: [{ name: '阿米娅' }, { name: '凯尔希' }],
    })
  })

  it('prefers the projected requirements over the bare names', () => {
    const target = buildCopilotDiscoveryDetailTarget(item({
      operators: ['阿米娅'],
      operatorDetails: [{ name: '阿米娅', elite: 2 }],
    }))
    expect(target.operators).toEqual([{ name: '阿米娅', elite: 2 }])
  })
})

describe('hasCopilotSearchCriteria', () => {
  it('treats blank input as no criteria', () => {
    expect(hasCopilotSearchCriteria({
      keyword: '  ',
      level: '',
      includedOperators: [],
      excludedOperators: [],
    })).toBe(false)
  })

  it('detects every filter dimension', () => {
    const base = { keyword: '', level: '', includedOperators: [], excludedOperators: [] }
    expect(hasCopilotSearchCriteria({ ...base, keyword: '1-7' })).toBe(true)
    expect(hasCopilotSearchCriteria({ ...base, level: 'main_01-07' })).toBe(true)
    expect(hasCopilotSearchCriteria({ ...base, includedOperators: ['阿米娅'] })).toBe(true)
    expect(hasCopilotSearchCriteria({ ...base, excludedOperators: ['陈'] })).toBe(true)
  })
})
