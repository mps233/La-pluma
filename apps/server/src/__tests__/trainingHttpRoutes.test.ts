import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import type { Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { createLaPlumaApp } from '../app.ts'
import { closeHttpServers, postJson, startHttpServer } from './support/httpTestHelpers.ts'
import operatorTraining from '../services/operatorTrainingService.ts'
import type {
  OperatorTrainingService,
  TrainingQueueSnapshot
} from '../services/operatorTrainingService.ts'
import { DEFAULT_TRAINING_SETTINGS, trainingError } from '../services/operatorTrainingModel.ts'
import type { ApplyPlanResult, FlowSyncState } from '../services/operatorTrainingApplication.ts'
import type { TrainingPlan } from '../services/operatorTrainingPlan.ts'
import { LocalResourceError } from '../services/operatorTrainingStore.ts'
import type { TrainingQueueItem } from '../services/operatorTrainingStore.ts'

const servers: Server[] = []
const originalMethods: OperatorTrainingService = { ...operatorTraining }
const originalConsoleError = console.error

function agentUrl(port: number, path: string): string {
  return `http://127.0.0.1:${port}/api/agent${path}`
}

interface ApiEnvelope<T = unknown> {
  success: boolean
  message: string
  data?: T
  error?: { code?: string; details?: Record<string, unknown>; retryable?: boolean }
}

function isApiEnvelope(value: unknown): value is ApiEnvelope {
  return typeof value === 'object'
    && value !== null
    && 'success' in value
    && 'message' in value
}

async function readEnvelope<T = unknown>(response: Response): Promise<ApiEnvelope<T>> {
  const body: unknown = await response.json()
  assert.ok(isApiEnvelope(body))
  return body as ApiEnvelope<T>
}

/**
 * 认证与坏请求用例必须在到达服务前结束：任何未显式替换的养成方法
 * 被调用即抛错并计数，避免以“返回空对象”掩盖路由提前放行。
 */
function stubUnreachableService(calls: { count: number }): void {
  const unreachable = async (): Promise<never> => {
    calls.count += 1
    throw new Error('training service must not be reached')
  }
  Object.assign(operatorTraining, {
    getOperatorList: unreachable,
    getTrainingQueue: unreachable,
    addToQueue: unreachable,
    removeFromQueue: unreachable,
    updateQueueOrder: unreachable,
    updateSettings: unreachable,
    syncTrainingFlow: unreachable,
    generateTrainingPlan: unreachable,
    applyPlanToTasks: unreachable,
    fetchOperatorMaterials: unreachable
  } satisfies Partial<OperatorTrainingService>)
}

function emptyQueueSnapshot(overrides: Partial<TrainingQueueSnapshot> = {}): TrainingQueueSnapshot {
  return {
    queue: [],
    settings: { ...DEFAULT_TRAINING_SETTINGS },
    lastUpdated: '2026-01-01T00:00:00.000Z',
    revision: 'revision-1',
    gameDate: '2026-01-01',
    clientType: 'Official',
    flowSync: { status: 'not_applied', flowName: '自动任务', taskName: '理智作战' },
    ...overrides
  }
}

function syncedFlow(): FlowSyncState {
  return { status: 'synced', flowName: '自动任务', taskName: '理智作战' };
}

function queueItem(overrides: Partial<TrainingQueueItem> = {}): TrainingQueueItem {
  return {
    operatorId: 'alpha',
    currentElite: 1,
    targetElite: 2,
    priority: 1,
    status: 'pending',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function appliedPlan(overrides: Partial<ApplyPlanResult> = {}): ApplyPlanResult {
  return {
    success: true,
    stageCount: 1,
    totalStages: 1,
    hasFallback: false,
    flowName: '自动任务',
    taskName: '理智作战',
    flowSync: syncedFlow(),
    scheduleSync: { attempted: false, success: true, message: null },
    ...overrides
  }
}

function trainingPlanFixture(): TrainingPlan {
  return {
    queueRevision: 'revision-1',
    mode: 'current',
    operators: [],
    materialHierarchy: [],
    stages: [],
    totalSanity: 0,
    warnings: []
  }
}

afterEach(async () => {
  Object.assign(operatorTraining, originalMethods)
  console.error = originalConsoleError
  await closeHttpServers(servers)
})

describe('training routes over real HTTP', () => {
  it('requires the API token on every training entry before reaching the service', async () => {
    const app = createLaPlumaApp({
      env: { LA_PLUMA_TOKEN: 'api-secret' },
      loginRateLimit: { maxAuthFailures: 100 }
    })
    const port = await startHttpServer(app, servers)
    const calls = { count: 0 }
    stubUnreachableService(calls)

    const entries = [
      ['GET', '/training/operators'],
      ['GET', '/training/queue'],
      ['POST', '/training/queue'],
      ['DELETE', '/training/queue/alpha'],
      ['PUT', '/training/queue/order'],
      ['POST', '/training/sync'],
      ['PUT', '/training/settings'],
      ['POST', '/training/plan'],
      ['POST', '/actions/apply-training-plan'],
      ['POST', '/actions/fetch-training-materials']
    ] as const

    for (const [method, path] of entries) {
      const response = await fetch(agentUrl(port, path), { method })
      assert.equal(response.status, 401, `${method} ${path} must stay behind auth`)
      assert.equal((await readEnvelope(response)).error?.code, 'AGENT_AUTH_REQUIRED')
    }
    assert.equal(calls.count, 0)

    operatorTraining.getTrainingQueue = async () => emptyQueueSnapshot()
    const authorized = await fetch(agentUrl(port, '/training/queue'), {
      headers: { Authorization: 'Bearer api-secret' }
    })
    assert.equal(authorized.status, 200)
    assert.equal((await readEnvelope<{ revision: string }>(authorized)).data?.revision, 'revision-1')
  })

  it('rejects invalid training write bodies before calling the service', async () => {
    const app = createLaPlumaApp({ env: {} })
    const port = await startHttpServer(app, servers)
    const calls = { count: 0 }
    stubUnreachableService(calls)

    const cases = [
      ['POST', '/training/queue', {}, 400, 'AGENT_VALIDATION_OPERATOR_ID_REQUIRED', '缺少 operatorId 参数'],
      ['POST', '/training/queue', { operatorId: 42 }, 400, 'AGENT_VALIDATION_OPERATOR_ID_REQUIRED', '缺少 operatorId 参数'],
      ['POST', '/training/queue', { operatorId: 'alpha', position: '0' }, 400, 'AGENT_INTERNAL_ERROR', 'position 必须是有效的队列位置'],
      ['PUT', '/training/queue/order', { operatorIds: 'alpha' }, 400, 'AGENT_VALIDATION_OPERATOR_IDS_REQUIRED', 'operatorIds 必须是数组'],
      ['POST', '/actions/apply-training-plan', { settings: { useMedicine: 1 } }, 400, 'AGENT_VALIDATION_PLAN_REQUIRED', '缺少 plan 参数'],
      ['POST', '/training/plan', { mode: 'hourly' }, 400, 'AGENT_INTERNAL_ERROR', '计划模式必须为 current 或 all']
    ] as const

    for (const [method, path, body, status, code, message] of cases) {
      const response = await fetch(agentUrl(port, path), {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      assert.equal(response.status, status, `${method} ${path}`)
      const payload = await readEnvelope(response)
      assert.equal(payload.success, false)
      assert.equal(payload.error?.code, code)
      assert.equal(payload.message, message)
    }
    assert.equal(calls.count, 0)
  })

  it('passes the resolved client type to plan generation', async () => {
    const app = createLaPlumaApp({ env: {} })
    const port = await startHttpServer(app, servers)
    const modes: Array<string | undefined> = []
    let captured: { mode?: string; options?: { clientType?: string } } | null = null
    operatorTraining.generateTrainingPlan = async (mode, options) => {
      modes.push(mode)
      captured = { mode, options }
      return trainingPlanFixture()
    }

    const response = await postJson(agentUrl(port, '/training/plan?clientType=YoStarEN'), { mode: 'all' })

    assert.equal(response.status, 200)
    assert.equal((await readEnvelope(response)).success, true)
    assert.deepEqual(captured, { mode: 'all', options: { clientType: 'YoStarEN' } })

    // 请求体缺省 mode 时沿用领域默认的 current。
    const defaultMode = await postJson(agentUrl(port, '/training/plan'), {})
    assert.equal(defaultMode.status, 200)
    assert.deepEqual(modes, ['all', 'current'])
  })

  it('passes the resolved client type and captured time to plan application and preserves stale-plan details', async () => {
    const app = createLaPlumaApp({ env: {} })
    const port = await startHttpServer(app, servers)
    const captured: Array<{
      plan: unknown
      settings: unknown
      options?: { clientType?: string; now?: Date }
    }> = []
    operatorTraining.applyPlanToTasks = async (plan, settings, options) => {
      captured.push({ plan, settings, options })
      throw trainingError('养成计划已过期，请重新生成计划后应用', 409, {
        code: 'AGENT_TRAINING_PLAN_STALE',
        details: {
          reason: 'stage_closed',
          gameDate: '2026-10-28',
          planGameDate: '2026-10-28',
          clientType: 'YoStarEN',
          planClientType: 'YoStarEN',
          closedStages: ['CE-6']
        }
      })
    }

    const requestedAt = Date.now()
    const response = await postJson(
      agentUrl(port, '/actions/apply-training-plan?clientType=YoStarEN'),
      { plan: { queueRevision: 'revision-1' }, settings: { useMedicine: 2 } }
    )
    const receivedAt = Date.now()

    assert.equal(response.status, 409)
    const body = await readEnvelope(response)
    assert.equal(body.success, false)
    assert.equal(body.message, '养成计划已过期，请重新生成计划后应用')
    assert.equal(body.error?.code, 'AGENT_TRAINING_PLAN_STALE')
    assert.deepEqual(body.error?.details, {
      reason: 'stage_closed',
      gameDate: '2026-10-28',
      planGameDate: '2026-10-28',
      clientType: 'YoStarEN',
      planClientType: 'YoStarEN',
      closedStages: ['CE-6']
    })
    assert.equal(body.error?.retryable, false)

    const applied = captured[0]
    assert.ok(applied)
    assert.deepEqual(applied.plan, { queueRevision: 'revision-1' })
    assert.deepEqual(applied.settings, { useMedicine: 2 })
    const appliedOptions = applied.options
    assert.equal(appliedOptions?.clientType, 'YoStarEN')
    assert.ok(appliedOptions?.now instanceof Date)
    assert.ok(appliedOptions.now.getTime() >= requestedAt)
    assert.ok(appliedOptions.now.getTime() <= receivedAt)
  })

  it('returns the current game day and client type with the queue snapshot', async () => {
    const app = createLaPlumaApp({ env: {} })
    const port = await startHttpServer(app, servers)
    operatorTraining.getTrainingQueue = async () => emptyQueueSnapshot({
      gameDate: '2026-10-28',
      clientType: 'YoStarEN'
    })

    const response = await fetch(agentUrl(port, '/training/queue'))

    assert.equal(response.status, 200)
    const body = await readEnvelope<{ gameDate: string; clientType: string }>(response)
    assert.equal(body.success, true)
    assert.equal(body.data?.gameDate, '2026-10-28')
    assert.equal(body.data?.clientType, 'YoStarEN')
  })

  it('keeps a saved queue distinguishable from failed flow and schedule synchronization', async () => {
    const app = createLaPlumaApp({ env: {} })
    const port = await startHttpServer(app, servers)
    const flowSync: FlowSyncState = { status: 'failed', flowName: '自动任务', taskName: '材料作战', error: '磁盘写入失败' }

    operatorTraining.addToQueue = async () => ({
      ...queueItem(),
      queueUpdated: true,
      queueRevision: 'revision-2',
      flowSync
    })
    operatorTraining.syncTrainingFlow = async () => ({
      queueUpdated: false, queueRevision: 'revision-2', flowSync
    })
    operatorTraining.applyPlanToTasks = async () => appliedPlan({
      scheduleSync: { attempted: true, success: false, message: '定时任务设置失败' }
    })

    const added = await postJson(agentUrl(port, '/training/queue'), {
      operatorId: 'alpha',
      currentElite: 1,
      targetElite: 2,
      position: 0
    })
    assert.equal(added.status, 200)
    const addedBody = await readEnvelope<{
      queueUpdated: boolean
      queueRevision: string
      flowSync: FlowSyncState
    }>(added)
    assert.equal(addedBody.success, true)
    assert.equal(addedBody.data?.queueUpdated, true)
    assert.equal(addedBody.data?.queueRevision, 'revision-2')
    assert.equal(addedBody.data?.flowSync.status, 'failed')

    const synced = await fetch(agentUrl(port, '/training/sync'), { method: 'POST' })
    assert.equal(synced.status, 200)
    const syncedBody = await readEnvelope<{ flowSync: FlowSyncState }>(synced)
    assert.equal(syncedBody.message, '任务流程同步失败，可重试')
    assert.equal(syncedBody.data?.flowSync.status, 'failed')

    const applied = await postJson(agentUrl(port, '/actions/apply-training-plan'), {
      plan: { queueRevision: 'revision-2' }
    })
    assert.equal(applied.status, 200)
    const appliedBody = await readEnvelope<{ flowSync: FlowSyncState; scheduleSync: unknown }>(applied)
    assert.equal(appliedBody.success, true)
    assert.equal(appliedBody.data?.flowSync.status, 'synced')
    assert.deepEqual(appliedBody.data?.scheduleSync, {
      attempted: true,
      success: false,
      message: '定时任务设置失败'
    })
  })

  it('returns candidate projections, their count and recognition completeness from the domain service', async () => {
    const app = createLaPlumaApp({ env: {} })
    const port = await startHttpServer(app, servers)
    let filters: unknown
    operatorTraining.getOperatorList = async value => {
      filters = value
      return {
        operators: [
          {
            id: 'alpha', name: 'Alpha', rarity: 5, profession: 'CASTER',
            currentElite: 0, currentLevel: 1, targetElite: 2, owned: true, ownership: 'owned', potential: 1,
            hasMaterialData: true, materials: null, canTrain: true, disabledReason: null,
            trainingStatus: 'trainable'
          },
          {
            id: 'beta', name: 'Beta', rarity: 4, profession: 'SNIPER',
            currentElite: 0, currentLevel: 1, targetElite: 2, owned: false, ownership: 'unknown', potential: 0,
            hasMaterialData: true, materials: null, canTrain: false, disabledReason: 'unrecognized',
            trainingStatus: 'unrecognized'
          }
        ],
        recognition: {
          status: 'partial',
          recognizedAt: '2026-10-26T00:00:00.000Z',
          total: 2,
          owned: 1,
          unknown: 1,
          missing: ['beta']
        }
      }
    }

    const response = await fetch(agentUrl(port, '/training/operators?rarity=5&status=owned'), {
      headers: { 'content-type': 'application/json' }
    })
    assert.equal(response.status, 200)
    const payload = await readEnvelope<{
      count: number
      operators: Array<{ id: string; ownership: string }>
      recognition: { status: string; unknown: number; missing: string[] }
    }>(response)
    assert.deepEqual(filters, {
      rarity: 5,
      profession: undefined,
      owned: undefined,
      needsElite2: false,
      status: 'owned'
    })
    assert.equal(payload.data?.count, 2)
    assert.deepEqual(payload.data?.operators.map(operator => [operator.id, operator.ownership]), [
      ['alpha', 'owned'],
      ['beta', 'unknown']
    ])
    assert.deepEqual(payload.data?.recognition, {
      status: 'partial',
      recognizedAt: '2026-10-26T00:00:00.000Z',
      total: 2,
      owned: 1,
      unknown: 1,
      missing: ['beta']
    })
  })

  it('routes training service errors through the unified error exit', async () => {
    const app = createLaPlumaApp({ env: {} })
    const port = await startHttpServer(app, servers)
    operatorTraining.getTrainingQueue = async () => {
      throw new Error('内部堆栈泄露标记')
    }
    console.error = () => {}

    const response = await fetch(agentUrl(port, '/training/queue'))

    assert.equal(response.status, 500)
    const body = await readEnvelope(response)
    assert.equal(body.success, false)
    assert.equal(body.error?.code, 'AGENT_INTERNAL_ERROR')
    assert.equal(body.message, '服务器内部错误')
    assert.ok(!JSON.stringify(body).includes('内部堆栈泄露标记'))
  })

  it('returns an actionable 503 when the real plan path cannot read local MAA resources', async () => {
    const app = createLaPlumaApp({ env: {} })
    const port = await startHttpServer(app, servers)
    console.error = () => {}
    const previousDataDir = process.env.MAA_DATA_DIR
    const previousResourceDir = process.env.MAA_RESOURCE_DIR
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'la-pluma-training-resource-'))
    const resourceDir = path.join(tempRoot, 'resource')
    process.env.MAA_DATA_DIR = tempRoot
    process.env.MAA_RESOURCE_DIR = resourceDir

    try {
      const response = await fetch(agentUrl(port, '/training/plan'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'current' })
      })

      assert.equal(response.status, 503)
      const body = await readEnvelope(response)
      assert.equal(body.success, false)
      assert.equal(body.error?.code, 'LOCAL_RESOURCE_MISSING')
      assert.equal(body.error?.retryable, true)
      assert.deepEqual(body.error?.details, {
        resourcePath: path.join(resourceDir, 'gamedata', 'excel', 'item_table.json')
      })
      assert.match(body.message, /MAA 游戏资源/)
      assert.match(body.message, /获取游戏资源/)
      assert.match(body.message, /MAA 资源目录/)
    } finally {
      if (previousDataDir === undefined) delete process.env.MAA_DATA_DIR
      else process.env.MAA_DATA_DIR = previousDataDir
      if (previousResourceDir === undefined) delete process.env.MAA_RESOURCE_DIR
      else process.env.MAA_RESOURCE_DIR = previousResourceDir
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('maps corrupt local MAA resources to an actionable 503 and keeps unknown errors opaque', async () => {
    const app = createLaPlumaApp({ env: {} })
    const port = await startHttpServer(app, servers)
    console.error = () => {}
    const requestPlan = async (): Promise<Response> => postJson(agentUrl(port, '/training/plan'), {
      mode: 'current'
    })

    operatorTraining.generateTrainingPlan = async () => {
      throw new LocalResourceError(
        '本地资源字段缺失: /opt/maa/resource/item_table.json 的 items',
        '/opt/maa/resource/item_table.json',
        'items'
      )
    }

    const invalid = await requestPlan()
    assert.equal(invalid.status, 503)
    const invalidBody = await readEnvelope(invalid)
    assert.equal(invalidBody.success, false)
    assert.equal(invalidBody.error?.code, 'LOCAL_RESOURCE_INVALID')
    assert.equal(invalidBody.error?.retryable, false)
    assert.deepEqual(invalidBody.error?.details, {
      resourcePath: '/opt/maa/resource/item_table.json',
      field: 'items'
    })
    assert.match(invalidBody.message, /MAA 游戏资源不可用/)
    assert.match(invalidBody.message, /MAA 资源目录/)

    operatorTraining.generateTrainingPlan = async () => {
      throw new Error('内部堆栈泄露标记')
    }

    const internal = await requestPlan()
    assert.equal(internal.status, 500)
    const internalBody = await readEnvelope(internal)
    assert.equal(internalBody.error?.code, 'AGENT_INTERNAL_ERROR')
    assert.ok(!JSON.stringify(internalBody).includes('内部堆栈泄露标记'))
  })

  it('maps local MAA resource failures to 503 across training endpoints without changing normal responses', async () => {
    const app = createLaPlumaApp({ env: {} })
    const port = await startHttpServer(app, servers)
    console.error = () => {}
    const resourcePath = '/opt/maa/resource/gamedata/excel/item_table.json'
    const localResourceError = (): LocalResourceError =>
      new LocalResourceError(`本地资源文件缺失: ${resourcePath}`, resourcePath, undefined, 'LOCAL_RESOURCE_MISSING')

    operatorTraining.getTrainingQueue = async () => emptyQueueSnapshot()
    operatorTraining.generateTrainingPlan = async () => trainingPlanFixture()
    operatorTraining.syncTrainingFlow = async () => ({
      queueUpdated: false, queueRevision: 'revision-1', flowSync: syncedFlow()
    })
    operatorTraining.applyPlanToTasks = async () => appliedPlan()
    operatorTraining.fetchOperatorMaterials = async () => ({
      scripts: [],
      operatorCount: 0,
      materialCount: 0,
      recipeCount: 0,
      lastUpdated: '2026-01-01T00:00:00.000Z'
    })

    const endpoints: Array<{ method: string; path: string; body?: unknown }> = [
      { method: 'GET', path: '/training/queue' },
      { method: 'POST', path: '/training/plan', body: { mode: 'current' } },
      { method: 'POST', path: '/training/sync' },
      { method: 'POST', path: '/actions/apply-training-plan', body: { plan: { queueRevision: 'revision-1' } } },
      { method: 'POST', path: '/actions/fetch-training-materials', body: {} }
    ]

    const request = async ({ method, path, body }: { method: string; path: string; body?: unknown }): Promise<Response> =>
      method === 'GET'
        ? fetch(agentUrl(port, path))
        : postJson(agentUrl(port, path), body ?? {})

    for (const endpoint of endpoints) {
      const normal = await request(endpoint)
      assert.equal(normal.status, 200, `${endpoint.method} ${endpoint.path}`)
      assert.equal((await readEnvelope(normal)).success, true)
    }

    operatorTraining.getTrainingQueue = async () => { throw localResourceError() }
    operatorTraining.generateTrainingPlan = async () => { throw localResourceError() }
    operatorTraining.syncTrainingFlow = async () => { throw localResourceError() }
    operatorTraining.applyPlanToTasks = async () => { throw localResourceError() }
    operatorTraining.fetchOperatorMaterials = async () => { throw localResourceError() }

    for (const endpoint of endpoints) {
      const response = await request(endpoint)
      assert.equal(response.status, 503, `${endpoint.method} ${endpoint.path}`)
      const payload = await readEnvelope(response)
      assert.equal(payload.success, false)
      assert.equal(payload.error?.code, 'LOCAL_RESOURCE_MISSING')
      assert.equal(payload.error?.retryable, true)
      assert.deepEqual(payload.error?.details, { resourcePath })
      assert.match(payload.message, /MAA 游戏资源缺失/)
      assert.match(payload.message, /获取游戏资源/)
      assert.match(payload.message, /MAA 资源目录/)
    }
  })
})
