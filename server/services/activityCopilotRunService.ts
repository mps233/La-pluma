import { asErrorWithCode, isRecord } from '../utils/errors.ts';
import type { ErrorWithCode } from '../utils/errors.ts';
import { getErrorMessage } from '../utils/errors.ts';
import { findActivityCopilotCandidates } from './activityCopilotDiscoveryService.ts';
import { loadActivitySelectionContext } from './activityCopilotPreferences.ts';
import { buildCopilotPlan, ensureCurrentMapActivityResource, executeCopilotPlan, executeSelectedCopilotEntries } from './copilotPlanService.ts';
import { getActivityRunPreflight } from './activityNavigationService.ts';
import { getMaaConfigDir, execDynamicTask, createMaaLogCheckpoint, readMaaLogSince } from './maaService.ts';
import { withMaaExecutionLease } from './executionCoordinatorService.ts';
import { updateMaaResources } from './resourceUpdateService.ts';
import { DEFAULT_CLIENT_TYPE } from '../config/connectionDefaults.ts';
import { getMaaResourceDir } from '../config/paths.ts';
import { averageRatingLevel } from './activityCopilotSelectionService.ts';

export { getCombatCopilotPreferences } from './activityCopilotPreferences.ts';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
const activityProgressPath = join(dataDir, 'activity-copilot-progress.json');
const RESOURCE_REFRESH_INTERVAL = 6 * 60 * 60 * 1000;
const resourceRefreshAttempts = new Map<string, number>();
interface ActivityRef {
  code?: string | null
  name?: string | null
  stages?: unknown[]
  [key: string]: unknown
}

interface ActivityProgressEntry {
  stages: string[]
  updatedAt?: string
}

type ActivityProgress = Record<string, ActivityProgressEntry>

interface ActivityCompletionEntry {
  displayStage?: string
  stage?: string
  success?: boolean
  [key: string]: unknown
}

interface ActivityRunPlan {
  state: string
  reason?: string
  activity?: ActivityRef
  entries: ActivityCompletionEntry[]
  navigationMode?: string
  requiresUserOnActivityMap?: boolean
  currentMapResource?: unknown
}

interface ActivityCandidateStage {
  stage: string
  candidates?: Array<{
    id: number
    uri: string
    presetFormation?: boolean
    title?: string
    ratingLevel?: number
    ratingRatio?: number
    missingOperators?: string[]
    requiresSupport?: boolean
  }>
}

interface ActivityCandidatesPlan {
  state?: string
  reason?: string
  stages?: ActivityCandidateStage[]
  preflight?: { activity?: ActivityRef; [key: string]: unknown }
  [key: string]: unknown
}

interface ActivityLifecycle {
  runId?: string
  onProgress?: (progress: unknown, taskResults?: unknown[] | null) => unknown
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}


export function shouldRefreshActivityNavigation(preflight: unknown = {}, lastAttemptAt = 0, now = Date.now()): boolean {
  const record = asRecord(preflight);
  return record.reasonCode === 'navigation-resource-unavailable' &&
    Boolean(asRecord(record.activity).code) &&
    now - lastAttemptAt >= RESOURCE_REFRESH_INTERVAL;
}

/**
 * MAA Copilot 只会在当前关卡界面里识别并滑动找关，不会启动游戏，也不会从
 * 主界面打开活动页。首页导航模式必须先重启客户端、进入终端并选中一个具体
 * 活动关卡，否则游戏未打开或停在其他界面时会一直横向滑动。
 */
export function buildActivityPreparationTasks(
  candidates: unknown = {},
  clientType: string = DEFAULT_CLIENT_TYPE,
  navigationStage = ''
): Array<{ name: string; type: string; params: Record<string, unknown> }> {
  const record = asRecord(candidates);
  const entryTask = String(asRecord(asRecord(record.preflight).navigation).entryTask || '').trim();
  if (record.navigationMode === 'current-map-fallback' || !entryTask) return [];

  const activityStages = new Set(asArray(asRecord(asRecord(record.preflight).activity).stages)
    .map(stage => String(stage || '').trim().toUpperCase())
    .filter(Boolean));
  const requestedStage = String(navigationStage || '').trim().toUpperCase();
  const stageTask = requestedStage && activityStages.has(requestedStage) ? requestedStage : '';
  // 优先运行具体关卡任务（例如 TL-4）：它会先走 <CODE>-OpenOpt 打开活动页，
  // 再按关卡名点击地图节点。通用的 OpenOpt 链末尾会用空文本 OCR 误点销量等
  // 非关卡元素，导致 Copilot 停在弹窗上继续横滑。
  const navigationTask = stageTask || entryTask;
  return [
    // 上一次运行可能停在活动地图、关卡详情或活动弹窗；StartUp 不会强制
    // 回到主界面。先关闭客户端再启动，能保证每次导航都从干净的主界面开始。
    { name: '关闭游戏', type: 'CloseDown', params: { client_type: clientType } },
    { name: '启动游戏', type: 'StartUp', params: { client_type: clientType, start_game_enabled: true } },
    { name: '进入终端', type: 'Custom', params: { task_names: ['Terminal-Entry'] } },
    // 终端页的动画/活动横幅加载晚于点击，立刻执行活动入口会偶发识别失败。
    { name: '等待终端加载', type: 'Custom', params: { task_names: ['SleepThenStop'] } },
    { name: '等待终端加载 2', type: 'Custom', params: { task_names: ['SleepThenStop'] } },
    { name: stageTask ? `选择活动关卡 ${stageTask}` : '打开活动页', type: 'Custom', params: { task_names: [navigationTask] } }
  ];
}


export function selectActivitySetEntries<T extends { displayStage?: unknown; itemIndex: number }>(
  entries: T[],
  activityStages: unknown,
  selectedIndexes: number[] = []
): T[] {
  const stages = new Set(asArray(activityStages).map(stage => String(stage || '').toUpperCase()).filter(Boolean));
  const requested = new Set((selectedIndexes || []).map(Number).filter(Number.isInteger));
  return (Array.isArray(entries) ? entries : []).filter(entry => (
    stages.has(String(entry?.displayStage || '').toUpperCase()) &&
    (!requested.size || requested.has(entry.itemIndex))
  ));
}

export interface ActivitySetExecutionOptions {
  setId: string;
  selectedIndexes?: number[];
  raid?: 'normal' | 'raid' | 'both';
  options?: Record<string, unknown>;
  clientType?: string;
}

/**
 * Execute one explicitly selected activity copilot set after performing the
 * same activity navigation preparation used by the automatic activity runner.
 * This keeps the manual "fill set, then execute" flow functionally aligned with
 * the old dashboard action.
 */
export async function runCurrentActivitySet(
  input: ActivitySetExecutionOptions,
  lifecycle: ActivityLifecycle = {}
): Promise<Record<string, unknown>> {
  const setId = String(input.setId || '').trim();
  if (!setId) throw new Error('缺少活动作业集 ID');
  const clientType = input.clientType || DEFAULT_CLIENT_TYPE;
  const raid = input.raid || 'normal';

  let preflight = await getActivityRunPreflight(clientType);
  if (preflight.state !== 'ready' && preflight.reasonCode === 'navigation-resource-unavailable') {
    try {
      await updateMaaResources();
      preflight = await getActivityRunPreflight(clientType);
    } catch {
      // Keep the original preflight error below so the caller gets a stable failure.
    }
  }
  if (preflight.state !== 'ready') {
    throw new Error(preflight.reason || '活动导航资源未就绪');
  }

  const activity = asRecord(preflight.activity);
  const activityStageSet = new Set(asArray(activity.stages).map(stage => String(stage || '').toUpperCase()).filter(Boolean));
  if (!activityStageSet.size) throw new Error('当前活动没有可执行关卡');

  const setPlan = await buildCopilotPlan(setId, raid);
  const selectedEntries = selectActivitySetEntries(setPlan.entries, [...activityStageSet], input.selectedIndexes || []);
  if (!selectedEntries.length) throw new Error('作业集不包含当前活动关卡');
  const selectedIndexes = [...new Set(selectedEntries.map(entry => entry.itemIndex))];
  const navigationStage = selectedEntries[0]?.displayStage || '';
  const options = buildActivityExecutionOptions(input.options || {}, clientType, 'home-navigation');

  try {
    const execution = await withMaaExecutionLease(
      { source: 'activity-copilot', taskName: '当前活动作业', command: 'activity-copilot' },
      async () => {
        await runActivityPreparation({ preflight, navigationMode: 'home-navigation' }, clientType, navigationStage);
        return executeCopilotPlan({
          setId,
          raid,
          selectedIndexes,
          options: { ...options, navigationStage },
          lifecycle
        });
      }
    );
    await recordActivityCompletion(
      activity,
      (execution.results || [])
        .filter(entry => entry.success !== false)
        .map(entry => ({ displayStage: String(entry.displayStage || ''), success: true }))
    );
    return {
      ...execution,
      executed: true,
      source: 'matching-set',
      activity,
      plan: { ...execution.plan, activity }
    };
  } catch (error) {
    const partialResults = asArray(asErrorWithCode(error).copilotPlan?.results);
    await recordActivityCompletion(
      activity,
      partialResults
        .filter(isRecord)
        .filter(entry => entry.success !== false && typeof entry.displayStage === 'string')
        .map(entry => ({ displayStage: entry.displayStage as string, success: true }))
    ).catch(() => undefined);
    throw error;
  }
}

async function loadActivityProgress(): Promise<ActivityProgress> {
  try { return JSON.parse(await readFile(activityProgressPath, 'utf8')) as ActivityProgress; } catch { return {}; }
}

async function saveActivityProgress(progress: ActivityProgress): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(activityProgressPath, JSON.stringify(progress, null, 2));
}

export function summarizeActivityCompletion(activity: unknown = {}, progress: ActivityProgress = {}): { known: boolean; complete: boolean; completedStages: string[]; totalStages: number; source: string } {
  const activityRecord = asRecord(activity);
  const stages: string[] = [...new Set(asArray(activityRecord.stages).map(stage => String(stage || '').toUpperCase()).filter(Boolean))];
  if (!activityRecord.code || !stages.length) return { known: false, complete: false, completedStages: [], totalStages: stages.length, source: 'local-activity-progress' };
  const completedStages = progress[String(activityRecord.code).toUpperCase()]?.stages || [];
  return {
    known: true,
    complete: stages.every(stage => completedStages.includes(stage)),
    completedStages: stages.filter(stage => completedStages.includes(stage)),
    totalStages: stages.length,
    source: 'local-activity-progress'
  };
}

export async function getActivityCompletion(activity: unknown = {}) {
  return summarizeActivityCompletion(activity, await loadActivityProgress());
}

async function recordActivityCompletion(activity: unknown, entries: ActivityCompletionEntry[]): Promise<void> {
  const progress = await loadActivityProgress();
  const code = String(asRecord(activity).code).toUpperCase();
  const existing = new Set(progress[code]?.stages || []);
  entries.filter(entry => entry.success !== false).forEach(entry => {
    if (entry.displayStage) existing.add(entry.displayStage);
  });
  progress[code] = { stages: [...existing].sort(), updatedAt: new Date().toISOString() };
  await saveActivityProgress(progress);
}

export function buildActivityCopilotRunPlan(candidatePlan: unknown, preferences: Record<string, unknown> = {}): ActivityRunPlan {
  const plan = candidatePlan as ActivityCandidatesPlan;
  if (plan?.state !== 'candidates-ready') {
    return {
      state: 'blocked',
      reason: plan?.reason || '活动作业候选尚未就绪。',
      entries: []
    };
  }

  const candidateStages = plan.stages || [];
  const missingStages = candidateStages.filter(stage => !stage.candidates?.length).map(stage => stage.stage);
  if (missingStages.length) {
    return {
      state: 'blocked',
      reason: `以下活动关卡没有可靠作业，未执行不完整流程：${missingStages.join('、')}`,
      entries: []
    };
  }

  const entries: ActivityCompletionEntry[] = [];
  const unsupportedRaidStages: string[] = [];
  for (const stage of candidateStages) {
    const candidate = stage.candidates?.[0];
    if (!candidate) continue;
    const requestedModes = preferences.raid === 'both'
      ? ['normal', 'raid']
      : [preferences.raid || 'normal'];
    for (const mode of requestedModes) {
      if (mode === 'raid' && candidate.presetFormation) {
        if (preferences.raid === 'raid') unsupportedRaidStages.push(stage.stage);
        continue;
      }
      entries.push({
        copilotId: candidate.id,
        uri: candidate.uri,
        displayStage: stage.stage,
        mode,
        presetFormation: candidate.presetFormation === true,
        title: candidate.title,
        ratingLevel: Number(candidate.ratingLevel) || 0,
        ratingRatio: Number(candidate.ratingRatio) || 0,
        missingOperators: candidate.missingOperators || [],
        requiresSupport: candidate.requiresSupport === true
      });
    }
  }

  if (unsupportedRaidStages.length || !entries.length) {
    return {
      state: 'blocked',
      reason: unsupportedRaidStages.length
        ? `以下关卡只有预设编队作业，不能执行突袭：${unsupportedRaidStages.join('、')}`
        : '没有与当前作业偏好兼容的活动作业。',
      entries: []
    };
  }

  return {
    state: 'ready',
    reason: '已为每个当前活动关卡选择一份可靠作业，将按关卡顺序执行。',
    activity: plan.preflight?.activity,
    entries
  };
}

export function hasCompletedActivityNavigation(logText: string, expectedTaskId: number) {
  return String(logText || '').split('\n').some((line: string) => {
    const marker = 'TaskChainCompleted ';
    const index = line.indexOf(marker);
    if (index < 0) return false;
    try {
      const payload = JSON.parse(line.slice(index + marker.length));
      return payload?.taskchain === 'Custom' && Number(payload?.taskid) === expectedTaskId;
    } catch {
      return false;
    }
  });
}

function activityStageNumber(stage: string): number | null {
  const match = stage.match(/-(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function resolvePreparationStage(requestedStage: string, activityCode: string): Promise<string> {
  const code = String(activityCode || '').trim().toUpperCase();
  const requested = String(requestedStage || '').trim().toUpperCase();
  if (!code) return '';
  let installed: Record<string, unknown> = {};
  try {
    const raw: unknown = JSON.parse(await readFile(join(getMaaResourceDir(), 'tasks', 'Stages', `${code}.json`), 'utf8'));
    if (isRecord(raw)) installed = raw;
  } catch {
    // No installed stage task file: fall back to the generic activity entry task.
  }
  const available = Object.keys(installed)
    .map(stage => stage.toUpperCase())
    .filter(stage => new RegExp(`^${code}-\\d+$`).test(stage));
  if (!available.length) return '';
  if (available.includes(requested)) return requested;
  const requestedNumber = activityStageNumber(requested);
  if (requestedNumber === null) return available.sort((left, right) => (activityStageNumber(left) ?? 0) - (activityStageNumber(right) ?? 0))[0] || '';
  // Prepare the activity map through a stage task MaaResource actually ships,
  // then let Copilot navigate to the requested first stage.
  return available
    .sort((left, right) => Math.abs((activityStageNumber(left) ?? 0) - requestedNumber) - Math.abs((activityStageNumber(right) ?? 0) - requestedNumber))[0]
    || '';
}

export function buildActivityExecutionOptions(
  preferences: unknown,
  clientType: string,
  navigationMode: string | null | undefined = null
): Record<string, unknown> {
  return {
    ...asRecord(preferences),
    clientType,
    // 活动作业按用户要求默认在理智不足时使用理智药；手动作业仍遵循自己的
    // 保存偏好，不在这里统一提高为 true。
    useSanityPotion: true,
    // 活动作业的 Copilot 列表已按导航关卡排序；不使用原生 maa copilot，
    // 否则会丢失首关顺序，从已经打开的错误关卡开始找关。
    nativeDelegation: false,
    ...(navigationMode === 'current-map-fallback' ? { userResource: true } : {})
  };
}

async function runActivityPreparation(candidates: unknown, clientType: string, navigationStage: string): Promise<true | null> {
  const activityCode = String(asRecord(asRecord(asRecord(candidates).preflight).activity).code || '');
  const preparationStage = await resolvePreparationStage(navigationStage, activityCode);
  const tasks = buildActivityPreparationTasks(candidates, clientType, preparationStage);
  if (!tasks.length) return null;

  const checkpoint = await createMaaLogCheckpoint();
  try {
    await execDynamicTask(
      `activity_prepare_${Date.now()}`,
      { tasks },
      '活动导航',
      'activity',
      true,
      false,
      { clientType }
    );
  } catch (error) {
    const navError = new Error(`活动导航未完成，已停止活动作业：${getErrorMessage(error)}`) as ErrorWithCode;
    navError.code = 'ACTIVITY_NAVIGATION_FAILED';
    navError.statusCode = 422;
    navError.retryable = true;
    throw navError;
  }

  // MAA 任务文件里的任务即使失败，maa-cli 仍可能继续执行后面的任务。因此
  // 单独运行导航任务，并确认最后一个 Custom 导航步骤确实完成，才允许启动
  // Copilot，避免导航失败后 Copilot 在错误界面上持续横滑。
  const logText = await readMaaLogSince(checkpoint).catch(() => '');
  if (!hasCompletedActivityNavigation(logText, tasks.length)) {
    const navError = new Error('活动导航未完成，已停止活动作业；请检查游戏是否已进入活动关卡。') as ErrorWithCode;
    navError.code = 'ACTIVITY_NAVIGATION_FAILED';
    navError.statusCode = 422;
    navError.retryable = true;
    throw navError;
  }
  return true;
}

export async function runCurrentActivityCopilots(clientType: string = DEFAULT_CLIENT_TYPE, lifecycle: ActivityLifecycle = {}): Promise<Record<string, unknown>> {
  const selection = await loadActivitySelectionContext();
  let candidates = await findActivityCopilotCandidates(clientType, { allowCurrentMap: true, selection });
  let resourceRefresh: Record<string, unknown> | null = null;
  const activityCode = String(candidates.preflight?.activity?.code || '').toUpperCase();
  const lastAttemptAt = resourceRefreshAttempts.get(`${clientType}:${activityCode}`) || 0;
  if (shouldRefreshActivityNavigation(candidates.preflight, lastAttemptAt)) {
    resourceRefreshAttempts.set(`${clientType}:${activityCode}`, Date.now());
    try {
      resourceRefresh = { attempted: true, ...(await updateMaaResources()) };
      candidates = await findActivityCopilotCandidates(clientType, { allowCurrentMap: true, selection });
    } catch (error) {
      resourceRefresh = { attempted: true, error: getErrorMessage(error) };
    }
  }
  const preferences = selection.preferences;
  const plan = buildActivityCopilotRunPlan(candidates, asRecord(preferences));
  const activity = plan.activity || candidates.preflight?.activity || {};
  const stageRatingScore = plan.state === 'ready' ? averageRatingLevel(plan.entries) : 0;
  const matchingSet = candidates.matchingSet;
  const setRatingScore = Number(matchingSet?.ratingScore) || 0;
  // 用户选择的策略是“作业集优先”：只要找到覆盖完整活动关卡的公开
  // 作业集，就执行该套装；没有可用套装时才回退到逐关最高分作业。
  const useMatchingSet = Boolean(matchingSet);
  const selectionSummary = { mode: useMatchingSet ? 'matching-set' : 'per-stage', setRatingScore, stageRatingScore };

  if (!useMatchingSet && plan.state !== 'ready') {
    return { executed: false, candidates, preferences, plan, resourceRefresh, selection: selectionSummary };
  }

  if (candidates.navigationMode === 'current-map-fallback') {
    plan.navigationMode = 'current-map-fallback';
    plan.requiresUserOnActivityMap = true;
    const configDir = (await getMaaConfigDir()).trim();
    plan.currentMapResource = await ensureCurrentMapActivityResource(
      configDir,
      activity.code,
      (plan.entries.length ? plan.entries : matchingSet?.members || []).map(entry => ('displayStage' in entry ? entry.displayStage : entry.stage))
    );
  }
  const baseExecutionOptions = buildActivityExecutionOptions(
    preferences,
    clientType,
    candidates.navigationMode
  );
  const buildExecutionOptions = (navigationStage = '') => ({
    ...baseExecutionOptions,
    ...(navigationStage ? { navigationStage } : {})
  });
  const runWithPreparation = (navigationStage: string, execute: () => Promise<unknown>) => (
    withMaaExecutionLease(
      { source: 'activity-copilot', taskName: '当前活动作业', command: 'activity-copilot' },
      async () => {
        await runActivityPreparation(candidates, clientType, navigationStage);
        return execute();
      }
    )
  );

  if (useMatchingSet) {
    const set = matchingSet!;
    const setPlan = await buildCopilotPlan(set.id, preferences.raid);
    const activityStages = new Set(asArray(activity.stages).map(stage => String(stage).toUpperCase()));
    const selectedIndexes: number[] = [...new Set(setPlan.entries
      .filter(entry => activityStages.has(String(entry.displayStage || '').toUpperCase()))
      .map(entry => entry.itemIndex))];
    if (!selectedIndexes.length) {
      throw new Error('匹配作业集不包含当前活动关卡');
    }
    const navigationStage = setPlan.entries
      .filter(entry => selectedIndexes.includes(entry.itemIndex))
      .map(entry => entry.displayStage)
      .find(stage => activityStages.has(String(stage || '').toUpperCase())) || '';
    const completionEntries = plan.state === 'ready'
      ? plan.entries
      : (set.members || [])
          .filter(member => member.stage && activityStages.has(String(member.stage).toUpperCase()))
          .map(member => ({ displayStage: member.stage || '', success: true }));
    try {
      const execution = await runWithPreparation(navigationStage, () => executeCopilotPlan({
        setId: set.id,
        raid: preferences.raid,
        selectedIndexes,
        options: buildExecutionOptions(navigationStage),
        lifecycle
      }));
      await recordActivityCompletion(activity, completionEntries);
      return {
        executed: true,
        source: 'matching-set',
        candidates,
        preferences,
        plan: { ...plan, activity, set, selection: selectionSummary },
        execution,
        resourceRefresh
      };
    } catch (error) {
      await recordActivityCompletion(activity, (asErrorWithCode(error).copilotPlan?.results || []) as ActivityCompletionEntry[]);
      throw error;
    }
  }

  const planId = `activity-${activity.code}-${Date.now()}`;
  const navigationStage = plan.entries[0]?.displayStage || '';
  const execution = await runWithPreparation(navigationStage, () => executeSelectedCopilotEntries({
    planId,
    name: `${activity.name || activity.code} 活动作业`,
    entries: plan.entries,
    options: buildExecutionOptions(navigationStage),
    lifecycle
  })) as { results?: ActivityCompletionEntry[] };
  await recordActivityCompletion(activity, execution.results || []);
  return {
    executed: true,
    source: 'composed-candidates',
    candidates,
    preferences,
    plan: { ...plan, planId, selection: selectionSummary },
    execution,
    resourceRefresh
  };
}
