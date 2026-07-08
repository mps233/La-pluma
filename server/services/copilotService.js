export function normalizeStageIdForPrts(stageId = '') {
  return String(stageId).replace(/#[fn]#/g, '')
}

async function loadLocalJson(relativePath, fallback) {
  const fs = await import('fs/promises')
  const path = await import('path')
  const { fileURLToPath } = await import('url')
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)

  try {
    const filePath = path.join(__dirname, relativePath)
    return JSON.parse(await fs.readFile(filePath, 'utf-8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

export async function resolveStageSearchKeyword(input) {
  const raw = String(input || '').trim()
  if (!raw) return ''

  const stages = await loadLocalJson('../data/stages.json', {})
  const upper = raw.toUpperCase()
  const stage = stages[upper]
    || Object.values(stages).find(item =>
      String(item.code || '').toUpperCase() === upper
      || String(item.name || '').trim() === raw
      || String(item.id || '').toUpperCase() === upper
    )

  return stage?.id ? normalizeStageIdForPrts(stage.id) : raw
}

export async function loadParadoxOperators() {
  const cached = await loadLocalJson('../data/paradox-operators.json', null)
  if (Array.isArray(cached)) return cached

  const [handbookResponse, characterResponse] = await Promise.all([
    fetch('https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/handbook_info_table.json'),
    fetch('https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/character_table.json')
  ])

  if (!handbookResponse.ok || !characterResponse.ok) {
    throw new Error('无法获取悖论模拟干员数据')
  }

  const handbook = await handbookResponse.json()
  const characters = await characterResponse.json()

  return Object.entries(handbook.handbookStageData || {})
    .map(([charId, stage]) => ({
      id: charId,
      name: characters[charId]?.name || handbook.handbookDict?.[charId]?.infoName || charId,
      stage_id: stage.stageId || stage.code,
      stage_name: stage.name || ''
    }))
    .filter(item => item.stage_id)
}
