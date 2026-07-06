import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.join(__dirname, '../data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'paradox-operators.json');
const BASE = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel';

async function fetchJson(name) {
  const response = await fetch(`${BASE}/${name}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return response.json();
}

const [handbook, characters] = await Promise.all([
  fetchJson('handbook_info_table.json'),
  fetchJson('character_table.json')
]);

const operators = Object.entries(handbook.handbookStageData || {})
  .map(([charId, stage]) => ({
    id: charId,
    name: characters[charId]?.name || handbook.handbookDict?.[charId]?.infoName || charId,
    stage_id: stage.stageId || stage.code,
    stage_name: stage.name || ''
  }))
  .filter(item => item.stage_id)
  .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

await fs.mkdir(OUTPUT_DIR, { recursive: true });
await fs.writeFile(OUTPUT_FILE, JSON.stringify(operators, null, 2), 'utf-8');
console.log(`✅ 悖论模拟干员数据已保存: ${OUTPUT_FILE} (${operators.length} 个)`);
