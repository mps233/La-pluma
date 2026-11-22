import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import router from '../agent.ts';
import training from '../../services/operatorTrainingService.ts';
import type { OperatorTrainingService } from '../../services/operatorTrainingService.ts';
import { DEFAULT_TRAINING_SETTINGS } from '../../services/operatorTrainingModel.ts';
import type { TrainingOperatorFilters } from '../../services/operatorTrainingModel.ts';
import type {
  ApplyPlanResult,
  FlowSyncState,
  QueueMutationResult
} from '../../services/operatorTrainingApplication.ts';
import type { OperatorRecognitionSummary } from '../../services/operatorCatalogModel.ts';

const originalMethods: OperatorTrainingService = { ...training };
afterEach(() => Object.assign(training, originalMethods));

function recognition(overrides: Partial<OperatorRecognitionSummary> = {}): OperatorRecognitionSummary {
  return {
    status: 'complete',
    recognizedAt: '2026-10-26T00:00:00.000Z',
    total: 1,
    owned: 1,
    unknown: 0,
    missing: [],
    ...overrides
  };
}

function syncedFlow(): FlowSyncState {
  return { status: 'synced', flowName: '自动任务', taskName: '理智作战' };
}

function mutation(overrides: Partial<QueueMutationResult> = {}): QueueMutationResult {
  return { queueUpdated: true, queueRevision: 'revision-1', flowSync: syncedFlow(), ...overrides };
}

/** 路由层只暴露调度函数；测试取最后一个 handler 直接调用。 */
type RouteHandler = (req: unknown, res: unknown, next?: (error?: unknown) => void) => unknown;

interface MountedRoute {
  path: string;
  methods?: Record<string, boolean>;
  stack: Array<{ handle: RouteHandler }>;
}

/** Express router 本身是带 `.stack` 的函数，反射时按对象读取。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function isMountedRoute(value: unknown): value is MountedRoute {
  if (!isRecord(value)) return false;
  if (typeof value.path !== 'string') return false;
  if (value.methods !== undefined && !isRecord(value.methods)) return false;
  if (!Array.isArray(value.stack)) return false;
  return value.stack.every(entry => isRecord(entry) && typeof entry.handle === 'function');
}

function handler(method: string, routePath: string): RouteHandler {
  const route = findMountedRoute(router, method, routePath);
  assert.ok(route, `missing ${method} ${routePath}`);
  const handle = route.stack.at(-1)?.handle;
  assert.ok(handle, `missing ${method} ${routePath} handler`);
  return handle;
}

function findMountedRoute(candidateRouter: unknown, method: string, routePath: string): MountedRoute | null {
  if (!isRecord(candidateRouter) || !Array.isArray(candidateRouter.stack)) return null;
  for (const layer of candidateRouter.stack) {
    if (!isRecord(layer)) continue;
    if (isMountedRoute(layer.route)
      && layer.route.path === routePath
      && layer.route.methods?.[method]) {
      return layer.route;
    }
    const nested = findMountedRoute(layer.handle, method, routePath);
    if (nested) return nested;
  }
  return null;
}

interface TestEnvelope {
  success: boolean;
  message: string;
  data: unknown;
  error?: { code?: string; message?: string };
  meta?: unknown;
}

function dataOf<T>(envelope: TestEnvelope | undefined): T {
  assert.ok(envelope, 'missing response envelope');
  return envelope.data as T;
}

interface TestResponse {
  statusCode: number;
  body?: TestEnvelope;
  status(value: number): TestResponse;
  set(): TestResponse;
  json(value: TestEnvelope): TestResponse;
}

function response(): TestResponse {
  return {
    statusCode: 200,
    status(value) { this.statusCode = value; return this; },
    set() { return this; },
    json(value) { this.body = value; return this; }
  };
}

describe('training queue route contract', () => {
  it('normalizes omitted and malformed candidate filters without changing the domain policy', async () => {
    let filters: TrainingOperatorFilters | undefined;
    training.getOperatorList = async value => {
      filters = value;
      return { operators: [], recognition: recognition({ status: 'missing', recognizedAt: null, total: 0, owned: 0 }) };
    };

    await handler('get', '/training/operators')({ headers: {}, query: {} }, response());
    assert.deepEqual(filters, {
      rarity: undefined,
      profession: undefined,
      owned: undefined,
      needsElite2: false,
      status: 'trainable'
    });

    await handler('get', '/training/operators')({
      headers: {},
      query: { rarity: '5abc', profession: ['CASTER', 'SNIPER'], owned: 'yes', status: 'unexpected' }
    }, response());
    assert.deepEqual(filters, {
      rarity: 5,
      profession: undefined,
      owned: undefined,
      needsElite2: false,
      status: 'all'
    });

    await handler('get', '/training/operators')({
      headers: {},
      query: { rarity: 'abc', owned: 'true', needsElite2: 'false', status: 'all' }
    }, response());
    assert.deepEqual(filters, {
      rarity: undefined,
      profession: undefined,
      owned: true,
      needsElite2: false,
      status: 'all'
    });

    await handler('get', '/training/operators')({
      headers: {},
      query: { profession: 'CASTER', owned: 'false', needsElite2: 'true', status: 'owned' }
    }, response());
    assert.deepEqual(filters, {
      rarity: undefined,
      profession: 'CASTER',
      owned: false,
      needsElite2: true,
      status: 'owned'
    });
  });

  it('returns synchronization results for removal, order changes and retry', async () => {
    const result = mutation({ queueRevision: 'revision-3' });
    training.removeFromQueue = async id => { assert.equal(id, 'alpha'); return result; };
    training.updateQueueOrder = async ids => { assert.deepEqual(ids, ['beta', 'alpha']); return result; };
    training.syncTrainingFlow = async () => ({ ...result, queueUpdated: false });
    for (const [method, routePath, req] of [
      ['delete', '/training/queue/:operatorId', { params: { operatorId: 'alpha' } }],
      ['put', '/training/queue/order', { body: { operatorIds: ['beta', 'alpha'] } }],
      ['post', '/training/sync', {}]
    ] as const) {
      const res = response();
      await handler(method, routePath)({ headers: {}, ...req }, res);
      const payload = dataOf<{
        flowSync: FlowSyncState;
        queueRevision: string;
        queueUpdated: boolean;
      }>(res.body);
      assert.equal(payload.flowSync.status, 'synced');
      assert.equal(payload.queueRevision, 'revision-3');
      assert.equal(payload.queueUpdated, method !== 'post');
    }
  });

  it('passes settings through so extension fields reach domain normalization', async () => {
    let received: unknown;
    training.updateSettings = async value => {
      received = value;
      return { ...DEFAULT_TRAINING_SETTINGS, extraField: { nested: true } };
    };
    const res = response();
    await handler('put', '/training/settings')({
      headers: {},
      body: { autoSwitch: 'yes', extraField: { nested: true } }
    }, res);

    assert.deepEqual(received, { autoSwitch: 'yes', extraField: { nested: true } });
    assert.deepEqual(dataOf<{ extraField: unknown }>(res.body).extraField, { nested: true });
  });

  it('passes the plan and settings through apply with the resolved connection context', async () => {
    const plan = {
      queueRevision: 'revision-1',
      openStages: [{ stage: 'S3-2', totalTimes: 2 }],
      summary: { gameDate: '2026-10-28', clientType: 'YoStarEN' }
    };
    const settings = { useMedicine: 2 };
    const applied: ApplyPlanResult = {
      success: true,
      stageCount: 1,
      totalStages: 1,
      hasFallback: false,
      flowName: '自动任务',
      taskName: '理智作战',
      flowSync: syncedFlow(),
      scheduleSync: { attempted: false, success: true, message: null }
    };
    const captured: Array<{
      plan?: unknown;
      settings?: unknown;
      options?: { clientType?: string; now?: Date };
    }> = [];
    training.applyPlanToTasks = async (receivedPlan, receivedSettings, options) => {
      captured.push({ plan: receivedPlan, settings: receivedSettings, options });
      return applied;
    };

    const res = response();
    await handler('post', '/actions/apply-training-plan')({
      headers: {},
      query: { clientType: 'YoStarEN' },
      body: { plan, settings }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(dataOf<ApplyPlanResult>(res.body).success, true);
    assert.deepEqual(captured[0]?.plan, plan);
    assert.deepEqual(captured[0]?.settings, settings);
    assert.equal(captured[0]?.options?.clientType, 'YoStarEN');
    assert.ok(captured[0]?.options?.now instanceof Date);
  });
});
