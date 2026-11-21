const CALLBACK_MARKER = 'Assistant::append_callback | ';
const LINE_TIMESTAMP_PATTERN = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\]/;

export type MaaCallbackDetails = Readonly<Record<string, unknown>>;

/**
 * 单条 MaaCore 回调事件：`callback` 与 `taskchain` 已校验，其余字段按 MaaCore 原样保留，
 * 未建模字段不会因解析被丢弃。
 */
export interface MaaCallbackEvent {
  callback: string;
  taskchain: string;
  atMs?: number;
  [field: string]: unknown;
}

function isPayloadRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLineTimestampMs(line: string): number | undefined {
  const match = LINE_TIMESTAMP_PATTERN.exec(line);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number(match[7]);

  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return undefined;
  }

  const date = new Date(year, month - 1, day, hour, minute, second, millisecond);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second ||
    date.getMilliseconds() !== millisecond
  ) {
    return undefined;
  }

  return date.getTime();
}

/** 解析日志中的结构化回调：只保留目标 taskchain，容忍断行与非法 JSON。 */
export function parseMaaCallbackEvents(
  logOutput: string | null | undefined,
  taskchain: string
): MaaCallbackEvent[] {
  const events: MaaCallbackEvent[] = [];

  for (const line of String(logOutput || '').split('\n')) {
    const atMs = parseLineTimestampMs(line);
    const markerIndex = line.indexOf(CALLBACK_MARKER);
    if (markerIndex === -1) continue;

    const callback = line.slice(markerIndex + CALLBACK_MARKER.length);
    const jsonIndex = callback.indexOf('{');
    if (jsonIndex === -1) continue;

    let payload: unknown;
    try {
      payload = JSON.parse(callback.slice(jsonIndex));
    } catch {
      // Incremental log checkpoints can begin with an incomplete callback line.
      continue;
    }

    // 只接受带目标 taskchain 的对象载荷；数组、标量与缺少 taskchain 的载荷都不是回调事件。
    if (!isPayloadRecord(payload)) continue;
    const payloadTaskchain = payload.taskchain;
    if (typeof payloadTaskchain !== 'string' || payloadTaskchain !== taskchain) continue;

    events.push({
      ...payload,
      taskchain: payloadTaskchain,
      callback: callback.slice(0, jsonIndex).trim(),
      ...(atMs === undefined ? {} : { atMs })
    });
  }

  return events;
}

export function getCallbackDetails(event: MaaCallbackEvent): MaaCallbackDetails | undefined {
  const details = event.details;
  return isPayloadRecord(details) ? details : undefined;
}

export function getCallbackStringField(event: MaaCallbackEvent, field: string): string | undefined {
  const value = event[field];
  return typeof value === 'string' ? value : undefined;
}

export function getCallbackStringList(event: MaaCallbackEvent, field: string): string[] {
  const value = getCallbackDetails(event)?.[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function getCallbackTaskName(event: MaaCallbackEvent): string | undefined {
  const task = getCallbackDetails(event)?.task;
  return typeof task === 'string' ? task : undefined;
}

export function getStartedTaskNames(events: readonly MaaCallbackEvent[]): string[] {
  const taskNames: string[] = [];

  for (const event of events) {
    if (event.callback !== 'SubTaskStart') continue;
    const task = getCallbackTaskName(event);
    if (task !== undefined) taskNames.push(task);
  }

  return taskNames;
}
