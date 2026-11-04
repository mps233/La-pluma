import { isRecord } from '../utils/errors.ts';

/**
 * 活动作业的干员需求判断。
 *
 * MAA 的自动编队不会替用户补上未拥有的干员；但助战位可以补 1 名。这里只做
 * 选择阶段的轻量过滤：0 名缺失始终允许；1 名缺失仅在助战模式能补位时允许；
 * 2 名及以上直接跳过该候选/套装。OperBox 不可用时不做过滤。
 */

export interface MissingOperatorInfo {
  names: string[];
  count: number;
  missingGroups: number;
  unknown?: boolean;
}

function readNames(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(item => String(isRecord(item) ? item.name || '' : '').trim())
    .filter(Boolean))];
}

export function findMissingOperators(content: unknown = {}, ownedOperators: Set<string> | null = null): MissingOperatorInfo {
  if (!ownedOperators || ownedOperators.size === 0) {
    return { names: [], count: 0, missingGroups: 0, unknown: true };
  }

  const source = isRecord(content) ? content : {};
  const requiredNames = readNames(source.opers);
  const missingNames = requiredNames.filter(name => !ownedOperators.has(name));

  const groups = Array.isArray(source.groups) ? source.groups : [];
  let missingGroups = 0;
  for (const group of groups) {
    const groupNames = readNames(isRecord(group) ? group.opers : null);
    if (groupNames.length > 0 && !groupNames.some(name => ownedOperators.has(name))) {
      missingGroups += 1;
    }
  }

  return {
    names: missingNames,
    count: missingNames.length + missingGroups,
    missingGroups
  };
}

export function canRunWithOperators(missing: MissingOperatorInfo | null | undefined, preferences: unknown = {}) {
  if (!missing || missing.count === 0 || missing.unknown) return true;
  if (missing.count !== 1) return false;
  const source = isRecord(preferences) ? preferences : {};
  if (source.allowOneMissingOperator === false) return false;

  const supportUsage = Number(source.supportUsage || 0);
  if (supportUsage === 1) return true;
  if (supportUsage === 2) {
    const supportName = String(source.supportName || '').trim();
    return Boolean(supportName && missing.names.includes(supportName));
  }
  return false;
}

export function averageRatingLevel(items: unknown[]) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return 0;
  return list.reduce<number>((total, item) => total + (Number(isRecord(item) ? item.ratingLevel : 0) || 0), 0) / list.length;
}
