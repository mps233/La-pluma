import { readFile } from 'fs/promises';
import { getMaaActivityPath } from '../config/paths.ts';
import { isRecord } from '../utils/errors.ts';

const STAGE_PREFIX = /^([A-Z]{1,8})-/i;

export function normalizeActivityClientType(clientType: unknown = 'Official'): string {
  const normalized = String(clientType || '').trim().toLowerCase();
  if (normalized === 'bilibili') return 'Official';
  if (normalized === 'txwy') return 'txwy';
  if (normalized === 'yostaren') return 'YostarEN';
  if (normalized === 'yostarjp') return 'YostarJP';
  if (normalized === 'yostarkr') return 'YostarKR';
  return 'Official';
}

export function parseStageActivityTime(value: unknown, timeZone: unknown = 8): number | null {
  const match = String(value || '').match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;

  const offsetHours = Number.isFinite(Number(timeZone)) ? Number(timeZone) : 8;
  const utc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  );
  return utc - offsetHours * 60 * 60 * 1000;
}

interface StageActivity {
  code: string;
  name: string;
  source: string;
  startTime: number;
  endTime: number | null;
  stages: string[];
  minimumRequired: unknown;
}

function getActivityWindow(activity: unknown): { startTime: number | null; endTime: number | null } {
  const record = isRecord(activity) ? activity : {};
  const startTime = parseStageActivityTime(record.UtcStartTime, record.TimeZone);
  const endTime = parseStageActivityTime(record.UtcExpireTime, record.TimeZone);
  return { startTime, endTime };
}

function getStagePrefix(stages: unknown[] = []): string {
  const counts = new Map<string, number>();
  for (const rawStage of stages) {
    const stage = isRecord(rawStage) ? rawStage : {};
    const value = String(stage.Value || '').trim();
    if (!value || /^SSReopen-/i.test(value)) continue;
    const match = value.match(STAGE_PREFIX);
    if (!match) continue;
    const prefix = match[1].toUpperCase();
    counts.set(prefix, (counts.get(prefix) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0] || 'SSReopen';
}

export function selectCurrentStageActivity(
  data: unknown,
  clientType: unknown = 'Official',
  now: Date | number = Date.now()
): StageActivity | null {
  const root = isRecord(data) ? data : {};
  const clientKey = normalizeActivityClientType(clientType);
  const rawClientData = root[clientKey] || root.Official;
  const clientData = isRecord(rawClientData) ? rawClientData : {};
  const sideStoryStage = clientData.sideStoryStage;
  if (!isRecord(sideStoryStage)) return null;

  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const active: StageActivity[] = [];

  for (const [key, rawValue] of Object.entries(sideStoryStage)) {
    const raw = isRecord(rawValue) ? rawValue : {};
    const activity = isRecord(raw.Activity) ? raw.Activity : null;
    const stages = Array.isArray(raw.Stages) ? raw.Stages : [];
    if (!activity || stages.length === 0) continue;

    const { startTime, endTime } = getActivityWindow(activity);
    if (startTime === null) continue;
    if (startTime > nowMs) continue;
    if (endTime !== null && endTime <= nowMs) continue;

    const stageValues = stages
      .map(stage => String(isRecord(stage) ? stage.Value || '' : '').trim())
      .filter(Boolean);

    if (stageValues.length === 0) continue;

    active.push({
      code: getStagePrefix(stages),
      name: typeof activity.StageName === 'string' && activity.StageName ? activity.StageName : typeof activity.Tip === 'string' && activity.Tip ? activity.Tip : key,
      source: 'stage-activity',
      startTime,
      endTime,
      stages: stageValues,
      minimumRequired: raw.MinimumRequired || null
    });
  }

  return active.sort((left, right) => right.startTime - left.startTime)[0] || null;
}

export async function getStageActivityInfo(
  clientType: unknown = 'Official',
  now: Date | number = Date.now(),
  { path = getMaaActivityPath(), readFileFn = readFile }: {
    path?: string;
    readFileFn?: (path: string, encoding: 'utf-8') => Promise<string>;
  } = {}
): Promise<StageActivity | null> {
  const content = await readFileFn(path, 'utf-8');
  const data = JSON.parse(content) as unknown;
  return selectCurrentStageActivity(data, clientType, now);
}
