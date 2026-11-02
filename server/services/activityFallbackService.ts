import fetch from 'node-fetch';
import { DEFAULT_CLIENT_TYPE } from '../config/connectionDefaults.ts';
import { isRecord } from '../utils/errors.ts';
import { createLogger } from '../utils/logger.ts';

const logger = createLogger('ActivityFallback');

const PENGUIN_API_BASE = 'https://penguin-stats.io/PenguinStats/api/v2';
const CACHE_TTL = 30 * 60 * 1000;
const CLIENT_SERVERS: Record<string, string> = {
  Official: 'CN',
  Bilibili: 'CN',
  YoStarEN: 'US',
  YoStarJP: 'JP',
  YoStarKR: 'KR'
};

interface ActivityExistence {
  openTime: number;
  closeTime: number | null;
}

interface PenguinActivity {
  code: string;
  name: string;
  source: 'penguin';
  startTime: number;
  endTime: number | null;
  stages: string[];
}

interface ActivityCacheEntry {
  timestamp: number;
  value: PenguinActivity | null;
}

const cache = new Map<string, ActivityCacheEntry>();
const activeRequests = new Map<string, Promise<PenguinActivity | null>>();

function getActiveExistence(item: unknown, server: string, now: number): ActivityExistence | null {
  const itemRecord = isRecord(item) ? item : {};
  const existenceMap = isRecord(itemRecord.existence) ? itemRecord.existence : {};
  const existence = isRecord(existenceMap[server]) ? existenceMap[server] : null;
  if (!existence?.exist) return null;

  const openTime = Number(existence.openTime);
  const closeTime = Number(existence.closeTime);
  if (!Number.isFinite(openTime) || openTime > now) return null;
  if (Number.isFinite(closeTime) && closeTime <= now) return null;

  return {
    openTime,
    closeTime: Number.isFinite(closeTime) ? closeTime : null
  };
}

function getStagePrefix(stageCodes: string[]): string | null {
  const counts = new Map<string, number>();
  stageCodes.forEach(code => {
    const match = String(code || '').match(/^([A-Z]{2,5})-/i);
    if (!match) return;
    const prefix = match[1].toUpperCase();
    counts.set(prefix, (counts.get(prefix) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0] || null;
}

export function selectCurrentPenguinActivity(
  zones: unknown,
  stages: unknown,
  server: string = 'CN',
  now: number = Date.now()
): PenguinActivity | null {
  if (!Array.isArray(zones) || !Array.isArray(stages)) return null;

  const activeZones = zones
    .filter(isRecord)
    .filter(zone => zone.type === 'ACTIVITY')
    .map(zone => ({ zone, window: getActiveExistence(zone, server, now) }))
    .filter((candidate): candidate is { zone: Record<string, unknown>; window: ActivityExistence } => (
      candidate.window !== null
    ))
    .sort((left, right) => right.window.openTime - left.window.openTime);

  for (const { zone, window } of activeZones) {
    const stageCodes = stages
      .filter(isRecord)
      .filter(stage => stage.zoneId === zone.zoneId && getActiveExistence(stage, server, now) !== null)
      .map(stage => String(stage.code || '').trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    const code = getStagePrefix(stageCodes);
    if (!code) continue;

    const zoneNameI18n = isRecord(zone.zoneName_i18n) ? zone.zoneName_i18n : {};
    const name = typeof zone.zoneName === 'string' && zone.zoneName
      ? zone.zoneName
      : typeof zoneNameI18n.zh === 'string' && zoneNameI18n.zh
        ? zoneNameI18n.zh
        : code;

    return {
      code,
      name,
      source: 'penguin',
      startTime: window.openTime,
      endTime: window.closeTime,
      stages: stageCodes
    };
  }

  return null;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function getFallbackActivity(
  clientType: string = DEFAULT_CLIENT_TYPE
): Promise<PenguinActivity | null> {
  const server = CLIENT_SERVERS[clientType];
  if (!server) {
    logger.debug('Penguin 没有该客户端的数据源', { clientType });
    return null;
  }

  const cached = cache.get(server);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.value;
  const pendingRequest = activeRequests.get(server);
  if (pendingRequest) return pendingRequest;

  const request = Promise.all([
    fetchJson(`${PENGUIN_API_BASE}/zones?server=${server}`),
    fetchJson(`${PENGUIN_API_BASE}/stages?server=${server}`)
  ]).then(([zones, stages]) => {
    const value = selectCurrentPenguinActivity(zones, stages, server);
    cache.set(server, { timestamp: Date.now(), value });
    return value;
  }).finally(() => {
    activeRequests.delete(server);
  });

  activeRequests.set(server, request);
  return request;
}
