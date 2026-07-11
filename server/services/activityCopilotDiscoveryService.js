import { getActivityRunPreflight } from './activityNavigationService.js';

const PRTS_QUERY_URL = 'https://prts.maa.plus/copilot/query';
const MAX_STAGES = 12;
const CANDIDATES_PER_STAGE = 3;
const SET_CANDIDATE_LIMIT = 8;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseContent(item) {
  try {
    return typeof item?.content === 'string' ? JSON.parse(item.content) : item?.content || {};
  } catch {
    return {};
  }
}

function isPresetFormation(content = {}) {
  return (!Array.isArray(content.opers) || content.opers.length === 0) &&
    (!Array.isArray(content.groups) || content.groups.length === 0) &&
    /_s\d+$/i.test(String(content.stage_name || ''));
}

function stageTitleMatches(title, stage) {
  return new RegExp(`^\\s*${escapeRegExp(stage)}(?:\\s|$|[-_:：,【（(])`, 'i').test(String(title || ''));
}

function findKnownStage(title, stages) {
  return stages.find(stage => stageTitleMatches(title, stage)) || null;
}

function activityStageTitleMatches(title, code) {
  return new RegExp(`^\\s*${escapeRegExp(code)}-(?:\\d+|EX-\\d+|S-\\d+|MO-\\d+|TR-\\d+)(?:\\s|$|[-_:：,【（(])`, 'i')
    .test(String(title || ''));
}

export function coversActivityStages(contents, activityCode, stages) {
  const expected = new Set(stages);
  if (!contents.length || !expected.size) return false;
  if (contents.some(content => !activityStageTitleMatches(content?.doc?.title, activityCode))) return false;
  const actual = new Set(contents
    .map(content => findKnownStage(content?.doc?.title, stages))
    .filter(Boolean));
  return [...expected].every(stage => actual.has(stage));
}

async function fetchCopilotContent(id) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`https://prts.maa.plus/copilot/get/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      return parseContent(payload?.data || payload);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw new Error(`作业读取失败: ${lastError?.message || '网络异常'}`);
}

export async function findMatchingCopilotSet(activity, stages) {
  const keyword = activity.name || activity.code;
  const response = await fetch('https://prts.maa.plus/set/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword, page: 1, limit: 20 }),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`作业集查询失败: HTTP ${response.status}`);
  const payload = await response.json();
  const sets = payload?.status_code === 200 && Array.isArray(payload?.data?.data) ? payload.data.data : [];
  const matches = [];
  for (const set of sets.filter(item => item?.status === 'PUBLIC').slice(0, SET_CANDIDATE_LIMIT)) {
    const ids = Array.isArray(set.copilot_ids) ? set.copilot_ids : [];
    if (ids.length < stages.length) continue;
    try {
      // The public service may reset a burst of simultaneous requests. Read a
      // set's small member list in order with retries so a valid complete set
      // is not accidentally discarded and replaced by individual copilots.
      const contents = [];
      for (const id of ids) contents.push(await fetchCopilotContent(id));
      // A full set often includes optional S/EX stages in addition to the main
      // event stages returned by the activity feed. Accept those extras, but
      // never accept a set containing unrelated stages or missing a main stage.
      if (!coversActivityStages(contents, activity.code, stages)) continue;
      matches.push({
        id: String(set.id),
        name: set.name || `作业集 ${set.id}`,
        creator: set.creator || null,
        updatedAt: set.update_time || set.create_time || null,
        stages: contents.map(content => findKnownStage(content?.doc?.title, stages)).filter(Boolean),
        source: 'prts-set-query'
      });
    } catch {
      // An unavailable member makes this set unsuitable; individual candidates can still be used.
    }
  }
  return matches.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0] || null;
}

export function rankActivityCopilots(items, stage) {
  return items
    .map(item => {
      const content = parseContent(item);
      return {
        id: Number(item.id),
        uri: `maa://${item.id}`,
        stage,
        title: String(content.doc?.title || item.doc?.title || '').trim(),
        stageName: String(content.stage_name || '').trim(),
        presetFormation: isPresetFormation(content),
        uploader: item.uploader || item.uploader_id || null,
        uploadTime: item.upload_time || null,
        ratingLevel: Number(item.rating_level) || 0,
        ratingRatio: Number(item.rating_ratio) || 0,
        hotScore: Number(item.hot_score) || 0,
        views: Number(item.views) || 0
      };
    })
    .filter(candidate => Number.isInteger(candidate.id) && candidate.id > 0 && stageTitleMatches(candidate.title, stage))
    .sort((left, right) =>
      right.ratingLevel - left.ratingLevel ||
      right.ratingRatio - left.ratingRatio ||
      String(right.uploadTime || '').localeCompare(String(left.uploadTime || '')) ||
      right.hotScore - left.hotScore ||
      right.views - left.views
    )
    .slice(0, CANDIDATES_PER_STAGE);
}

async function queryStageCandidates(stage) {
  const url = `${PRTS_QUERY_URL}?level_keyword=${encodeURIComponent(stage)}&page=1&limit=50&order_by=hot`;
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`作业站请求失败: HTTP ${response.status}`);
  const payload = await response.json();
  const items = payload?.status_code === 200 && Array.isArray(payload?.data?.data)
    ? payload.data.data
    : [];
  const reliableItems = items.filter(item =>
    item?.available !== false && item?.status === 'PUBLIC' && item?.not_enough_rating !== true
  );
  return {
    stage,
    query: url,
    candidates: rankActivityCopilots(reliableItems, stage)
  };
}

export function canUseCurrentMapFallback(preflight) {
  return preflight?.state === 'blocked' &&
    preflight?.reasonCode === 'navigation-resource-unavailable' &&
    Boolean(preflight?.activity?.code) &&
    Array.isArray(preflight?.activity?.stages) && preflight.activity.stages.length > 0;
}

export async function findActivityCopilotCandidates(clientType = 'Official', { allowCurrentMap = false } = {}) {
  const preflight = await getActivityRunPreflight(clientType);
  const base = {
    execution: { mode: 'manual-selection-required', executable: false },
    source: { provider: 'prts.maa.plus', endpoint: '/copilot/query', orderBy: 'hot' },
    ranking: [
      '仅保留公开、可用且评分充足的作业',
      '评分等级和评分比例优先',
      '同等评分按上传时间、热度和浏览量排序'
    ],
    preflight
  };

  const currentMapFallback = allowCurrentMap && canUseCurrentMapFallback(preflight);
  if (preflight.state !== 'ready' && !currentMapFallback) {
    return {
      ...base,
      state: 'blocked',
      reason: preflight.reason,
      stages: []
    };
  }

  const stages = [...new Set((preflight.activity.stages || [])
    .map(stage => String(stage || '').trim().toUpperCase())
    .filter(stage => new RegExp(`^${escapeRegExp(preflight.activity.code)}-(?:\\d+|EX-\\d+|S-\\d+|MO-\\d+|TR-\\d+)$`, 'i').test(stage)))]
    .slice(0, MAX_STAGES);
  if (!stages.length) {
    return {
      ...base,
      state: 'blocked',
      reason: '当前活动未提供可精确匹配的关卡列表，未查询作业站。',
      stages: []
    };
  }

  const results = await Promise.all(stages.map(async stage => {
    try {
      return await queryStageCandidates(stage);
    } catch (error) {
      return { stage, query: null, candidates: [], error: error.message };
    }
  }));
  let matchingSet = null;
  try {
    matchingSet = await findMatchingCopilotSet(preflight.activity, stages);
  } catch {
    // Set discovery is an optimization only; exact per-stage candidates remain valid.
  }
  const candidateCount = results.reduce((count, result) => count + result.candidates.length, 0);
  return {
    ...base,
    state: candidateCount ? 'candidates-ready' : 'blocked',
    reason: candidateCount
      ? currentMapFallback
        ? '未找到主页自动导航资源。请先手动进入当前活动关卡地图；系统将仅尝试在该地图内识别并运行作业。'
        : '已按当前活动的明确关卡代号找到候选作业，请选择后再执行。'
      : '未找到满足可靠性条件的活动作业，未生成执行计划。',
    stages: results,
    matchingSet,
    navigationMode: currentMapFallback ? 'current-map-fallback' : 'home-navigation'
  };
}
