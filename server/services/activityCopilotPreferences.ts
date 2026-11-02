import { loadUserConfig } from './configStorageService.ts';
import { getOperBoxData } from './dataParserService.ts';
import { isRecord } from '../utils/errors.ts';

export interface CombatCopilotPreferences {
  raid: 'normal' | 'raid' | 'both';
  loopTimes: number | string;
  ignoreRequirements: boolean;
  useSanityPotion: boolean;
  addTrust: boolean;
  formationIndex: unknown;
  supportUsage: unknown;
  supportName: unknown;
  allowOneMissingOperator: boolean;
  formationMode: string;
}

export function normalizeRaid(value: unknown): 'normal' | 'raid' | 'both' {
  if (value === 'raid' || value === '1') return 'raid';
  if (value === 'both' || value === '2') return 'both';
  return 'normal';
}

export function getCombatCopilotPreferences(combatTasks: unknown = {}): CombatCopilotPreferences {
  const tasks = isRecord(combatTasks) ? combatTasks : {};
  const advancedParams = isRecord(tasks.advancedParams) ? tasks.advancedParams : {};
  const preferences = isRecord(advancedParams.copilot) ? advancedParams.copilot : {};
  const autoFormation = isRecord(tasks.autoFormation) ? tasks.autoFormation : {};
  return {
    raid: normalizeRaid(preferences.raid),
    loopTimes: typeof preferences.loopTimes === 'number' || typeof preferences.loopTimes === 'string' ? preferences.loopTimes : 1,
    ignoreRequirements: preferences.ignoreRequirements !== false,
    useSanityPotion: preferences.useSanityPotion === true,
    addTrust: preferences.addTrust === true,
    formationIndex: preferences.formationIndex,
    supportUsage: preferences.supportUsage,
    supportName: preferences.supportName,
    // 活动作业选关时允许缺少 1 名干员，由助战位补上。真正的补位仍要求
    // supportUsage 为“缺一个时使用”或指定助战与缺失干员一致。
    allowOneMissingOperator: preferences.allowOneMissingOperator !== false,
    formationMode: typeof autoFormation.copilot === 'string' ? autoFormation.copilot : 'auto'
  };
}

/**
 * 读取作业选择需要的本地上下文：用户配置的助战/编队偏好，以及 OperBox
 * 中已拥有的干员名。OperBox 缺失时返回 null，选择逻辑会跳过干员过滤。
 */
export async function loadActivitySelectionContext() {
  const configResult = await loadUserConfig('combat-tasks');
  const preferences = getCombatCopilotPreferences(configResult.success && 'data' in configResult ? configResult.data : {});

  let ownedOperators: Set<string> | null = null;
  try {
    const box = await getOperBoxData();
    const boxRecord = isRecord(box) ? box : {};
    const allOpers = Array.isArray(boxRecord.allOpers) ? boxRecord.allOpers : null;
    const hasOwnFlags = allOpers
      ? allOpers.some(oper => isRecord(oper) && Object.prototype.hasOwnProperty.call(oper, 'own'))
      : false;
    const source = hasOwnFlags
      ? allOpers || []
      : Array.isArray(boxRecord.data)
        ? boxRecord.data
        : [];
    const names = source
      .filter(oper => !isRecord(oper) || oper.own !== false)
      .map(oper => String(isRecord(oper) ? oper.name || '' : '').trim())
      .filter(Boolean);
    if (names.length) ownedOperators = new Set(names);
  } catch {
    // OperBox 是可选数据；没有识别过干员时保持 null，不能因此阻断作业选择。
  }

  return { preferences, ownedOperators };
}
