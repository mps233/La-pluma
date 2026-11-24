import { describe, expect, it } from 'vitest'
import type { OperBoxData, OperatorCatalogSource, OperatorDetailed } from '@/features/game-data'
import {
  AMIYA_FORM_IDS,
  DEFAULT_OPERATOR_FILTERS,
  buildKnownOperatorIdSet,
  buildOwnedOperatorIdSet,
  hasActiveOperatorFilters,
  isOwnedOperator,
  isUnknownOperator,
  selectOperators,
  type OperatorFilters,
  type OperatorSelectionInput,
} from './operatorFilters'

const operator = (
  id: string,
  name: string,
  overrides: Partial<OperatorDetailed> = {},
): OperatorDetailed => ({
  id,
  name,
  rarity: 4,
  profession: 'SNIPER',
  level: 0,
  elite: 0,
  potential: 1,
  ...overrides,
})

const catalog: OperatorDetailed[] = [
  operator('char_002_amiya', '阿米娅', { rarity: 5, profession: 'CASTER' }),
  operator('char_1001_amiya2', '阿米娅', { rarity: 5, profession: 'CASTER' }),
  operator('char_1037_amiya3', '阿米娅', { rarity: 5, profession: 'CASTER' }),
  operator('char_alpha', '阿尔法', { rarity: 6 }),
  operator('char_beta', '贝塔', { rarity: 4, profession: 'MEDIC' }),
  operator('char_gamma', '伽马', { rarity: 4 }),
]

const operBox = (data: OperatorDetailed[]): OperBoxData => ({
  operCount: data.length,
  data,
  timestamp: '2026-10-25T00:00:00.000Z',
})

/** 带识别目录的快照：`recognized` 决定快照覆盖面，其余条目拥有状态未知。 */
const recognizedBox = (
  data: OperatorDetailed[],
  recognized: readonly OperatorDetailed[],
  status: 'complete' | 'partial',
): OperBoxData => ({
  ...operBox(data),
  allOpers: recognized.map(entry => ({
    id: entry.id,
    name: entry.name,
    rarity: entry.rarity,
    owned: data.some(operator => operator.id === entry.id),
  })),
  operTotal: recognized.length,
  recognition: { status, total: recognized.length, owned: data.length },
})

/** 完整识别快照：识别目录覆盖整个目录，未列出的条目都是确认未拥有。 */
const completeBox = (data: OperatorDetailed[]): OperBoxData =>
  recognizedBox(data, catalog, 'complete')

/** 识别中途失败后的快照：目录存在，但只有已识别的干员被确认。 */
const partialBox = (data: OperatorDetailed[], coveredIds: readonly string[]): OperBoxData =>
  recognizedBox(data, catalog.filter(entry => coveredIds.includes(entry.id)), 'partial')

const ownedAlpha = operator('char_alpha', '阿尔法', { rarity: 6, level: 80, elite: 2, potential: 1 })
const ownedAmiya = operator('char_002_amiya', '阿米娅', {
  rarity: 5,
  profession: 'CASTER',
  level: 50,
  elite: 2,
  potential: 3,
})

const ownedBox = completeBox([ownedAlpha, ownedAmiya])

const filters = (overrides: Partial<OperatorFilters> = {}): OperatorFilters => ({
  ...DEFAULT_OPERATOR_FILTERS,
  ...overrides,
})

const ids = (operators: readonly OperatorDetailed[]) => operators.map(op => op.id)

const select = (
  input: Omit<OperatorSelectionInput, 'catalogSource'> & { catalogSource?: OperatorCatalogSource },
): OperatorDetailed[] => selectOperators({ catalogSource: 'remote', ...input })

describe('Amiya form ownership', () => {
  it('expands all three forms when any one is owned', () => {
    const ownedIds = buildOwnedOperatorIdSet(ownedBox)

    expect(AMIYA_FORM_IDS.every(id => ownedIds.has(id))).toBe(true)
    expect(ownedIds.size).toBe(4)
  })

  it('does not invent forms when no Amiya form is owned', () => {
    const ownedIds = buildOwnedOperatorIdSet(operBox([
      operator('char_alpha', '阿尔法', { rarity: 6, level: 80 }),
    ]))

    expect(AMIYA_FORM_IDS.some(id => ownedIds.has(id))).toBe(false)
    expect(ownedIds.size).toBe(1)
  })

  it('treats every form as owned on the operator card', () => {
    const ownedIds = buildOwnedOperatorIdSet(ownedBox)
    const unownedForm = catalog.find(op => op.id === 'char_1037_amiya3')!

    expect(isOwnedOperator(unownedForm, ownedIds)).toBe(true)
    expect(isOwnedOperator(catalog.find(op => op.id === 'char_beta')!, ownedIds)).toBe(false)
  })
})

describe('operator selection', () => {
  it('excludes every Amiya form from the unowned view', () => {
    const result = select({
      catalog,
      operBox: ownedBox,
      filters: filters({ ownership: 'unowned' }),
    })

    expect(ids(result)).not.toContain('char_002_amiya')
    expect(ids(result)).not.toContain('char_1001_amiya2')
    expect(ids(result)).not.toContain('char_1037_amiya3')
    expect(ids(result)).toEqual(['char_beta', 'char_gamma'])
    expect(result.every(op => op.level === 0 && op.elite === 0 && op.potential === 0)).toBe(true)
  })

  it('fills missing Amiya forms from the owned form in the owned view', () => {
    const result = select({
      catalog,
      operBox: ownedBox,
      filters: filters({ ownership: 'owned', sortBy: 'level' }),
    })

    expect(ids(result)).toHaveLength(4)
    expect(ids(result).slice(1).sort()).toEqual([...AMIYA_FORM_IDS].sort())
    for (const id of AMIYA_FORM_IDS) {
      const form = result.find(op => op.id === id)!
      expect(form).toMatchObject({ level: 50, elite: 2, potential: 3, profession: 'CASTER' })
    }
  })

  it('uses catalog metadata for owned operators and zero stats for the rest in the all view', () => {
    const result = select({
      catalog,
      operBox: ownedBox,
      filters: filters({ ownership: 'all', profession: 'SNIPER' }),
    })

    expect(ids(result)).toEqual(['char_alpha', 'char_gamma'].sort())
    expect(result.find(op => op.id === 'char_alpha')).toMatchObject({ level: 80, profession: 'SNIPER' })
    expect(result.find(op => op.id === 'char_gamma')).toMatchObject({ level: 0, elite: 0, potential: 0 })
  })

  it('fills missing Amiya forms with owned stats in the all view', () => {
    const result = select({
      catalog,
      operBox: ownedBox,
      filters: filters({ ownership: 'all', profession: 'CASTER' }),
    })

    expect(ids(result).sort()).toEqual([...AMIYA_FORM_IDS].sort())
    expect(result.every(op => op.level === 50 && op.elite === 2 && op.potential === 3)).toBe(true)
  })

  it('returns an empty list when the required source is absent', () => {
    expect(select({
      catalog,
      operBox: null,
      filters: filters({ ownership: 'owned' }),
    })).toEqual([])
    expect(select({
      catalog: [],
      operBox: ownedBox,
      filters: filters(),
    })).toEqual([])
  })
})

describe('operator filters', () => {
  it('clamps rarity above six before comparing', () => {
    const result = select({
      catalog: [
        operator('char_six', '六星', { rarity: 6 }),
        operator('char_over', '超限', { rarity: 8 }),
        operator('char_five', '五星', { rarity: 5 }),
      ],
      operBox: null,
      filters: filters({ rarity: '6' }),
    })

    expect(ids(result)).toEqual(['char_over', 'char_six'])
  })

  it('ignores elite and potential filters in the unowned view', () => {
    const result = select({
      catalog,
      operBox: ownedBox,
      filters: filters({ ownership: 'unowned', elite: '2', potential: '3' }),
    })

    expect(ids(result)).toEqual(['char_beta', 'char_gamma'])
  })

  it('applies elite and potential filters outside the unowned view', () => {
    const elite = select({
      catalog,
      operBox: ownedBox,
      filters: filters({ ownership: 'owned', elite: '2' }),
    })
    const potential = select({
      catalog,
      operBox: ownedBox,
      filters: filters({ ownership: 'owned', potential: '1' }),
    })

    expect(elite).toHaveLength(4)
    expect(ids(potential)).toEqual(['char_alpha'])

    const allElite = select({
      catalog,
      operBox: ownedBox,
      filters: filters({ ownership: 'all', elite: '2' }),
    })
    expect(ids(allElite).sort()).toEqual(
      ['char_002_amiya', 'char_1001_amiya2', 'char_1037_amiya3', 'char_alpha'].sort(),
    )
  })
})

describe('operator sorting', () => {
  it('keeps the owned snapshot order for the default sort', () => {
    const result = select({
      catalog,
      operBox: ownedBox,
      filters: filters({ ownership: 'owned' }),
    })

    expect(ids(result)).toEqual([
      'char_alpha',
      'char_002_amiya',
      'char_1001_amiya2',
      'char_1037_amiya3',
    ])
  })

  it('sorts owned operators by level, rarity, or potential', () => {
    const byLevel = select({
      catalog,
      operBox: ownedBox,
      filters: filters({ ownership: 'owned', sortBy: 'level' }),
    })
    const byRarity = select({
      catalog,
      operBox: ownedBox,
      filters: filters({ ownership: 'owned', sortBy: 'rarity' }),
    })
    const byPotential = select({
      catalog,
      operBox: ownedBox,
      filters: filters({ ownership: 'owned', sortBy: 'potential' }),
    })

    expect(byLevel[0]?.id).toBe('char_alpha')
    expect(byRarity[0]?.id).toBe('char_alpha')
    expect(byPotential[0]?.id).toBe('char_002_amiya')
  })

  it('sorts non-owned views by rarity then Chinese name and ignores level sorting', () => {
    const unownedCatalog = [
      operator('char_low', '阿低', { rarity: 3 }),
      operator('char_high_b', '乙高', { rarity: 5 }),
      operator('char_high_a', '甲高', { rarity: 5 }),
    ]
    const result = select({
      catalog: unownedCatalog,
      operBox: recognizedBox([], unownedCatalog, 'complete'),
      filters: filters({ ownership: 'unowned', sortBy: 'level' }),
    })

    expect(ids(result)).toEqual(['char_high_a', 'char_high_b', 'char_low'])
  })

  it('does not sort the caller-owned catalog array in place', () => {
    const unsorted = [
      operator('char_low', '阿低', { rarity: 3 }),
      operator('char_high', '阿高', { rarity: 6 }),
    ]
    const before = ids(unsorted)

    select({ catalog: unsorted, operBox: null, filters: filters() })

    expect(ids(unsorted)).toEqual(before)
  })
})

describe('operator recognition coverage', () => {
  it('confirms the whole catalog only from a complete snapshot', () => {
    const ownedOnly = ['char_002_amiya', 'char_1001_amiya2', 'char_1037_amiya3', 'char_alpha'].sort()
    const complete = buildKnownOperatorIdSet(ownedBox)
    const partial = buildKnownOperatorIdSet(partialBox([ownedAlpha, ownedAmiya], ['char_alpha', 'char_beta']))
    const legacy = buildKnownOperatorIdSet(operBox([ownedAlpha, ownedAmiya]))

    expect(catalog.every(entry => complete.has(entry.id))).toBe(true)
    expect([...partial].sort()).toEqual(ownedOnly)
    expect([...legacy].sort()).toEqual(ownedOnly)
  })

  it('labels operators outside the snapshot coverage as unknown instead of unowned', () => {
    const knownIds = buildKnownOperatorIdSet(partialBox([ownedAlpha], ['char_alpha']))
    const uncovered = catalog.find(entry => entry.id === 'char_beta')!

    expect(isUnknownOperator(uncovered, knownIds)).toBe(true)
    expect(isUnknownOperator(catalog.find(entry => entry.id === 'char_alpha')!, knownIds)).toBe(false)
  })

  it('keeps operators outside a partial snapshot out of the unowned view', () => {
    const box = partialBox([ownedAlpha], ['char_alpha'])

    const result = select({
      catalog,
      operBox: box,
      filters: filters({ ownership: 'unowned' }),
    })

    expect(ids(result)).toEqual([])
  })

  it('treats every non-owned operator as unknown when the snapshot carries no signal', () => {
    const result = select({
      catalog,
      operBox: operBox([ownedAlpha]),
      filters: filters({ ownership: 'unowned' }),
    })

    expect(ids(result)).toEqual([])
  })

  it('confirms unowned entries listed by a complete snapshot', () => {
    const result = select({
      catalog,
      operBox: ownedBox,
      filters: filters({ ownership: 'unowned' }),
    })

    expect(ids(result)).toEqual(['char_beta', 'char_gamma'])
  })
})

describe('filter activity', () => {
  it('detects active filters and resets to the default state', () => {
    expect(hasActiveOperatorFilters(DEFAULT_OPERATOR_FILTERS)).toBe(false)
    expect(hasActiveOperatorFilters(filters({ sortBy: 'rarity' }))).toBe(true)
    expect(hasActiveOperatorFilters(filters({ ownership: 'owned' }))).toBe(true)
  })
})

describe('fallback catalogue participation', () => {
  const snapshotCatalog: readonly OperatorDetailed[] = [
    operator('char_owned', '已拥有干员', { rarity: 6, profession: '', level: 0, elite: 0, potential: 0 }),
    operator('char_missing', '未拥有干员', { rarity: 5, profession: '', level: 0, elite: 0, potential: 0 }),
  ]
  const snapshotOwnedEntry = {
    id: 'char_owned',
    name: '已拥有干员',
    rarity: 6,
    level: 80,
    elite: 2,
    potential: 3,
  } as OperatorDetailed
  const snapshotBox: OperBoxData = {
    operCount: 1,
    data: [snapshotOwnedEntry],
    allOpers: snapshotCatalog.map(entry => ({
      id: entry.id,
      name: entry.name,
      rarity: entry.rarity,
      owned: entry.id === 'char_owned',
    })),
    operTotal: snapshotCatalog.length,
    recognition: { status: 'complete', total: snapshotCatalog.length, owned: 1 },
    timestamp: '2026-10-25T00:00:00.000Z',
  }

  it('browses snapshot fallback entries by name and rarity', () => {
    const all = selectOperators({
      catalog: snapshotCatalog,
      catalogSource: 'snapshot',
      operBox: snapshotBox,
      filters: filters(),
    })
    const rarity = selectOperators({
      catalog: snapshotCatalog,
      catalogSource: 'snapshot',
      operBox: snapshotBox,
      filters: filters({ rarity: '5' }),
    })

    expect(ids(all).sort()).toEqual(['char_missing', 'char_owned'])
    expect(all.every(entry => entry.name.length > 0 && entry.rarity > 0)).toBe(true)
    expect(ids(rarity)).toEqual(['char_missing'])
  })

  it('drops placeholder fallback entries once an elite or potential filter is active', () => {
    const eliteZero = selectOperators({
      catalog: snapshotCatalog,
      catalogSource: 'snapshot',
      operBox: snapshotBox,
      filters: filters({ elite: '0' }),
    })
    const potentialOne = selectOperators({
      catalog: snapshotCatalog,
      catalogSource: 'snapshot',
      operBox: snapshotBox,
      filters: filters({ potential: '1' }),
    })

    expect(ids(eliteZero)).toEqual([])
    expect(ids(potentialOne)).toEqual([])
  })

  it('keeps elite and potential filters on owned snapshot entries', () => {
    const elite = selectOperators({
      catalog: snapshotCatalog,
      catalogSource: 'snapshot',
      operBox: snapshotBox,
      filters: filters({ ownership: 'owned', elite: '2' }),
    })
    const potential = selectOperators({
      catalog: snapshotCatalog,
      catalogSource: 'snapshot',
      operBox: snapshotBox,
      filters: filters({ ownership: 'owned', potential: '3' }),
    })

    expect(ids(elite)).toEqual(['char_owned'])
    expect(ids(potential)).toEqual(['char_owned'])
  })

  it('keeps the unowned view unrestricted by elite and potential filters', () => {
    const elite = selectOperators({
      catalog: snapshotCatalog,
      catalogSource: 'snapshot',
      operBox: snapshotBox,
      filters: filters({ ownership: 'unowned', elite: '0' }),
    })
    const potential = selectOperators({
      catalog: snapshotCatalog,
      catalogSource: 'snapshot',
      operBox: snapshotBox,
      filters: filters({ ownership: 'unowned', potential: '1' }),
    })

    expect(ids(elite)).toEqual(['char_missing'])
    expect(ids(potential)).toEqual(['char_missing'])
  })

  it('does not filter snapshot entries by profession', () => {
    const withProfession = snapshotCatalog.map(entry => ({ ...entry, profession: 'SNIPER' }))
    const all = selectOperators({
      catalog: withProfession,
      catalogSource: 'snapshot',
      operBox: snapshotBox,
      filters: filters({ profession: 'SNIPER' }),
    })
    const owned = selectOperators({
      catalog: withProfession,
      catalogSource: 'snapshot',
      operBox: snapshotBox,
      filters: filters({ ownership: 'owned', profession: 'SNIPER' }),
    })
    const unowned = selectOperators({
      catalog: withProfession,
      catalogSource: 'snapshot',
      operBox: snapshotBox,
      filters: filters({ ownership: 'unowned', profession: 'SNIPER' }),
    })

    expect(all).toEqual([])
    expect(owned).toEqual([])
    expect(unowned).toEqual([])
  })

  it('keeps profession filtering for a trusted catalogue', () => {
    const result = selectOperators({
      catalog: snapshotCatalog.map(entry => ({ ...entry, profession: 'SNIPER' })),
      catalogSource: 'remote',
      operBox: snapshotBox,
      filters: filters({ profession: 'SNIPER' }),
    })

    expect(ids(result).sort()).toEqual(['char_missing', 'char_owned'])
  })
})
