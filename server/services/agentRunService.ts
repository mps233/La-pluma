import { asErrorWithCode, getErrorDetails, getErrorStatus } from '../utils/errors.ts';
import type { ErrorWithCode } from '../utils/errors.ts';
import { getErrorCode, getErrorMessage } from '../utils/errors.ts';
import { createHash, randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { agentError } from '../utils/apiHelper.ts';
import { readJsonFile, writeJsonFile } from '../utils/fileHelper.ts';
import { createLogger } from '../utils/logger.ts';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$/;
const TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_TERMINAL_RUNS = 500;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'stopped', 'interrupted']);
const ACTIVE_STATUSES = new Set(['accepted', 'waiting', 'running', 'stopping']);
const ALL_STATUSES = new Set([...TERMINAL_STATUSES, ...ACTIVE_STATUSES]);
const AGENT_RUN_STORE_VERSION = 1;
const DEFAULT_AGENT_RUN_STORE_PATH = fileURLToPath(new URL('../data/agent-runs.json', import.meta.url));
const logger = createLogger('AgentRunService');

export interface AgentRunFailure {
  code: string;
  message: string;
  statusCode: number;
  details: Record<string, unknown>;
  retryable: boolean;
}

export interface AgentRun {
  runId: string;
  operationId: string;
  idempotencyKey: string | null;
  inputFingerprint: string;
  input: unknown;
  metadata: unknown;
  trigger: unknown;
  progress: unknown;
  taskResults: unknown[];
  status: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  result: unknown;
  error: AgentRunFailure | null;
}

export interface AgentRunRecord {
  run: AgentRun;
  sequence: number;
  createdAtMs: number;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  terminalSequence: number | null;
}

export interface AgentRunDto {
  runId: string;
  operationId: string;
  state: string;
  acceptedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs?: number;
  trigger: unknown;
  progress?: unknown;
  taskResults: unknown[];
  result: unknown;
  error?: AgentRunFailure;
  links: { self: string; stop: string; targetedStop: string };
}

export interface AgentRunPersistence {
  enabled: boolean;
  required: boolean;
  filePath: string;
  readStore: (filePath: string, fallback: unknown) => Promise<unknown>;
  writeStore: (filePath: string, data: unknown) => Promise<unknown>;
  runtimeLogger: ReturnType<typeof createLogger>;
}

export interface AgentRunStoreOverrides {
  filePath?: string;
  readStore?: AgentRunPersistence['readStore'];
  writeStore?: AgentRunPersistence['writeStore'];
  runtimeLogger?: AgentRunPersistence['runtimeLogger'];
  required?: boolean;
}

export interface BeginAgentRunInput {
  operationId: string;
  idempotencyKey?: string | null;
  input?: unknown;
  metadata?: unknown;
  trigger?: unknown;
  progress?: unknown;
  taskResults?: unknown[];
}


const runs = new Map<string, AgentRunRecord>();
const idempotencyIndex = new Map<string, { runId: string; inputFingerprint: string }>();
let sequence = 0;
let terminalSequence = 0;
let persistence: AgentRunPersistence = {
  enabled: false,
  required: false,
  filePath: DEFAULT_AGENT_RUN_STORE_PATH,
  readStore: readJsonFile,
  writeStore: writeJsonFile,
  runtimeLogger: logger
};
let persistenceDirty = false;
let persistencePromise: Promise<void> | null = null;
let persistenceError: unknown = null;
let persistenceStartQueued = false;
let persistenceGeneration = 0;

function agentRunPersistenceError(error: unknown) {
  return agentError('AGENT_RUN_PERSISTENCE_FAILED', `Agent run 持久化失败: ${getErrorMessage(error) || error}`, {
    statusCode: 503,
    details: { filePath: persistence.filePath },
    retryable: true
  });
}

function assertAgentRunStoreReadable() {
  if (persistence.required && !persistence.enabled) {
    throw agentRunPersistenceError(persistenceError || new Error('Agent run 存储尚未就绪'));
  }
}

function buildStoreSnapshot() {
  return {
    version: AGENT_RUN_STORE_VERSION,
    savedAt: new Date().toISOString(),
    runs: [...runs.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .map(record => ({
        run: JSON.parse(JSON.stringify(record.run)),
        sequence: record.sequence,
        createdAtMs: record.createdAtMs,
        startedAtMs: record.startedAtMs,
        finishedAtMs: record.finishedAtMs,
        terminalSequence: record.terminalSequence
      }))
  };
}

function startPersistenceWriter() {
  if (!persistence.enabled || persistencePromise || !persistenceDirty) return persistencePromise;

  const generation = persistenceGeneration;
  const activePersistence = persistence;
  const writer = (async (): Promise<void> => {
    while (generation === persistenceGeneration && persistenceDirty) {
      persistenceDirty = false;
      try {
        await activePersistence.writeStore(activePersistence.filePath, buildStoreSnapshot());
        if (generation !== persistenceGeneration) break;
        persistenceError = null;
      } catch (error) {
        if (generation !== persistenceGeneration) break;
        persistenceDirty = true;
        persistenceError = error;
        activePersistence.runtimeLogger.error('Agent run 持久化失败', {
          filePath: activePersistence.filePath,
          error: getErrorMessage(error)
        });
        break;
      }
    }
  });
  const settled = writer().finally(() => {
    if (persistencePromise !== settled) return;
    persistencePromise = null;
    if (generation === persistenceGeneration
      && persistence.enabled
      && persistenceDirty
      && !persistenceError) {
      startPersistenceWriter();
    }
  });
  persistencePromise = settled;
  return settled;
}

function scheduleAgentRunPersistence() {
  if (!persistence.enabled) return;
  persistenceDirty = true;
  if (persistencePromise || persistenceStartQueued) return;
  const generation = persistenceGeneration;
  persistenceStartQueued = true;
  queueMicrotask(() => {
    if (generation !== persistenceGeneration) return;
    persistenceStartQueued = false;
    startPersistenceWriter();
  });
}

export async function flushAgentRunStore() {
  if (!persistence.enabled) {
    if (persistence.required) {
      throw agentRunPersistenceError(persistenceError || new Error('Agent run 存储尚未就绪'));
    }
    return { persisted: false, filePath: persistence.filePath };
  }

  while (true) {
    const pending = startPersistenceWriter();
    if (pending) await pending;
    if (persistenceError) throw agentRunPersistenceError(persistenceError);
    if (!persistenceDirty && !persistencePromise) {
      return { persisted: true, filePath: persistence.filePath };
    }
  }
}

export async function withFlushedAgentRunSnapshot<T>(runId: string, consume: (run: AgentRunDto | null) => T): Promise<T> {
  while (true) {
    await flushAgentRunStore();
    const run = getAgentRun(runId);
    if (!persistenceDirty && !persistencePromise) return consume(run);
  }
}

export function getAgentRunStoreStatus() {
  return {
    enabled: persistence.enabled,
    required: persistence.required,
    ready: persistence.enabled && !persistenceError,
    dirty: persistenceDirty,
    filePath: persistence.filePath,
    error: persistenceError ? getErrorMessage(persistenceError) : null
  };
}

function validationError(code: string, message: string, details: Record<string, unknown> = {}) {
  return agentError(code, message, {
    statusCode: 400,
    details,
    retryable: false
  });
}

function normalizeJson<T>(value: T, fieldName: string): T {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError(`${fieldName} 不是可序列化的 JSON 值`);
    }
    return JSON.parse(serialized) as T;
  } catch (error) {
    throw validationError(
      'AGENT_RUN_JSON_INVALID',
      `${fieldName} 必须是可序列化的 JSON`,
      { field: fieldName, reason: getErrorMessage(error) }
    );
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

export function fingerprintAgentRunInput(input: unknown = {}) {
  const normalized = normalizeJson(input, 'input');
  return createHash('sha256').update(stableJson(normalized)).digest('hex');
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toAgentRunDto(run: AgentRun | undefined | null): AgentRunDto | null {
  if (!run) return null;

  const dto: AgentRunDto = {
    runId: run.runId,
    operationId: run.operationId,
    state: run.status,
    acceptedAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    result: cloneJson(run.result),
    trigger: run.trigger === undefined ? null : cloneJson(run.trigger),
    taskResults: cloneJson(run.taskResults || []),
    links: {
      self: `/api/agent/runs/${run.runId}`,
      stop: '/api/agent/actions/stop',
      targetedStop: `/api/agent/runs/${run.runId}/stop`
    }
  };
  if (run.durationMs !== null) dto.durationMs = run.durationMs;
  if (run.progress) dto.progress = cloneJson(run.progress);
  if (run.error) {
    dto.error = {
      code: run.error.code,
      message: run.error.message,
      details: cloneJson(run.error.details),
      retryable: run.error.retryable,
      statusCode: run.error.statusCode
    };
  }
  return cloneJson(dto);
}

function idempotencyIndexKey(operationId: string, idempotencyKey: string) {
  return JSON.stringify([operationId, idempotencyKey]);
}

function removeRecord(runId: string): boolean {
  const record = runs.get(runId);
  if (!record) return false;

  runs.delete(runId);
  if (record.run.idempotencyKey) {
    const indexKey = idempotencyIndexKey(record.run.operationId, record.run.idempotencyKey);
    if (idempotencyIndex.get(indexKey)?.runId === runId) idempotencyIndex.delete(indexKey);
  }
  return true;
}

function pruneTerminalRuns(now: number = Date.now()): number {
  const cutoff = now - TERMINAL_RETENTION_MS;
  const retained: AgentRunRecord[] = [];
  let removed = 0;

  for (const [runId, record] of runs) {
    if (!TERMINAL_STATUSES.has(record.run.status)) continue;
    if ((record.finishedAtMs ?? 0) <= cutoff) {
      if (removeRecord(runId)) removed += 1;
      continue;
    }
    retained.push(record);
  }

  if (retained.length <= MAX_TERMINAL_RUNS) return removed;
  retained.sort((left, right) =>
    (left.finishedAtMs ?? 0) - (right.finishedAtMs ?? 0) || (left.terminalSequence ?? 0) - (right.terminalSequence ?? 0)
  );
  for (const record of retained.slice(0, retained.length - MAX_TERMINAL_RUNS)) {
    if (removeRecord(record.run.runId)) removed += 1;
  }
  return removed;
}

function normalizeOperationId(operationId: unknown): string {
  if (typeof operationId !== 'string' || !operationId.trim()) {
    throw validationError(
      'AGENT_RUN_OPERATION_REQUIRED',
      'operationId 不能为空',
      { operationId }
    );
  }
  return operationId.trim();
}

function normalizeIdempotencyKey(idempotencyKey: unknown): string | null {
  if (idempotencyKey === undefined || idempotencyKey === null) return null;
  if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw validationError(
      'AGENT_IDEMPOTENCY_KEY_INVALID',
      'idempotencyKey 格式不合法',
      { idempotencyKey, pattern: IDEMPOTENCY_KEY_PATTERN.source }
    );
  }
  return idempotencyKey;
}

function requireRecord(runId: string): AgentRunRecord {
  if (pruneTerminalRuns() > 0) scheduleAgentRunPersistence();
  const record = runs.get(runId);
  if (!record) {
    throw agentError('AGENT_RUN_NOT_FOUND', `未找到 Agent run: ${runId}`, {
      statusCode: 404,
      details: { runId },
      retryable: false
    });
  }
  return record;
}

function transitionError(record: AgentRunRecord, targetStatus: string, allowedStatuses: string[]) {
  return agentError('AGENT_RUN_STATE_CONFLICT', `无法将 run 从 ${record.run.status} 更新为 ${targetStatus}`, {
    statusCode: 409,
    details: {
      runId: record.run.runId,
      status: record.run.status,
      targetStatus,
      allowedStatuses
    },
    retryable: false
  });
}

function transition(runId: string, targetStatus: string, allowedStatuses: string[], updates: Partial<AgentRun> = {}) {
  const record = requireRecord(runId);
  if (record.run.status === targetStatus) return toAgentRunDto(record.run) as AgentRunDto;
  if (!allowedStatuses.includes(record.run.status)) {
    throw transitionError(record, targetStatus, allowedStatuses);
  }

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  record.run.status = targetStatus;
  record.run.updatedAt = now;
  Object.assign(record.run, updates);

  if (targetStatus === 'running' && !record.run.startedAt) {
    record.run.startedAt = now;
    record.startedAtMs = nowMs;
  }

  if (TERMINAL_STATUSES.has(targetStatus)) {
    record.run.finishedAt = now;
    record.run.durationMs = Math.max(0, nowMs - (record.startedAtMs ?? record.createdAtMs));
    record.finishedAtMs = nowMs;
    record.terminalSequence = ++terminalSequence;
    pruneTerminalRuns(nowMs);
  }

  scheduleAgentRunPersistence();
  return toAgentRunDto(record.run) as AgentRunDto;
}

function normalizeFailure(error: unknown): AgentRunFailure {
  if (error instanceof Error) {
    const failure = error as ErrorWithCode;
    return normalizeJson({
      code: failure.code || 'AGENT_RUN_FAILED',
      message: failure.message,
      statusCode: normalizeFailureStatusCode(failure.statusCode || failure.status),
      details: failure.details || {},
      retryable: failure.retryable ?? false
    }, 'error') as AgentRunFailure;
  }
  const normalized: unknown = normalizeJson(error ?? { message: 'Agent run 执行失败' }, 'error');
  if (typeof normalized === 'string') {
    return { code: 'AGENT_RUN_FAILED', message: normalized, statusCode: 500, details: {} as Record<string, unknown>, retryable: false };
  }
  const failure = normalized && typeof normalized === 'object' && !Array.isArray(normalized)
    ? normalized as Record<string, unknown>
    : {};
  return {
    code: typeof failure.code === 'string' ? failure.code : 'AGENT_RUN_FAILED',
    message: typeof failure.message === 'string' ? failure.message : 'Agent run 执行失败',
    statusCode: normalizeFailureStatusCode(failure.statusCode ?? failure.status),
    details: failure.details && typeof failure.details === 'object' && !Array.isArray(failure.details)
      ? failure.details as Record<string, unknown>
      : {},
    retryable: failure.retryable === true
  };
}

function normalizeFailureStatusCode(statusCode: unknown): number {
  const normalized = Number(statusCode);
  return Number.isInteger(normalized) && normalized >= 400 && normalized <= 599 ? normalized : 500;
}

function storeValidationError(message: string, details: Record<string, unknown> = {}) {
  return agentError('AGENT_RUN_STORE_INVALID', message, {
    statusCode: 503,
    details: { filePath: persistence.filePath, ...details },
    retryable: false
  });
}

function finiteTimestamp(value: unknown, fallback: number | undefined, field: string, index: number): number {
  const normalized = Number(value ?? fallback);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw storeValidationError(`Agent run 存储中的 ${field} 无效`, { index, field });
  }
  return normalized;
}

function restoreRecord(item: unknown, index: number): AgentRunRecord {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw storeValidationError('Agent run 存储记录格式无效', { index });
  }
  const itemRecord = item as Record<string, unknown>;
  if (!itemRecord.run || typeof itemRecord.run !== 'object') {
    throw storeValidationError('Agent run 存储记录格式无效', { index });
  }

  const run = normalizeJson<AgentRun>(itemRecord.run as AgentRun, `runs[${index}].run`);
  if (typeof run.runId !== 'string' || !run.runId
    || typeof run.operationId !== 'string' || !run.operationId
    || !ALL_STATUSES.has(run.status)
    || typeof run.createdAt !== 'string' || !Number.isFinite(Date.parse(run.createdAt))) {
    throw storeValidationError('Agent run 存储记录缺少有效的身份或状态字段', { index, runId: run.runId || null });
  }
  if (run.idempotencyKey !== null && run.idempotencyKey !== undefined
    && (typeof run.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(run.idempotencyKey))) {
    throw storeValidationError('Agent run 存储中的幂等键无效', { index, runId: run.runId });
  }
  if (run.idempotencyKey && typeof run.inputFingerprint !== 'string') {
    throw storeValidationError('Agent run 存储缺少请求指纹', { index, runId: run.runId });
  }

  const terminal = TERMINAL_STATUSES.has(run.status);
  const active = ACTIVE_STATUSES.has(run.status);
  if (typeof run.updatedAt !== 'string' || !Number.isFinite(Date.parse(run.updatedAt))) {
    throw storeValidationError('Agent run 存储中的 updatedAt 无效', { index, runId: run.runId });
  }
  if (run.startedAt !== null && run.startedAt !== undefined
    && (typeof run.startedAt !== 'string' || !Number.isFinite(Date.parse(run.startedAt)))) {
    throw storeValidationError('Agent run 存储中的 startedAt 无效', { index, runId: run.runId });
  }
  if (terminal && (typeof run.finishedAt !== 'string' || !Number.isFinite(Date.parse(run.finishedAt)))) {
    throw storeValidationError('Agent run 终态记录缺少有效的 finishedAt', { index, runId: run.runId });
  }
  if (active && run.finishedAt !== null && run.finishedAt !== undefined) {
    throw storeValidationError('Agent run 活跃记录不能包含 finishedAt', { index, runId: run.runId });
  }
  if (['failed', 'interrupted'].includes(run.status)
    && (!run.error || typeof run.error !== 'object' || Array.isArray(run.error))) {
    throw storeValidationError('Agent run 失败终态缺少错误信息', { index, runId: run.runId });
  }

  run.idempotencyKey = run.idempotencyKey || null;
  run.inputFingerprint = typeof run.inputFingerprint === 'string' ? run.inputFingerprint : '';
  run.input = run.input ?? {};
  run.metadata = run.metadata ?? {};
  run.startedAt = run.startedAt ?? null;
  run.finishedAt = run.finishedAt ?? null;
  run.durationMs = run.durationMs ?? null;
  run.result = run.result ?? null;
  run.error = run.error ?? null;

  const createdAtMs = finiteTimestamp(itemRecord.createdAtMs, Date.parse(run.createdAt), 'createdAtMs', index);
  const startedAtMs = run.startedAt
    ? finiteTimestamp(itemRecord.startedAtMs, Date.parse(run.startedAt), 'startedAtMs', index)
    : null;
  if (terminal && (itemRecord.finishedAtMs === null || itemRecord.finishedAtMs === undefined)) {
    throw storeValidationError('Agent run 终态记录缺少 finishedAtMs', { index, runId: run.runId });
  }
  const finishedAtMs = terminal
    ? finiteTimestamp(itemRecord.finishedAtMs, undefined, 'finishedAtMs', index)
    : null;
  const storedSequence = Number(itemRecord.sequence);
  if (!Number.isInteger(storedSequence) || storedSequence <= 0) {
    throw storeValidationError('Agent run 存储中的 sequence 无效', { index, runId: run.runId });
  }
  const storedTerminalSequence = itemRecord.terminalSequence === null || itemRecord.terminalSequence === undefined
    ? null
    : Number(itemRecord.terminalSequence);
  if (terminal && (!Number.isInteger(storedTerminalSequence) || (storedTerminalSequence as number) <= 0)) {
    throw storeValidationError('Agent run 终态记录缺少有效的 terminalSequence', { index, runId: run.runId });
  }
  if (active && storedTerminalSequence !== null) {
    throw storeValidationError('Agent run 活跃记录不能包含 terminalSequence', { index, runId: run.runId });
  }
  if (startedAtMs !== null && startedAtMs < createdAtMs) {
    throw storeValidationError('Agent run 的 startedAt 早于 createdAt', { index, runId: run.runId });
  }
  if (finishedAtMs !== null && finishedAtMs < (startedAtMs ?? createdAtMs)) {
    throw storeValidationError('Agent run 的 finishedAt 早于开始时间', { index, runId: run.runId });
  }

  return {
    run,
    sequence: storedSequence,
    createdAtMs,
    startedAtMs,
    finishedAtMs,
    terminalSequence: storedTerminalSequence
  };
}

function restoreStoreSnapshot(snapshot: unknown, nowMs: number = Date.now()) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw storeValidationError('Agent run 存储版本或顶层格式无效', {
      expectedVersion: AGENT_RUN_STORE_VERSION,
      actualVersion: null
    });
  }
  const normalized = snapshot as Record<string, unknown>;
  if (normalized.version !== AGENT_RUN_STORE_VERSION || !Array.isArray(normalized.runs)) {
    throw storeValidationError('Agent run 存储版本或顶层格式无效', {
      expectedVersion: AGENT_RUN_STORE_VERSION,
      actualVersion: normalized.version ?? null
    });
  }

  const restoredRecords = normalized.runs.map((item, index) => restoreRecord(item, index));
  const runIds = new Set();
  const sequences = new Set();
  const terminalSequences = new Set();
  const idempotencyKeys = new Set();
  let restoredSequence = 0;
  let restoredTerminalSequence = 0;
  let interruptedRuns = 0;
  const now = new Date(nowMs).toISOString();

  for (const record of restoredRecords) {
    const { run } = record;
    if (runIds.has(run.runId)) {
      throw storeValidationError('Agent run 存储包含重复 runId', { runId: run.runId });
    }
    runIds.add(run.runId);
    if (sequences.has(record.sequence)) {
      throw storeValidationError('Agent run 存储包含重复 sequence', { sequence: record.sequence });
    }
    sequences.add(record.sequence);
    if (record.terminalSequence !== null) {
      if (terminalSequences.has(record.terminalSequence)) {
        throw storeValidationError('Agent run 存储包含重复 terminalSequence', {
          terminalSequence: record.terminalSequence
        });
      }
      terminalSequences.add(record.terminalSequence);
    }
    restoredSequence = Math.max(restoredSequence, record.sequence);
    restoredTerminalSequence = Math.max(restoredTerminalSequence, record.terminalSequence || 0);

    if (run.idempotencyKey) {
      const indexKey = idempotencyIndexKey(run.operationId, run.idempotencyKey);
      if (idempotencyKeys.has(indexKey)) {
        throw storeValidationError('Agent run 存储包含重复幂等键', {
          operationId: run.operationId,
          idempotencyKey: run.idempotencyKey
        });
      }
      idempotencyKeys.add(indexKey);
    }
  }

  for (const record of restoredRecords) {
    if (!ACTIVE_STATUSES.has(record.run.status)) continue;
    const previousState = record.run.status;
    record.run.status = 'interrupted';
    record.run.updatedAt = now;
    record.run.finishedAt = now;
    record.run.durationMs = Math.max(0, nowMs - (record.startedAtMs ?? record.createdAtMs));
    record.run.error = {
      code: 'AGENT_RUN_INTERRUPTED',
      message: '服务重启时该执行尚未结束，已标记为中断且不会自动续跑',
      statusCode: 503,
      details: { reason: 'server_restart', previousState },
      retryable: false
    };
    record.finishedAtMs = nowMs;
    record.terminalSequence = ++restoredTerminalSequence;
    interruptedRuns += 1;
  }

  return {
    records: restoredRecords,
    sequence: restoredSequence,
    terminalSequence: restoredTerminalSequence,
    interruptedRuns
  };
}

export async function initializeAgentRunStore(overrides: AgentRunStoreOverrides = {}) {
  if (persistencePromise) await persistencePromise;

  persistenceGeneration += 1;
  persistence = {
    enabled: false,
    required: true,
    filePath: overrides.filePath || process.env.LA_PLUMA_AGENT_RUN_STORE || DEFAULT_AGENT_RUN_STORE_PATH,
    readStore: overrides.readStore || readJsonFile,
    writeStore: overrides.writeStore || writeJsonFile,
    runtimeLogger: overrides.runtimeLogger || logger
  };
  persistenceDirty = false;
  persistenceError = null;
  persistenceStartQueued = false;

  let restored: ReturnType<typeof restoreStoreSnapshot>;
  try {
    const snapshot = await persistence.readStore(persistence.filePath, {
      version: AGENT_RUN_STORE_VERSION,
      runs: []
    });
    restored = restoreStoreSnapshot(snapshot);
  } catch (error) {
    persistenceError = error;
    persistence.runtimeLogger.error('Agent run 存储恢复失败，执行接口将保持关闭', {
      filePath: persistence.filePath,
      error: getErrorMessage(error)
    });
    throw getErrorCode(error) === 'AGENT_RUN_STORE_INVALID' ? error : agentRunPersistenceError(error);
  }

  runs.clear();
  idempotencyIndex.clear();
  for (const record of restored.records) {
    runs.set(record.run.runId, record);
    if (record.run.idempotencyKey) {
      idempotencyIndex.set(idempotencyIndexKey(record.run.operationId, record.run.idempotencyKey), {
        runId: record.run.runId,
        inputFingerprint: record.run.inputFingerprint
      });
    }
  }
  sequence = restored.sequence;
  terminalSequence = restored.terminalSequence;
  const prunedRuns = pruneTerminalRuns();

  persistence.enabled = true;
  scheduleAgentRunPersistence();
  await flushAgentRunStore();
  persistence.runtimeLogger.info('Agent run 存储恢复完成', {
    filePath: persistence.filePath,
    restoredRuns: runs.size,
    interruptedRuns: restored.interruptedRuns,
    prunedRuns
  });
  return {
    filePath: persistence.filePath,
    restoredRuns: runs.size,
    interruptedRuns: restored.interruptedRuns,
    prunedRuns
  };
}

export async function shutdownAgentRunStoreForTests({ clearMemory = true }: { clearMemory?: boolean } = {}) {
  let flushError: unknown = null;
  try {
    if (persistence.enabled) await flushAgentRunStore();
  } catch (error) {
    flushError = error;
  } finally {
    resetAgentRunState({ clearMemory });
  }
  if (flushError) throw flushError;
}

export function beginAgentRun({
  operationId,
  idempotencyKey = null,
  input = {},
  metadata = {},
  trigger = null,
  progress = null,
  taskResults = []
}: BeginAgentRunInput) {
  if (persistence.required && !persistence.enabled) {
    throw agentRunPersistenceError(persistenceError || new Error('Agent run 存储尚未就绪'));
  }
  if (pruneTerminalRuns() > 0) scheduleAgentRunPersistence();

  const normalizedOperationId = normalizeOperationId(operationId);
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
  const normalizedInput = normalizeJson(input, 'input');
  const normalizedMetadata = normalizeJson(metadata, 'metadata');
  const normalizedTrigger = trigger === null ? null : normalizeJson(trigger, 'trigger');
  const normalizedProgress = progress === null ? null : normalizeJson(progress, 'progress');
  const normalizedTaskResults = normalizeJson(taskResults, 'taskResults');
  if (!Array.isArray(normalizedTaskResults)) {
    throw validationError('AGENT_RUN_TASK_RESULTS_INVALID', 'taskResults 必须是数组', { taskResults });
  }
  const inputFingerprint = createHash('sha256').update(stableJson(normalizedInput)).digest('hex');

  if (normalizedIdempotencyKey) {
    const indexKey = idempotencyIndexKey(normalizedOperationId, normalizedIdempotencyKey);
    const existing = idempotencyIndex.get(indexKey);
    if (existing) {
      const record = runs.get(existing.runId);
      if (record && existing.inputFingerprint === inputFingerprint) {
        return { run: toAgentRunDto(record.run) as AgentRunDto, replayed: true };
      }
      if (record) {
        throw agentError('AGENT_IDEMPOTENCY_KEY_REUSED', '同一 operation 的幂等键不能用于不同输入', {
          statusCode: 409,
          details: {
            operationId: normalizedOperationId,
            idempotencyKey: normalizedIdempotencyKey,
            runId: existing.runId,
            existingFingerprint: existing.inputFingerprint,
            inputFingerprint
          },
          retryable: false
        });
      }
      idempotencyIndex.delete(indexKey);
    }
  }

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const run: AgentRun = {
    runId: randomUUID(),
    operationId: normalizedOperationId,
    idempotencyKey: normalizedIdempotencyKey,
    inputFingerprint,
    input: normalizedInput,
    metadata: normalizedMetadata,
    trigger: normalizedTrigger,
    progress: normalizedProgress,
    taskResults: normalizedTaskResults,
    status: 'accepted',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    result: null,
    error: null
  };
  const record: AgentRunRecord = {
    run,
    sequence: ++sequence,
    createdAtMs: nowMs,
    startedAtMs: null,
    finishedAtMs: null,
    terminalSequence: null
  };
  runs.set(run.runId, record);

  if (normalizedIdempotencyKey) {
    idempotencyIndex.set(idempotencyIndexKey(normalizedOperationId, normalizedIdempotencyKey), {
      runId: run.runId,
      inputFingerprint
    });
  }

  scheduleAgentRunPersistence();
  return { run: toAgentRunDto(run) as AgentRunDto, replayed: false };
}

export function startAgentRun(runId: string) {
  return transition(runId, 'running', ['accepted']);
}

/** 手动作业集在条目之间进入等待；等待状态不持有设备租约。 */
export function markAgentRunWaiting(runId: string) {
  return transition(runId, 'waiting', ['running']);
}

/** 续跑时从 waiting 重新获得执行权；同时兼容首次启动。 */
export function startAgentRunForExecution(runId: string) {
  const run = getAgentRun(runId);
  if (!run) throw transitionError({ run: { runId, status: 'missing' } } as AgentRunRecord, 'running', ['accepted', 'waiting']);
  if (run.state === 'waiting') return transition(runId, 'running', ['waiting']);
  if (run.state === 'accepted') return transition(runId, 'running', ['accepted']);
  if (run.state === 'running') return run;
  throw transitionError({ run: { runId, status: run.state } } as AgentRunRecord, 'running', ['accepted', 'waiting', 'running']);
}

export function markAgentRunStopping(runId: string) {
  return transition(runId, 'stopping', ['accepted', 'waiting', 'running']);
}

export function setAgentRunAcceptedResult(runId: string, result: unknown = null): AgentRunDto {
  const record = requireRecord(runId);
  if (TERMINAL_STATUSES.has(record.run.status)) return toAgentRunDto(record.run) as AgentRunDto;
  if (!['accepted', 'waiting', 'running', 'stopping'].includes(record.run.status)) {
    throw transitionError(record, 'accepted-result', ['accepted', 'running', 'stopping']);
  }
  record.run.result = normalizeJson(result, 'result');
  record.run.updatedAt = new Date().toISOString();
  scheduleAgentRunPersistence();
  return toAgentRunDto(record.run) as AgentRunDto;
}

export function completeAgentRun(runId: string, result: unknown = null) {
  return transition(runId, 'succeeded', ['accepted', 'waiting', 'running'], {
    result: normalizeJson(result, 'result'),
    error: null
  });
}

export function failAgentRun(runId: string, error: unknown = null) {
  return transition(runId, 'failed', ['accepted', 'waiting', 'running', 'stopping'], {
    result: null,
    error: normalizeFailure(error)
  });
}

export function stopAgentRun(runId: string, result: unknown = null) {
  return transition(runId, 'stopped', ['accepted', 'waiting', 'running', 'stopping'], {
    result: normalizeJson(result, 'result'),
    error: null
  });
}

export function updateAgentRunProgress(runId: string, progress: unknown, taskResults: unknown[] | null = null): AgentRunDto {
  const record = requireRecord(runId);
  if (TERMINAL_STATUSES.has(record.run.status)) return toAgentRunDto(record.run) as AgentRunDto;
  record.run.progress = progress === null ? null : normalizeJson(progress, 'progress');
  if (taskResults !== null) {
    const normalized = normalizeJson(taskResults, 'taskResults');
    if (!Array.isArray(normalized)) {
      throw validationError('AGENT_RUN_TASK_RESULTS_INVALID', 'taskResults 必须是数组', { taskResults });
    }
    record.run.taskResults = normalized;
  }
  record.run.updatedAt = new Date().toISOString();
  scheduleAgentRunPersistence();
  return toAgentRunDto(record.run) as AgentRunDto;
}

export function releaseAgentRunIdempotency(runId: string) {
  const record = requireRecord(runId);
  if (!record.run.idempotencyKey) return toAgentRunDto(record.run) as AgentRunDto;
  const indexKey = idempotencyIndexKey(record.run.operationId, record.run.idempotencyKey);
  if (idempotencyIndex.get(indexKey)?.runId === runId) idempotencyIndex.delete(indexKey);
  record.run.idempotencyKey = null;
  scheduleAgentRunPersistence();
  return toAgentRunDto(record.run) as AgentRunDto;
}

export function discardAgentRun(runId: string) {
  const record = requireRecord(runId);
  const allowedStatuses: string[] = ['accepted', 'waiting', 'running'];
  if (!allowedStatuses.includes(record.run.status)) {
    throw transitionError(record, 'discarded', allowedStatuses);
  }

  const discarded = toAgentRunDto(record.run) as AgentRunDto;
  removeRecord(runId);
  scheduleAgentRunPersistence();
  return discarded;
}

export function getAgentRun(runId: string): AgentRunDto | null {
  assertAgentRunStoreReadable();
  if (pruneTerminalRuns() > 0) scheduleAgentRunPersistence();
  return toAgentRunDto(runs.get(runId)?.run);
}

export function listAgentRuns({ operationId = null, state = null, status = null, limit = 500 }: { operationId?: string | null; state?: string | null; status?: string | null; limit?: number } = {}) {
  assertAgentRunStoreReadable();
  if (pruneTerminalRuns() > 0) scheduleAgentRunPersistence();
  const normalizedLimit = Math.min(Math.max(Number(limit) || 0, 0), 500);
  if (normalizedLimit === 0) return [];
  const requestedState = state || status;

  return [...runs.values()]
    .filter(record => !operationId || record.run.operationId === operationId)
    .filter(record => !requestedState || record.run.status === requestedState)
    .sort((left, right) => right.sequence - left.sequence)
    .slice(0, normalizedLimit)
    .map(record => toAgentRunDto(record.run));
}

export function getCurrentAgentRun() {
  assertAgentRunStoreReadable();
  if (pruneTerminalRuns() > 0) scheduleAgentRunPersistence();
  const priority: Record<string, number> = { stopping: 4, running: 3, accepted: 2, waiting: 1 };
  const current = [...runs.values()]
    .filter(record => priority[record.run.status])
    .sort((left, right) =>
      priority[right.run.status] - priority[left.run.status] || right.sequence - left.sequence
    )[0];
  return toAgentRunDto(current?.run);
}

function resetAgentRunState({ clearMemory = true }: { clearMemory?: boolean } = {}) {
  persistenceGeneration += 1;
  persistence = {
    enabled: false,
    required: false,
    filePath: DEFAULT_AGENT_RUN_STORE_PATH,
    readStore: readJsonFile,
    writeStore: writeJsonFile,
    runtimeLogger: logger
  };
  persistenceDirty = false;
  persistenceError = null;
  persistenceStartQueued = false;
  if (clearMemory) {
    runs.clear();
    idempotencyIndex.clear();
    sequence = 0;
    terminalSequence = 0;
  }
}

export function resetAgentRunsForTests() {
  resetAgentRunState();
}
