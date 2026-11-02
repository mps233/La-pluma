import { getErrorMessage } from '../utils/errors.ts';
import { writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

interface FetchDrop { stageId?: string; occPer?: number }
interface FetchMaterial { id: string; name: string; rarity: number; bestStages?: Array<{ stage: string; efficiency: number; dropRate: number }> }
interface FetchMaterialsFile { materials: Record<string, FetchMaterial>; recipes: Record<string, unknown>; stageSchedule: Record<string, unknown> }

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 从游戏数据获取完整的材料信息（包括刷取关卡）
 */
async function fetchAllMaterials() {
  try {
    console.log('正在获取 item_table.json...');

    const itemTableUrl = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/item_table.json';
    const itemResponse = await fetch(itemTableUrl);

    if (!itemResponse.ok) {
      throw new Error(`HTTP error! status: ${itemResponse.status}`);
    }

    const itemTable = await itemResponse.json() as unknown;
    const items = itemTable && typeof itemTable === 'object' && !Array.isArray(itemTable)
      ? (itemTable as Record<string, unknown>).items
      : null;
    const itemRecords = items && typeof items === 'object' && !Array.isArray(items)
      ? items as Record<string, unknown>
      : {};

    console.log(`找到 ${Object.keys(itemRecords).length} 个物品\n`);

    // 提取材料信息（只要材料类型的物品）
    const materials: Record<string, FetchMaterial> = {};
    let count = 0;

    for (const [itemId, rawItem] of Object.entries(itemRecords)) {
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue;
      const item = rawItem as Record<string, unknown>;
      // 只处理材料类型（itemType === 'MATERIAL'）
      if (item.itemType === 'MATERIAL' && item.classifyType === 'MATERIAL') {
        // 检查是否有关卡掉落信息
        const stageDropList = Array.isArray(item.stageDropList) ? item.stageDropList : [];
        const bestStages: Array<{ stage: string; efficiency: number; dropRate: number }> = [];

        // 简单处理：取前3个关卡作为推荐关卡
        for (const rawDrop of stageDropList.slice(0, 3)) {
          if (!rawDrop || typeof rawDrop !== 'object' || Array.isArray(rawDrop)) continue;
          const drop = rawDrop as FetchDrop;
          if (typeof drop.stageId === 'string' && drop.stageId && typeof drop.occPer === 'number' && drop.occPer) {
            bestStages.push({
              stage: drop.stageId,
              efficiency: 1.0, // 默认效率
              dropRate: parseFloat((drop.occPer / 10000).toFixed(4)) // occPer 是万分比
            });
          }
        }

        const name = String(item.name || '');
        const rarity = parseInt(String(item.rarity ?? ''), 10) || 0;
        materials[itemId] = {
          id: itemId,
          name,
          rarity,
          bestStages: bestStages.length > 0 ? bestStages : undefined
        };

        count++;

        // 打印前几个示例
        if (count <= 10) {
          console.log(`  ${itemId} (${name}) [稀有度${rarity}] - ${bestStages.length} 个关卡`);
        }
      }
    }

    console.log(`\n提取了 ${Object.keys(materials).length} 个材料`);

    // 读取现有的 materials.json
    const materialsPath = join(__dirname, '../data/materials.json');
    let existingData: Record<string, unknown>;
    try {
      const data = await readFile(materialsPath, 'utf-8');
      const parsed = JSON.parse(data) as unknown;
      existingData = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      existingData = { materials: {}, recipes: {}, stageSchedule: {} };
    }

    // 合并材料信息（保留 recipes 和 stageSchedule）
    const newData: FetchMaterialsFile = {
      materials,
      recipes: existingData.recipes && typeof existingData.recipes === 'object' && !Array.isArray(existingData.recipes) ? existingData.recipes as Record<string, unknown> : {},
      stageSchedule: existingData.stageSchedule && typeof existingData.stageSchedule === 'object' && !Array.isArray(existingData.stageSchedule) ? existingData.stageSchedule as Record<string, unknown> : {}
    };

    // 保存到文件
    await writeFile(materialsPath, JSON.stringify(newData, null, 2), 'utf-8');

    console.log(`✅ 材料信息已保存到: ${materialsPath}`);
    console.log(`总共 ${Object.keys(materials).length} 个材料`);

    // 特别检查异铁
    if (materials['30042']) {
      console.log('\n✅ 找到异铁 (30042):');
      console.log(`  名称: ${materials['30042'].name}`);
      console.log(`  稀有度: ${materials['30042'].rarity}`);
      console.log(`  关卡数: ${materials['30042'].bestStages?.length || 0}`);
    }

  } catch (error) {
    console.error('❌ 获取材料信息失败:', getErrorMessage(error));
    process.exit(1);
  }
}

// 执行
fetchAllMaterials();
