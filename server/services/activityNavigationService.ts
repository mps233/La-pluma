import { readFile } from 'fs/promises';
import { join } from 'path';
import { DEFAULT_CLIENT_TYPE } from '../config/connectionDefaults.ts';
import { execMaaCommand, getCurrentActivity } from './maaService.ts';
import { isRecord } from '../utils/errors.ts';

interface ActivitySummary {
  code: string | null;
  name: string | null;
  source: string | null;
  stages: unknown[];
  [key: string]: unknown;
}

interface ActivityNavigationResult {
  state: 'blocked' | 'ready';
  canPrepare: boolean;
  canRun: boolean;
  reasonCode: string | null;
  reason: string;
  activity: ActivitySummary;
  navigation: {
    source: string;
    stageFile: string;
    stageCount: number;
    entryTask: string;
  } | null;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

/**
 * MaaCore stage resources reference the shared open-option task as either
 * `CODE-OpenOpt` or an implicit variant such as `CODE-6@CODE-OpenOpt`.
 */
function referencesTask(values: unknown, taskName: string) {
  return toArray(values).some(value => (
    value === taskName || String(value).endsWith(`@${taskName}`)
  ));
}

function blocked(activity: unknown, reasonCode: string, reason: string): ActivityNavigationResult {
  const record = isRecord(activity) ? activity : {};
  return {
    state: 'blocked',
    canPrepare: false,
    canRun: false,
    reasonCode,
    reason,
    activity: {
      code: typeof record.code === 'string' ? record.code : null,
      name: typeof record.name === 'string' ? record.name : null,
      source: typeof record.source === 'string' ? record.source : null,
      stages: Array.isArray(record.stages) ? record.stages : []
    },
    navigation: null
  };
}

/**
 * Checks that an activity's MAA stage file contains a complete home-screen
 * navigation chain. A stage list from a third-party source alone is not enough
 * to safely navigate the game UI.
 */
export function assessActivityNavigation(activity: unknown, tasks: unknown): ActivityNavigationResult {
  const activityRecord = isRecord(activity) ? activity : {};
  const code = String(activityRecord.code || '').trim().toUpperCase();
  if (!code) {
    return blocked(activity, 'activity-unavailable', '无法确认当前活动，未准备活动作业。');
  }
  if (!/^[A-Z0-9]{2,8}$/.test(code)) {
    return blocked(activity, 'activity-code-invalid', '当前活动代号格式异常，未准备活动作业。');
  }
  if (!tasks || typeof tasks !== 'object' || Array.isArray(tasks)) {
    return blocked(activity, 'navigation-resource-unavailable', `未找到 ${code} 的活动导航资源。`);
  }

  const taskMap = isRecord(tasks) ? tasks : {};
  const openOptionKey = `${code}-OpenOpt`;
  const rawOpenOption = taskMap[openOptionKey];
  const openOption = isRecord(rawOpenOption) ? rawOpenOption : null;
  const openKeys: string[] = [`${code}-OpenOcr`, `${code}-Open`];
  const openKey = openKeys.find(key => Boolean(taskMap[key]));
  const stageEntries = Object.entries(taskMap).filter(([key, task]) =>
    new RegExp(`^${code}-(?:\\d+|EX-\\d+|S-\\d+|MO-\\d+|TR-\\d+)$`, 'i').test(key) && isRecord(task)
  );
  const rawOpenSequenceTask = openKey ? taskMap[openKey] : null;
  const openSequenceTask = isRecord(rawOpenSequenceTask) ? rawOpenSequenceTask : null;
  const hasOpenSequence = Boolean(openOption && openKey && openSequenceTask &&
    toArray(openOption.next).some(next => openKeys.some(key => referencesTask([next], key))) &&
    toArray(openSequenceTask.next).length > 0);
  const hasStageEntry = stageEntries.some(([, task]) =>
    isRecord(task) && referencesTask(task.sub, openOptionKey) && toArray(task.next).length > 0
  );

  if (!hasOpenSequence || !hasStageEntry) {
    return blocked(
      activity,
      'navigation-incomplete',
      `${code} 的资源未包含从主页进入活动关卡的完整导航链，未准备活动作业。`
    );
  }

  return {
    state: 'ready',
    canPrepare: true,
    canRun: false,
    reasonCode: null,
    reason: '已确认当前活动和从主页进入活动关卡的导航资源；此接口不会启动作业。',
    activity: {
      code,
      name: typeof activityRecord.name === 'string' && activityRecord.name ? activityRecord.name : code,
      source: typeof activityRecord.source === 'string' ? activityRecord.source : null,
      stages: Array.isArray(activityRecord.stages) ? activityRecord.stages : []
    },
    navigation: {
      source: 'maa-resource',
      stageFile: `tasks/Stages/${code}.json`,
      stageCount: stageEntries.length,
      entryTask: openOptionKey
    }
  };
}

async function loadActivityStageTasks(code: string): Promise<unknown> {
  const resourceDir = (await execMaaCommand('dir', ['resource'], null, null, false, true)).stdout.trim();
  if (!resourceDir) throw new Error('无法读取 MAA 资源目录');
  const stageFile = join(resourceDir, 'tasks', 'Stages', `${code}.json`);
  return JSON.parse(await readFile(stageFile, 'utf8'));
}

export async function getActivityRunPreflight(clientType: string = DEFAULT_CLIENT_TYPE): Promise<ActivityNavigationResult> {
  const activity = await getCurrentActivity(clientType);
  if (!isRecord(activity) || !activity.code) return assessActivityNavigation(activity, null);

  try {
    const tasks = await loadActivityStageTasks(String(activity.code).toUpperCase());
    return assessActivityNavigation(activity, tasks);
  } catch {
    return blocked(
      activity,
      'navigation-resource-unavailable',
      `未找到 ${String(activity.code)} 的活动导航资源，未准备活动作业。`
    );
  }
}
