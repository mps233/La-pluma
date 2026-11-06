import { isRecord } from '../../utils/errors.ts'
import type { ErrorWithCode } from '../../utils/errors.ts'
import type { ChildProcess } from 'node:child_process'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import router, { buildDynamicFightPlan, buildFightPlans, buildWebrtcBrowserProtocol, buildWebrtcDeviceStatus, executeTrackedAgentAction, needsDynamicFight, parseDeviceStatsOutput } from '../agent.ts'
import { API_VERSION, buildAgentManifest } from '../agentContract.ts'
import { clearRealtimeLogs, getRealtimeLogs, getTaskStatus, setTaskStatus } from '../../services/maaService.ts'
import { loggerManager } from '../../utils/logger.ts'
import {
  beginAgentRun,
  completeAgentRun,
  flushAgentRunStore,
  getAgentRun,
  getCurrentAgentRun,
  initializeAgentRunStore,
  resetAgentRunsForTests,
  shutdownAgentRunStoreForTests,
  startAgentRun
} from '../../services/agentRunService.ts'
import type { AgentRunDto, AgentRunStoreOverrides } from '../../services/agentRunService.ts'

type TrackedAgentActionOptions = Parameters<typeof executeTrackedAgentAction>[2]
type AgentRunLifecycle = Parameters<TrackedAgentActionOptions['execute']>[0]
type FightPlanningInput = NonNullable<Parameters<typeof buildDynamicFightPlan>[0]>

type RouteHandler = (req: unknown, res: unknown, next?: () => void) => unknown

interface ApiMeta {
  requestId: string | null
  dryRun: boolean
}

interface AgentErrorDetails {
  runId?: string
  run?: AgentRunDto | null
  requestedRunId?: string
  currentRunId?: string
  state?: string
  result?: { details?: { index?: number } }
  [key: string]: unknown
}

interface AgentErrorBody {
  success: false
  message: string
  error: {
    code: string
    details: AgentErrorDetails
    retryable: boolean
  }
  meta: ApiMeta
  data?: undefined
}

interface AgentSuccessBody<TData> {
  success: true
  message: string
  data: TData
  meta: ApiMeta
}

type AgentManifestBody = AgentSuccessBody<ReturnType<typeof buildAgentManifest>>

interface OpenApiOperationFixture {
  requestBody?: unknown
  parameters: Array<{ name: string; in: string }>
}

interface OpenApiBody {
  openapi: string
  paths: Record<string, { get: OpenApiOperationFixture }>
  components: {
    responses: {
      Conflict: {
        content: {
          'application/json': {
            schema: { $ref: string }
          }
        }
      }
    }
  }
}

type RunData = AgentRunDto & {
  message?: string
  plan?: unknown
  stdout?: string
  signal?: string
  run?: AgentRunDto
}

interface StopData {
  stopped: boolean
  acceptedRunCanceled?: boolean
  run: AgentRunDto | null
}

interface CurrentRunData {
  isRunning: boolean
  schedule: unknown
  recentLogs: unknown[]
  run: AgentRunDto | null
  lastRun: AgentRunDto | null
}

interface DailyFlowStep {
  index: number
  id: string
  name: string
  command: string
  args: string[]
  dynamicTask: boolean
  taskConfig?: { type?: string }
}

interface DailyFlowData {
  dryRun: boolean
  scheduleId: string | null
  totalSteps: number
  plan: DailyFlowStep[]
}

type RunResponseBody = AgentSuccessBody<RunData>
type StopResponseBody = AgentSuccessBody<StopData>
type CurrentRunResponseBody = AgentSuccessBody<CurrentRunData>
type DailyFlowResponseBody = AgentSuccessBody<DailyFlowData>

interface TestResponse<TBody = unknown> {
  statusCode: number
  readonly body: TBody
  readonly headers: Record<string, string>
  status(code: number): TestResponse<TBody>
  set(name: string, value: string): TestResponse<TBody>
  json(body: TBody): TestResponse<TBody>
}

const quietLogger = loggerManager.getLogger('AgentRoutesTest', { enableConsole: false })

function isRouteHandler(value: unknown): value is RouteHandler {
  return typeof value === 'function'
}

function findHandler(method: string, path: string): RouteHandler {
  for (const layer of router.stack) {
    if (!isRecord(layer.route)) continue
    const methods = layer.route.methods
    if (!isRecord(methods) || !methods[method]) continue
    if (layer.route.path !== path) continue
    const handler = layer.route.stack.at(-1)?.handle
    if (isRouteHandler(handler)) return handler
  }
  assert.fail(`missing ${method.toUpperCase()} ${path}`)
}

function createResponse<TBody = unknown>(): TestResponse<TBody> {
  let body: TBody | undefined
  return {
    statusCode: 200,
    headers: {},
    get body(): TBody {
      if (body === undefined) throw new Error('response body was not written')
      return body
    },
    status(code) {
      this.statusCode = code
      return this
    },
    set(name, value) {
      this.headers[name] = value
      return this
    },
    json(value) {
      body = value
      return this
    }
  }
}

describe('Agent fight planning', () => {
  it('builds one valid maa fight command per stage instead of a comma-separated stage list', () => {
    const plans = buildFightPlans({
      stages: [{ stage: '1-7', times: 3 }, { stage: 'CE-6', times: 1 }],
      medicine: 2,
      stone: 1,
      series: 2
    })

    assert.deepEqual(plans, [
      { stage: '1-7', times: '3', args: ['1-7', '--times', '3', '-m', '2', '--expiring-medicine', '0', '--stone', '1', '--series', '2'] },
      { stage: 'CE-6', times: '1', args: ['CE-6', '--times', '1', '-m', '2', '--expiring-medicine', '0', '--stone', '1', '--series', '2'] }
    ])
  })

  it('builds a dynamic multi-task plan for Core-only Fight fields', () => {
    const input: FightPlanningInput = {
      stages: [{ stage: '1-7', times: 2 }, { stage: 'CE-6', times: '' }],
      medicine: 1,
      medicineExpireDays: 2,
      server: 'JP',
      series: 8,
      drops: '30011=10,30062=5',
      reportToPenguin: true,
      penguinId: 'doctor',
      clientType: 'Bilibili'
    }

    assert.equal(needsDynamicFight(input), true)
    const plan = buildDynamicFightPlan(input)!
    assert.equal(plan.type, 'Fight')
    assert.equal(plan.client_type, 'Bilibili')
    assert.equal(plan.tasks.length, 2)
    assert.deepEqual(plan.tasks[0].params, {
      medicine: 1,
      medicine_expire_days: 2,
      series: 8,
      drops: { 30011: 10, 30062: 5 },
      server: 'JP',
      report_to_penguin: true,
      penguin_id: 'doctor',
      stage: '1-7',
      times: 2
    })
    assert.equal(plan.tasks[1].params.stage, 'CE-6')
    assert.equal(plan.tasks[1].params.times, undefined)
  })

  it('keeps single-stage requests unchanged and ignores empty stage entries', () => {
    assert.deepEqual(buildFightPlans({ stage: '1-7', times: 3 }), [
      { stage: '1-7', times: '3', args: ['1-7', '--times', '3', '-m', '0', '--expiring-medicine', '0', '--stone', '0', '--series', '0'] }
    ])
    assert.deepEqual(buildFightPlans({ stages: [{ stage: '  ' }, { stage: 'CE-6' }] }), [
      { stage: 'CE-6', times: '', args: ['CE-6', '-m', '0', '--expiring-medicine', '0', '--stone', '0', '--series', '0'] }
    ])
  })
})

describe('Agent discovery routes', () => {
  it('documents the same-origin browser signaling endpoint', () => {
    assert.deepEqual(buildWebrtcBrowserProtocol('preview-device'), {
      websocket: '/webrtc-signaling/connect_client?token=',
      connectMessage: { message_type: 'connect', device_id: 'preview-device' },
      requestOfferPayload: { type: 'request-offer', ip_preference: 'ipv4' },
      candidatePolicy: 'relay preferred / ipv4'
    })
  })

  it('summarizes online devices and flags an outdated agent', () => {
    const result = buildWebrtcDeviceStatus([
      { id: 'preview-device', online: true, agentVersion: 'v0.4.2-abcdef' },
      { id: 'offline-device', online: false, agentVersion: 'v0.4.3-1b7d786' }
    ], 'preview-device')

    assert.deepEqual(result.devices, ['preview-device'])
    assert.equal(result.deviceId, 'preview-device')
    assert.equal(result.agentVersion, 'v0.4.2-abcdef')
    assert.equal(result.agentOnline, true)
    assert.equal(result.agentVersionStatus, 'outdated')
    assert.equal(result.minimumAgentVersion, '0.4.3')
  })

  it('reports an unknown agent version instead of guessing', () => {
    const result = buildWebrtcDeviceStatus([
      { id: 'preview-device', online: false, agentVersion: null }
    ], 'preview-device')

    assert.deepEqual(result.devices, [])
    assert.equal(result.agentVersion, null)
    assert.equal(result.agentVersionStatus, 'unknown')
  })

  it('serves the generated manifest through the public route', async () => {
    const res = createResponse<AgentManifestBody>()
    await findHandler('get', '/manifest')({ headers: { 'x-request-id': 'manifest-test' } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.success, true)
    assert.equal(res.body.meta.requestId, 'manifest-test')
    assert.equal(res.body.data.version, API_VERSION)
    assert.equal(res.body.data.actions.length, 26)
    assert.ok(res.body.data.actions.every(action => action.safety && action.execution))
  })

  it('serves OpenAPI with real query parameters and structured errors', async () => {
    const res = createResponse<OpenApiBody>()
    await findHandler('get', '/openapi.json')({ headers: {} }, res)

    const discover = res.body.paths['/api/agent/actions/discover-devices'].get
    assert.equal(res.body.openapi, '3.1.0')
    assert.equal(discover.requestBody, undefined)
    assert.ok(discover.parameters.some(parameter => parameter.name === 'adbPath' && parameter.in === 'query'))
    assert.equal(
      res.body.components.responses.Conflict.content['application/json'].schema.$ref,
      '#/components/schemas/ErrorResponse'
    )
  })
})

describe('Agent run routes', () => {
  beforeEach(() => resetAgentRunsForTests())
  afterEach(() => {
    resetAgentRunsForTests()
    if (getTaskStatus().isRunning) setTaskStatus(false)
  })

  it('returns a retained terminal snapshot by run id', async () => {
    const run = beginAgentRun({ operationId: 'fight', input: { stage: '1-7' } }).run
    startAgentRun(run.runId)
    completeAgentRun(run.runId, { success: true, summary: 'done' })
    const res = createResponse<RunResponseBody>()

    await findHandler('get', '/runs/:runId')({
      headers: { 'x-request-id': 'run-lookup' },
      params: { runId: run.runId }
    }, res, () => {})

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.meta.requestId, 'run-lookup')
    assert.equal(res.body.data.runId, run.runId)
    assert.equal(res.body.data.state, 'succeeded')
    assert.deepEqual(res.body.data.result, { success: true, summary: 'done' })
  })

  it('cancels an accepted run through the targeted stop endpoint', async () => {
    const run = beginAgentRun({ operationId: 'fight', input: { stage: '1-7' } }).run
    const res = createResponse<StopResponseBody>()

    await findHandler('post', '/runs/:runId/stop')({
      headers: {},
      params: { runId: run.runId }
    }, res, () => {})

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.data.acceptedRunCanceled, true)
    assert.equal(getAgentRun(run.runId)!.state, 'stopped')
  })

  it('returns a structured 404 for an unknown run id', async () => {
    const res = createResponse<AgentErrorBody>()

    await findHandler('get', '/runs/:runId')({
      headers: {},
      params: { runId: '00000000-0000-4000-8000-000000000000' }
    }, res, () => {})

    assert.equal(res.statusCode, 404)
    assert.equal(res.body.error.code, 'AGENT_RUN_NOT_FOUND')
  })

  it('keeps the legacy current-run fields while exposing the tracked run', async () => {
    const terminal = beginAgentRun({ operationId: 'fight' }).run
    completeAgentRun(terminal.runId, { ok: true })
    const run = beginAgentRun({ operationId: 'run_task' }).run
    startAgentRun(run.runId)
    const res = createResponse<CurrentRunResponseBody>()

    await findHandler('get', '/runs/current')({ headers: {}, query: { lines: 1 } }, res, () => {})

    assert.equal(typeof res.body.data.isRunning, 'boolean')
    assert.ok(res.body.data.schedule)
    assert.ok(Array.isArray(res.body.data.recentLogs))
    assert.equal(res.body.data.run!.runId, run.runId)
    assert.equal(res.body.data.run!.state, 'running')
    assert.equal(res.body.data.lastRun!.runId, terminal.runId)
    assert.equal(res.body.data.lastRun!.state, 'succeeded')
  })

  it('selects lastRun by completion time rather than creation order', async () => {
    const originalNow = Date.now
    let now = Date.parse('2026-07-12T00:00:00.000Z')
    Date.now = () => now
    try {
      const older = beginAgentRun({ operationId: 'fight' }).run
      now += 1
      const newer = beginAgentRun({ operationId: 'run_task' }).run
      now += 1
      completeAgentRun(newer.runId, { order: 1 })
      now += 1
      completeAgentRun(older.runId, { order: 2 })
      const res = createResponse<CurrentRunResponseBody>()

      await findHandler('get', '/runs/current')({ headers: {}, query: {} }, res, () => {})

      assert.equal(res.body.data.lastRun!.runId, older.runId)
      assert.deepEqual(res.body.data.lastRun!.result, { order: 2 })
    } finally {
      Date.now = originalNow
    }
  })

  it('replays one background intent without executing it twice and retains its final result', async () => {
    const req = { headers: { 'idempotency-key': 'background:test:1' } }
    const first = createResponse<RunResponseBody>()
    let executions = 0
    let settle: NonNullable<AgentRunLifecycle['onSettled']> | null = null
    const options: TrackedAgentActionOptions = {
      operationId: 'test_background_action',
      input: { command: 'award', waitForCompletion: false },
      waitForCompletion: false,
      execute: async (lifecycle) => {
        executions += 1
        settle = lifecycle.onSettled!
        return { message: 'started', plan: { command: 'award' } }
      }
    }

    await executeTrackedAgentAction(req, first, options)

    assert.equal(first.statusCode, 202)
    assert.equal(first.headers['Idempotency-Replayed'], 'false')
    assert.equal(executions, 1)
    const runId = first.body.data.runId

    const activeReplay = createResponse<RunResponseBody>()
    await executeTrackedAgentAction(req, activeReplay, options)
    assert.equal(activeReplay.statusCode, 202)
    assert.equal(activeReplay.body.data.message, first.body.data.message)
    assert.deepEqual(activeReplay.body.data.plan, first.body.data.plan)
    assert.equal(activeReplay.body.data.runId, runId)
    assert.equal(executions, 1)

    await settle!({ ok: true, result: { stdout: 'finished', exitCode: 0 } })
    const terminal = getAgentRun(runId)!
    assert.equal(terminal.state, 'succeeded')
    assert.deepEqual(terminal.result, {
      message: 'started',
      plan: { command: 'award' },
      stdout: 'finished',
      exitCode: 0
    })

    const replay = createResponse<RunResponseBody>()
    await executeTrackedAgentAction(req, replay, options)

    assert.equal(replay.statusCode, 200)
    assert.equal(replay.headers['Idempotency-Replayed'], 'true')
    assert.equal(replay.body.data.runId, runId)
    assert.equal(replay.body.data.run!.state, 'succeeded')
    assert.equal(executions, 1)
  })

  it('returns an early background failure instead of a successful accepted response', async () => {
    const error: ErrorWithCode = new Error('background process failed before admission returned')
    error.code = 'EARLY_BACKGROUND_FAILURE'
    error.statusCode = 422
    const res = createResponse<AgentErrorBody>()

    await executeTrackedAgentAction(
      { headers: { 'idempotency-key': 'background:early-failure' } },
      res,
      {
        operationId: 'test_early_background_failure',
        input: { command: 'award' },
        waitForCompletion: false,
        execute: async (lifecycle) => {
          lifecycle.onStarted!()
          await lifecycle.onSettled!({ ok: false, error })
          return { message: 'started' }
        }
      }
    )

    assert.equal(res.statusCode, 422)
    assert.equal(res.body.success, false)
    assert.equal(res.body.error.code, 'EARLY_BACKGROUND_FAILURE')
    assert.equal(res.body.error.details.run!.state, 'failed')
  })

  it('returns a stopped result when a background process exits during admission', async () => {
    const res = createResponse<RunResponseBody>()

    await executeTrackedAgentAction(
      { headers: { 'idempotency-key': 'background:early-stop' } },
      res,
      {
        operationId: 'test_early_background_stop',
        input: { command: 'fight' },
        waitForCompletion: false,
        execute: async (lifecycle) => {
          lifecycle.onStarted!()
          await lifecycle.onSettled!({
            ok: false,
            stopped: true,
            result: { signal: 'SIGTERM' }
          })
          return { message: 'started' }
        }
      }
    )

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.success, true)
    assert.equal(res.body.message, '任务已终止')
    assert.equal(res.body.data.run!.state, 'stopped')
    assert.equal(res.body.data.signal, 'SIGTERM')
  })

  it('does not execute when the accepted run cannot be persisted and releases the key for retry', async () => {
    let failWrites = false
    let executions = 0
    const req = { headers: { 'idempotency-key': 'persistence:retry:1' } }
    const options: TrackedAgentActionOptions = {
      operationId: 'test_persistence_failure',
      input: { command: 'award' },
      execute: async () => {
        executions += 1
        return { success: true }
      }
    }
    const routeLogger = loggerManager.getLogger('AgentRoutes')
    const wasConsoleEnabled = routeLogger.enableConsole
    routeLogger.enableConsole = false

    try {
      await initializeAgentRunStore({
        filePath: '/virtual/agent-route-runs.json',
        readStore: async (_filePath, fallback) => fallback,
        writeStore: async () => {
          if (failWrites) throw new Error('simulated write failure')
        },
        runtimeLogger: quietLogger
      })

      failWrites = true
      const rejected = createResponse<AgentErrorBody>()
      await executeTrackedAgentAction(req, rejected, options)

      assert.equal(rejected.statusCode, 503)
      assert.equal(rejected.body.error.code, 'AGENT_RUN_PERSISTENCE_FAILED')
      assert.equal(executions, 0)
      const rejectedRunId = rejected.body.error.details.runId

      failWrites = false
      const retry = createResponse<RunResponseBody>()
      await executeTrackedAgentAction(req, retry, options)

      assert.equal(retry.statusCode, 200)
      assert.equal(executions, 1)
      assert.notEqual(retry.body.data.runId, rejectedRunId)
    } finally {
      failWrites = false
      try {
        await shutdownAgentRunStoreForTests()
      } finally {
        routeLogger.enableConsole = wasConsoleEnabled
      }
    }
  })

  it('replays a run interrupted by restart without executing it again', async () => {
    let snapshot: unknown = null
    let executions = 0
    const req = { headers: { 'idempotency-key': 'restart:interrupted:1' } }
    const options: TrackedAgentActionOptions = {
      operationId: 'test_restart_interruption',
      input: { command: 'fight' },
      execute: async () => {
        executions += 1
        return { success: true }
      }
    }
    const store: AgentRunStoreOverrides = {
      filePath: '/virtual/agent-route-restart-runs.json',
      runtimeLogger: quietLogger,
      writeStore: async (_filePath, value) => {
        snapshot = JSON.parse(JSON.stringify(value))
      }
    }

    await initializeAgentRunStore({ ...store, readStore: async (_filePath, fallback) => fallback })

    try {
      const accepted = beginAgentRun({
        operationId: options.operationId,
        idempotencyKey: req.headers['idempotency-key'],
        input: options.input
      }).run
      await flushAgentRunStore()
      await shutdownAgentRunStoreForTests()
      await initializeAgentRunStore({ ...store, readStore: async () => snapshot })

      const replay = createResponse<AgentErrorBody>()
      await executeTrackedAgentAction(req, replay, options)

      assert.equal(replay.statusCode, 503)
      assert.equal(replay.headers['Idempotency-Replayed'], 'true')
      assert.equal(replay.body.error.code, 'AGENT_RUN_INTERRUPTED')
      assert.equal(replay.body.error.retryable, false)
      assert.equal(replay.body.error.details.runId, accepted.runId)
      assert.equal(executions, 0)
    } finally {
      await shutdownAgentRunStoreForTests()
    }
  })

  it('waits for the accepted snapshot before acknowledging a concurrent replay', async () => {
    let blockWrites = false
    let releaseBlockedWrite!: (() => void) | null
    let signalWriteStarted: (() => void) | null = null
    const writeStarted = new Promise<void>((resolve) => { signalWriteStarted = () => resolve() })
    let executions = 0
    const req = { headers: { 'idempotency-key': 'persistence:concurrent:1' } }
    const options: TrackedAgentActionOptions = {
      operationId: 'test_persistence_concurrency',
      input: { command: 'award' },
      execute: async () => {
        executions += 1
        return { success: true }
      }
    }

    await initializeAgentRunStore({
      filePath: '/virtual/agent-route-concurrent-runs.json',
      readStore: async (_filePath, fallback) => fallback,
      writeStore: async () => {
        if (!blockWrites) return
        signalWriteStarted!()
        await new Promise<void>((resolve) => { releaseBlockedWrite = () => resolve() })
      },
      runtimeLogger: quietLogger
    })

    try {
      blockWrites = true
      const first = createResponse<RunResponseBody>()
      let firstFinished = false
      const firstRequest = executeTrackedAgentAction(req, first, options)
        .then(() => { firstFinished = true })
      await writeStarted

      const replay = createResponse<RunResponseBody>()
      let replayFinished = false
      const replayRequest = executeTrackedAgentAction(req, replay, options)
        .then(() => { replayFinished = true })
      await new Promise<void>((resolve) => setImmediate(resolve))

      assert.equal(firstFinished, false)
      assert.equal(replayFinished, false)
      assert.equal(executions, 0)

      blockWrites = false
      releaseBlockedWrite!()
      await Promise.all([firstRequest, replayRequest])

      assert.equal(first.statusCode, 200)
      assert.equal(replay.statusCode, 202)
      assert.equal(replay.headers['Idempotency-Replayed'], 'true')
      assert.equal(replay.body.data.runId, first.body.data.runId)
      assert.equal(executions, 1)
    } finally {
      blockWrites = false
      releaseBlockedWrite?.()
      await shutdownAgentRunStoreForTests()
    }
  })

  it('refreshes a replay that becomes terminal while its state is being persisted', async () => {
    let blockWrites = false
    let releaseBlockedWrite!: (() => void) | null
    let signalWriteStarted: (() => void) | null = null
    const writeStarted = new Promise<void>((resolve) => { signalWriteStarted = () => resolve() })
    let executions = 0
    const req = { headers: { 'idempotency-key': 'persistence:refresh-replay' } }
    const options: TrackedAgentActionOptions = {
      operationId: 'test_replay_refresh',
      input: { command: 'award' },
      waitForCompletion: false,
      execute: async () => {
        executions += 1
        return { message: 'must not execute' }
      }
    }

    await initializeAgentRunStore({
      filePath: '/virtual/agent-route-refresh-runs.json',
      readStore: async (_filePath, fallback) => fallback,
      writeStore: async () => {
        if (!blockWrites) return
        signalWriteStarted!()
        await new Promise<void>((resolve) => { releaseBlockedWrite = () => resolve() })
      },
      runtimeLogger: quietLogger
    })

    try {
      const run = beginAgentRun({
        operationId: options.operationId,
        idempotencyKey: req.headers['idempotency-key'],
        input: options.input
      }).run
      await flushAgentRunStore()

      blockWrites = true
      startAgentRun(run.runId)
      const replay = createResponse<RunResponseBody>()
      const replayRequest = executeTrackedAgentAction(req, replay, options)
      await writeStarted
      completeAgentRun(run.runId, { stdout: 'finished during replay' })
      blockWrites = false
      releaseBlockedWrite!()
      await replayRequest

      assert.equal(replay.statusCode, 200)
      assert.equal(replay.headers['Idempotency-Replayed'], 'true')
      assert.equal(replay.body.data.run!.state, 'succeeded')
      assert.equal(replay.body.data.stdout, 'finished during replay')
      assert.equal(executions, 0)
    } finally {
      blockWrites = false
      releaseBlockedWrite?.()
      await shutdownAgentRunStoreForTests()
    }
  })

  it('serializes a replay from the same snapshot observed at response time', async () => {
    const req = { headers: { 'idempotency-key': 'persistence:response-snapshot' } }
    const input = { command: 'award' }
    const run = beginAgentRun({
      operationId: 'test_response_snapshot',
      idempotencyKey: req.headers['idempotency-key'],
      input
    }).run
    startAgentRun(run.runId)

    let executions = 0
    let stateAtSerialization: string | null = null
    const res = createResponse<RunResponseBody>()
    const serialize = res.json
    res.json = function json(body) {
      stateAtSerialization = getAgentRun(run.runId)!.state
      return serialize.call(this, body)
    }

    const replay = executeTrackedAgentAction(req, res, {
      operationId: 'test_response_snapshot',
      input,
      waitForCompletion: false,
      execute: async () => {
        executions += 1
        return { message: 'must not execute' }
      }
    })
    queueMicrotask(() => completeAgentRun(run.runId, { stdout: 'completed in microtask' }))
    await replay

    assert.equal(res.body.data.run!.state, stateAtSerialization)
    assert.equal(getAgentRun(run.runId)!.state, 'succeeded')
    assert.equal(executions, 0)
  })

  it('returns a background failure that settles during the response flush', async () => {
    let releaseBlockedWrite!: (() => void) | null
    let signalWriteStarted: (() => void) | null = null
    const writeStarted = new Promise<void>((resolve) => { signalWriteStarted = () => resolve() })
    let settle: NonNullable<AgentRunLifecycle['onSettled']> | null = null
    const error: ErrorWithCode = new Error('background failed during response persistence')
    error.code = 'BACKGROUND_SETTLED_DURING_FLUSH'
    error.statusCode = 422

    await initializeAgentRunStore({
      filePath: '/virtual/agent-route-response-runs.json',
      readStore: async (_filePath, fallback) => fallback,
      writeStore: async (_filePath, snapshot) => {
        if (!isRecord(snapshot) || !Array.isArray(snapshot.runs)) return
        const first = snapshot.runs[0]
        if (!isRecord(first) || !isRecord(first.run)) return
        const run = first.run
        const result = isRecord(run.result) ? run.result : null
        if (run.status === 'running' && result?.message === 'started') {
          signalWriteStarted!()
          await new Promise<void>((resolve) => { releaseBlockedWrite = () => resolve() })
        }
      },
      runtimeLogger: quietLogger
    })

    try {
      const res = createResponse<AgentErrorBody>()
      const request = executeTrackedAgentAction(
        { headers: { 'idempotency-key': 'background:settle-during-flush' } },
        res,
        {
          operationId: 'test_settle_during_response_flush',
          input: { command: 'award' },
          waitForCompletion: false,
          execute: async (lifecycle) => {
            lifecycle.onStarted!()
            settle = lifecycle.onSettled!
            return { message: 'started' }
          }
        }
      )

      await writeStarted
      const settlement = settle!({ ok: false, error })
      releaseBlockedWrite!()
      await Promise.all([request, settlement])

      assert.equal(res.statusCode, 422)
      assert.equal(res.body.success, false)
      assert.equal(res.body.error.code, 'BACKGROUND_SETTLED_DURING_FLUSH')
      assert.equal(res.body.error.details.run!.state, 'failed')
    } finally {
      releaseBlockedWrite?.()
      await shutdownAgentRunStoreForTests()
    }
  })

  it('keeps a concurrently replayed run queryable when admission later fails', async () => {
    const req = { headers: { 'idempotency-key': 'busy:retry:1' } }
    let rejectAdmission: ((reason?: unknown) => void) | null = null
    let executions = 0
    const options: TrackedAgentActionOptions = {
      operationId: 'test_busy_action',
      input: { command: 'fight', waitForCompletion: false },
      waitForCompletion: false,
      execute: async () => {
        executions += 1
        if (executions === 1) {
          await new Promise<unknown>((_resolve, reject) => { rejectAdmission = reject })
        }
        return { message: 'started' }
      }
    }

    const first = createResponse<AgentErrorBody>()
    const firstRequest = executeTrackedAgentAction(req, first, options)
    await Promise.resolve()
    const replay = createResponse<RunResponseBody>()
    await executeTrackedAgentAction(req, replay, options)
    const replayedRunId = replay.body.data.runId
    const busy: ErrorWithCode = new Error('MAA 正在被其他任务使用')
    busy.code = 'MAA_EXECUTION_BUSY'
    busy.statusCode = 409
    busy.retryable = true
    rejectAdmission!(busy)
    await firstRequest

    assert.equal(replay.statusCode, 202)
    assert.equal(first.statusCode, 409)
    assert.equal(first.body.data, undefined)
    assert.equal(first.body.error.details.runId, replayedRunId)
    assert.equal(getAgentRun(replayedRunId)!.state, 'failed')

    const retry = createResponse<RunResponseBody>()
    await executeTrackedAgentAction(req, retry, options)
    assert.equal(retry.statusCode, 202)
    assert.notEqual(retry.body.data.runId, replayedRunId)
    assert.equal(executions, 2)
  })

  it('does not let a pending admission hide the run that owns the executor', async () => {
    const owner = beginAgentRun({ operationId: 'fight' }).run
    startAgentRun(owner.runId)
    let rejectAdmission: ((reason?: unknown) => void) | null = null
    const res = createResponse<AgentErrorBody>()
    const request = executeTrackedAgentAction(
      { headers: { 'idempotency-key': 'pending:behind-owner' } },
      res,
      {
        operationId: 'run_task',
        input: { command: 'award' },
        execute: async () => new Promise<unknown>((_resolve, reject) => { rejectAdmission = reject })
      }
    )
    await new Promise<void>((resolve) => setImmediate(resolve))

    assert.equal(getCurrentAgentRun()!.runId, owner.runId)
    const busy: ErrorWithCode = new Error('MAA 正在被其他任务使用')
    busy.code = 'MAA_EXECUTION_BUSY'
    busy.statusCode = 409
    rejectAdmission!(busy)
    await request

    assert.equal(res.statusCode, 409)
    assert.equal(getCurrentAgentRun()!.runId, owner.runId)
  })

  it('rejects guarded stop when the requested run is not current', async () => {
    const older = beginAgentRun({ operationId: 'fight' }).run
    startAgentRun(older.runId)
    const current = beginAgentRun({ operationId: 'run_task' }).run
    startAgentRun(current.runId)
    const res = createResponse<AgentErrorBody>()

    await findHandler('post', '/actions/stop')({
      headers: {},
      body: { runId: older.runId }
    }, res, () => {})

    assert.equal(res.statusCode, 409)
    assert.equal(res.body.error.code, 'AGENT_RUN_NOT_CURRENT')
    assert.equal(res.body.error.details.requestedRunId, older.runId)
    assert.equal(res.body.error.details.currentRunId, current.runId)
  })

  it('does not let an accepted run stop an untracked legacy process', async () => {
    const signals: Array<NodeJS.Signals | number | undefined> = []
    setTaskStatus(true, '旧版任务', 'legacy', {
      pid: null,
      exitCode: null,
      kill: (signal?: NodeJS.Signals | number) => {
        signals.push(signal)
        return true
      }
    } as unknown as ChildProcess)
    let rejectAdmission: ((reason?: unknown) => void) | null = null
    const startResponse = createResponse<RunResponseBody>()
    const startRequest = executeTrackedAgentAction(
      { headers: { 'idempotency-key': 'guard:legacy-process' } },
      startResponse,
      {
        operationId: 'run_task',
        input: { command: 'award' },
        execute: async () => new Promise<unknown>((_resolve, reject) => { rejectAdmission = reject })
      }
    )
    await Promise.resolve()
    const acceptedRun = getCurrentAgentRun()!
    assert.equal(acceptedRun.state, 'accepted')

    const stopResponse = createResponse<AgentErrorBody>()
    await findHandler('post', '/actions/stop')({
      headers: {},
      body: { runId: acceptedRun.runId }
    }, stopResponse, () => {})

    assert.equal(stopResponse.statusCode, 409)
    assert.equal(stopResponse.body.error.code, 'AGENT_RUN_NOT_STARTED')
    assert.deepEqual(signals, [])

    const busy: ErrorWithCode = new Error('MAA 正在被其他任务使用')
    busy.code = 'MAA_EXECUTION_BUSY'
    busy.statusCode = 409
    rejectAdmission!(busy)
    await startRequest
  })
})

describe('Agent daily flow route', () => {
  it('returns an inspectable dry-run plan with the standard dry-run metadata', async () => {
    const res = createResponse<DailyFlowResponseBody>()
    const req = {
      headers: { 'x-request-id': 'dry-run-test' },
      body: {
        dryRun: true,
        scheduleId: 'contract-test',
        taskFlow: [
          { id: 'award-1', commandId: 'award', name: '领取奖励', enabled: true }
        ]
      },
      query: {}
    }

    await findHandler('post', '/actions/run-daily-flow')(req, res, () => {})

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.success, true)
    assert.equal(res.body.meta.requestId, 'dry-run-test')
    assert.equal(res.body.meta.dryRun, true)
    assert.equal(res.body.data.dryRun, true)
    assert.equal(res.body.data.scheduleId, 'contract-test')
    assert.equal(res.body.data.totalSteps, 1)
    assert.deepEqual(res.body.data.plan[0], {
      index: 1,
      id: 'award-1',
      name: '领取奖励',
      command: 'award',
      args: [],
      dynamicTask: false
    })
  })

  it('uses scheduler-native dynamic configs and advanced fight arguments in dry-run output', async () => {
    const res = createResponse<DailyFlowResponseBody>()
    const req = {
      headers: {},
      query: {},
      body: {
        dryRun: true,
        taskFlow: [{
          id: 'recruit-1', commandId: 'recruit', name: '自动公招', enabled: true,
          taskType: 'Recruit', params: { refresh: true, times: '4' }
        }, {
          id: 'fight-1', commandId: 'fight', name: '理智作战', enabled: true,
          params: {
            stage: '1-7', medicine: 1, drops: '30011=10',
            report_to_penguin: true, penguin_id: 'doctor'
          }
        }]
      }
    }

    await findHandler('post', '/actions/run-daily-flow')(req, res, () => {})

    assert.equal(res.body.meta.dryRun, true)
    assert.equal(res.body.data.plan[0].command, 'run')
    assert.equal(res.body.data.plan[0].dynamicTask, true)
    assert.equal(res.body.data.plan[0].taskConfig!.type, 'Recruit')
    assert.deepEqual(res.body.data.plan[1].args, [
      '1-7', '-m', '1', '-D30011=10', '--report-to-penguin', '--penguin-id', 'doctor'
    ])
  })

  it('rejects invalid scheduler configuration during dry-run', async () => {
    const res = createResponse<AgentErrorBody>()
    const req = {
      headers: {},
      query: {},
      body: {
        dryRun: true,
        taskFlow: [{
          id: 'infrast-1', name: '基建换班', enabled: true,
          taskType: 'Infrast', params: { mode: 10000, filename: '' }
        }]
      }
    }

    await findHandler('post', '/actions/run-daily-flow')(req, res, () => {})

    assert.equal(res.statusCode, 400)
    assert.equal(res.body.success, false)
    assert.equal(res.body.error.code, 'AGENT_DAILY_FLOW_REJECTED')
    assert.match(res.body.message, /排班文件/)
  })

  it('returns a validation error for malformed task entries', async () => {
    const res = createResponse<AgentErrorBody>()
    const req = { headers: {}, query: {}, body: { dryRun: true, taskFlow: [null] } }

    await findHandler('post', '/actions/run-daily-flow')(req, res, () => {})

    assert.equal(res.statusCode, 400)
    assert.equal(res.body.error.code, 'AGENT_DAILY_FLOW_REJECTED')
    assert.equal(res.body.error.details.result!.details!.index, 0)
  })
})

describe('Agent status and log projections', () => {
  afterEach(() => {
    clearRealtimeLogs()
    if (getTaskStatus().isRunning) setTaskStatus(false)
  })

  it('omits the realtime log buffer from task status and current run', async () => {
    clearRealtimeLogs()
    setTaskStatus(true, '投影测试', 'automation', null)

    const statusRes = createResponse<AgentSuccessBody<Record<string, unknown>>>()
    await findHandler('get', '/tasks/status')({ headers: {} }, statusRes, () => {})
    assert.equal('logs' in statusRes.body.data, false)
    assert.equal(statusRes.body.data.isRunning, true)

    const runRes = createResponse<CurrentRunResponseBody>()
    await findHandler('get', '/runs/current')({ headers: {}, query: { lines: 1 } }, runRes, () => {})
    assert.equal('logs' in (runRes.body.data as unknown as Record<string, unknown>), false)
    assert.ok(Array.isArray(runRes.body.data.recentLogs))
    assert.ok(runRes.body.data.recentLogs.length <= 1)
  })

  it('returns only log entries newer than the requested sequence', async () => {
    clearRealtimeLogs()
    setTaskStatus(true, '增量日志测试', 'automation', null)
    const initial = getRealtimeLogs(10)
    const cursor = initial.at(-1)?.sequence
    assert.equal(typeof cursor, 'number')

    setTaskStatus(false)

    const res = createResponse<AgentSuccessBody<Array<{ sequence?: number }>>>()
    await findHandler('get', '/logs/recent')({
      headers: {},
      query: { lines: 10, afterSequence: cursor }
    }, res, () => {})

    assert.ok(res.body.data.length >= 1)
    assert.ok(res.body.data.every(entry => (entry.sequence ?? 0) > cursor!))
  })

  it('falls back to a bounded window when the lines query is not numeric', async () => {
    clearRealtimeLogs()
    for (let index = 0; index < 3; index += 1) {
      setTaskStatus(true, `任务${index}`, 'automation', null)
    }

    const res = createResponse<AgentSuccessBody<Array<{ sequence?: number }>>>()
    await findHandler('get', '/logs/recent')({ headers: {}, query: { lines: 'abc' } }, res, () => {})

    assert.ok(Array.isArray(res.body.data))
    assert.ok(res.body.data.length <= 80)
  })

  it('parses one combined adb shell probe into device stats', () => {
    const stats = parseDeviceStatsOutput([
      '@@LA_PLUMA_LOAD@@',
      '0.42 0.31 0.20 1/100 1234',
      '@@LA_PLUMA_MEM@@',
      'MemTotal: 8000000 kB',
      'MemFree: 1000000 kB',
      'MemAvailable: 3000000 kB',
      'SwapTotal: 1000 kB',
      '@@LA_PLUMA_DISK@@',
      '/dev/block/dm-1 100G 40G 60G 40% /data',
      '@@LA_PLUMA_TEMP@@',
      'temperature: 321',
      '@@LA_PLUMA_TOP@@',
      '400%cpu 20%user 10%sys 370%idle'
    ].join('\n'))

    assert.equal(stats.load1m, 0.42)
    assert.equal(stats.load5m, 0.31)
    assert.equal(stats.memTotalKb, 8000000)
    assert.equal(stats.memUsedKb, 5000000)
    assert.equal(stats.memFree, '2.9G')
    assert.equal(stats.diskPct, 40)
    assert.equal(stats.temp, 32.1)
    assert.equal(stats.cpuPct, 8)
  })
})
