import { writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
    
    const itemTable = await itemResponse.json();
    const items = itemTable.items || {};
    
    console.log(`找到 ${Object.keys(items).length} 个物品\n`);
    
    // 提取材料信息（只要材料类型的物品）
    const materials = {};
    let count = 0;
    
    for (const [itemId, item] of Object.entries(items)) {
      // 只处理材料类型（itemType === 'MATERIAL'）
      if (item.itemType === 'MATERIAL' && item.classifyType === 'MATERIAL') {
        // 检查是否有关卡掉落信息
        const stageDropList = item.stageDropList || [];
        const bestStages = [];
        
        // 简单处理：取前3个关卡作为推荐关卡
        for (const drop of stageDropList.slice(0, 3)) {
          if (drop.stageId && drop.occPer) {
            bestStages.push({
              stage: drop.stageId,
              efficiency: 1.0, // 默认效率
              dropRate: parseFloat((drop.occPer / 10000).toFixed(4)) // occPer 是万分比
            });
          }
        }
        
        materials[itemId] = {
          id: itemId,
          name: item.name,
          rarity: parseInt(item.rarity) || 0, // 确保是数字
          bestStages: bestStages.length > 0 ? bestStages : undefined
        };
        
        count++;
        
        // 打印前几个示例
        if (count <= 10) {
          console.log(`  ${itemId} (${item.name}) [稀有度${parseInt(item.rarity) || 0}] - ${bestStages.length} 个关卡`);
        }
      }
    }
    
    console.log(`\n提取了 ${Object.keys(materials).length} 个材料`);
    
    // 读取现有的 materials.json
    const materialsPath = join(__dirname, '../data/materials.json');
    let existingData;
    try {
      const data = await readFile(materialsPath, 'utf-8');
      existingData = JSON.parse(data);
    } catch (error) {
      existingData = { materials: {}, recipes: {}, stageSchedule: {} };
    }
    
    // 合并材料信息（保留 recipes 和 stageSchedule）
    const newData = {
      materials,
      recipes: existingData.recipes || {},
      stageSchedule: existingData.stageSchedule || {}
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
    console.error('❌ 获取材料信息失败:', error.message);
    process.exit(1);
  }
}

// 执行
fetchAllMaterials();
