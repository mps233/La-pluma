import { isRecord } from '@/shared/api'

export interface DropSummary {
  count: number
  items?: string
  recent: Array<{
    stage: string
    items: string
  }>
}

const MAX_RECENT_DROP_STAGES = 3
const UNKNOWN_STAGE = '未知关卡'
const FALLBACK_ITEM_NAME = '材料'
const EMPTY_DROP_DETAIL = '已记录作战，暂无材料明细'

interface ParsedDropItem {
  key: string
  name: string
  count: number | null
}

interface AggregatedDropItem {
  name: string
  count: number | null
}

interface AggregatedDropStage {
  stage: string
  lastIndex: number
  items: Map<string, AggregatedDropItem>
}

const firstString = (...values: unknown[]): string | undefined => values.find(
  (value): value is string => typeof value === 'string' && value.trim().length > 0,
)

const toPositiveCount = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
)

const parseDropItem = (value: unknown): ParsedDropItem => {
  const item = isRecord(value) ? value : {}
  const name = firstString(item.name, item.itemName) ?? FALLBACK_ITEM_NAME
  return {
    key: firstString(item.itemId) ?? name,
    name,
    count: toPositiveCount(item.count),
  }
}

const parseRecordItems = (record: Record<string, unknown>): ParsedDropItem[] | null => {
  for (const field of ['drops', 'items'] as const) {
    const value = record[field]
    if (Array.isArray(value) && value.length > 0) return value.map(parseDropItem)
  }
  const nameOnly = firstString(record.itemName)
  return nameOnly === undefined ? null : [{ key: nameOnly, name: nameOnly, count: null }]
}

const accumulateItems = (
  target: Map<string, AggregatedDropItem>,
  parsed: readonly ParsedDropItem[],
): void => {
  for (const item of parsed) {
    const existing = target.get(item.key)
    if (!existing) {
      target.set(item.key, { name: item.name, count: item.count })
      continue
    }
    if (item.count !== null) existing.count = (existing.count ?? 0) + item.count
  }
}

const formatDropItems = (items: ReadonlyMap<string, AggregatedDropItem>): string => {
  if (items.size === 0) return EMPTY_DROP_DETAIL
  return [...items.values()]
    .sort((left, right) => (right.count ?? -1) - (left.count ?? -1))
    .map(item => item.count === null ? item.name : `${item.name}×${item.count}`)
    .join('、')
}

/** 分组键优先关卡代码，行内展示优先显示名；掉落记录可能只带其中一个字段。 */
const parseRecordStage = (record: Record<string, unknown>): { key: string; label: string } => {
  const label = firstString(record.stageName, record.stageCode, record.stage) ?? UNKNOWN_STAGE
  return { key: firstString(record.stageCode, record.stage) ?? label, label }
}

/**
 * 把当天的逐条掉落记录按关卡合并为兼容缓存用的摘要行，同时把所有关卡的物品
 * 合并为一个展示串：同一物品按键累加，按累加数量倒序。
 */
export function buildDropSummary(records: ReadonlyArray<Record<string, unknown>>): DropSummary {
  const stages = new Map<string, AggregatedDropStage>()
  const allItems = new Map<string, AggregatedDropItem>()

  records.forEach((record, index) => {
    const { key, label } = parseRecordStage(record)
    const existing = stages.get(key)
    const group: AggregatedDropStage = existing ?? { stage: label, lastIndex: index, items: new Map() }
    group.lastIndex = index
    stages.set(key, group)

    const parsedItems = parseRecordItems(record)
    if (parsedItems) {
      accumulateItems(group.items, parsedItems)
      accumulateItems(allItems, parsedItems)
    }
  })

  const recent = [...stages.values()]
    .sort((left, right) => right.lastIndex - left.lastIndex)
    .slice(0, MAX_RECENT_DROP_STAGES)
    .map(group => ({ stage: group.stage, items: formatDropItems(group.items) }))

  return { count: records.length, items: formatDropItems(allItems), recent }
}
