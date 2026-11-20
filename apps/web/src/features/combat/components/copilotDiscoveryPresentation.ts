import {
  COPILOT_MATCH_MODES,
  type CopilotMatchMode,
} from '../model/copilotDiscovery'
import type { CopilotSearchItem, CopilotStageCandidate } from '../types'
import type { CopilotDetailTarget } from '../model/copilotDetail'
import type { CombatCopilotMatchSettings } from './combatPanelTypes'

export const COPILOT_DISCOVERY_OPERATOR_LIMIT = 5
export const COPILOT_DISCOVERY_STAGE_PAGE_SIZE = 50

export const COPILOT_MATCH_MODE_LABELS: Readonly<Record<CopilotMatchMode, string>> = Object.fromEntries(
  COPILOT_MATCH_MODES.map(({ mode, label }) => [mode, label]),
) as Record<CopilotMatchMode, string>

export interface CopilotSearchCriteria {
  keyword: string
  level: string
  includedOperators: readonly string[]
  excludedOperators: readonly string[]
}

export function hasCopilotSearchCriteria(criteria: CopilotSearchCriteria): boolean {
  return Boolean(
    criteria.keyword.trim()
    || criteria.level.trim()
    || criteria.includedOperators.length
    || criteria.excludedOperators.length,
  )
}

/** 匹配只在客户端过滤：缺少 match 数据的作业保留，由卡片标注“未识别”。 */
export function filterCopilotSearchItems(
  items: readonly CopilotSearchItem[],
  settings: CombatCopilotMatchSettings,
): CopilotSearchItem[] {
  if (!settings.enabled) return [...items]
  const modes = new Set(settings.modes)
  return items.filter(item => !item.match || modes.has(item.match.mode))
}

export interface CopilotStageSummary {
  code: string
  label: string | null
}

export interface CopilotStageOption {
  code: string
  name: string
  zone: string
}

export function deriveCopilotStageOption(
  candidate: Pick<CopilotStageCandidate, 'stageId' | 'code' | 'name' | 'category' | 'zone'>,
): CopilotStageOption {
  const stageId = candidate.stageId.trim()
  const code = candidate.code.trim() || stageId
  const name = candidate.name.trim()
  const zone = candidate.zone.trim() || candidate.category.trim()
  return {
    code,
    name: name && name !== code && name !== stageId ? name : '',
    zone: zone && zone !== code && zone !== name && zone !== stageId ? zone : '',
  }
}

const STAGE_SUFFIX_PATTERN = /#(?:f#|n#|s)$/i

/** 作业内容里的 stageName 会带 `#f#`、`#n#`、`#s` 内部后缀，展示前必须去掉。 */
export function stripCopilotStageSuffix(value: string | undefined): string {
  return (value ?? '').trim().replace(STAGE_SUFFIX_PATTERN, '').trim()
}

export function describeCopilotStage(
  item: Pick<CopilotSearchItem, 'stageCode' | 'stageLabel' | 'stageId' | 'stageName'>,
): CopilotStageSummary {
  const stageCode = stripCopilotStageSuffix(item.stageCode)
  const stageLabel = stripCopilotStageSuffix(item.stageLabel)
  const stageId = stripCopilotStageSuffix(item.stageId)
  const stageName = stripCopilotStageSuffix(item.stageName)
  const code = stageCode || stageId || stageName || '未知关卡'
  const label = stageLabel || (stageName && stageName !== code ? stageName : '')
  return { code, label: label || null }
}

/**
 * 列表条目到详情抽屉目标的投影：卡片数据已含说明与练度要求，
 * 点开时先按它渲染，详情响应回来后再由预览数据覆盖。
 */
export function buildCopilotDiscoveryDetailTarget(item: CopilotSearchItem): CopilotDetailTarget {
  const stage = describeCopilotStage(item)
  const hasStage = Boolean(stripCopilotStageSuffix(item.stageCode)
    || stripCopilotStageSuffix(item.stageId)
    || stripCopilotStageSuffix(item.stageName))
  const operators = item.operatorDetails?.length
    ? item.operatorDetails
    : item.operators?.map(name => ({ name }))
  const stageId = stripCopilotStageSuffix(item.stageId)
  return {
    title: item.title?.trim() || `作业 ${item.id}`,
    ...(item.details ? { details: item.details } : {}),
    ...(hasStage ? { stage: stage.code } : {}),
    ...(stageId ? { stageId } : {}),
    uri: item.uri,
    sourceLabel: '链接',
    ...(operators?.length ? { operators } : {}),
    ...(item.groupNames?.length ? { groups: item.groupNames } : {}),
    ...(item.recommendedMode ? { recommendedMode: item.recommendedMode } : {}),
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatCopilotHotScore(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** 上传时间按本地时区压成短日期，缺失或无法解析时返回 null。 */
export function formatCopilotUploadTime(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function countOperatorSelection(included: readonly string[], excluded: readonly string[]): number {
  return included.length + excluded.length
}
