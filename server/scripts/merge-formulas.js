import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 合并材料合成配方到 materials.json
 */
async function mergeFormulas() {
  try {
    console.log('正在读取文件...');
    
    // 读取 materials.json
    const materialsPath = join(__dirname, '../data/materials.json');
    const materialsData = JSON.parse(await readFile(materialsPath, 'utf-8'));
    
    // 读取 material-formulas.json
    const formulasPath = join(__dirname, '../data/material-formulas.json');
    const formulasData = JSON.parse(await readFile(formulasPath, 'utf-8'));
    
    console.log(`materials.json 中有 ${Object.keys(materialsData.recipes || {}).length} 个配方`);
    console.log(`material-formulas.json 中有 ${Object.keys(formulasData).length} 个配方`);
    
    // 合并配方（新配方会覆盖旧配方）
    materialsData.recipes = {
      ...materialsData.recipes,
      ...formulasData
    };
    
    console.log(`合并后共有 ${Object.keys(materialsData.recipes).length} 个配方`);
    
    // 保存回 materials.json
    await writeFile(materialsPath, JSON.stringify(materialsData, null, 2), 'utf-8');
    
    console.log('✅ 配方已成功合并到 materials.json');
    
    // 验证 D32钢
    if (materialsData.recipes['30135']) {
      console.log('\n✅ D32钢 (30135) 配方:');
      console.log(`  名称: ${materialsData.recipes['30135'].name}`);
      console.log(`  材料: ${JSON.stringify(materialsData.recipes['30135'].materials)}`);
    }
    
  } catch (error) {
    console.error('❌ 合并配方失败:', error.message);
    process.exit(1);
  }
}

// 执行
mergeFormulas();
