import { readFile } from 'fs/promises';
import { getMaaActivityPath } from '../config/paths.js';

const STAGE_PREFIX = /^([A-Z]{1,8})-/i;

export function normalizeActivityClientType(clientType = 'Official') {
  const normalized = String(clientType || '').trim().toLowerCase();
  if (normalized === 'bilibili') return 'Official';
  if (normalized === 'txwy') return 'txwy';
  if (normalized === 'yostaren') return 'YostarEN';
  if (normalized === 'yostarjp') return 'YostarJP';
  if (normalized === 'yostarkr') return 'YostarKR';
  return 'Official';
}

export function parseStageActivityTime(value, timeZone = 8) {
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

function getActivityWindow(activity = {}) {
  const startTime = parseStageActivityTime(activity.UtcStartTime, activity.TimeZone);
  const endTime = parseStageActivityTime(activity.UtcExpireTime, activity.TimeZone);
  return { startTime, endTime };
}

function getStagePrefix(stages = []) {
  const counts = new Map();
  for (const stage of stages) {
    const value = String(stage?.Value || '').trim();
    if (!value || /^SSReopen-/i.test(value)) continue;
    const match = value.match(STAGE_PREFIX);
    if (!match) continue;
    const prefix = match[1].toUpperCase();
    counts.set(prefix, (counts.get(prefix) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0] || 'SSReopen';
}

export function selectCurrentStageActivity(data, clientType = 'Official', now = Date.now()) {
  const clientKey = normalizeActivityClientType(clientType);
  const clientData = data?.[clientKey] || data?.Official;
  const sideStoryStage = clientData?.sideStoryStage;
  if (!sideStoryStage || typeof sideStoryStage !== 'object') return null;

  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const active = [];

  for (const [key, raw] of Object.entries(sideStoryStage)) {
    const activity = raw?.Activity;
    const stages = Array.isArray(raw?.Stages) ? raw.Stages : [];
    if (!activity || stages.length === 0) continue;

    const { startTime, endTime } = getActivityWindow(activity);
    if (startTime === null) continue;
    if (startTime > nowMs) continue;
    if (endTime !== null && endTime <= nowMs) continue;

    const stageValues = stages
      .map(stage => String(stage?.Value || '').trim())
      .filter(Boolean);

    if (stageValues.length === 0) continue;

    active.push({
      code: getStagePrefix(stages),
      name: activity.StageName || activity.Tip || key,
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
  clientType = 'Official',
  now = Date.now(),
  { path = getMaaActivityPath(), readFileFn = readFile } = {}
) {
  const content = await readFileFn(path, 'utf-8');
  const data = JSON.parse(content);
  return selectCurrentStageActivity(data, clientType, now);
}
