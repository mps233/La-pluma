import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { execMaaCommand, execDynamicTask, getMaaConfigDir, createMaaLogCheckpoint, readMaaLogSince } from './maaService.js';
import { withMaaExecutionLease } from './executionCoordinatorService.js';
import { recordDrops } from './dropRecordService.js';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
const progressPath = join(dataDir, 'copilot-progress.json');

function parseCopilotContent(data) {
  try {
    return typeof data?.content === 'string' ? JSON.parse(data.content) : (data?.content || {});
  } catch {
    return {};
  }
}

async function fetchJson(url, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`作业站请求失败: ${response.status}`);
      const payload = await response.json();
      if (payload.status_code && payload.status_code !== 200) throw new Error(payload.message || '作业站返回失败');
      return payload.data || payload;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw new Error(`作业站请求失败: ${lastError?.message || '网络异常'}`, { cause: lastError });
}

export function isPresetFormationCopilot(copilot = {}) {
  const stageName = String(copilot.stage_name || '');
  return (!Array.isArray(copilot.opers) || copilot.opers.length === 0) &&
    (!Array.isArray(copilot.groups) || copilot.groups.length === 0) &&
    /_s\d+$/i.test(stageName);
}

export function getNavigationStage(copilot = {}) {
  const title = String(copilot.doc?.title || '').trim();
  const code = title.match(/\b(?:[A-Z]{1,5}|\d{1,2})-(?:(?:EX|S|MO|TR)-)?\d+\b/i)?.[0];
  return code || title || String(copilot.stage_name || '');
}

async function loadStageCodeMap(stageIds) {
  try {
    const resourceDir = (await execMaaCommand('dir', ['resource'], null, null, false, true)).stdout.trim();
    const tileDir = join(resourceDir, 'Arknights-Tile-Pos');
    const filenames = await readdir(tileDir);
    const result = new Map();
    await Promise.all([...new Set(stageIds.filter(Boolean))].map(async stageId => {
      const filename = filenames.find(name =>
        name.endsWith('.json') && (name.startsWith(`${stageId}-`) || name.startsWith(`${stageId}#`))
      );
      if (!filename) return;
      try {
        const metadata = JSON.parse(await readFile(join(tileDir, filename), 'utf8'));
        if (metadata.code) result.set(stageId, { code: metadata.code, apCost: 0 });
      } catch {}
    }));
    try {
      const stages = JSON.parse(await readFile(join(resourceDir, 'stages.json'), 'utf8'));
      for (const stage of stages) {
        if (!stage?.stageId || !stage?.code) continue;
        const existing = result.get(stage.stageId);
        result.set(stage.stageId, {
          code: existing?.code || stage.code,
          apCost: Math.max(0, Number(stage.apCost) || 0)
        });
      }
    } catch {}
    const missingStageIds = [...new Set(stageIds.filter(stageId => stageId && !result.get(stageId)?.apCost))];
    if (missingStageIds.length > 0) {
      try {
        const penguinStages = await fetchJson('https://penguin-stats.io/PenguinStats/api/v2/stages?server=CN');
        for (const stage of penguinStages) {
          if (!missingStageIds.includes(stage?.stageId) || !stage?.code) continue;
          result.set(stage.stageId, {
            code: stage.code,
            apCost: Math.max(0, Number(stage.apCost) || 0)
          });
        }
      } catch {}
    }
    return result;
  } catch {
    return new Map();
  }
}

export async function buildCopilotPlan(setId, raid = 'normal') {
  const set = await fetchJson(`https://prts.maa.plus/set/get?id=${encodeURIComponent(setId)}`);
  const ids = Array.isArray(set.copilot_ids) ? set.copilot_ids : [];
  const copilotContents = [];
  for (const id of ids) {
    const data = await fetchJson(`https://prts.maa.plus/copilot/get/${id}`);
    copilotContents.push({ id, content: parseCopilotContent(data) });
  }
  const stageCodes = await loadStageCodeMap(copilotContents.map(item => item.content.stage_name));
  const copilots = copilotContents.map(({ id, content }) => {
    return {
      id: Number(id),
      stageId: content.stage_name || '',
      stage: stageCodes.get(content.stage_name)?.code || getNavigationStage(content) || `maa://${id}`,
      apCost: stageCodes.get(content.stage_name)?.apCost || 0,
      presetFormation: isPresetFormationCopilot(content),
      supportsRaid: !isPresetFormationCopilot(content),
      operators: content.opers || [],
      groups: content.groups || []
    };
  });

  const requestedModes = raid === 'both' ? ['normal', 'raid'] : [raid === 'raid' ? 'raid' : 'normal'];
  const entries = [];
  for (const [itemIndex, copilot] of copilots.entries()) {
    for (const mode of requestedModes) {
      if (mode === 'raid' && !copilot.supportsRaid) continue;
      entries.push({
        key: `${itemIndex}:${copilot.id}:${mode}`,
        itemIndex,
        copilotId: copilot.id,
        stageId: copilot.stageId,
        displayStage: copilot.stage,
        apCost: copilot.apCost,
        mode,
        presetFormation: copilot.presetFormation
      });
    }
  }
  const progress = await loadProgress();
  const completed = new Set(progress[String(setId)] || []);
  return {
    setId: String(setId),
    name: set.name || `作业集 ${setId}`,
    items: copilots,
    entries: entries.map(entry => ({ ...entry, completed: completed.has(entry.key) }))
  };
}

async function loadProgress() {
  try { return JSON.parse(await readFile(progressPath, 'utf8')); } catch { return {}; }
}

async function saveProgress(progress) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(progressPath, JSON.stringify(progress, null, 2));
}

export function mergePresetFormationTasks(installedTasks, userTasks = {}) {
  return {
    ...userTasks,
    LaPlumaPresetBattleConfirm: {
      algorithm: 'OcrDetect',
      text: ['开始战斗', '是否开始战斗'],
      roi: [700, 430, 560, 280],
      action: 'ClickSelf',
      postDelay: 2000,
      next: ['BattleOfficiallyBegin', 'SkipThePreBattlePlot', 'Stop']
    },
    BattleStart: {
      ...installedTasks.BattleStart,
      ...(userTasks.BattleStart || {}),
      next: ['BattleOfficiallyBegin', 'LaPlumaPresetBattleConfirm', 'SkipThePreBattlePlot', 'Stop']
    }
  };
}

export async function ensurePresetFormationResource(configDir) {
  const installedResource = (await execMaaCommand('dir', ['resource'], null, null, false, true)).stdout.trim();
  const installedTasks = JSON.parse(await readFile(join(installedResource, 'tasks', 'tasks.json'), 'utf8'));
  const userTasksDir = join(configDir, 'resource', 'tasks');
  const userTasksPath = join(userTasksDir, 'tasks.json');
  await mkdir(userTasksDir, { recursive: true });
  let userTasks = {};
  try { userTasks = JSON.parse(await readFile(userTasksPath, 'utf8')); } catch {}

  await writeFile(userTasksPath, JSON.stringify(mergePresetFormationTasks(installedTasks, userTasks), null, 2));
}

export function buildCopilotTaskParams(list, presetFormation, options = {}) {
  return {
    copilot_list: list,
    formation: presetFormation ? false : options.formationMode !== 'off',
    ignore_requirements: options.ignoreRequirements !== false,
    use_sanity_potion: options.useSanityPotion === true,
    add_trust: options.addTrust === true,
    formation_index: Number(options.formationIndex || 0),
    support_unit_usage: Number(options.supportUsage || 0),
    support_unit_name: String(options.supportName || '')
  };
}

export function normalizeCopilotLoopTimes(value) {
  return Math.max(1, Math.min(99, Number.parseInt(String(value || 1), 10) || 1));
}

export function buildCopilotRepeatFiles(entry, loopTimes, planDir) {
  return Array.from({ length: normalizeCopilotLoopTimes(loopTimes) }, (_, index) => ({
    repeat: index + 1,
    filename: join(planDir, `${entry.itemIndex}-${entry.copilotId}-${entry.mode}-${index + 1}.json`)
  }));
}

async function recordCompletedCopilotEntries(entries, loopTimes) {
  for (const entry of entries) {
    await recordDrops({
      stage: entry.displayStage,
      times: loopTimes,
      sanity: entry.apCost * loopTimes,
      medicine: 0,
      stone: 0,
      items: [],
      source: 'copilot',
      mode: entry.mode
    });
  }
}

function groupEntries(entries) {
  const groups = [];
  for (const entry of entries) {
    const previous = groups[groups.length - 1];
    if (previous && previous.presetFormation === entry.presetFormation) previous.entries.push(entry);
    else groups.push({ presetFormation: entry.presetFormation, entries: [entry] });
  }
  return groups;
}

export async function executeCopilotPlan({ setId, raid = 'normal', selectedIndexes = [], options = {} }) {
  const plan = await buildCopilotPlan(setId, raid);
  const selected = new Set(selectedIndexes.map(Number));
  const selectedEntries = plan.entries.filter(entry => selected.size === 0 || selected.has(entry.itemIndex));
  const progress = await loadProgress();
  const completed = new Set(progress[String(setId)] || []);
  const pending = selectedEntries.filter(entry => !completed.has(entry.key));
  const results = [];
  const loopTimes = normalizeCopilotLoopTimes(options.loopTimes);

  await withMaaExecutionLease({ source: 'copilot-set', taskName: plan.name, command: 'copilot-plan' }, async () => {
    const configDir = (await getMaaConfigDir()).trim();
    const planDir = join(configDir, 'copilot-plans', String(setId));
    await mkdir(planDir, { recursive: true });

    for (const group of groupEntries(pending)) {
      const list = [];
      const executionItems = [];
      for (const entry of group.entries) {
        const data = await fetchJson(`https://prts.maa.plus/copilot/get/${entry.copilotId}`);
        const content = parseCopilotContent(data);
        for (const { repeat, filename } of buildCopilotRepeatFiles(entry, loopTimes, planDir)) {
          await writeFile(filename, JSON.stringify(content, null, 2));
          list.push({
            id: executionItems.length,
            filename,
            stage_name: entry.displayStage,
            is_raid: entry.mode === 'raid'
          });
          executionItems.push({ entry, filename, repeat });
        }
      }
      if (!list.length) continue;

      const taskId = `copilot_plan_${setId}_${Date.now()}`;
      const taskConfig = {
        name: taskId,
        type: 'Copilot',
        params: buildCopilotTaskParams(list, group.presetFormation, options)
      };
      const checkpoint = await createMaaLogCheckpoint();
      try {
        if (group.presetFormation) await ensurePresetFormationResource(configDir);
        await execDynamicTask(taskId, taskConfig, `作业集 ${plan.name}`, 'copilot', true, group.presetFormation);
        for (const entry of group.entries) {
          completed.add(entry.key);
          results.push({ ...entry, success: true });
        }
        await recordCompletedCopilotEntries(group.entries, loopTimes);
        progress[String(setId)] = [...completed];
        await saveProgress(progress);
      } catch (error) {
        const message = error.message || '作业集执行失败';
        const logText = await readMaaLogSince(checkpoint).catch(() => '');
        const loadedFiles = [...String(logText).matchAll(/CopilotListLoadTaskFileSuccess[\s\S]{0,500}?"file_name"\s*:\s*"([^"]+)"/g)]
          .map(match => match[1]);
        const currentFile = loadedFiles.at(-1) || '';
        const currentIndex = executionItems.findIndex(item => currentFile === item.filename || currentFile.endsWith(item.filename));
        const successfulEntries = [];
        group.entries.forEach(entry => {
          const entryIndexes = executionItems
            .map((item, index) => item.entry.key === entry.key ? index : -1)
            .filter(index => index >= 0);
          const success = currentIndex > 0 && entryIndexes.every(index => index < currentIndex);
          if (success) {
            completed.add(entry.key);
            successfulEntries.push(entry);
          }
          results.push({ ...entry, success, error: success ? undefined : message });
        });
        await recordCompletedCopilotEntries(successfulEntries, loopTimes);
        progress[String(setId)] = [...completed];
        await saveProgress(progress);
        error.code = error.code || 'COPILOT_PLAN_FAILED';
        error.statusCode = error.statusCode || 422;
        error.details = { ...(error.details || {}), plan, results, completed: [...completed] };
        error.retryable = true;
        throw Object.assign(error, { copilotPlan: { plan, results, completed: [...completed] } });
      }
    }
  });

  return { success: true, plan, results, completed: [...completed], pending: selectedEntries.filter(entry => !completed.has(entry.key)) };
}

export async function resetCopilotPlanProgress(setId) {
  const progress = await loadProgress();
  delete progress[String(setId)];
  await saveProgress(progress);
  return { success: true };
}
