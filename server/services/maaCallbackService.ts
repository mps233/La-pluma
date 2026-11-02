import { isRecord } from '../utils/errors.ts';

const CALLBACK_MARKER = 'Assistant::append_callback | ';

export interface MaaCallbackPayload {
  what?: string;
  taskchain?: string;
  details?: Record<string, unknown>;
  callback?: string;
  [key: string]: unknown;
}

export interface DropItem {
  itemId: string;
  name: string;
  count: number;
}

export interface AuxiliaryCallbacks {
  blackflowStartRun: Array<{ status: string; rewards: string[] }>;
  blackflowScrapTradeAborted: Array<{ reason: string; item: string }>;
  copilotPrecheckFile: Array<{ navName: string; filename: string }>;
  stageInfo: Array<{ name: string; stage: string }>;
  stageInfoErrors: number;
  unsupportedLevels: string[];
  recruitSpecialTags: string[];
  recruitSelectedTags: string[][];
  connectionEvents: Array<{ what: string; details: Record<string, unknown> }>;
}

export interface FightCallbackSummary {
  stage: string | null;
  items: DropItem[];
  sanityUsed: number;
  sanityBefore: number | null;
  sanityAfter: number | null;
}

export function parseMaaCallbackPayloads(logOutput: unknown): MaaCallbackPayload[] {
  const events: MaaCallbackPayload[] = [];

  for (const line of String(logOutput || '').split('\n')) {
    const markerIndex = line.indexOf(CALLBACK_MARKER);
    if (markerIndex === -1) continue;

    const callback = line.slice(markerIndex + CALLBACK_MARKER.length);
    const jsonIndex = callback.indexOf('{');
    if (jsonIndex === -1) continue;

    try {
      const parsed = JSON.parse(callback.slice(jsonIndex)) as unknown;
      if (!isRecord(parsed)) continue;
      events.push({
        ...parsed,
        callback: callback.slice(0, jsonIndex).trim()
      } as MaaCallbackPayload);
    } catch {
      // Incremental log checkpoints can begin with an incomplete callback line.
    }
  }

  return events;
}

export function parseMaaCallbackEvents(logOutput: unknown, taskchain: string): MaaCallbackPayload[] {
  return parseMaaCallbackPayloads(logOutput)
    .filter(payload => payload.taskchain === taskchain);
}

function addDropItem(items: DropItem[], rawItem: unknown) {
  const item = isRecord(rawItem) ? rawItem : {};
  const count = Number(item.addQuantity ?? item.quantity ?? 0);
  if (!Number.isFinite(count) || count <= 0) return;

  const itemId = String(item.itemId ?? item.id ?? '');
  const name = String(item.itemName ?? item.name ?? itemId);
  const existing = items.find(entry => entry.itemId === itemId && entry.name === name);
  if (existing) existing.count += count;
  else items.push({ itemId, name, count });
}

/**
 * Collapse Fight callback events into one structured result.
 *
 * `StageDrops.stats[].addQuantity` is the per-run delta; `quantity` is the
 * cumulative owned count. `FightTimes.sanity_cost` is emitted per fight.
 * `SanityBeforeStage` is used as a fallback for sanity when FightTimes is not
 * present in the checkpoint window.
 */
function pushCapped<T>(list: T[], value: T, limit = 20) {
  list.push(value);
  if (list.length > limit) list.splice(0, list.length - limit);
}

/**
 * Summarize callback events that the project exposes to Agent/UI surfaces but
 * that are not part of the Fight drop summarizer.
 */
export function summarizeAuxiliaryCallbacks(logOutput: unknown): AuxiliaryCallbacks {
  const result: AuxiliaryCallbacks = {
    blackflowStartRun: [],
    blackflowScrapTradeAborted: [],
    copilotPrecheckFile: [],
    stageInfo: [],
    stageInfoErrors: 0,
    unsupportedLevels: [],
    recruitSpecialTags: [],
    recruitSelectedTags: [],
    connectionEvents: []
  };

  for (const payload of parseMaaCallbackPayloads(logOutput)) {
    const details = isRecord(payload.details) ? payload.details : {};
    switch (payload.what) {
      case 'BlackFlowStartRun':
        pushCapped(result.blackflowStartRun, {
          status: String(details.status || ''),
          rewards: Array.isArray(details.rewards) ? details.rewards.map(String) : []
        });
        break;
      case 'BlackFlowScrapTradeAborted':
        pushCapped(result.blackflowScrapTradeAborted, {
          reason: String(details.reason || ''),
          item: String(details.item || '')
        });
        break;
      case 'CopilotPrecheckFile':
        pushCapped(result.copilotPrecheckFile, {
          navName: String(details.nav_name || details.navName || ''),
          filename: String(details.filename || '')
        });
        break;
      case 'StageInfo':
        pushCapped(result.stageInfo, {
          name: String(details.name || details.stage || ''),
          stage: String(details.stage || '')
        });
        break;
      case 'StageInfoError':
        result.stageInfoErrors += 1;
        break;
      case 'UnsupportedLevel':
        pushCapped(result.unsupportedLevels, String(details.level || ''));
        break;
      case 'RecruitSpecialTag':
        pushCapped(result.recruitSpecialTags, String(details.tag || ''));
        break;
      case 'RecruitTagsSelected':
        pushCapped(result.recruitSelectedTags, Array.isArray(details.tags) ? details.tags.map(String) : []);
        break;
      case 'ConnectFailed':
      case 'Connected':
      case 'Reconnecting':
      case 'Reconnected':
      case 'Disconnect':
      case 'ScreencapFailed':
      case 'TouchModeNotAvailable':
      case 'MuMuExtrasInputStatus':
      case 'ResolutionChanged':
      case 'ScreencapCost':
      case 'EmulatorFPS':
        pushCapped(result.connectionEvents, { what: payload.what, details });
        break;
      default:
        break;
    }
  }

  return result;
}

export function summarizeFightCallbacks(logOutput: unknown): FightCallbackSummary {
  const payloads = parseMaaCallbackPayloads(logOutput);
  const items: DropItem[] = [];
  let stage: string | null = null;
  let sanityCost = 0;
  let sanityBefore: number | null = null;
  let sanityAfter: number | null = null;

  for (const payload of payloads) {
    const details = isRecord(payload.details) ? payload.details : {};

    if (payload.what === 'StageDrops') {
      const stageDetails = isRecord(details.stage) ? details.stage : null;
      if (typeof stageDetails?.stageCode === 'string') stage = stageDetails.stageCode;
      const stats = Array.isArray(details.stats) ? details.stats : [];
      const drops = stats.length > 0
        ? stats
        : Array.isArray(details.drops) ? details.drops : [];
      for (const item of drops) addDropItem(items, item);
    } else if (payload.what === 'FightTimes') {
      const cost = Number(details.sanity_cost);
      if (Number.isFinite(cost) && cost > 0) sanityCost += cost;
    } else if (payload.what === 'SanityBeforeStage') {
      const current = Number(details.current_sanity);
      if (Number.isFinite(current)) {
        if (sanityBefore === null) sanityBefore = current;
        sanityAfter = current;
      }
    }
  }

  const sanityUsed = sanityCost > 0
    ? sanityCost
    : (sanityBefore !== null && sanityAfter !== null && sanityBefore > sanityAfter
        ? sanityBefore - sanityAfter
        : 0);

  return { stage, items, sanityUsed, sanityBefore, sanityAfter };
}
