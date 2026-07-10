import fetch from 'node-fetch';

const PENGUIN_API_BASE = 'https://penguin-stats.io/PenguinStats/api/v2';
const CACHE_TTL = 30 * 60 * 1000;
const CLIENT_SERVERS = {
  Official: 'CN',
  Bilibili: 'CN',
  YoStarEN: 'US',
  YoStarJP: 'JP',
  YoStarKR: 'KR'
};

const cache = new Map();
const activeRequests = new Map();

function getActiveExistence(item, server, now) {
  const existence = item?.existence?.[server];
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

function getStagePrefix(stageCodes) {
  const counts = new Map();
  stageCodes.forEach(code => {
    const match = String(code || '').match(/^([A-Z]{2,5})-/i);
    if (!match) return;
    const prefix = match[1].toUpperCase();
    counts.set(prefix, (counts.get(prefix) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0] || null;
}

export function selectCurrentPenguinActivity(zones, stages, server = 'CN', now = Date.now()) {
  if (!Array.isArray(zones) || !Array.isArray(stages)) return null;

  const activeZones = zones
    .filter(zone => zone?.type === 'ACTIVITY')
    .map(zone => ({ zone, window: getActiveExistence(zone, server, now) }))
    .filter(candidate => candidate.window)
    .sort((left, right) => right.window.openTime - left.window.openTime);

  for (const { zone, window } of activeZones) {
    const stageCodes = stages
      .filter(stage => stage?.zoneId === zone.zoneId && getActiveExistence(stage, server, now))
      .map(stage => String(stage.code || '').trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    const code = getStagePrefix(stageCodes);
    if (!code) continue;

    return {
      code,
      name: zone.zoneName || zone.zoneName_i18n?.zh || code,
      source: 'penguin',
      startTime: window.openTime,
      endTime: window.closeTime,
      stages: stageCodes
    };
  }

  return null;
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function getFallbackActivity(clientType = 'Official') {
  const server = CLIENT_SERVERS[clientType];
  if (!server) return null;

  const cached = cache.get(server);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.value;
  if (activeRequests.has(server)) return activeRequests.get(server);

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
