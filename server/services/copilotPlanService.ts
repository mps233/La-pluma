import { asErrorWithCode, isRecord } from '../utils/errors.ts';
import { getErrorCode, getErrorDetails, getErrorMessage, getErrorStatus } from '../utils/errors.ts';
import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { execMaaCommand, execDynamicTask, getMaaConfigDir, createMaaLogCheckpoint, readMaaLogSince } from './maaService.ts';
import { withMaaExecutionLease } from './executionCoordinatorService.ts';
import { recordDrops } from './dropRecordService.ts';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
const progressPath = join(dataDir, 'copilot-progress.json');

interface CopilotDocument {
  title?: string
  [key: string]: unknown
}

interface CopilotContent {
  stage_name?: string
  doc?: CopilotDocument
  opers?: unknown[]
  groups?: unknown[]
  [key: string]: unknown
}

interface StageCodeInfo {
  code: string
  apCost: number
}

interface CopilotItem {
  id: number
  stageId: string
  stage: string
  apCost: number | null
  presetFormation: boolean
  supportsRaid: boolean
  operators: unknown[]
  groups: unknown[]
}

interface CopilotEntry {
  key: string
  itemIndex: number
  copilotId: number
  stageId: string
  displayStage: string
  apCost: number | null
  mode: string
  presetFormation: boolean
  completed?: boolean
}

interface CopilotPlan {
  setId: string
  name: string
  items: CopilotItem[]
  entries: CopilotEntry[]
}

interface CopilotOptions {
  formationMode?: unknown
  userAdditional?: unknown
  ignoreRequirements?: unknown
  useSanityPotion?: unknown
  addTrust?: unknown
  formationIndex?: unknown
  supportUsage?: unknown
  supportName?: unknown
  userResource?: unknown
  profile?: unknown
  profileId?: unknown
  address?: unknown
  [key: string]: unknown
}

interface CopilotExecutionOptions extends CopilotOptions {
  loopTimes?: unknown
  preTasks?: unknown
  navigationStage?: unknown
  clientType?: unknown
  nativeDelegation?: unknown
}

interface CopilotLifecycle {
  runId?: string
  onStarted?: (context?: unknown) => unknown
  onSettled?: (outcome: unknown) => unknown
}

interface CopilotUserAdditional {
  name: string
  skill: number
}

interface CopilotTaskParams {
  copilot_list: unknown[]
  formation: boolean
  user_additional?: CopilotUserAdditional[]
  ignore_requirements: boolean
  use_sanity_potion: boolean
  add_trust: boolean
  formation_index: number
  support_unit_usage: number
  support_unit_name: string
}

interface CopilotRepeatSource {
  itemIndex?: unknown
  copilotId?: unknown
  mode?: unknown
}

interface CopilotRepeatFile {
  repeat: number
  filename: string
}

interface CopilotListEntry {
  id: number
  filename: string
  stage_name: string
  nav_name_override: string
  is_raid: boolean
}

interface CopilotTaskDefinition {
  name?: string
  type?: string
  params?: unknown
  [key: string]: unknown
}

interface DynamicTaskConfig {
  tasks: CopilotTaskDefinition[]
}

interface CopilotEntryInput {
  key?: unknown
  itemIndex?: unknown
  copilotId?: unknown
  stageId?: unknown
  displayStage?: unknown
  apCost?: unknown
  mode?: unknown
  presetFormation?: unknown
  completed?: unknown
}

interface ExecutableCopilotEntry extends CopilotEntryInput {
  copilotId: number
  displayStage: string
}

interface CopilotEntryGroup<T extends ExecutableCopilotEntry> {  presetFormation: unknown
  entries: T[]
}

interface CopilotExecutionItem {
  entry: ExecutableCopilotEntry
  filename: string
  repeat: number
}

interface CopilotExecutionResult {
  success: boolean
  [key: string]: unknown
}

interface CopilotExecutionSummary {
  success: true
  results: CopilotExecutionResult[]
  loopTimes: number
}

interface CopilotPlanExecutionSummary {
  success: true
  source?: 'native'
  command?: string
  results: CopilotExecutionResult[]
  loopTimes?: number
  output?: string
  plan?: CopilotPlan
  completed?: string[]
  pending?: CopilotEntry[]
}

interface ExecuteSelectedCopilotParams {
  planId: unknown
  name: string
  entries: CopilotEntryInput[]
  options?: CopilotExecutionOptions
  lifecycle?: CopilotLifecycle
}

interface ExecuteCopilotPlanParams {
  setId: unknown
  raid?: string
  selectedIndexes?: unknown[]
  options?: CopilotExecutionOptions
  lifecycle?: CopilotLifecycle
}

interface NativeCopilotEntry {
  presetFormation?: unknown
}

interface NativeCopilotSetOptions {
  entries?: NativeCopilotEntry[]
  totalItems?: number
  hasPresetFormation?: boolean
  raid?: string
  loopTimes?: number
  selectedIndexes?: unknown[]
  completedKeys?: unknown[]
  formationMode?: string
  userAdditional?: unknown
}

interface PresetFormationTasks {
  LaPlumaPresetBattleConfirm: Record<string, unknown>
  BattleStart: Record<string, unknown> & { next: string[] }
  [key: string]: unknown
}

type CopilotProgress = Record<string, string[]>

interface DropRecordEntry {
  displayStage: string
  apCost?: unknown
  mode?: unknown
}

function normalizeCopilotContent(value: Record<string, unknown>): CopilotContent {
  const doc = isRecord(value.doc)
    ? {
      ...value.doc,
      title: typeof value.doc.title === 'string' ? value.doc.title : undefined
    }
    : undefined;
  return {
    ...value,
    stage_name: typeof value.stage_name === 'string' ? value.stage_name : undefined,
    doc,
    opers: Array.isArray(value.opers) ? value.opers : undefined,
    groups: Array.isArray(value.groups) ? value.groups : undefined
  };
}

function parseCopilotContent(data: unknown): CopilotContent {
  try {
    const content = isRecord(data) ? data.content : undefined;
    if (typeof content === 'string') {
      const parsed: unknown = JSON.parse(content);
      return isRecord(parsed) ? normalizeCopilotContent(parsed) : {};
    }
    return isRecord(content) ? normalizeCopilotContent(content) : {};
  } catch {
    return {};
  }
}

async function fetchJson(url: string, maxAttempts = 3): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`作业站请求失败: ${response.status}`);
      const payload: unknown = await response.json();
      const payloadRecord = isRecord(payload) ? payload : null;
      if (payloadRecord?.status_code && payloadRecord.status_code !== 200) {
        throw new Error(typeof payloadRecord.message === 'string' ? payloadRecord.message : '作业站返回失败');
      }
      return payloadRecord?.data || payload;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise<void>(resolve => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw new Error(`作业站请求失败: ${getErrorMessage(lastError) || '网络异常'}`, { cause: lastError });
}

export function isPresetFormationCopilot(copilot: CopilotContent = {}): boolean {
  const stageName = String(copilot.stage_name || '');
  return (!Array.isArray(copilot.opers) || copilot.opers.length === 0) &&
    (!Array.isArray(copilot.groups) || copilot.groups.length === 0) &&
    /_s\d+$/i.test(stageName);
}

export function getNavigationStage(copilot: CopilotContent = {}): string {
  const title = String(copilot.doc?.title || '').trim();
  const code = title.match(/\b(?:[A-Z]{1,5}|\d{1,2})-(?:(?:EX|S|MO|TR)-)?\d+\b/i)?.[0];
  return code || title || String(copilot.stage_name || '');
}

async function loadStageCodeMap(stageIds: string[]): Promise<Map<string, StageCodeInfo>> {
  try {
    const resourceDir = (await execMaaCommand('dir', ['resource'], null, null, false, true)).stdout.trim();
    const tileDir = join(resourceDir, 'Arknights-Tile-Pos');
    const filenames = await readdir(tileDir);
    const result = new Map<string, StageCodeInfo>();
    await Promise.all([...new Set(stageIds.filter(Boolean))].map(async stageId => {
      const filename = filenames.find(name =>
        name.endsWith('.json') && (name.startsWith(`${stageId}-`) || name.startsWith(`${stageId}#`))
      );
      if (!filename) return;
      try {
        const metadata: unknown = JSON.parse(await readFile(join(tileDir, filename), 'utf8'));
        if (isRecord(metadata) && typeof metadata.code === 'string' && metadata.code) {
          result.set(stageId, { code: metadata.code, apCost: 0 });
        }
      } catch {}
    }));
    try {
      const stages: unknown = JSON.parse(await readFile(join(resourceDir, 'stages.json'), 'utf8'));
      if (isRecord(stages)) {
        for (const rawStage of Object.values(stages)) {
          if (!isRecord(rawStage) || !rawStage.stageId || !rawStage.code) continue;
          const stageId = String(rawStage.stageId);
          const code = String(rawStage.code);
          const existing = result.get(stageId);
          result.set(stageId, {
            code: existing?.code || code,
            apCost: Math.max(0, Number(rawStage.apCost) || 0)
          });
        }
      }
    } catch {}
    const missingStageIds: string[] = [...new Set(stageIds.filter(stageId => stageId && !result.get(stageId)?.apCost))];
    if (missingStageIds.length > 0) {
      try {
        const penguinStages = await fetchJson('https://penguin-stats.io/PenguinStats/api/v2/stages?server=CN');
        for (const stage of Array.isArray(penguinStages) ? penguinStages : []) {
          if (!isRecord(stage) || !stage.code) continue;
          const stageId = stage.stageId == null ? '' : String(stage.stageId);
          if (!missingStageIds.includes(stageId)) continue;
          result.set(stageId, {
            code: String(stage.code),
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

export async function buildCopilotPlan(setId: string | number, raid = 'normal'): Promise<CopilotPlan> {
  const set = await fetchJson(`https://prts.maa.plus/set/get?id=${encodeURIComponent(setId)}`);
  const setRecord = isRecord(set) ? set : {};
  const ids: unknown[] = Array.isArray(setRecord.copilot_ids) ? setRecord.copilot_ids : [];
  const copilotContents: Array<{ id: number; content: CopilotContent }> = [];
  for (const id of ids) {
    const data = await fetchJson(`https://prts.maa.plus/copilot/get/${id}`);
    copilotContents.push({ id: Number(id), content: parseCopilotContent(data) });
  }
  const stageCodes = await loadStageCodeMap(copilotContents.map(item => item.content.stage_name || ''));
  const copilots: CopilotItem[] = copilotContents.map(({ id, content }) => {
    const stageName = content.stage_name || '';
    const stageInfo = stageCodes.get(stageName);
    const apCost = stageInfo?.apCost || 0;
    return {
      id: Number(id),
      stageId: stageName,
      stage: stageInfo?.code || getNavigationStage(content) || `prts://${id}`,
      apCost: apCost > 0 ? apCost : null,
      presetFormation: isPresetFormationCopilot(content),
      supportsRaid: !isPresetFormationCopilot(content),
      operators: content.opers || [],
      groups: content.groups || []
    };
  });

  const requestedModes = raid === 'both' ? ['normal', 'raid'] : [raid === 'raid' ? 'raid' : 'normal'];
  const entries: CopilotEntry[] = [];
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
  const name = typeof setRecord.name === 'string' && setRecord.name ? setRecord.name : `作业集 ${setId}`;
  return {
    setId: String(setId),
    name,
    items: copilots,
    entries: entries.map(entry => ({ ...entry, completed: completed.has(entry.key) }))
  };
}

function normalizeProgress(value: unknown): CopilotProgress {
  if (!isRecord(value)) return {};
  const progress: CopilotProgress = {};
  for (const [setId, entries] of Object.entries(value)) {
    if (Array.isArray(entries)) {
      progress[setId] = entries.filter((entry): entry is string => typeof entry === 'string');
    }
  }
  return progress;
}

async function loadProgress(): Promise<CopilotProgress> {
  try { return normalizeProgress(JSON.parse(await readFile(progressPath, 'utf8'))); } catch { return {}; }
}

async function saveProgress(progress: CopilotProgress) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(progressPath, JSON.stringify(progress, null, 2));
}

export function mergePresetFormationTasks(
  installedTasks: Record<string, unknown>,
  userTasks: Record<string, unknown> = {}
): PresetFormationTasks {
  const installedBattleStart = isRecord(installedTasks.BattleStart) ? installedTasks.BattleStart : {};
  const userBattleStart = isRecord(userTasks.BattleStart) ? userTasks.BattleStart : {};
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
      ...installedBattleStart,
      ...userBattleStart,
      next: ['BattleOfficiallyBegin', 'LaPlumaPresetBattleConfirm', 'SkipThePreBattlePlot', 'Stop']
    }
  };
}

export function buildCurrentMapStageTasks(stages: unknown[] = []): Record<string, { text: string[] }> {
  return Object.fromEntries([...new Set(stages.map(stage => String(stage || '').trim().toUpperCase()).filter(Boolean))]
    .map(stage => [stage, { text: [stage] }]));
}

export async function ensureCurrentMapActivityResource(
  configDir: string,
  activityCode: unknown,
  stages: unknown[]
): Promise<{ stageFile: string; stages: string[] }> {
  const code = String(activityCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(code)) throw new Error('活动代号格式不合法');
  const tasks = buildCurrentMapStageTasks(stages);
  if (!Object.keys(tasks).length) throw new Error('没有可写入的活动关卡');
  const stagesDir = join(configDir, 'resource', 'tasks', 'Stages');
  await mkdir(stagesDir, { recursive: true });
  await writeFile(join(stagesDir, `${code}.json`), JSON.stringify(tasks, null, 2));
  return { stageFile: join(stagesDir, `${code}.json`), stages: Object.keys(tasks) };
}

async function ensurePresetFormationResource(configDir: string) {
  const installedResource = (await execMaaCommand('dir', ['resource'], null, null, false, true)).stdout.trim();
  const installedTasksRaw: unknown = JSON.parse(await readFile(join(installedResource, 'tasks', 'tasks.json'), 'utf8'));
  const installedTasks = isRecord(installedTasksRaw) ? installedTasksRaw : {};
  const userTasksDir = join(configDir, 'resource', 'tasks');
  const userTasksPath = join(userTasksDir, 'tasks.json');
  await mkdir(userTasksDir, { recursive: true });
  let userTasks: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(userTasksPath, 'utf8'));
    if (isRecord(parsed)) userTasks = parsed;
  } catch {}

  await writeFile(userTasksPath, JSON.stringify(mergePresetFormationTasks(installedTasks, userTasks), null, 2));
}

function normalizeUserAdditional(value: unknown): CopilotUserAdditional[] {
  if (Array.isArray(value)) {
    return value.map((item): CopilotUserAdditional => {
      const name = isRecord(item) && item.name != null ? String(item.name).trim() : '';
      const skill = isRecord(item) ? Number(item.skill) : Number.NaN;
      return {
        name,
        skill: Number.isInteger(skill) && skill >= 1 && skill <= 3 ? skill : 0
      };
    }).filter(item => item.name !== '');
  }
  if (typeof value !== 'string' || !value.trim()) return [];
  return value.split(/[,，\n]/).map((entry): CopilotUserAdditional | null => {
    const [name, skill] = entry.split(/[:：]/).map(part => part.trim());
    if (!name) return null;
    const numericSkill = Number(skill);
    return {
      name,
      skill: Number.isInteger(numericSkill) && numericSkill >= 1 && numericSkill <= 3 ? numericSkill : 0
    };
  }).filter((item): item is CopilotUserAdditional => item !== null);
}

export function buildCopilotTaskParams(
  list: unknown[],
  presetFormation: boolean,
  options: CopilotOptions = {}
): CopilotTaskParams {
  const formation = presetFormation ? false : options.formationMode !== 'off';
  const userAdditional = formation ? normalizeUserAdditional(options.userAdditional) : [];
  return {
    copilot_list: list,
    formation,
    ...(userAdditional.length > 0 ? { user_additional: userAdditional } : {}),
    ignore_requirements: options.ignoreRequirements !== false,
    use_sanity_potion: options.useSanityPotion === true,
    add_trust: options.addTrust === true,
    formation_index: Number(options.formationIndex || 0),
    support_unit_usage: Number(options.supportUsage || 0),
    support_unit_name: String(options.supportName || '')
  };
}

function normalizeCopilotLoopTimes(value: unknown): number {
  return Math.max(1, Math.min(99, Number.parseInt(String(value || 1), 10) || 1));
}

export function sanitizeCopilotPlanId(value: unknown): string {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) {
    throw new Error('作业集 ID 不合法');
  }
  return id;
}

export function extractLoadedCopilotFiles(logText: unknown = ''): string[] {
  // MAA writes `file_name` inside `details` before the trailing `what`
  // discriminator for a successfully loaded copilot entry.
  return [...String(logText).matchAll(/"file_name"\s*:\s*"([^"]+)"[\s\S]{0,500}?"what"\s*:\s*"CopilotListLoadTaskFileSuccess"/g)]
    .map(match => match[1]);
}

export function buildCopilotRepeatFiles(
  entry: CopilotRepeatSource,
  loopTimes: unknown,
  planDir: string
): CopilotRepeatFile[] {
  return Array.from({ length: normalizeCopilotLoopTimes(loopTimes) }, (_, index) => ({
    repeat: index + 1,
    filename: join(planDir, `${entry.itemIndex}-${entry.copilotId}-${entry.mode}-${index + 1}.json`)
  }));
}

async function recordCompletedCopilotEntries(entries: DropRecordEntry[], loopTimes: number) {
  for (const entry of entries) {
    const apCost = entry.apCost === null || entry.apCost === undefined
      ? null
      : Number(entry.apCost);
    await recordDrops({
      stage: entry.displayStage,
      times: loopTimes,
      sanity: apCost !== null && Number.isFinite(apCost) ? apCost * loopTimes : 0,
      medicine: 0,
      stone: 0,
      items: [],
      source: 'copilot',
      mode: entry.mode
    });
  }
}

/**
 * A full copilot set can be delegated to `maa copilot prts://s<id>` when the
 * project does not need per-stage custom behavior (preset formation, partial
 * selection, loop expansion, or resume progress).
 */
export function canUseNativeCopilotSet({
  entries = [],
  totalItems = entries.length,
  hasPresetFormation = entries.some(entry => Boolean(entry.presetFormation)),
  raid = 'normal',
  loopTimes = 1,
  selectedIndexes = [],
  completedKeys = [],
  formationMode = 'auto',
  userAdditional = null
}: NativeCopilotSetOptions = {}) {
  if (entries.length === 0) return false;
  // selectedIndexes 是作业条目索引，entries 会按 raid=both 展开成多份。
  // 必须和作业条目总数比较，不能和展开后的 entries 数比较。
  // 同时拒绝重复或越界索引，避免原生委托执行未选中的关卡。
  if (selectedIndexes.length > 0) {
    const normalizedIndexes = selectedIndexes.map(Number);
    if (normalizedIndexes.some(index => !Number.isInteger(index) || index < 0 || index >= totalItems)) return false;
    if (new Set(normalizedIndexes).size !== totalItems) return false;
  }
  if (loopTimes !== 1) return false;
  if (completedKeys.length > 0) return false;
  if (hasPresetFormation || entries.some(entry => Boolean(entry.presetFormation))) return false;
  const hasUserAdditional = typeof userAdditional === 'string'
    ? userAdditional.trim().length > 0
    : Array.isArray(userAdditional)
      ? userAdditional.length > 0
      : isRecord(userAdditional)
        ? Object.keys(userAdditional).length > 0
        : false;
  if (hasUserAdditional) return false;
  // maa-cli 按作业 JSON 文件数量决定 formation：多作业集强制 true，单作业默认 false。
  // raid=both 会把 entries 展开成两份，但不会改变作业 JSON 文件数量，所以这里用 totalItems。
  if (formationMode === 'auto' && totalItems < 2) return false;
  if (formationMode === 'off' && totalItems >= 2) return false;
  // 单文件模式会丢失 is_raid；只有 copilot_list 分支保留突袭标记。
  if (raid === 'raid' && totalItems < 2) return false;
  return raid === 'normal' || raid === 'raid' || raid === 'both';
}

export function buildNativeCopilotCommand(setId: unknown, raid = 'normal', options: CopilotOptions = {}): string[] {
  const args: string[] = [`prts://s${setId}`, '--batch'];
  if (raid === 'raid' || raid === 'both') args.push('--raid', raid);
  if (options.formationMode === 'on') args.push('--formation');
  const formationIndex = Number(options.formationIndex || 0);
  if (Number.isFinite(formationIndex) && formationIndex > 0) args.push('--formation-index', String(formationIndex));
  if (options.addTrust === true) args.push('--add-trust');
  if (options.ignoreRequirements === true) args.push('--ignore-requirements');
  if (options.useSanityPotion === true) args.push('--use-sanity-potion');
  const supportUsage = Number(options.supportUsage || 0);
  if (Number.isFinite(supportUsage) && supportUsage > 0) args.push('--support-unit-usage', String(supportUsage));
  if (typeof options.supportName === 'string' && options.supportName.trim()) {
    args.push('--support-unit-name', options.supportName.trim());
  }
  if (options.userResource) args.push('--user-resource');
  const profile = options.profile || options.profileId;
  if (profile) args.push('-p', String(profile));
  if (options.address) args.push('-a', String(options.address));
  return args;
}

function groupEntries<T extends ExecutableCopilotEntry>(entries: T[]): Array<CopilotEntryGroup<T>> {
  const groups: Array<CopilotEntryGroup<T>> = [];
  for (const entry of entries) {
    const previous = groups[groups.length - 1];
    if (previous && previous.presetFormation === entry.presetFormation) previous.entries.push(entry);
    else groups.push({ presetFormation: entry.presetFormation, entries: [entry] });
  }
  return groups;
}

/**
 * 把活动导航等前置任务和 Copilot 写进同一个 MAA 任务文件，避免依赖上一条
 * MAA 进程留下的界面状态，也保证前置步骤和作业共享同一次执行锁。
 */
export function buildCopilotDynamicTaskConfig(preTasks: unknown, task: CopilotTaskDefinition): DynamicTaskConfig {
  return {
    tasks: [
      ...(Array.isArray(preTasks) ? preTasks.filter(isCopilotTaskDefinition) : []),
      task
    ]
  };
}

function isCopilotTaskDefinition(value: unknown): value is CopilotTaskDefinition {
  return isRecord(value);
}

/**
 * 前置导航会先选中一个具体关卡；把同一关卡的作业排到最前面，Copilot
 * 才能从已经打开的关卡详情页直接确认并开始，而不是重新找关。
 */
export function orderEntriesForNavigation<T extends { displayStage?: unknown }>(
  entries: T[],
  navigationStage: unknown
): T[] {
  const list = Array.isArray(entries) ? entries : [];
  const stage = String(navigationStage || '').trim().toUpperCase();
  if (!stage) return list;
  return [
    ...list.filter(entry => String(entry?.displayStage || '').trim().toUpperCase() === stage),
    ...list.filter(entry => String(entry?.displayStage || '').trim().toUpperCase() !== stage)
  ];
}

function isExecutableCopilotEntry(entry: CopilotEntryInput): entry is ExecutableCopilotEntry {
  return Number.isInteger(Number(entry.copilotId)) &&
    typeof entry.displayStage === 'string' &&
    entry.displayStage.length > 0;
}

/**
 * Runs an already-selected list of copilot ids through the same dynamic MAA
 * Copilot task used by copilot sets. Callers must decide selection separately.
 */
export async function executeSelectedCopilotEntries({
  planId,
  name,
  entries,
  options = {},
  lifecycle = {}
}: ExecuteSelectedCopilotParams): Promise<CopilotExecutionSummary> {
  planId = sanitizeCopilotPlanId(planId);
  const normalizedEntries = entries.filter(isExecutableCopilotEntry);
  if (!normalizedEntries.length) throw new Error('没有可执行的作业条目');

  const results: CopilotExecutionResult[] = [];
  const loopTimes = normalizeCopilotLoopTimes(options.loopTimes);
  const clientType = typeof options.clientType === 'string' ? options.clientType : undefined;
  await withMaaExecutionLease({ source: 'activity-copilot', taskName: name, command: 'copilot-plan' }, async () => {
    lifecycle.onStarted?.();
    const configDir = (await getMaaConfigDir()).trim();
    const planDir = join(configDir, 'copilot-plans', String(planId));
    await mkdir(planDir, { recursive: true });

    for (const [groupIndex, group] of groupEntries(orderEntriesForNavigation(normalizedEntries, options.navigationStage)).entries()) {
      const list: CopilotListEntry[] = [];
      for (const entry of group.entries) {
        const data = await fetchJson(`https://prts.maa.plus/copilot/get/${entry.copilotId}`);
        const content = parseCopilotContent(data);
        for (const { filename } of buildCopilotRepeatFiles(entry, loopTimes, planDir)) {
          await writeFile(filename, JSON.stringify(content, null, 2));
          list.push({
            id: list.length,
            filename,
            stage_name: entry.displayStage,
            nav_name_override: entry.displayStage,
            is_raid: entry.mode === 'raid'
          });
        }
      }
      if (!list.length) continue;

      const taskId = `activity_copilot_${planId}_${groupIndex}`;
      const taskConfig = buildCopilotDynamicTaskConfig(
        groupIndex === 0 ? options.preTasks : [],
        {
          name: taskId,
          type: 'Copilot',
          params: buildCopilotTaskParams(list, Boolean(group.presetFormation), options)
        }
      );
      if (group.presetFormation) await ensurePresetFormationResource(configDir);
      await execDynamicTask(
        taskId,
        taskConfig,
        name,
        'copilot',
        true,
        Boolean(group.presetFormation) || options.userResource === true,
        { clientType }
      );
      results.push(...group.entries.map(entry => ({ ...entry, success: true })));
    }
  });

  return { success: true, results, loopTimes };
}

export async function executeCopilotPlan({
  setId,
  raid = 'normal',
  selectedIndexes = [],
  options = {},
  lifecycle = {}
}: ExecuteCopilotPlanParams): Promise<CopilotPlanExecutionSummary> {
  const planId = sanitizeCopilotPlanId(setId);
  const plan = await buildCopilotPlan(planId, raid);
  const selected = new Set(selectedIndexes.map(Number));
  const selectedEntries = plan.entries.filter(entry => selected.size === 0 || selected.has(entry.itemIndex));
  const progress = await loadProgress();
  const completed = new Set(progress[planId] || []);
  const pending = selectedEntries.filter(entry => !completed.has(entry.key));
  const results: CopilotExecutionResult[] = [];
  const loopTimes = normalizeCopilotLoopTimes(options.loopTimes);
  const clientType = typeof options.clientType === 'string' ? options.clientType : undefined;

  // 原生命令只会执行 Copilot；带活动导航前置任务时必须走动态任务文件。
  const hasPreTasks = Array.isArray(options.preTasks) && options.preTasks.length > 0;
  if (!hasPreTasks && options.nativeDelegation !== false && canUseNativeCopilotSet({
    entries: selectedEntries,
    totalItems: plan.items.length,
    hasPresetFormation: plan.items.some(item => item.presetFormation),
    raid,
    loopTimes,
    selectedIndexes,
    completedKeys: [...completed],
    formationMode: typeof options.formationMode === 'string' && options.formationMode
      ? options.formationMode
      : 'auto',
    userAdditional: options.userAdditional || null
  })) {
    const args = buildNativeCopilotCommand(planId, raid, options);
    const result = await execMaaCommand('copilot', args, plan.name, 'copilot', true, false, lifecycle);
    await recordCompletedCopilotEntries(selectedEntries, loopTimes);
    progress[planId] = [...new Set([...completed, ...selectedEntries.map(entry => entry.key)])];
    await saveProgress(progress);
    return {
      success: true,
      source: 'native',
      command: `maa copilot ${args.join(' ')}`,
      results: selectedEntries.map(entry => ({ ...entry, success: true })),
      loopTimes,
      output: result.stdout || result.stderr || ''
    };
  }

  await withMaaExecutionLease({ source: 'copilot-set', taskName: plan.name, command: 'copilot-plan' }, async () => {
    lifecycle.onStarted?.();
    const configDir = (await getMaaConfigDir()).trim();
    const planDir = join(configDir, 'copilot-plans', planId);
    await mkdir(planDir, { recursive: true });

    for (const [groupIndex, group] of groupEntries(orderEntriesForNavigation(pending, options.navigationStage)).entries()) {
      const list: CopilotListEntry[] = [];
      const executionItems: CopilotExecutionItem[] = [];
      for (const entry of group.entries) {
        const data = await fetchJson(`https://prts.maa.plus/copilot/get/${entry.copilotId}`);
        const content = parseCopilotContent(data);
        for (const { repeat, filename } of buildCopilotRepeatFiles(entry, loopTimes, planDir)) {
          await writeFile(filename, JSON.stringify(content, null, 2));
          list.push({
            id: executionItems.length,
            filename,
            stage_name: entry.displayStage,
            nav_name_override: entry.displayStage,
            is_raid: entry.mode === 'raid'
          });
          executionItems.push({ entry, filename, repeat });
        }
      }
      if (!list.length) continue;

      const taskId = `copilot_plan_${planId}_${Date.now()}`;
      const taskConfig = buildCopilotDynamicTaskConfig(
        groupIndex === 0 ? options.preTasks : [],
        {
          name: taskId,
          type: 'Copilot',
          params: buildCopilotTaskParams(list, Boolean(group.presetFormation), options)
        }
      );
      const checkpoint = await createMaaLogCheckpoint();
      try {
        if (group.presetFormation) await ensurePresetFormationResource(configDir);
        await execDynamicTask(
          taskId,
          taskConfig,
          `作业集 ${plan.name}`,
          'copilot',
          true,
          Boolean(group.presetFormation) || options.userResource === true,
          { clientType }
        );
        for (const entry of group.entries) {
          completed.add(entry.key);
          results.push({ ...entry, success: true });
        }
        await recordCompletedCopilotEntries(group.entries, loopTimes);
        progress[planId] = [...completed];
        await saveProgress(progress);
      } catch (error) {
        const message = getErrorMessage(error) || '作业集执行失败';
        const logText = await readMaaLogSince(checkpoint).catch(() => '');
        const loadedFiles = extractLoadedCopilotFiles(logText);
        const currentFile = loadedFiles.at(-1) || '';
        const currentIndex = executionItems.findIndex(item => currentFile === item.filename || currentFile.endsWith(item.filename));
        const successfulEntries: ExecutableCopilotEntry[] = [];
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
        progress[planId] = [...completed];
        await saveProgress(progress);
        const copilotError = asErrorWithCode(error);
        copilotError.code = copilotError.code || 'COPILOT_PLAN_FAILED';
        copilotError.statusCode = copilotError.statusCode || 422;
        copilotError.details = { ...getErrorDetails(error), plan, results, completed: [...completed] };
        copilotError.retryable = true;
        throw Object.assign(copilotError, { copilotPlan: { plan, results, completed: [...completed] } });
      }
    }
  });

  return {
    success: true,
    plan,
    results,
    completed: [...completed],
    pending: selectedEntries.filter(entry => !completed.has(entry.key))
  };
}

export async function resetCopilotPlanProgress(setId: unknown) {
  const progress = await loadProgress();
  delete progress[String(setId)];
  await saveProgress(progress);
  return { success: true };
}
