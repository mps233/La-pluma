import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import router, { buildWebrtcBrowserProtocol, executeTrackedAgentAction } from '../agent.js'
import { API_VERSION } from '../agentContract.js'
import { getTaskStatus, setTaskStatus } from '../../services/maaService.js'
import { loggerManager } from '../../utils/logger.js'
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
} from '../../services/agentRunService.js'

const quietLogger = {
  info() {},
  error() {}
}

function findHandler(method, path) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods?.[method])
  assert.ok(layer, `missing ${method.toUpperCase()} ${path}`)
  return layer.route.stack.at(-1).handle
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code
      return this
    },
    set(name, value) {
      this.headers[name] = value
      return this
    },
    json(body) {
      this.body = body
      return this
    }
  }
}

describe('Agent discovery routes', () => {
  it('documents the same-origin browser signaling endpoint', () => {
    assert.deepEqual(buildWebrtcBrowserProtocol('preview-device'), {
      websocket: '/webrtc-signaling/connect_client?token=',
      connectMessage: { message_type: 'connect', device_id: 'preview-device' },
      requestOfferPayload: { type: 'request-offer', ip_preference: 'ipv4' },
      candidatePolicy: 'relay preferred / ipv4'
    })
  })

  it('serves the generated manifest through the public route', async () => {
    const res = createResponse()
    await findHandler('get', '/manifest')({ headers: { 'x-request-id': 'manifest-test' } }, res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.success, true)
    assert.equal(res.body.meta.requestId, 'manifest-test')
    assert.equal(res.body.data.version, API_VERSION)
    assert.equal(res.body.data.actions.length, 21)
    assert.ok(res.body.data.actions.every(action => action.safety && action.execution))
  })

  it('serves OpenAPI with real query parameters and structured errors', async () => {
    const res = createResponse()
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
    const res = createResponse()

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

  it('returns a structured 404 for an unknown run id', async () => {
    const res = createResponse()

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
    const res = createResponse()

    await findHandler('get', '/runs/current')({ headers: {}, query: { lines: 1 } }, res, () => {})

    assert.equal(typeof res.body.data.isRunning, 'boolean')
    assert.ok(res.body.data.schedule)
    assert.ok(Array.isArray(res.body.data.recentLogs))
    assert.equal(res.body.data.run.runId, run.runId)
    assert.equal(res.body.data.run.state, 'running')
    assert.equal(res.body.data.lastRun.runId, terminal.runId)
    assert.equal(res.body.data.lastRun.state, 'succeeded')
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
      const res = createResponse()

      await findHandler('get', '/runs/current')({ headers: {}, query: {} }, res, () => {})

      assert.equal(res.body.data.lastRun.runId, older.runId)
      assert.deepEqual(res.body.data.lastRun.result, { order: 2 })
    } finally {
      Date.now = originalNow
    }
  })

  it('replays one background intent without executing it twice and retains its final result', async () => {
    const req = { headers: { 'idempotency-key': 'background:test:1' } }
    const first = createResponse()
    let executions = 0
    let settle = null
    const options = {
      operationId: 'test_background_action',
      input: { command: 'award', waitForCompletion: false },
      waitForCompletion: false,
      execute: async lifecycle => {
        executions += 1
        settle = lifecycle.onSettled
        return { message: 'started', plan: { command: 'award' } }
      }
    }

    await executeTrackedAgentAction(req, first, options)

    assert.equal(first.statusCode, 202)
    assert.equal(first.headers['Idempotency-Replayed'], 'false')
    assert.equal(executions, 1)
    const runId = first.body.data.runId

    const activeReplay = createResponse()
    await executeTrackedAgentAction(req, activeReplay, options)
    assert.equal(activeReplay.statusCode, 202)
    assert.equal(activeReplay.body.data.message, first.body.data.message)
    assert.deepEqual(activeReplay.body.data.plan, first.body.data.plan)
    assert.equal(activeReplay.body.data.runId, runId)
    assert.equal(executions, 1)

    await settle({ ok: true, result: { stdout: 'finished', exitCode: 0 } })
    const terminal = getAgentRun(runId)
    assert.equal(terminal.state, 'succeeded')
    assert.deepEqual(terminal.result, {
      message: 'started',
      plan: { command: 'award' },
      stdout: 'finished',
      exitCode: 0
    })

    const replay = createResponse()
    await executeTrackedAgentAction(req, replay, options)

    assert.equal(replay.statusCode, 200)
    assert.equal(replay.headers['Idempotency-Replayed'], 'true')
    assert.equal(replay.body.data.runId, runId)
    assert.equal(replay.body.data.run.state, 'succeeded')
    assert.equal(executions, 1)
  })

  it('returns an early background failure instead of a successful accepted response', async () => {
    const error = new Error('background process failed before admission returned')
    error.code = 'EARLY_BACKGROUND_FAILURE'
    error.statusCode = 422
    const res = createResponse()

    await executeTrackedAgentAction(
      { headers: { 'idempotency-key': 'background:early-failure' } },
      res,
      {
        operationId: 'test_early_background_failure',
        input: { command: 'award' },
        waitForCompletion: false,
        execute: async lifecycle => {
          lifecycle.onStarted()
          await lifecycle.onSettled({ ok: false, error })
          return { message: 'started' }
        }
      }
    )

    assert.equal(res.statusCode, 422)
    assert.equal(res.body.success, false)
    assert.equal(res.body.error.code, 'EARLY_BACKGROUND_FAILURE')
    assert.equal(res.body.error.details.run.state, 'failed')
  })

  it('returns a stopped result when a background process exits during admission', async () => {
    const res = createResponse()

    await executeTrackedAgentAction(
      { headers: { 'idempotency-key': 'background:early-stop' } },
      res,
      {
        operationId: 'test_early_background_stop',
        input: { command: 'fight' },
        waitForCompletion: false,
        execute: async lifecycle => {
          lifecycle.onStarted()
          await lifecycle.onSettled({
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
    assert.equal(res.body.data.run.state, 'stopped')
    assert.equal(res.body.data.signal, 'SIGTERM')
  })

  it('does not execute when the accepted run cannot be persisted and releases the key for retry', async () => {
    let failWrites = false
    let executions = 0
    const req = { headers: { 'idempotency-key': 'persistence:retry:1' } }
    const options = {
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
      const rejected = createResponse()
      await executeTrackedAgentAction(req, rejected, options)

      assert.equal(rejected.statusCode, 503)
      assert.equal(rejected.body.error.code, 'AGENT_RUN_PERSISTENCE_FAILED')
      assert.equal(executions, 0)
      const rejectedRunId = rejected.body.error.details.runId

      failWrites = false
      const retry = createResponse()
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
    let snapshot = null
    let executions = 0
    const req = { headers: { 'idempotency-key': 'restart:interrupted:1' } }
    const options = {
      operationId: 'test_restart_interruption',
      input: { command: 'fight' },
      execute: async () => {
        executions += 1
        return { success: true }
      }
    }
    const store = {
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

      const replay = createResponse()
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
    let releaseBlockedWrite
    let signalWriteStarted
    const writeStarted = new Promise(resolve => { signalWriteStarted = resolve })
    let executions = 0
    const req = { headers: { 'idempotency-key': 'persistence:concurrent:1' } }
    const options = {
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
        signalWriteStarted()
        await new Promise(resolve => { releaseBlockedWrite = resolve })
      },
      runtimeLogger: quietLogger
    })

    try {
      blockWrites = true
      const first = createResponse()
      let firstFinished = false
      const firstRequest = executeTrackedAgentAction(req, first, options)
        .then(() => { firstFinished = true })
      await writeStarted

      const replay = createResponse()
      let replayFinished = false
      const replayRequest = executeTrackedAgentAction(req, replay, options)
        .then(() => { replayFinished = true })
      await new Promise(resolve => setImmediate(resolve))

      assert.equal(firstFinished, false)
      assert.equal(replayFinished, false)
      assert.equal(executions, 0)

      blockWrites = false
      releaseBlockedWrite()
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
    let releaseBlockedWrite
    let signalWriteStarted
    const writeStarted = new Promise(resolve => { signalWriteStarted = resolve })
    let executions = 0
    const req = { headers: { 'idempotency-key': 'persistence:refresh-replay' } }
    const options = {
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
        signalWriteStarted()
        await new Promise(resolve => { releaseBlockedWrite = resolve })
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
      const replay = createResponse()
      const replayRequest = executeTrackedAgentAction(req, replay, options)
      await writeStarted
      completeAgentRun(run.runId, { stdout: 'finished during replay' })
      blockWrites = false
      releaseBlockedWrite()
      await replayRequest

      assert.equal(replay.statusCode, 200)
      assert.equal(replay.headers['Idempotency-Replayed'], 'true')
      assert.equal(replay.body.data.run.state, 'succeeded')
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
    let stateAtSerialization = null
    const res = createResponse()
    const serialize = res.json
    res.json = function json(body) {
      stateAtSerialization = getAgentRun(run.runId).state
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

    assert.equal(res.body.data.run.state, stateAtSerialization)
    assert.equal(getAgentRun(run.runId).state, 'succeeded')
    assert.equal(executions, 0)
  })

  it('returns a background failure that settles during the response flush', async () => {
    let releaseBlockedWrite
    let signalWriteStarted
    const writeStarted = new Promise(resolve => { signalWriteStarted = resolve })
    let settle
    const error = new Error('background failed during response persistence')
    error.code = 'BACKGROUND_SETTLED_DURING_FLUSH'
    error.statusCode = 422

    await initializeAgentRunStore({
      filePath: '/virtual/agent-route-response-runs.json',
      readStore: async (_filePath, fallback) => fallback,
      writeStore: async (_filePath, snapshot) => {
        const run = snapshot.runs[0]?.run
        if (run?.status === 'running' && run?.result?.message === 'started') {
          signalWriteStarted()
          await new Promise(resolve => { releaseBlockedWrite = resolve })
        }
      },
      runtimeLogger: quietLogger
    })

    try {
      const res = createResponse()
      const request = executeTrackedAgentAction(
        { headers: { 'idempotency-key': 'background:settle-during-flush' } },
        res,
        {
          operationId: 'test_settle_during_response_flush',
          input: { command: 'award' },
          waitForCompletion: false,
          execute: async lifecycle => {
            lifecycle.onStarted()
            settle = lifecycle.onSettled
            return { message: 'started' }
          }
        }
      )

      await writeStarted
      const settlement = settle({ ok: false, error })
      releaseBlockedWrite()
      await Promise.all([request, settlement])

      assert.equal(res.statusCode, 422)
      assert.equal(res.body.success, false)
      assert.equal(res.body.error.code, 'BACKGROUND_SETTLED_DURING_FLUSH')
      assert.equal(res.body.error.details.run.state, 'failed')
    } finally {
      releaseBlockedWrite?.()
      await shutdownAgentRunStoreForTests()
    }
  })

  it('keeps a concurrently replayed run queryable when admission later fails', async () => {
    const req = { headers: { 'idempotency-key': 'busy:retry:1' } }
    let rejectAdmission
    let executions = 0
    const options = {
      operationId: 'test_busy_action',
      input: { command: 'fight', waitForCompletion: false },
      waitForCompletion: false,
      execute: async () => {
        executions += 1
        if (executions === 1) {
          await new Promise((_, reject) => { rejectAdmission = reject })
        }
        return { message: 'started' }
      }
    }

    const first = createResponse()
    const firstRequest = executeTrackedAgentAction(req, first, options)
    await Promise.resolve()
    const replay = createResponse()
    await executeTrackedAgentAction(req, replay, options)
    const replayedRunId = replay.body.data.runId
    const busy = new Error('MAA 正在被其他任务使用')
    busy.code = 'MAA_EXECUTION_BUSY'
    busy.statusCode = 409
    busy.retryable = true
    rejectAdmission(busy)
    await firstRequest

    assert.equal(replay.statusCode, 202)
    assert.equal(first.statusCode, 409)
    assert.equal(first.body.data, undefined)
    assert.equal(first.body.error.details.runId, replayedRunId)
    assert.equal(getAgentRun(replayedRunId).state, 'failed')

    const retry = createResponse()
    await executeTrackedAgentAction(req, retry, options)
    assert.equal(retry.statusCode, 202)
    assert.notEqual(retry.body.data.runId, replayedRunId)
    assert.equal(executions, 2)
  })

  it('does not let a pending admission hide the run that owns the executor', async () => {
    const owner = beginAgentRun({ operationId: 'fight' }).run
    startAgentRun(owner.runId)
    let rejectAdmission
    const res = createResponse()
    const request = executeTrackedAgentAction(
      { headers: { 'idempotency-key': 'pending:behind-owner' } },
      res,
      {
        operationId: 'run_task',
        input: { command: 'award' },
        execute: async () => new Promise((_, reject) => { rejectAdmission = reject })
      }
    )
    await new Promise(resolve => setImmediate(resolve))

    assert.equal(getCurrentAgentRun().runId, owner.runId)
    const busy = new Error('MAA 正在被其他任务使用')
    busy.code = 'MAA_EXECUTION_BUSY'
    busy.statusCode = 409
    rejectAdmission(busy)
    await request

    assert.equal(res.statusCode, 409)
    assert.equal(getCurrentAgentRun().runId, owner.runId)
  })

  it('rejects guarded stop when the requested run is not current', async () => {
    const older = beginAgentRun({ operationId: 'fight' }).run
    startAgentRun(older.runId)
    const current = beginAgentRun({ operationId: 'run_task' }).run
    startAgentRun(current.runId)
    const res = createResponse()

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
    const signals = []
    setTaskStatus(true, '旧版任务', 'legacy', {
      pid: null,
      exitCode: null,
      kill: signal => signals.push(signal)
    })
    let rejectAdmission
    const startResponse = createResponse()
    const startRequest = executeTrackedAgentAction(
      { headers: { 'idempotency-key': 'guard:legacy-process' } },
      startResponse,
      {
        operationId: 'run_task',
        input: { command: 'award' },
        execute: async () => new Promise((_, reject) => { rejectAdmission = reject })
      }
    )
    await Promise.resolve()
    const acceptedRun = getCurrentAgentRun()
    assert.equal(acceptedRun.state, 'accepted')

    const stopResponse = createResponse()
    await findHandler('post', '/actions/stop')({
      headers: {},
      body: { runId: acceptedRun.runId }
    }, stopResponse, () => {})

    assert.equal(stopResponse.statusCode, 409)
    assert.equal(stopResponse.body.error.code, 'AGENT_RUN_NOT_STARTED')
    assert.deepEqual(signals, [])

    const busy = new Error('MAA 正在被其他任务使用')
    busy.code = 'MAA_EXECUTION_BUSY'
    busy.statusCode = 409
    rejectAdmission(busy)
    await startRequest
  })
})

describe('Agent daily flow route', () => {
  it('returns an inspectable dry-run plan with the standard dry-run metadata', async () => {
    const res = createResponse()
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
    const res = createResponse()
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
    assert.equal(res.body.data.plan[0].taskConfig.type, 'Recruit')
    assert.deepEqual(res.body.data.plan[1].args, [
      '1-7', '-m', '1', '-D30011=10', '--report-to-penguin', '--penguin-id', 'doctor'
    ])
  })

  it('rejects invalid scheduler configuration during dry-run', async () => {
    const res = createResponse()
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
    const res = createResponse()
    const req = { headers: {}, query: {}, body: { dryRun: true, taskFlow: [null] } }

    await findHandler('post', '/actions/run-daily-flow')(req, res, () => {})

    assert.equal(res.statusCode, 400)
    assert.equal(res.body.error.code, 'AGENT_DAILY_FLOW_REJECTED')
    assert.equal(res.body.error.details.result.details.index, 0)
  })
})
