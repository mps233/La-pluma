import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 从 ArknightsGameData 获取材料合成配方
 */
async function fetchMaterialFormulas() {
  try {
    console.log('正在获取 building_data.json...');
    
    // 先获取 building_data.json 中的配方详情
    const buildingUrl = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/building_data.json';
    const buildingResponse = await fetch(buildingUrl);
    
    if (!buildingResponse.ok) {
      throw new Error(`HTTP error! status: ${buildingResponse.status}`);
    }
    
    const buildingData = await buildingResponse.json();
    const workshopFormulas = buildingData.workshopFormulas || {};
    const manufactFormulas = buildingData.manufactFormulas || {};
    
    console.log(`找到 ${Object.keys(workshopFormulas).length} 个工坊配方`);
    console.log(`找到 ${Object.keys(manufactFormulas).length} 个制造站配方`);
    
    // 建立 formulaId -> 配方详情 的映射
    const formulaMap = {};
    
    // 添加工坊配方
    for (const [formulaId, formula] of Object.entries(workshopFormulas)) {
      formulaMap[`WORKSHOP_${formulaId}`] = { ...formula, roomType: 'WORKSHOP' };
    }
    
    // 添加制造站配方
    for (const [formulaId, formula] of Object.entries(manufactFormulas)) {
      formulaMap[`MANUFACTURE_${formulaId}`] = { ...formula, roomType: 'MANUFACTURE' };
    }
    
    console.log('\n正在获取 item_table.json...');
    
    // 从 GitHub 获取 item_table.json
    const itemTableUrl = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/item_table.json';
    const itemResponse = await fetch(itemTableUrl);
    
    if (!itemResponse.ok) {
      throw new Error(`HTTP error! status: ${itemResponse.status}`);
    }
    
    const itemTable = await itemResponse.json();
    const items = itemTable.items || {};
    
    console.log(`找到 ${Object.keys(items).length} 个物品\n`);
    
    // 提取合成配方
    const recipes = {};
    let count = 0;
    
    
    for (const [itemId, item] of Object.entries(items)) {
      // 检查是否有合成配方
      if (item.buildingProductList && item.buildingProductList.length > 0) {
        const productInfo = item.buildingProductList[0]; // 取第一个配方
        
        // 处理工坊和制造站配方
        if (productInfo.roomType && productInfo.formulaId) {
          const formulaKey = `${productInfo.roomType}_${productInfo.formulaId}`;
          const formula = formulaMap[formulaKey];
          
          if (formula && formula.costs && formula.costs.length > 0) {
            const materials = {};
            
            for (const cost of formula.costs) {
              if (cost.id && cost.count) {
                materials[cost.id] = cost.count;
              }
            }
            
            if (Object.keys(materials).length > 0) {
              recipes[itemId] = {
                id: itemId,
                name: item.name,
                type: productInfo.roomType === 'WORKSHOP' ? 'craft' : 'manufacture',
                materials
              };
              count++;
              
              // 打印前几个示例
              if (count <= 10) {
                console.log(`  ${itemId} (${item.name}) [${productInfo.roomType}]: ${JSON.stringify(materials)}`);
              }
            }
          }
        }
      }
    }
    
    console.log(`\n提取了 ${Object.keys(recipes).length} 个合成配方`);
    
    // 保存到文件
    const outputPath = join(__dirname, '../data/material-formulas.json');
    await writeFile(outputPath, JSON.stringify(recipes, null, 2), 'utf-8');
    
    console.log(`✅ 材料合成配方已保存到: ${outputPath}`);
    
    // 特别检查 D32钢
    if (recipes['30135']) {
      console.log('\n✅ 找到 D32钢 (30135) 的合成配方:');
      console.log(`  名称: ${recipes['30135'].name}`);
      console.log(`  材料: ${JSON.stringify(recipes['30135'].materials)}`);
    } else {
      console.log('\n⚠️  未找到 D32钢 (30135) 的合成配方');
    }
    
  } catch (error) {
    console.error('❌ 获取材料合成配方失败:', error.message);
    process.exit(1);
  }
}

// 执行
fetchMaterialFormulas();
