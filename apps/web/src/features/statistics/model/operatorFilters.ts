// 四条不变量：阿米娅三个形态共享持有状态，拥有任意一个即视为拥有全部；「未拥有」视图
// 只收录识别快照确认未拥有的干员，快照未覆盖的干员拥有状态未知；「未拥有」视图
// 不应用精英化/潜能筛选且等级固定 0；非「已拥有」视图按星级降序、同名按中文名排序，
// 忽略等级/潜能排序。

import type {
  OperBoxData,
  OperatorCatalogSource,
  OperatorDetailed,
} from '@/features/game-data'

export type FilterRarity = 'all' | '1' | '2' | '3' | '4' | '5' | '6'
export type FilterElite = 'all' | '0' | '1' | '2'
export type FilterPotential = 'all' | '1' | '2' | '3' | '4' | '5' | '6'
export type FilterOwnership = 'all' | 'owned' | 'unowned'
export type FilterProfession = 'all' | 'PIONEER' | 'WARRIOR' | 'TANK' | 'SNIPER' | 'CASTER' | 'MEDIC' | 'SUPPORT' | 'SPECIAL'
export type SortBy = 'default' | 'level' | 'rarity' | 'potential'

export interface OperatorFilters {
  rarity: FilterRarity
  elite: FilterElite
  potential: FilterPotential
  ownership: FilterOwnership
  profession: FilterProfession
  sortBy: SortBy
}

export const DEFAULT_OPERATOR_FILTERS: OperatorFilters = {
  rarity: 'all',
  elite: 'all',
  potential: 'all',
  ownership: 'all',
  profession: 'all',
  sortBy: 'default',
}

/** 阿米娅三个形态共享持有状态。 */
export const AMIYA_FORM_IDS = ['char_002_amiya', 'char_1001_amiya2', 'char_1037_amiya3'] as const

const AMIYA_FORM_ID_SET: ReadonlySet<string> = new Set(AMIYA_FORM_IDS)

export const hasAnyAmiyaForm = (ownedIds: ReadonlySet<string>): boolean =>
  AMIYA_FORM_IDS.some(id => ownedIds.has(id))

/**
 * 由持有干员快照构建用于筛选与卡片的持有 id 集合。
 * 拥有任意阿米娅形态时补齐全部形态，避免同一干员出现「拥有/未拥有」两种结论。
 */
export function buildOwnedOperatorIdSet(operBox: OperBoxData | null): Set<string> {
  const ownedIds = new Set((operBox?.data ?? []).map(operator => operator.id))
  if (hasAnyAmiyaForm(ownedIds)) {
    for (const id of AMIYA_FORM_IDS) ownedIds.add(id)
  }
  return ownedIds
}

/**
 * 由持有干员快照构建拥有状态已确认的 id 集合：已识别拥有的干员，以及完整识别目录
 * 覆盖到的条目。部分识别与缺少完整信号的快照只确认已识别拥有的干员。
 */
export function buildKnownOperatorIdSet(operBox: OperBoxData | null): Set<string> {
  const knownIds = buildOwnedOperatorIdSet(operBox)
  if (operBox?.recognition?.status !== 'complete') return knownIds
  for (const operator of operBox.allOpers ?? []) knownIds.add(operator.id)
  return knownIds
}

/** 卡片上的「已拥有」判定：有等级或持有 id 集合包含该干员。 */
export const isOwnedOperator = (
  operator: OperatorDetailed,
  ownedIds: ReadonlySet<string>,
): boolean => operator.level > 0 || ownedIds.has(operator.id)

/** 卡片上的「未知」判定：没有持有记录，且识别快照没有覆盖该干员。 */
export const isUnknownOperator = (
  operator: OperatorDetailed,
  knownIds: ReadonlySet<string>,
): boolean => operator.level <= 0 && !knownIds.has(operator.id)

export interface OperatorSelectionInput {
  catalog: readonly OperatorDetailed[]
  catalogSource: OperatorCatalogSource
  operBox: OperBoxData | null
  filters: OperatorFilters
}

const buildDataSource = ({
  catalog,
  operBox,
  filters,
}: OperatorSelectionInput): OperatorDetailed[] => {
  const ownedOperators = operBox?.data ?? []
  const catalogById = new Map(catalog.map(operator => [operator.id, operator]))
  const ownedIds = buildOwnedOperatorIdSet(operBox)
  const knownIds = buildKnownOperatorIdSet(operBox)
  const hasAmiya = hasAnyAmiyaForm(ownedIds)

  if (filters.ownership === 'unowned') {
    return catalog
      .filter(operator => knownIds.has(operator.id) && !ownedIds.has(operator.id))
      .map(operator => ({ ...operator, level: 0, elite: 0, potential: 0 }))
  }

  if (filters.ownership === 'owned') {
    const ownedList = ownedOperators.map((owned) => {
      const fullInfo = catalogById.get(owned.id)
      return {
        ...owned,
        profession: fullInfo?.profession || owned.profession,
        position: fullInfo?.position || owned.position,
      }
    })

    if (hasAmiya) {
      for (const amiyaId of AMIYA_FORM_IDS) {
        if (ownedList.some(operator => operator.id === amiyaId)) continue
        const amiyaInfo = catalogById.get(amiyaId)
        if (!amiyaInfo) continue
        const ownedAmiya = ownedList.find(operator => AMIYA_FORM_ID_SET.has(operator.id))
        ownedList.push({
          ...amiyaInfo,
          level: ownedAmiya?.level || 1,
          elite: ownedAmiya?.elite || 0,
          potential: ownedAmiya?.potential || 1,
          position: amiyaInfo.position,
        })
      }
    }

    return ownedList
  }

  const ownedById = new Map(ownedOperators.map(operator => [operator.id, operator]))
  const ownedAmiya = hasAmiya
    ? AMIYA_FORM_IDS.map(id => ownedById.get(id)).find(operator => operator !== undefined)
    : undefined

  return catalog.map((operator) => {
    const owned = ownedById.get(operator.id)
    if (owned) return { ...operator, ...owned }
    if (hasAmiya && AMIYA_FORM_ID_SET.has(operator.id)) {
      return {
        ...operator,
        level: ownedAmiya?.level || 1,
        elite: ownedAmiya?.elite || 0,
        potential: ownedAmiya?.potential || 1,
      }
    }
    return { ...operator, level: 0, elite: 0, potential: 0 }
  })
}

export const isProfessionFilterUnavailable = ({
  catalogSource,
  filters,
}: Pick<OperatorSelectionInput, 'catalogSource' | 'filters'>): boolean =>
  catalogSource === 'snapshot' && filters.profession !== 'all'

/** 应用筛选并排序；返回新数组，不修改传入的目录或持有快照。 */
export function selectOperators(input: OperatorSelectionInput): OperatorDetailed[] {
  const { filters } = input
  const catalog = input.catalog ?? []
  const unownedView = filters.ownership === 'unowned'

  if (filters.ownership === 'owned' && !input.operBox?.data) return []
  if (filters.ownership !== 'owned' && catalog.length === 0) return []
  if (isProfessionFilterUnavailable(input)) return []

  let filtered = buildDataSource({ ...input, catalog })

  const structuredFiltersActive = !unownedView
    && (filters.elite !== 'all' || filters.potential !== 'all')
  if (input.catalogSource === 'snapshot' && structuredFiltersActive) {
    const ownedIds = buildOwnedOperatorIdSet(input.operBox)
    filtered = filtered.filter(operator => ownedIds.has(operator.id))
  }

  if (filters.rarity !== 'all') {
    const rarity = Number(filters.rarity)
    filtered = filtered.filter(operator => Math.min(operator.rarity || 0, 6) === rarity)
  }

  if (filters.profession !== 'all') {
    filtered = filtered.filter(operator => operator.profession === filters.profession)
  }

  if (filters.elite !== 'all' && !unownedView) {
    const elite = Number(filters.elite)
    filtered = filtered.filter(operator => (operator.elite || 0) === elite)
  }

  if (filters.potential !== 'all' && !unownedView) {
    const potential = Number(filters.potential)
    filtered = filtered.filter(operator => (operator.potential || 1) === potential)
  }

  if (filters.ownership === 'owned') {
    if (filters.sortBy === 'level') {
      filtered.sort((a, b) => (b.level || 0) - (a.level || 0))
    } else if (filters.sortBy === 'rarity') {
      filtered.sort((a, b) => Math.min(b.rarity || 0, 6) - Math.min(a.rarity || 0, 6))
    } else if (filters.sortBy === 'potential') {
      filtered.sort((a, b) => (b.potential || 1) - (a.potential || 1))
    }
  } else {
    filtered.sort((a, b) => {
      const rarityA = Math.min(a.rarity || 0, 6)
      const rarityB = Math.min(b.rarity || 0, 6)
      if (rarityB !== rarityA) return rarityB - rarityA
      return a.name.localeCompare(b.name, 'zh-CN')
    })
  }

  return filtered
}

export const hasActiveOperatorFilters = (filters: OperatorFilters): boolean => (
  filters.rarity !== 'all'
  || filters.elite !== 'all'
  || filters.potential !== 'all'
  || filters.ownership !== 'all'
  || filters.profession !== 'all'
  || filters.sortBy !== 'default'
)
