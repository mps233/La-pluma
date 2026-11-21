import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, afterEach, describe, it } from 'node:test'
import {
  beginAgentRun,
  completeAgentRun,
  markAgentRunWaiting,
  requestAgentRunStop,
  resetAgentRunsForTests,
  startAgentRun
} from '../agentRunService.ts'
import { clearRealtimeLogs, getTaskStatus, setTaskStatus } from '../maaProcessService.ts'
import { buildAgentRunSnapshot } from '../runSnapshotService.ts'
import {
  configureRoguelikeProgressTrackerRuntimeForTests,
  getRoguelikeProgress,
  resetRoguelikeProgressTrackerForTests,
  startRoguelikeProgressTracker
} from '../roguelikeProgressTrackerService.ts'
import type { RoguelikeProgressTrackerInput } from '../roguelikeProgressTrackerService.ts'
import {
  configureCopilotQueueRuntimeForTests,
  resetCopilotQueueRunStateForTests,
  startManualCopilotQueue
} from '../copilotQueueRunService.ts'
import type { CopilotQueueProgress } from '../copilotQueueRunService.ts'
import type { CopilotQueuePlanEntry } from '../copilotPlanService.ts'
import { loggerManager } from '../../utils/logger.ts'

loggerManager.getLogger('MaaService').enableConsole = false

let lockDir: string
let lockFile: string
let previousLockFile: string | undefined

before(async () => {
  lockDir = await mkdtemp(join(tmpdir(), 'la-pluma-run-snapshot-'))
  lockFile = join(lockDir, 'maa-execution.lock')
  previousLockFile = process.env.LA_PLUMA_MAA_LOCK_FILE
  process.env.LA_PLUMA_MAA_LOCK_FILE = lockFile
})

after(async () => {
  if (previousLockFile === undefined) delete process.env.LA_PLUMA_MAA_LOCK_FILE
  else process.env.LA_PLUMA_MAA_LOCK_FILE = previousLockFile
  await rm(lockDir, { recursive: true, force: true })
})

async function writeLease(owner: Record<string, unknown>): Promise<void> {
  await writeFile(lockFile, JSON.stringify(owner))
}

function startSilentTracker(overrides: Partial<RoguelikeProgressTrackerInput> = {}): string {
  configureRoguelikeProgressTrackerRuntimeForTests({
    schedule: () => ({ cancel() {} })
  })
  const input: RoguelikeProgressTrackerInput = {
    runId: 'snapshot-run-1',
    checkpoint: { logPath: '/virtual/asst.log', size: 0 },
    command: 'roguelike',
    theme: 'JieGarden',
    mode: 30001,
    targetRounds: 3,
    settlementSupported: true,
    startedAtMs: Date.now(),
    ...overrides
  }
  assert.equal(startRoguelikeProgressTracker(input), true)
  return input.runId
}

async function startBlackFlowTracker(overrides: Partial<RoguelikeProgressTrackerInput> = {}): Promise<string> {
  const line = '[2026-11-21 21:28:27.403][INF] Assistant::append_callback | SubTaskExtraInfo '
    + JSON.stringify({
      taskchain: 'Roguelike',
      what: 'BlackFlowMapSummary',
      details: {
        run_revision: 2,
        map_revision: 1,
        observation_id: 'BF-O1',
        floor: 2,
        current_node: 562950054084616
      }
    })
  let delivered = false
  configureRoguelikeProgressTrackerRuntimeForTests({
    schedule(callback) {
      if (!delivered) callback()
      return { cancel() {} }
    },
    async readChunk(source) {
      if (delivered) {
        return { status: 'ok', text: '', nextCheckpoint: source, caughtUp: true }
      }
      delivered = true
      return {
        status: 'ok',
        text: line,
        nextCheckpoint: { logPath: source.logPath, size: line.length },
        caughtUp: true
      }
    }
  })
  const input: RoguelikeProgressTrackerInput = {
    runId: 'snapshot-blackflow-run',
    checkpoint: { logPath: '/virtual/asst.log', size: 0 },
    command: 'roguelike',
    theme: 'JieGarden',
    mode: 0,
    targetRounds: 1,
    settlementSupported: true,
    startedAtMs: Date.now(),
    ...overrides
  }
  assert.equal(startRoguelikeProgressTracker(input), true)
  for (let index = 0; index < 12; index += 1) {
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  return input.runId
}

describe('run snapshot', () => {
  beforeEach(async () => {
    resetAgentRunsForTests()
    resetCopilotQueueRunStateForTests()
    resetRoguelikeProgressTrackerForTests()
    await rm(lockFile, { force: true })
    if (getTaskStatus().isRunning) setTaskStatus(false)
  })

  afterEach(() => {
    resetCopilotQueueRunStateForTests()
    resetRoguelikeProgressTrackerForTests()
  })

  it('reports idle without runs, tasks or a lease', async () => {
    const snapshot = await buildAgentRunSnapshot()

    assert.equal(snapshot.run, null)
    assert.equal(snapshot.lastRun, null)
    assert.deepEqual(snapshot.activeRuns, [])
    assert.equal(snapshot.isRunning, false)
    assert.equal(snapshot.occupancy.state, 'idle')
    assert.deepEqual(snapshot.occupancy.lease, { state: 'free', owner: null })
    assert.deepEqual(snapshot.occupancy.sources, [])
  })

  it('reports a tracked run as the device owner', async () => {
    const run = beginAgentRun({ operationId: 'run_daily_flow' }).run
    startAgentRun(run.runId)

    const snapshot = await buildAgentRunSnapshot()

    assert.ok(snapshot.run)
    assert.equal(snapshot.run.runId, run.runId)
    assert.equal(snapshot.run.state, 'running')
    assert.equal(snapshot.occupancy.state, 'run')
    assert.equal(snapshot.occupancy.runId, run.runId)
    assert.equal(snapshot.occupancy.runState, 'running')
    assert.deepEqual(snapshot.occupancy.sources, ['run'])
    assert.ok(snapshot.run.progress)
    assert.equal(snapshot.run.progress.currentStep, null)
    assert.equal(snapshot.run.progress.message, '等待流程状态')
  })

  it('does not project another flow into a daily-flow run that does not own it', async () => {
    const accepted = beginAgentRun({ operationId: 'run_daily_flow' }).run

    const pendingSnapshot = await buildAgentRunSnapshot()
    assert.ok(pendingSnapshot.run)
    assert.ok(pendingSnapshot.run.progress)
    assert.equal(pendingSnapshot.run.progress.currentStep, null)
    assert.equal(pendingSnapshot.run.progress.message, '等待执行权')

    startAgentRun(accepted.runId)
    const snapshot = await buildAgentRunSnapshot()
    assert.ok(snapshot.run)
    assert.ok(snapshot.run.progress)
    assert.equal(snapshot.run.progress.currentStep, null)
    assert.equal(snapshot.run.progress.message, '等待流程状态')
  })

  it('reports a live lease without a run as external occupancy', async () => {
    const startedAt = new Date().toISOString()
    await writeLease({
      pid: process.pid,
      source: 'auto-update',
      taskName: '自动更新 MAA',
      command: 'update',
      startedAt
    })

    const snapshot = await buildAgentRunSnapshot()

    assert.equal(snapshot.occupancy.state, 'external')
    assert.equal(snapshot.occupancy.runId, null)
    assert.deepEqual(snapshot.occupancy.sources, ['lease'])
    assert.equal(snapshot.occupancy.lease.state, 'held')
    assert.deepEqual(snapshot.occupancy.lease.owner, {
      pid: process.pid,
      source: 'auto-update',
      taskName: '自动更新 MAA',
      command: 'update',
      startedAt
    })
  })

  it('treats a reclaimable lock file as stale rather than occupied', async () => {
    await writeLease({
      pid: 2147483647,
      source: 'dead-process',
      taskName: '已退出的进程',
      command: 'fight',
      startedAt: new Date().toISOString()
    })

    const snapshot = await buildAgentRunSnapshot()

    assert.equal(snapshot.occupancy.lease.state, 'stale')
    assert.equal(snapshot.occupancy.state, 'idle')
    assert.deepEqual(snapshot.occupancy.sources, [])
  })

  it('reports an unreadable lease as unknown instead of idle', async () => {
    await writeFile(lockFile, '{not json')

    const snapshot = await buildAgentRunSnapshot()

    assert.equal(snapshot.occupancy.lease.state, 'unknown')
    assert.equal(snapshot.occupancy.lease.owner, null)
    assert.equal(snapshot.occupancy.state, 'unknown')
  })

  it('reports a waiting manual set as a pending intent without device ownership', async () => {
    const run = beginAgentRun({ operationId: 'run_copilot_set' }).run
    startAgentRun(run.runId)
    markAgentRunWaiting(run.runId)

    const snapshot = await buildAgentRunSnapshot()

    assert.ok(snapshot.run)
    assert.ok(snapshot.run.progress)
    assert.equal(snapshot.run.runId, run.runId)
    assert.equal(snapshot.run.state, 'waiting')
    assert.equal(snapshot.run.progress.message, '等待开始下一关')
    assert.equal(snapshot.occupancy.state, 'pending')
    assert.equal(snapshot.occupancy.runState, 'waiting')
    assert.deepEqual(snapshot.occupancy.sources, ['run'])

    const newer = beginAgentRun({ operationId: 'run_task' }).run
    const withIntent = await buildAgentRunSnapshot()
    assert.ok(withIntent.run)
    assert.equal(withIntent.run.runId, newer.runId)
    const waitingEntry = withIntent.activeRuns.find(active => active.runId === run.runId)
    assert.ok(waitingEntry?.progress)
    assert.equal(waitingEntry.state, 'waiting')
    assert.equal(waitingEntry.progress.message, '等待开始下一关')
    assert.equal(withIntent.occupancy.state, 'pending')
  })

  it('reports a waiting copilot queue without a session as a pending intent', async () => {
    const run = beginAgentRun({ operationId: 'run_copilot_queue' }).run
    startAgentRun(run.runId)
    markAgentRunWaiting(run.runId)

    const snapshot = await buildAgentRunSnapshot()

    assert.ok(snapshot.run)
    assert.ok(snapshot.run.progress)
    assert.equal(snapshot.run.state, 'waiting')
    assert.equal(snapshot.run.progress.message, '等待开始下一项')
    assert.equal(snapshot.occupancy.state, 'pending')
    assert.equal(snapshot.occupancy.runState, 'waiting')
  })

  it('injects copilot queue progress while the queue waits for the next entry', async () => {
    const entries: CopilotQueuePlanEntry[] = ['queue-a', 'queue-b'].map((clientId, itemIndex) => ({
      key: clientId,
      clientId,
      source: 'prts',
      itemIndex,
      copilotId: 100 + itemIndex,
      stageId: `main_01-0${itemIndex + 1}`,
      displayStage: `1-${itemIndex + 1}`,
      apCost: 6,
      mode: 'normal',
      presetFormation: false
    }))
    configureCopilotQueueRuntimeForTests({
      buildCopilotQueuePlan: async () => ({ entries }),
      executeCopilotQueueEntries: async ({ entries: attempted = [], lifecycle = {} }) => {
        await lifecycle.onBeforeStart?.()
        lifecycle.onStarted?.()
        for (const entry of attempted) {
          lifecycle.onEntryStarted?.(entry, [entry])
          lifecycle.onEntrySettled?.(entry, 'success')
        }
        return {
          stopped: false,
          error: null,
          completed: attempted.map(entry => entry.key),
          loopTimes: 1,
          statuses: attempted.map(entry => ({ entry, status: 'success' as const }))
        }
      }
    })
    const run = beginAgentRun({ operationId: 'run_copilot_queue' }).run

    await startManualCopilotQueue({
      runId: run.runId,
      queueId: 'queue-snapshot',
      name: '快照队列',
      entries: [],
      mode: 'manual',
      failurePolicy: 'stop',
      options: {},
      lifecycle: {}
    })

    const snapshot = await buildAgentRunSnapshot()

    assert.ok(snapshot.run)
    const progress = snapshot.run.progress
    assert.ok(progress && 'queueId' in progress)
    const queueProgress = progress as CopilotQueueProgress
    assert.equal(queueProgress.queueId, 'queue-snapshot')
    assert.equal(queueProgress.phase, 'waiting_for_next')
    assert.equal(queueProgress.message, '等待开始下一项')
    assert.equal(queueProgress.nextEntry?.clientId, 'queue-b')
    assert.equal(queueProgress.totalSteps, 2)
    assert.equal(queueProgress.successCount, 1)
    assert.equal(queueProgress.pendingCount, 1)
    assert.equal(snapshot.occupancy.state, 'pending')

    const newer = beginAgentRun({ operationId: 'run_task' }).run
    const withIntent = await buildAgentRunSnapshot()
    const queueEntry = withIntent.activeRuns.find(active => active.runId === run.runId)
    assert.ok(queueEntry?.progress && 'queueId' in queueEntry.progress)
    assert.equal(queueEntry.runId, run.runId)
    assert.equal(withIntent.run?.runId, newer.runId)
  })

  it('keeps the latest terminal run without making it the current identity', async () => {
    const run = beginAgentRun({ operationId: 'fight' }).run
    startAgentRun(run.runId)
    completeAgentRun(run.runId, { ok: true })

    const snapshot = await buildAgentRunSnapshot()

    assert.equal(snapshot.run, null)
    assert.ok(snapshot.lastRun)
    assert.equal(snapshot.lastRun.runId, run.runId)
    assert.equal(snapshot.lastRun.state, 'succeeded')
    assert.equal(snapshot.occupancy.state, 'idle')
  })

  it('only projects progress onto the current active run', async () => {
    const older = beginAgentRun({ operationId: 'fight' }).run
    const newer = beginAgentRun({ operationId: 'run_task' }).run

    const snapshot = await buildAgentRunSnapshot()

    assert.ok(snapshot.run)
    assert.ok(snapshot.run.progress)
    assert.equal(snapshot.run.runId, newer.runId)
    assert.equal('roguelike' in snapshot.run.progress, false)
    assert.equal(snapshot.run.progress.message, '等待任务启动')
    assert.equal(snapshot.activeRuns.find(item => item.runId === older.runId)?.progress, undefined)
  })

  it('projects live roguelike progress for an active run_task', async () => {
    const run = beginAgentRun({ operationId: 'run_task' }).run
    startAgentRun(run.runId)
    startSilentTracker({ runId: run.runId })

    const snapshot = await buildAgentRunSnapshot()

    assert.ok(snapshot.run)
    const progress = snapshot.run.progress
    if (!progress || !('roguelike' in progress)) assert.fail('expected a roguelike progress projection')
    assert.equal(progress.message, '集成战略执行中')
    assert.equal(progress.currentTask, null)
    assert.equal(progress.roguelike?.command, 'roguelike')
    assert.equal(progress.roguelike?.theme, 'JieGarden')
    assert.equal(progress.roguelike?.mode, 30001)
    assert.equal(progress.roguelike?.targetRounds, 3)
    assert.equal(progress.roguelike?.settlementSupported, true)
    assert.equal(progress.roguelike?.phase, 'starting')
    assert.equal(progress.roguelike?.observed, false)
  })

  it('projects live black flow progress and keeps lastRun free of progress', async () => {
    const run = beginAgentRun({ operationId: 'run_task' }).run
    startAgentRun(run.runId)
    await startBlackFlowTracker({ runId: run.runId })

    const snapshot = await buildAgentRunSnapshot()

    assert.ok(snapshot.run)
    const progress = snapshot.run.progress
    if (!progress || !('roguelike' in progress)) assert.fail('expected a roguelike progress projection')
    assert.equal(progress.roguelike?.blackflow?.floor, 2)
    assert.deepEqual(progress.roguelike?.blackflow?.currentNode, {
      id: '562950054084616',
      name: null,
      type: null
    })
    assert.ok(progress.roguelike?.blackflow?.updatedAt)

    completeAgentRun(run.runId, { ok: true })
    const terminal = await buildAgentRunSnapshot()

    assert.equal(terminal.run, null)
    assert.ok(terminal.lastRun)
    assert.equal(terminal.lastRun.runId, run.runId)
    assert.equal('progress' in terminal.lastRun, false)
  })

  it('projects reclamation progress with the reclamation message', async () => {
    const run = beginAgentRun({ operationId: 'run_task' }).run
    startAgentRun(run.runId)
    startSilentTracker({
      runId: run.runId,
      command: 'reclamation',
      theme: 'Tales',
      mode: 0,
      settlementSupported: false
    })

    const snapshot = await buildAgentRunSnapshot()

    assert.ok(snapshot.run)
    const progress = snapshot.run.progress
    if (!progress || !('roguelike' in progress)) assert.fail('expected a roguelike progress projection')
    assert.equal(progress.message, '生息演算执行中')
    assert.equal(progress.roguelike?.command, 'reclamation')
    assert.equal(progress.roguelike?.mode, 0)
    assert.equal(progress.roguelike?.settlementSupported, false)
  })

  it('keeps roguelike progress readable while the run is stopping', async () => {
    const run = beginAgentRun({ operationId: 'run_task' }).run
    startAgentRun(run.runId)
    startSilentTracker({ runId: run.runId })
    requestAgentRunStop(run.runId)

    const snapshot = await buildAgentRunSnapshot()

    assert.ok(snapshot.run)
    assert.equal(snapshot.run.state, 'stopping')
    const progress = snapshot.run.progress
    if (!progress || !('roguelike' in progress)) assert.fail('expected a roguelike progress projection')
    assert.equal(progress.roguelike?.command, 'roguelike')
    assert.equal(progress.stopIntent, undefined)
  })

  it('keeps the latest terminal run free of progress even when its tracker is still registered', async () => {
    const run = beginAgentRun({ operationId: 'run_task' }).run
    startAgentRun(run.runId)
    startSilentTracker({ runId: run.runId })
    completeAgentRun(run.runId, { ok: true })

    const snapshot = await buildAgentRunSnapshot()

    assert.equal(snapshot.run, null)
    assert.ok(snapshot.lastRun)
    assert.equal(snapshot.lastRun.runId, run.runId)
    assert.equal('progress' in snapshot.lastRun, false)
    assert.ok(getRoguelikeProgress(run.runId))
  })
})

describe('run snapshot recent log wiring', () => {
  beforeEach(() => {
    clearRealtimeLogs()
    if (getTaskStatus().isRunning) setTaskStatus(false)
    for (let index = 0; index < 510; index += 1) {
      setTaskStatus(index % 2 === 0, `seed-task-${index}`, 'automation')
    }
    setTaskStatus(false)
  })

  afterEach(() => {
    clearRealtimeLogs()
  })

  it('serves the default 80 lines and honors a requested count', async () => {
    assert.equal((await buildAgentRunSnapshot()).recentLogs.length, 80)
    assert.equal((await buildAgentRunSnapshot({ lines: 200 })).recentLogs.length, 200)
  })
})
