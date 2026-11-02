import { getErrorMessage } from '../utils/errors.ts';
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

    const buildingData = await buildingResponse.json() as Record<string, unknown>;
    const workshopFormulas = buildingData.workshopFormulas && typeof buildingData.workshopFormulas === 'object' && !Array.isArray(buildingData.workshopFormulas)
      ? buildingData.workshopFormulas as Record<string, unknown>
      : {};
    const manufactFormulas = buildingData.manufactFormulas && typeof buildingData.manufactFormulas === 'object' && !Array.isArray(buildingData.manufactFormulas)
      ? buildingData.manufactFormulas as Record<string, unknown>
      : {};

    console.log(`找到 ${Object.keys(workshopFormulas).length} 个工坊配方`);
    console.log(`找到 ${Object.keys(manufactFormulas).length} 个制造站配方`);

    // 建立 formulaId -> 配方详情 的映射
    const formulaMap: Record<string, Record<string, unknown>> = {};

    // 添加工坊配方
    for (const [formulaId, rawFormula] of Object.entries(workshopFormulas)) {
      if (!rawFormula || typeof rawFormula !== 'object' || Array.isArray(rawFormula)) continue;
      formulaMap[`WORKSHOP_${formulaId}`] = { ...rawFormula as Record<string, unknown>, roomType: 'WORKSHOP' };
    }

    // 添加制造站配方
    for (const [formulaId, rawFormula] of Object.entries(manufactFormulas)) {
      if (!rawFormula || typeof rawFormula !== 'object' || Array.isArray(rawFormula)) continue;
      formulaMap[`MANUFACTURE_${formulaId}`] = { ...rawFormula as Record<string, unknown>, roomType: 'MANUFACTURE' };
    }

    console.log('\n正在获取 item_table.json...');

    // 从 GitHub 获取 item_table.json
    const itemTableUrl = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/item_table.json';
    const itemResponse = await fetch(itemTableUrl);

    if (!itemResponse.ok) {
      throw new Error(`HTTP error! status: ${itemResponse.status}`);
    }

    const itemTable = await itemResponse.json() as Record<string, unknown>;
    const items = itemTable.items && typeof itemTable.items === 'object' && !Array.isArray(itemTable.items)
      ? itemTable.items as Record<string, unknown>
      : {};

    console.log(`找到 ${Object.keys(items).length} 个物品\n`);

    // 提取合成配方
    const recipes: Record<string, Record<string, unknown>> = {};
    let count = 0;


    for (const [itemId, rawItem] of Object.entries(items)) {
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue;
      const item = rawItem as Record<string, unknown>;
      // 检查是否有合成配方
      if (Array.isArray(item.buildingProductList) && item.buildingProductList.length > 0) {
        const firstProduct = item.buildingProductList[0];
        if (!firstProduct || typeof firstProduct !== 'object' || Array.isArray(firstProduct)) continue;
        const productInfo = firstProduct as Record<string, unknown>; // 取第一个配方

        // 处理工坊和制造站配方
        if (typeof productInfo.roomType === 'string' && productInfo.roomType && typeof productInfo.formulaId === 'string' && productInfo.formulaId) {
          const formulaKey = `${productInfo.roomType}_${productInfo.formulaId}`;
          const formula = formulaMap[formulaKey];

          if (formula && Array.isArray(formula.costs) && formula.costs.length > 0) {
            const materials: Record<string, unknown> = {};

            for (const rawCost of formula.costs) {
              if (!rawCost || typeof rawCost !== 'object' || Array.isArray(rawCost)) continue;
              const cost = rawCost as Record<string, unknown>;
              if (typeof cost.id === 'string' && cost.id && cost.count) {
                materials[cost.id] = cost.count;
              }
            }

            if (Object.keys(materials).length > 0) {
              recipes[itemId] = {
                id: itemId,
                name: String(item.name || ''),
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
    console.error('❌ 获取材料合成配方失败:', getErrorMessage(error));
    process.exit(1);
  }
}

// 执行
fetchMaterialFormulas();
