import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.join(__dirname, '../data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'paradox-operators.json');
const BASE = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel';

async function fetchJson(name: string): Promise<unknown> {
  const response = await fetch(`${BASE}/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return response.json();
}

const [rawHandbook, rawCharacters] = await Promise.all([
  fetchJson('handbook_info_table.json'),
  fetchJson('character_table.json')
]);
const handbook = rawHandbook && typeof rawHandbook === 'object' && !Array.isArray(rawHandbook)
  ? rawHandbook as Record<string, unknown>
  : {};
const characters = rawCharacters && typeof rawCharacters === 'object' && !Array.isArray(rawCharacters)
  ? rawCharacters as Record<string, unknown>
  : {};
const stageData = handbook.handbookStageData && typeof handbook.handbookStageData === 'object' && !Array.isArray(handbook.handbookStageData)
  ? handbook.handbookStageData as Record<string, unknown>
  : {};
const handbookDict = handbook.handbookDict && typeof handbook.handbookDict === 'object' && !Array.isArray(handbook.handbookDict)
  ? handbook.handbookDict as Record<string, unknown>
  : {};

interface ParadoxOperator { id: string; name: string; stage_id: unknown; stage_name: unknown }
const operators: ParadoxOperator[] = Object.entries(stageData)
  .map(([charId, rawStage]) => {
    const stage = rawStage && typeof rawStage === 'object' && !Array.isArray(rawStage) ? rawStage as Record<string, unknown> : {};
    const character = characters[charId];
    const dictEntry = handbookDict[charId];
    const characterName = character && typeof character === 'object' && !Array.isArray(character)
      ? (character as Record<string, unknown>).name
      : undefined;
    const dictName = dictEntry && typeof dictEntry === 'object' && !Array.isArray(dictEntry)
      ? (dictEntry as Record<string, unknown>).infoName
      : undefined;
    return {
      id: charId,
      name: String(characterName || dictName || charId),
      stage_id: stage.stageId || stage.code,
      stage_name: stage.name || ''
    };
  })
  .filter(item => Boolean(item.stage_id))
  .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

await fs.mkdir(OUTPUT_DIR, { recursive: true });
await fs.writeFile(OUTPUT_FILE, JSON.stringify(operators, null, 2), 'utf-8');
console.log(`✅ 悖论模拟干员数据已保存: ${OUTPUT_FILE} (${operators.length} 个)`);
