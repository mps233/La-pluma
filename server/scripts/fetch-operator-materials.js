/**
 * 从 Kengxxiao/ArknightsGameData 获取干员材料数据
 * 自动生成 operator-materials.json
 */

import https from 'https';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GAMEDATA_URL = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/character_table.json';
const ITEM_TABLE_URL = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/item_table.json';
const OUTPUT_PATH = path.join(__dirname, '../data/operator-materials.json');

/**
 * 从 URL 获取 JSON 数据
 */
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

/**
 * 职业映射
 */
const professionMap = {
  'PIONEER': '先锋',
  'WARRIOR': '近卫',
  'SNIPER': '狙击',
  'TANK': '重装',
  'MEDIC': '医疗',
  'SUPPORT': '辅助',
  'CASTER': '术师',
  'SPECIAL': '特种'
};

/**
 * 解析干员材料数据
 */
function parseOperatorMaterials(characterData, itemTable) {
  const operators = {};
  
  for (const [charId, charInfo] of Object.entries(characterData)) {
    // 只处理可招募的干员（排除敌人、NPC等）
    if (!charInfo.phases || charInfo.phases.length === 0) continue;
    if (charInfo.isNotObtainable) continue;
    
    // 解析稀有度：TIER_1 = 1星, TIER_2 = 2星, ..., TIER_6 = 6星
    let rarity = 0;
    if (typeof charInfo.rarity === 'string' && charInfo.rarity.startsWith('TIER_')) {
      rarity = parseInt(charInfo.rarity.replace('TIER_', ''));
    } else if (typeof charInfo.rarity === 'number') {
      rarity = charInfo.rarity + 1; // 游戏内部从 0 开始
    }
    
    // 只处理 4 星及以上
    if (rarity < 4) continue;
    
    const operator = {
      id: charId,
      name: charInfo.name,
      rarity: rarity,
      profession: professionMap[charInfo.profession] || charInfo.profession
    };
    
    // 解析精英化材料
    if (charInfo.phases.length >= 2) {
      // 精英 1
      const phase1 = charInfo.phases[1];
      if (phase1.evolveCost) {
        operator.elite1 = {
          lmd: phase1.evolveCost.find(c => c.id === '4001')?.count || 0,
          materials: phase1.evolveCost
            .filter(c => c.id !== '4001')
            .map(c => ({
              id: c.id,
              name: itemTable.items[c.id]?.name || c.id,
              count: c.count
            }))
        };
      }
    }
    
    if (charInfo.phases.length >= 3) {
      // 精英 2
      const phase2 = charInfo.phases[2];
      if (phase2.evolveCost) {
        const materials = [];
        const chips = [];
        
        phase2.evolveCost.forEach(c => {
          if (c.id === '4001') return; // 跳过龙门币
          
          const item = {
            id: c.id,
            name: itemTable.items[c.id]?.name || c.id,
            count: c.count
          };
          
          // 芯片组单独分类
          if (c.id.startsWith('32')) {
            chips.push(item);
          } else {
            materials.push(item);
          }
        });
        
        operator.elite2 = {
          lmd: phase2.evolveCost.find(c => c.id === '4001')?.count || 0,
          materials,
          chips
        };
      }
    }
    
    // 只保存有精英化数据的干员
    if (operator.elite1 || operator.elite2) {
      operators[charId] = operator;
    }
  }
  
  return operators;
}

/**
 * 主函数
 */
async function main() {
  try {
    console.log('正在获取干员数据...');
    const characterData = await fetchJSON(GAMEDATA_URL);
    
    console.log('正在获取物品数据...');
    const itemTable = await fetchJSON(ITEM_TABLE_URL);
    
    console.log('正在解析材料数据...');
    const operators = parseOperatorMaterials(characterData, itemTable);
    
    const output = {
      operators,
      metadata: {
        version: '2.0.0',
        lastUpdated: new Date().toISOString().split('T')[0],
        totalOperators: Object.keys(operators).length,
        source: 'Kengxxiao/ArknightsGameData',
        notes: '自动从游戏数据生成，包含所有 4 星及以上可招募干员的精英化材料'
      }
    };
    
    console.log(`共解析 ${output.metadata.totalOperators} 个干员`);
    
    console.log('正在保存到文件...');
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
    
    console.log(`✓ 成功！数据已保存到: ${OUTPUT_PATH}`);
    console.log(`\n统计信息:`);
    
    // 统计各稀有度数量
    const rarityCount = {};
    for (const op of Object.values(operators)) {
      rarityCount[op.rarity] = (rarityCount[op.rarity] || 0) + 1;
    }
    
    console.log(`  6星: ${rarityCount[6] || 0} 个`);
    console.log(`  5星: ${rarityCount[5] || 0} 个`);
    console.log(`  4星: ${rarityCount[4] || 0} 个`);
    
  } catch (error) {
    console.error('错误:', error.message);
    process.exit(1);
  }
}

main();
