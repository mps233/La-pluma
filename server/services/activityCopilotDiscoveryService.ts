import { getErrorMessage, isRecord } from '../utils/errors.ts';
import { getActivityRunPreflight } from './activityNavigationService.ts';
import { getMaaStageByCode } from './maaResourceDataService.ts';
import { loadActivitySelectionContext } from './activityCopilotPreferences.ts';
import { canRunWithOperators, findMissingOperators } from './activityCopilotSelectionService.ts';
import { DEFAULT_CLIENT_TYPE } from '../config/connectionDefaults.ts';

const PRTS_QUERY_URL = 'https://prts.maa.plus/copilot/query';
const MAX_STAGES = 12;
const CANDIDATES_PER_STAGE = 3;
const SET_CANDIDATE_LIMIT = 8;

interface CopilotContent {
  doc?: { title?: string; [key: string]: unknown }
  stage_name?: string
  opers?: unknown[]
  groups?: unknown[]
  [key: string]: unknown
}

interface CopilotRecord {
  id: number
  content: CopilotContent
  ratingLevel: number
  ratingRatio: number
  notEnoughRating: boolean
  hotScore: number
  views: number
  uploadTime: string | null
}

interface CopilotSetMember extends Omit<CopilotRecord, 'content' | 'hotScore' | 'views' | 'uploadTime'> {
  stage: string | null
  missingOperators: string[]
  missingOperatorCount: number
  requiresSupport: boolean
  allowed: boolean
}

interface CopilotSetMatch {
  id: string
  name: string
  creator: string | null
  updatedAt: string | null
  stages: Array<string | null>
  members: CopilotSetMember[]
  ratingScore: number
  ratingRatio: number
  unratedMainStages: number
  source: string
}


export interface ActivityCopilotCandidates {
  state: string
  reason?: string
  stages?: Array<{ stage: string; stageId: string | null; query: string | null; candidates: CopilotCandidate[]; error?: string }>
  preflight?: {
    state: string
    reason?: string
    reasonCode?: string
    activity: { code?: string | null; stages?: unknown[]; [key: string]: unknown }
    [key: string]: unknown
  }
  results?: Array<{ stage: string; stageId: string | null; query: string | null; candidates: CopilotCandidate[]; error?: string }>
  matchingSet?: CopilotSetMatch | null
  navigationMode?: string
  [key: string]: unknown
}

interface CopilotCandidate {
  id: number
  uri: string
  stage: string
  title: string
  stageName: string
  presetFormation: boolean
  uploader: string | null
  uploadTime: string | null
  ratingLevel: number
  ratingRatio: number
  notEnoughRating: boolean
  hotScore: number
  views: number
  missingOperators: string[]
  missingOperatorCount: number
  requiresSupport: boolean
  allowed: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}


function escapeRegExp(value: unknown): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compareActivityStageCodes(left: string, right: string): number {
  const leftMatch = left.match(/-(\d+)$/);
  const rightMatch = right.match(/-(\d+)$/);
  if (leftMatch && rightMatch) {
    const numberDelta = Number(leftMatch[1]) - Number(rightMatch[1]);
    if (numberDelta !== 0) return numberDelta;
  }
  return left.localeCompare(right);
}

function parseContent(item: unknown): CopilotContent {
  try {
    const content = asRecord(item).content;
    return (typeof content === 'string' ? JSON.parse(content) : content || {}) as CopilotContent;
  } catch {
    return {};
  }
}

function isPresetFormation(content: CopilotContent = {}): boolean {
  return (!Array.isArray(content.opers) || content.opers.length === 0) &&
    (!Array.isArray(content.groups) || content.groups.length === 0) &&
    /_s\d+$/i.test(String(content.stage_name || ''));
}

function stageTitleMatches(title: unknown, stage: unknown): boolean {
  return new RegExp(`(?:^|[\\s\\-_【（(】])${escapeRegExp(stage)}(?:\\s|$|[-_:：,【（(])`, 'i').test(String(title || ''));
}

function findKnownStage(title: unknown, stages: string[]): string | null {
  return stages.find(stage => stageTitleMatches(title, stage)) || null;
}

function activityStageTitleMatches(title: unknown, code: unknown): boolean {
  return new RegExp(`(?:^|[\\s\\-_【（(】])${escapeRegExp(code)}-(?:\\d+|EX-\\d+|S-\\d+|MO-\\d+|TR-\\d+)(?:\\s|$|[-_:：,【（(])`, 'i')
    .test(String(title || ''));
}

export function coversActivityStages(contents: unknown[], activityCode: string, stages: string[]): boolean {
  const expected = new Set(stages);
  if (!contents.length || !expected.size) return false;
  if (contents.some(content => !activityStageTitleMatches(asRecord(asRecord(content).doc).title, activityCode))) return false;
  const actual = new Set(contents
    .map(content => findKnownStage(asRecord(asRecord(content).doc).title, stages))
    .filter(Boolean));
  return [...expected].every(stage => actual.has(stage));
}

async function fetchCopilotRecord(id: number): Promise<CopilotRecord> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`https://prts.maa.plus/copilot/get/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      const data = asRecord(asRecord(payload).data || payload);
      return {
        id: asNumber(data.id) || id,
        content: parseContent(data),
        ratingLevel: asNumber(data.rating_level),
        ratingRatio: asNumber(data.rating_ratio),
        notEnoughRating: data.not_enough_rating === true,
        hotScore: asNumber(data.hot_score),
        views: asNumber(data.views),
        uploadTime: typeof data.upload_time === 'string' ? data.upload_time : null
      };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise<void>(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw new Error(`作业读取失败: ${getErrorMessage(lastError) || '网络异常'}`);
}

export function scoreCopilotSetMembers(members: Array<{ stage?: unknown; ratingLevel: number; ratingRatio: number }>) {
  const mainMembers = members.filter(member => member.stage);
  const total = mainMembers.length;
  if (!total) return { ratingScore: 0, ratingRatio: 0, unratedMainStages: 0 };
  return {
    ratingScore: mainMembers.reduce((sum, member) => sum + member.ratingLevel, 0) / total,
    ratingRatio: mainMembers.reduce((sum, member) => sum + member.ratingRatio, 0) / total,
    unratedMainStages: mainMembers.filter(member => member.ratingLevel <= 0 && member.ratingRatio <= 0).length
  };
}

async function findMatchingCopilotSets(activity: Record<string, unknown>, stages: string[], selection: unknown = null): Promise<CopilotSetMatch[]> {
  const keyword = asString(activity.name) || asString(activity.code);
  const response = await fetch('https://prts.maa.plus/set/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword, page: 1, limit: 20 }),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`作业集查询失败: HTTP ${response.status}`);
  const payload: unknown = await response.json();
  const payloadRecord = asRecord(payload);
  const sets = payloadRecord.status_code === 200 && Array.isArray(asRecord(payloadRecord.data).data)
    ? asRecord(payloadRecord.data).data as unknown[]
    : [];
  const matches: CopilotSetMatch[] = [];
  for (const setValue of sets.filter(item => asRecord(item).status === 'PUBLIC').slice(0, SET_CANDIDATE_LIMIT)) {
    const set = asRecord(setValue);
    const ids = Array.isArray(set.copilot_ids) ? set.copilot_ids.map(Number).filter(Number.isInteger) : [];
    if (ids.length < stages.length) continue;
    try {
      // The public service may reset a burst of simultaneous requests. Read a
      // set's small member list in order with retries so a valid complete set
      // is not accidentally discarded and replaced by individual copilots.
      const records: CopilotRecord[] = [];
      for (const id of ids) records.push(await fetchCopilotRecord(id));
      // A full set often includes optional S/EX stages in addition to the main
      // event stages returned by the activity feed. Accept those extras, but
      // never accept a set containing unrelated stages or missing a main stage.
      if (!coversActivityStages(records.map(record => record.content), asString(activity.code), stages)) continue;

      const members: CopilotSetMember[] = records.map(record => {
        const stage = findKnownStage(record.content?.doc?.title, stages) || null;
        const missing = findMissingOperators(record.content, asRecord(selection).ownedOperators as Set<string> | null);
        const allowed = !selection || canRunWithOperators(missing, asRecord(selection).preferences);
        return {
          id: record.id,
          stage,
          ratingLevel: record.ratingLevel,
          ratingRatio: record.ratingRatio,
          notEnoughRating: record.notEnoughRating,
          missingOperators: missing.names,
          missingOperatorCount: missing.count,
          requiresSupport: missing.count > 0 && allowed,
          allowed
        };
      });
      if (members.some(member => !member.allowed)) continue;

      const score = scoreCopilotSetMembers(members);
      matches.push({
        id: String(set.id),
        name: asString(set.name) || `作业集 ${String(set.id)}`,
        creator: typeof set.creator === 'string' ? set.creator : null,
        updatedAt: typeof (set.update_time || set.create_time) === 'string' ? String(set.update_time || set.create_time) : null,
        stages: members.map(member => member.stage).filter((stage): stage is string => Boolean(stage)),
        members,
        ...score,
        source: 'prts-set-query'
      });
    } catch {
      // An unavailable member makes this set unsuitable; individual candidates can still be used.
    }
  }
  return matches.sort((left, right) =>
    right.ratingScore - left.ratingScore ||
    right.ratingRatio - left.ratingRatio ||
    right.unratedMainStages - left.unratedMainStages ||
    String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''))
  );
}

export function rankActivityCopilots(items: unknown[], stage: string, selection: unknown = null): CopilotCandidate[] {
  return items
    .map(itemValue => {
      const item = asRecord(itemValue);
      const content = parseContent(item);
      const missing = findMissingOperators(content, asRecord(selection).ownedOperators as Set<string> | null);
      const allowed = !selection || canRunWithOperators(missing, asRecord(selection).preferences);
      return {
        id: Number(item.id),
        uri: `prts://${item.id}`,
        stage,
        title: String(content.doc?.title || asRecord(item.doc).title || '').trim(),
        stageName: String(content.stage_name || '').trim(),
        presetFormation: isPresetFormation(content),
        uploader: typeof item.uploader === 'string' ? item.uploader : (typeof item.uploader_id === 'string' ? item.uploader_id : null),
        uploadTime: typeof item.upload_time === 'string' ? item.upload_time : null,
        ratingLevel: asNumber(item.rating_level),
        ratingRatio: asNumber(item.rating_ratio),
        notEnoughRating: item.not_enough_rating === true,
        hotScore: asNumber(item.hot_score),
        views: asNumber(item.views),
        missingOperators: missing.names,
        missingOperatorCount: missing.count,
        requiresSupport: missing.count > 0 && allowed,
        allowed
      };
    })
    .filter(candidate => candidate.allowed
      && Number.isInteger(candidate.id) && candidate.id > 0
      && stageTitleMatches(candidate.title, stage))
    .sort((left, right) =>
      right.ratingLevel - left.ratingLevel ||
      right.ratingRatio - left.ratingRatio ||
      String(right.uploadTime || '').localeCompare(String(left.uploadTime || '')) ||
      right.hotScore - left.hotScore ||
      right.views - left.views
    )
    .slice(0, CANDIDATES_PER_STAGE);
}

async function queryStageCandidates(stage: string, selection: unknown = null): Promise<{ stage: string; stageId: string | null; query: string | null; candidates: CopilotCandidate[] }> {
  const stageInfo = await getMaaStageByCode(stage).catch(() => null);
  const stageId = typeof stageInfo?.stageId === 'string' ? stageInfo.stageId : null;
  const keywords: string[] = [...new Set([stageId, stage].filter((value): value is string => Boolean(value)))];
  let lastQuery: string | null = null;
  let lastError: unknown = null;
  let succeeded = false;

  for (const keyword of keywords) {
    const url = `${PRTS_QUERY_URL}?level_keyword=${encodeURIComponent(keyword)}&page=1&limit=50&order_by=hot`;
    lastQuery = url;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`作业站请求失败: HTTP ${response.status}`);
      const payload: unknown = await response.json();
      succeeded = true;
      const payloadRecord = asRecord(payload);
      const dataRecord = asRecord(payloadRecord.data);
      const items = payloadRecord.status_code === 200 && Array.isArray(dataRecord.data)
        ? dataRecord.data
        : [];
      const reliableItems = items.filter(item => {
        const record = asRecord(item);
        return record.available !== false && record.status === 'PUBLIC' && record.not_enough_rating !== true;
      });
      const candidates = rankActivityCopilots(reliableItems, stage, selection);
      if (candidates.length > 0) {
        return {
          stage,
          stageId,
          query: url,
          candidates
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (!succeeded && lastError) throw lastError;

  return {
    stage,
    stageId,
    query: lastQuery,
    candidates: []
  };
}

export function canUseCurrentMapFallback(preflight: unknown): boolean {
  const record = asRecord(preflight);
  const activity = asRecord(record.activity);
  return record.state === 'blocked' &&
    record.reasonCode === 'navigation-resource-unavailable' &&
    Boolean(activity.code) &&
    Array.isArray(activity.stages) && activity.stages.length > 0;
}

export async function findActivityCopilotCandidates(clientType: string = DEFAULT_CLIENT_TYPE, { allowCurrentMap = false, selection = null }: { allowCurrentMap?: boolean; selection?: unknown } = {}): Promise<ActivityCopilotCandidates> {
  const selectionContext = selection || await loadActivitySelectionContext();
  const preflight = await getActivityRunPreflight(clientType) as {
    state: string
    reason?: string
    reasonCode?: string
    activity: { code?: string | null; stages?: unknown[]; [key: string]: unknown }
  };
  const base: Record<string, unknown> = {
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

  const stages: string[] = [...new Set(((preflight.activity.stages || []) as unknown[])
    .map(stage => String(stage || '').trim().toUpperCase())
    .filter(stage => new RegExp(`^${escapeRegExp(preflight.activity.code)}-(?:\\d+|EX-\\d+|S-\\d+|MO-\\d+|TR-\\d+)$`, 'i').test(stage)))]
    .sort(compareActivityStageCodes)
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
      return await queryStageCandidates(stage, selectionContext);
    } catch (error) {
      return { stage, stageId: null, query: null, candidates: [], error: getErrorMessage(error) };
    }
  }));
  let matchingSets: CopilotSetMatch[] = [];
  try {
    matchingSets = await findMatchingCopilotSets(preflight.activity, stages, selectionContext);
  } catch {
    // Set discovery is an optimization only; exact per-stage candidates remain valid.
  }
  const matchingSet = matchingSets[0] || null;
  const candidateCount = results.reduce((count, result) => count + result.candidates.length, 0);
  return {
    ...base,
    state: candidateCount || matchingSet ? 'candidates-ready' : 'blocked',
    reason: candidateCount || matchingSet
      ? currentMapFallback
        ? '未找到主页自动导航资源。请先手动进入当前活动关卡地图；系统将仅尝试在该地图内识别并运行作业。'
        : '已按当前活动的明确关卡代号找到候选作业，请选择后再执行。'
      : '未找到满足可靠性条件的活动作业，未生成执行计划。',
    stages: results,
    matchingSet,
    matchingSets,
    navigationMode: currentMapFallback ? 'current-map-fallback' : 'home-navigation'
  };
}
