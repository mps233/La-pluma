import { getErrorMessage } from '../utils/errors.ts';
import { createLogger } from '../utils/logger.ts'
import { findMaaStage, getMaaParadoxOperators } from './maaResourceDataService.ts'

const logger = createLogger('CopilotService')

function normalizeStageIdForPrts(stageId: unknown = ''): string {
  return String(stageId).replace(/#[fn]#/g, '')
}

export async function resolveStageSearchKeyword(input: unknown, {
  findStage = findMaaStage
}: { findStage?: typeof findMaaStage } = {}): Promise<string> {
  const raw = String(input || '').trim()
  if (!raw) return ''

  try {
    const stage = await findStage(raw)
    if (stage?.stageId) return normalizeStageIdForPrts(stage.stageId)
  } catch (error) {
    logger.warn('读取 MaaResource 关卡索引失败，保留原始搜索词', {
      input: raw,
      error: getErrorMessage(error)
    })
  }

  return raw
}

export async function loadParadoxOperators({
  loadDerived = getMaaParadoxOperators
}: { loadDerived?: typeof getMaaParadoxOperators } = {}) {
  try {
    const derived = await loadDerived()
    return Array.isArray(derived) ? derived : []
  } catch (error) {
    logger.warn('从 MaaResource 推导悖论干员失败', {
      error: getErrorMessage(error)
    })
    return []
  }
}
