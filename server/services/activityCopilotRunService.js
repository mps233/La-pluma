import { loadUserConfig } from './configStorageService.js';
import { findActivityCopilotCandidates } from './activityCopilotDiscoveryService.js';
import { buildCopilotPlan, ensureCurrentMapActivityResource, executeCopilotPlan, executeSelectedCopilotEntries } from './copilotPlanService.js';
import { getMaaConfigDir } from './maaService.js';
import { updateMaaResources } from './resourceUpdateService.js';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
const activityProgressPath = join(dataDir, 'activity-copilot-progress.json');
const RESOURCE_REFRESH_INTERVAL = 6 * 60 * 60 * 1000;
const resourceRefreshAttempts = new Map();

export function shouldRefreshActivityNavigation(preflight = {}, lastAttemptAt = 0, now = Date.now()) {
  return preflight?.reasonCode === 'navigation-resource-unavailable' &&
    Boolean(preflight?.activity?.code) &&
    now - lastAttemptAt >= RESOURCE_REFRESH_INTERVAL;
}

async function loadActivityProgress() {
  try { return JSON.parse(await readFile(activityProgressPath, 'utf8')); } catch { return {}; }
}

async function saveActivityProgress(progress) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(activityProgressPath, JSON.stringify(progress, null, 2));
}

export function summarizeActivityCompletion(activity = {}, progress = {}) {
  const stages = [...new Set((activity.stages || []).map(stage => String(stage || '').toUpperCase()).filter(Boolean))];
  if (!activity.code || !stages.length) return { known: false, complete: false, completedStages: [], totalStages: stages.length, source: 'local-activity-progress' };
  const completedStages = Array.isArray(progress[String(activity.code).toUpperCase()]?.stages)
    ? progress[String(activity.code).toUpperCase()].stages
    : [];
  return {
    known: true,
    complete: stages.every(stage => completedStages.includes(stage)),
    completedStages: stages.filter(stage => completedStages.includes(stage)),
    totalStages: stages.length,
    source: 'local-activity-progress'
  };
}

export async function getActivityCompletion(activity = {}) {
  return summarizeActivityCompletion(activity, await loadActivityProgress());
}

async function recordActivityCompletion(activity, entries) {
  const progress = await loadActivityProgress();
  const code = String(activity.code).toUpperCase();
  const existing = new Set(progress[code]?.stages || []);
  entries.filter(entry => entry.success !== false).forEach(entry => existing.add(entry.displayStage));
  progress[code] = { stages: [...existing].sort(), updatedAt: new Date().toISOString() };
  await saveActivityProgress(progress);
}

function normalizeRaid(value) {
  if (value === 'raid' || value === '1') return 'raid';
  if (value === 'both' || value === '2') return 'both';
  return 'normal';
}

export function getCombatCopilotPreferences(combatTasks = {}) {
  const preferences = combatTasks?.advancedParams?.copilot || {};
  return {
    raid: normalizeRaid(preferences.raid),
    loopTimes: preferences.loopTimes || 1,
    ignoreRequirements: preferences.ignoreRequirements !== false,
    useSanityPotion: preferences.useSanityPotion === true,
    addTrust: preferences.addTrust === true,
    formationIndex: preferences.formationIndex,
    supportUsage: preferences.supportUsage,
    supportName: preferences.supportName,
    formationMode: combatTasks?.autoFormation?.copilot || 'auto'
  };
}

export function buildActivityCopilotRunPlan(candidatePlan, preferences = {}) {
  if (candidatePlan?.state !== 'candidates-ready') {
    return {
      state: 'blocked',
      reason: candidatePlan?.reason || '活动作业候选尚未就绪。',
      entries: []
    };
  }

  const missingStages = candidatePlan.stages.filter(stage => !stage.candidates?.length).map(stage => stage.stage);
  if (missingStages.length) {
    return {
      state: 'blocked',
      reason: `以下活动关卡没有可靠作业，未执行不完整流程：${missingStages.join('、')}`,
      entries: []
    };
  }

  const entries = [];
  const unsupportedRaidStages = [];
  for (const stage of candidatePlan.stages) {
    const candidate = stage.candidates[0];
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
        title: candidate.title
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
    activity: candidatePlan.preflight.activity,
    entries
  };
}

export async function runCurrentActivityCopilots(clientType = 'Official') {
  let candidates = await findActivityCopilotCandidates(clientType, { allowCurrentMap: true });
  let resourceRefresh = null;
  const activityCode = String(candidates.preflight?.activity?.code || '').toUpperCase();
  const lastAttemptAt = resourceRefreshAttempts.get(`${clientType}:${activityCode}`) || 0;
  if (shouldRefreshActivityNavigation(candidates.preflight, lastAttemptAt)) {
    resourceRefreshAttempts.set(`${clientType}:${activityCode}`, Date.now());
    try {
      resourceRefresh = { attempted: true, ...(await updateMaaResources()) };
      candidates = await findActivityCopilotCandidates(clientType, { allowCurrentMap: true });
    } catch (error) {
      resourceRefresh = { attempted: true, error: error.message };
    }
  }
  const configResult = await loadUserConfig('combat-tasks');
  const preferences = getCombatCopilotPreferences(configResult.success ? configResult.data : {});
  const plan = buildActivityCopilotRunPlan(candidates, preferences);
  if (plan.state !== 'ready') {
    return { executed: false, candidates, preferences, plan, resourceRefresh };
  }

  if (candidates.navigationMode === 'current-map-fallback') {
    plan.navigationMode = 'current-map-fallback';
    plan.requiresUserOnActivityMap = true;
    const configDir = (await getMaaConfigDir()).trim();
    plan.currentMapResource = await ensureCurrentMapActivityResource(
      configDir,
      plan.activity.code,
      plan.entries.map(entry => entry.displayStage)
    );
  }
  const executionOptions = candidates.navigationMode === 'current-map-fallback'
    ? { ...preferences, userResource: true }
    : preferences;

  if (candidates.matchingSet) {
    const setPlan = await buildCopilotPlan(candidates.matchingSet.id, preferences.raid);
    const activityStagePattern = new RegExp(
      `^${String(plan.activity.code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(?:\\d+|EX-\\d+|S-\\d+|MO-\\d+|TR-\\d+)$`,
      'i'
    );
    const selectedIndexes = [...new Set(setPlan.entries
      .filter(entry => activityStagePattern.test(entry.displayStage))
      .map(entry => entry.itemIndex))];
    try {
      const execution = await executeCopilotPlan({
        setId: candidates.matchingSet.id,
        raid: preferences.raid,
        selectedIndexes,
        options: executionOptions
      });
      await recordActivityCompletion(plan.activity, plan.entries);
      return {
        executed: true,
        source: 'matching-set',
        candidates,
        preferences,
        plan: { ...plan, set: candidates.matchingSet },
        execution,
        resourceRefresh
      };
    } catch (error) {
      await recordActivityCompletion(plan.activity, error?.copilotPlan?.results || []);
      throw error;
    }
  }

  const planId = `activity-${plan.activity.code}-${Date.now()}`;
  const execution = await executeSelectedCopilotEntries({
    planId,
    name: `${plan.activity.name || plan.activity.code} 活动作业`,
    entries: plan.entries,
    options: executionOptions
  });
  await recordActivityCompletion(plan.activity, execution.results);
  return { executed: true, source: 'composed-candidates', candidates, preferences, plan: { ...plan, planId }, execution, resourceRefresh };
}
