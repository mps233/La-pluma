import { createLogger } from '../utils/logger.js'
import { findMaaStage, getMaaParadoxOperators } from './maaResourceDataService.js'

const logger = createLogger('CopilotService')

function normalizeStageIdForPrts(stageId = '') {
  return String(stageId).replace(/#[fn]#/g, '')
}

export async function resolveStageSearchKeyword(input, {
  findStage = findMaaStage
} = {}) {
  const raw = String(input || '').trim()
  if (!raw) return ''

  try {
    const stage = await findStage(raw)
    if (stage?.stageId) return normalizeStageIdForPrts(stage.stageId)
  } catch (error) {
    logger.warn('读取 MaaResource 关卡索引失败，保留原始搜索词', {
      input: raw,
      error: error.message
    })
  }

  return raw
}

export async function loadParadoxOperators({
  loadDerived = getMaaParadoxOperators
} = {}) {
  try {
    const derived = await loadDerived()
    return Array.isArray(derived) ? derived : []
  } catch (error) {
    logger.warn('从 MaaResource 推导悖论干员失败', {
      error: error.message
    })
    return []
  }
}
