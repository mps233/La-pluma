import { readFile } from 'fs/promises';
import { join } from 'path';
import { execMaaCommand, getCurrentActivity } from './maaService.js';

function toArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function blocked(activity, reasonCode, reason) {
  return {
    state: 'blocked',
    canPrepare: false,
    canRun: false,
    reasonCode,
    reason,
    activity: {
      code: activity?.code || null,
      name: activity?.name || null,
      source: activity?.source || null,
      stages: activity?.stages || []
    },
    navigation: null
  };
}

/**
 * Checks that an activity's MAA stage file contains a complete home-screen
 * navigation chain. A stage list from a third-party source alone is not enough
 * to safely navigate the game UI.
 */
export function assessActivityNavigation(activity, tasks) {
  const code = String(activity?.code || '').trim().toUpperCase();
  if (!code) {
    return blocked(activity, 'activity-unavailable', '无法确认当前活动，未准备活动作业。');
  }
  if (!/^[A-Z0-9]{2,8}$/.test(code)) {
    return blocked(activity, 'activity-code-invalid', '当前活动代号格式异常，未准备活动作业。');
  }
  if (!tasks || typeof tasks !== 'object' || Array.isArray(tasks)) {
    return blocked(activity, 'navigation-resource-unavailable', `未找到 ${code} 的活动导航资源。`);
  }

  const openOptionKey = `${code}-OpenOpt`;
  const openOption = tasks[openOptionKey];
  const openKeys = [`${code}-OpenOcr`, `${code}-Open`];
  const openKey = openKeys.find(key => tasks[key]);
  const stageEntries = Object.entries(tasks).filter(([key, task]) =>
    new RegExp(`^${code}-(?:\\d+|EX-\\d+|S-\\d+|MO-\\d+|TR-\\d+)$`, 'i').test(key) && task && typeof task === 'object'
  );
  const hasOpenSequence = Boolean(openOption && openKey &&
    toArray(openOption.next).some(next => openKeys.includes(next)) &&
    toArray(tasks[openKey].next).length > 0);
  const hasStageEntry = stageEntries.some(([, task]) =>
    toArray(task.sub).includes(openOptionKey) && toArray(task.next).length > 0
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
      name: activity?.name || code,
      source: activity?.source || null,
      stages: activity?.stages || []
    },
    navigation: {
      source: 'maa-resource',
      stageFile: `tasks/Stages/${code}.json`,
      stageCount: stageEntries.length,
      entryTask: openOptionKey
    }
  };
}

async function loadActivityStageTasks(code) {
  const resourceDir = (await execMaaCommand('dir', ['resource'], null, null, false, true)).stdout.trim();
  if (!resourceDir) throw new Error('无法读取 MAA 资源目录');
  const stageFile = join(resourceDir, 'tasks', 'Stages', `${code}.json`);
  return JSON.parse(await readFile(stageFile, 'utf8'));
}

export async function getActivityRunPreflight(clientType = 'Official') {
  const activity = await getCurrentActivity(clientType);
  if (!activity?.code) return assessActivityNavigation(activity, null);

  try {
    const tasks = await loadActivityStageTasks(String(activity.code).toUpperCase());
    return assessActivityNavigation(activity, tasks);
  } catch (error) {
    return blocked(
      activity,
      'navigation-resource-unavailable',
      `未找到 ${activity.code} 的活动导航资源，未准备活动作业。`
    );
  }
}
