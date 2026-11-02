import { getErrorMessage } from '../utils/errors.ts';
/**
 * 获取明日方舟游戏资源数据
 * 包括：干员、技能、物品/材料等
 */

import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 游戏数据仓库
const GAME_DATA_BASE = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata';

// CDN 基础路径
// 注意：官方 CDN 上只有 avatar/ 目录（用户头像），没有干员、技能、物品图片
// 这些图片需要从第三方来源获取，或使用降级方案（首字母、图标等）
const CDN_BASE: string | null = null; // 设置为 null 表示不生成图片 URL

// 输出路径
const OUTPUT_DIR = path.join(__dirname, '../data');

/**
 * 获取干员表数据
 */
async function fetchCharacterTable(): Promise<Record<string, unknown>> {
  console.log('📥 正在获取干员表数据...');

  try {
    const response = await fetch(`${GAME_DATA_BASE}/excel/character_table.json`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as Record<string, unknown>;
    console.log('✅ 干员表数据获取成功');
    return data;
  } catch (error) {
    console.error('❌ 获取干员表失败:', getErrorMessage(error));
    throw error;
  }
}

/**
 * 获取技能表数据
 */
async function fetchSkillTable(): Promise<Record<string, unknown>> {
  console.log('📥 正在获取技能表数据...');

  try {
    const response = await fetch(`${GAME_DATA_BASE}/excel/skill_table.json`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as Record<string, unknown>;
    console.log('✅ 技能表数据获取成功');
    return data;
  } catch (error) {
    console.error('❌ 获取技能表失败:', getErrorMessage(error));
    throw error;
  }
}

/**
 * 获取物品表数据
 */
async function fetchItemTable(): Promise<Record<string, unknown>> {
  console.log('📥 正在获取物品表数据...');

  try {
    const response = await fetch(`${GAME_DATA_BASE}/excel/item_table.json`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as Record<string, unknown>;
    console.log('✅ 物品表数据获取成功');
    return data;
  } catch (error) {
    console.error('❌ 获取物品表失败:', getErrorMessage(error));
    throw error;
  }
}

/**
 * 解析干员数据
 */
function parseCharacterData(characterTable: Record<string, unknown>): Record<string, unknown> {
  console.log('🔄 正在解析干员数据...');

  const characters: Record<string, unknown> = {};

  Object.keys(characterTable).forEach(charId => {
    const rawChar = characterTable[charId];
    if (!rawChar || typeof rawChar !== 'object' || Array.isArray(rawChar)) return;
    const char = rawChar as Record<string, unknown>;

    // 跳过非干员数据
    if (!char.name || charId.startsWith('trap_') || charId.startsWith('token_')) {
      return;
    }

    characters[charId] = {
      id: charId,
      name: char.name,
      rarity: char.rarity,
      profession: char.profession,
      subProfessionId: char.subProfessionId,

      // 图片 URL 设置为 null（官方 CDN 上不存在这些图片）
      // 前端应使用降级方案：首字母、职业图标、渐变色块等
      avatar: null,
      portrait: null,
      fullPortrait: null,

      // 技能列表
      skills: Array.isArray(char.skills) ? char.skills.map(rawSkill => {
        const skill = rawSkill && typeof rawSkill === 'object' && !Array.isArray(rawSkill) ? rawSkill as Record<string, unknown> : {};
        return {
          skillId: skill.skillId,
          levelUpCostCond: skill.levelUpCostCond
        };
      }) : []
    };
  });

  console.log(`✅ 解析完成，共 ${Object.keys(characters).length} 个干员`);
  return characters;
}

/**
 * 解析技能数据
 */
function parseSkillData(skillTable: Record<string, unknown>): Record<string, unknown> {
  console.log('🔄 正在解析技能数据...');

  const skills: Record<string, unknown> = {};

  Object.keys(skillTable).forEach(skillId => {
    const rawSkill = skillTable[skillId];
    if (!rawSkill || typeof rawSkill !== 'object' || Array.isArray(rawSkill)) return;
    const skill = rawSkill as Record<string, unknown>;

    skills[skillId] = {
      id: skillId,
      name: Array.isArray(skill.levels) && skill.levels[0] && typeof skill.levels[0] === 'object' ? (skill.levels[0] as Record<string, unknown>).name || skillId : skillId,

      // 技能图标
      icon: `${CDN_BASE}/skill_icon/${skill.iconId || skillId}.png`,

      // 技能等级数据
      levels: Array.isArray(skill.levels) ? skill.levels.map(rawLevel => {
        const level = rawLevel && typeof rawLevel === 'object' && !Array.isArray(rawLevel) ? rawLevel as Record<string, unknown> : {};
        return {
          name: level.name,
          description: level.description,
          spData: level.spData,
          duration: level.duration
        };
      }) : []
    };
  });

  console.log(`✅ 解析完成，共 ${Object.keys(skills).length} 个技能`);
  return skills;
}

/**
 * 解析物品数据
 */
function parseItemData(itemTable: Record<string, unknown>): Record<string, unknown> {
  console.log('🔄 正在解析物品数据...');

  const items: Record<string, unknown> = {};
  const itemsData = itemTable.items && typeof itemTable.items === 'object' && !Array.isArray(itemTable.items)
    ? itemTable.items as Record<string, unknown>
    : {};

  Object.keys(itemsData).forEach(itemId => {
    const rawItem = itemsData[itemId];
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return;
    const item = rawItem as Record<string, unknown>;

    items[itemId] = {
      id: itemId,
      name: item.name,
      description: item.description,
      rarity: item.rarity,
      itemType: item.itemType,

      // 物品图标
      icon: `${CDN_BASE}/item_icon/${item.iconId || itemId}.png`,

      // 分类
      classifyType: item.classifyType,

      // 是否可以在商店购买
      obtainApproach: item.obtainApproach
    };
  });

  console.log(`✅ 解析完成，共 ${Object.keys(items).length} 个物品`);
  return items;
}

/**
 * 保存数据到文件
 */
async function saveData(filename: string, data: Record<string, unknown>) {
  const filepath = path.join(OUTPUT_DIR, filename);

  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`✅ 数据已保存到: ${filepath}`);
    console.log(`📊 总计 ${Object.keys(data).length} 条记录`);
  } catch (error) {
    console.error(`❌ 保存数据失败:`, getErrorMessage(error));
    throw error;
  }
}

/**
 * 显示示例数据
 */
function showExamples(data: Record<string, unknown>, count = 5) {
  const examples = Object.keys(data).slice(0, count);
  console.log('\n示例数据:');
  examples.forEach(key => {
    const rawItem = data[key];
    const item = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem) ? rawItem as Record<string, unknown> : {};
    console.log(`  ${key}: ${String(item.name || item.id || '')}`);
  });
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('   明日方舟游戏资源数据获取工具');
  console.log('========================================\n');

  try {
    // 1. 获取干员数据
    console.log('【1/3】处理干员数据');
    console.log('─────────────────────────────────────');
    const characterTable = await fetchCharacterTable();
    const characters = parseCharacterData(characterTable);
    await saveData('characters.json', characters);
    showExamples(characters);

    console.log('\n');

    // 2. 获取技能数据
    console.log('【2/3】处理技能数据');
    console.log('─────────────────────────────────────');
    const skillTable = await fetchSkillTable();
    const skills = parseSkillData(skillTable);
    await saveData('skills.json', skills);
    showExamples(skills);

    console.log('\n');

    // 3. 获取物品数据
    console.log('【3/3】处理物品数据');
    console.log('─────────────────────────────────────');
    const itemTable = await fetchItemTable();
    const items = parseItemData(itemTable);
    await saveData('items.json', items);
    showExamples(items);

    console.log('\n========================================');
    console.log('   ✅ 所有任务完成！');
    console.log('========================================');
    console.log('\n生成的文件:');
    console.log(`  - characters.json (${Object.keys(characters).length} 个干员)`);
    console.log(`  - skills.json (${Object.keys(skills).length} 个技能)`);
    console.log(`  - items.json (${Object.keys(items).length} 个物品)`);

  } catch (error) {
    console.error('\n❌ 执行失败:', getErrorMessage(error));
    process.exit(1);
  }
}

// 运行
main();
