import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  beginAgentRun,
  completeAgentRun,
  flushAgentRunStore,
  getActiveAgentRuns,
  getAgentRun,
  initializeAgentRunStore,
  interruptAgentRun,
  listAgentRuns,
  requestAgentRunStop,
  resetAgentRunsForTests,
  shutdownAgentRunStoreForTests,
  startAgentRun,
  stopAgentRun
} from '../agentRunService.ts';
import type { AgentRunDto, AgentRunRecord } from '../agentRunService.ts';
import {
  acquireMaaExecutionLease,
  withMaaExecutionLease
} from '../executionCoordinatorService.ts';
import {
  clearExecutionAdmissionGateForTests,
  getExecutionAdmissionGate,
  installExecutionAdmissionGate
} from '../executionAdmissionService.ts';
import {
  attachExecutionShutdownToLifecycle,
  createExecutionShutdownService
} from '../executionShutdownService.ts';
import type { ExecutionShutdownRuntime } from '../executionShutdownService.ts';
import { createRuntimeLifecycle } from '../runtimeLifecycleService.ts';
import { executeScheduledTaskFromCron } from '../schedulerService.ts';
import {
  configureRoguelikeProgressTrackerRuntimeForTests,
  getRoguelikeProgress,
  resetRoguelikeProgressTrackerForTests,
  startRoguelikeProgressTracker
} from '../roguelikeProgressTrackerService.ts';
import {
  configureCopilotSetRuntimeForTests,
  continueManualCopilotSet,
  hasCopilotSetSession,
  requestCopilotSetRunStop,
  resetCopilotSetRunStateForTests,
  startManualCopilotSet
} from '../copilotSetRunService.ts';
import type { CopilotPlanEntry, CopilotTaskResult } from '../copilotPlanService.ts';
import { execMaaCommand } from '../maaExecutionService.ts';
import { getTaskStatus } from '../maaProcessService.ts';
import { writeJsonFile } from '../../utils/fileHelper.ts';
import { installShutdownHandlers, startLaPlumaServer } from '../../server.ts';
import type { ShutdownOutcome } from '../../server.ts';

const quietLogger = {
  log() {},
  info() {},
  warn() {},
  error() {}
};

let testDir = '';
let storePath = '';
let lockPath = '';
let previousLockPath: string | undefined;
let harnessPath = '';

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'la-pluma-execution-shutdown-'));
  storePath = join(testDir, 'agent-runs.json');
  lockPath = join(testDir, 'maa.lock');
  previousLockPath = process.env.LA_PLUMA_MAA_LOCK_FILE;
  process.env.LA_PLUMA_MAA_LOCK_FILE = lockPath;
  harnessPath = join(testDir, 'shutdown-harness.mjs');
  try {
    await shutdownAgentRunStoreForTests();
  } catch {
    // 上一个用例的故障写入器让存储保持 fail-closed；本用例重新初始化即可。
  }
  resetCopilotSetRunStateForTests();
  resetAgentRunsForTests();
  resetRoguelikeProgressTrackerForTests();
  clearExecutionAdmissionGateForTests();
  await initializeAgentRunStore({ filePath: storePath, runtimeLogger: quietLogger });
});

afterEach(async () => {
  clearExecutionAdmissionGateForTests();
  resetCopilotSetRunStateForTests();
  resetAgentRunsForTests();
  resetRoguelikeProgressTrackerForTests();
  try {
    await shutdownAgentRunStoreForTests();
  } catch {
    await initializeAgentRunStore({
      filePath: join(testDir, 'cleanup-agent-runs.json'),
      runtimeLogger: quietLogger
    }).catch(() => {});
    await shutdownAgentRunStoreForTests().catch(() => {});
  }
  if (previousLockPath === undefined) delete process.env.LA_PLUMA_MAA_LOCK_FILE;
  else process.env.LA_PLUMA_MAA_LOCK_FILE = previousLockPath;
  // 存储关闭后仍可能有在途写入落盘，删除目录时重试避免 ENOTEMPTY 竞态。
  await rm(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  assert.ok(isRecord(value), `${label} 应为 JSON 对象`);
  return value;
}

function requireRun(runId: string): AgentRunDto {
  const run = getAgentRun(runId);
  assert.ok(run, `run ${runId} 不存在`);
  return run;
}

function readRunResult(run: AgentRunDto): Record<string, unknown> {
  return readRecord(run.result, 'run result');
}

interface StoredRunSnapshot {
  runs: Array<{ run: AgentRunRecord }>;
}

async function readStoredRuns(): Promise<Map<string, AgentRunRecord>> {
  const snapshot = JSON.parse(await readFile(storePath, 'utf8')) as StoredRunSnapshot;
  return new Map(snapshot.runs.map(record => [record.run.runId, record.run]));
}

function realRunRuntime(
  overrides: Partial<ExecutionShutdownRuntime> = {}
): Partial<ExecutionShutdownRuntime> {
  return {
    listActiveRuns: () => getActiveAgentRuns().map(run => ({
      runId: run.runId,
      state: run.state,
      operationId: run.operationId
    })),
    requestRunStop: runId => ({ disposition: requestAgentRunStop(runId).disposition }),
    requestCopilotSetStop: runId => {
      const outcome = requestCopilotSetRunStop(runId);
      return outcome ? { disposition: outcome.disposition } : null;
    },
    interruptRun: (runId, details) => interruptAgentRun(runId, details),
    flushRunStore: () => flushAgentRunStore(),
    stopDeviceTask: () => null,
    stopScheduleFlow: () => false,
    isDeviceTaskRunning: () => false,
    isScheduleRunning: () => false,
    sleep: ms => new Promise<void>(resolve => { setTimeout(resolve, ms); }),
    ...overrides
  };
}

function taskResult(entry: CopilotPlanEntry): CopilotTaskResult {
  return {
    key: entry.key,
    itemIndex: entry.itemIndex,
    copilotId: entry.copilotId,
    stageId: entry.stageId,
    stage: entry.stageId,
    displayStage: entry.displayStage,
    apCost: entry.apCost,
    mode: entry.mode,
    presetFormation: entry.presetFormation,
    status: 'success'
  };
}

function planEntries(): CopilotPlanEntry[] {
  return [
    {
      key: 'entry-a', itemIndex: 0, copilotId: 1, stageId: 'stage-a', displayStage: '1-7',
      apCost: 0, mode: 'normal', presetFormation: false, completed: false
    },
    {
      key: 'entry-b', itemIndex: 1, copilotId: 2, stageId: 'stage-b', displayStage: '1-8',
      apCost: 0, mode: 'normal', presetFormation: false, completed: false
    }
  ];
}

describe('execution admission gate', () => {
  it('rejects new Run admission and new device leases once the gate closes', async () => {
    const gate = installExecutionAdmissionGate();
    assert.equal(gate.isClosed(), false);

    gate.close('SIGTERM');

    assert.equal(gate.isClosed(), true);
    assert.throws(
      () => beginAgentRun({ operationId: 'fight' }),
      error => isRecord(error)
        && error.code === 'AGENT_EXECUTION_SHUTTING_DOWN'
        && error.statusCode === 503
        && error.retryable === true
        && isRecord(error.details)
        && error.details.reason === 'SIGTERM'
    );
    await assert.rejects(
      acquireMaaExecutionLease({ source: 'telegram', taskName: '刷关卡' }),
      error => isRecord(error) && error.code === 'MAA_EXECUTION_SHUTTING_DOWN' && error.statusCode === 503
    );
    assert.equal(listAgentRuns().length, 0);
    await assert.rejects(stat(lockPath), { code: 'ENOENT' });
    const gateAfterClose = getExecutionAdmissionGate();
    assert.ok(gateAfterClose);
    assert.equal(gateAfterClose.status().rejected >= 2, true);
  });

  it('keeps reentrant lease use inside an execution that already owns the lease', async () => {
    const gate = installExecutionAdmissionGate();
    await withMaaExecutionLease({ source: 'schedule' }, async () => {
      gate.close('SIGTERM');
      const reentrant = await acquireMaaExecutionLease({ source: 'schedule' });
      assert.equal(reentrant.reentrant, true);
    });
    await assert.rejects(
      acquireMaaExecutionLease({ source: 'schedule' }),
      error => isRecord(error) && error.code === 'MAA_EXECUTION_SHUTTING_DOWN'
    );
  });

  it('rejects device-mutating commands before spawning a CLI process', async () => {
    installExecutionAdmissionGate().close('SIGTERM');

    await assert.rejects(
      execMaaCommand('fight', ['1-7'], '刷关卡', 'combat'),
      error => isRecord(error) && error.code === 'MAA_EXECUTION_SHUTTING_DOWN'
    );
    assert.equal(getTaskStatus().isRunning, false);
    assert.equal(getTaskStatus().taskName, null);
    await assert.rejects(stat(lockPath), { code: 'ENOENT' });
  });

  it('stops cron execution at the same gate without creating a Run', async () => {
    installExecutionAdmissionGate().close('SIGTERM');

    const result = await executeScheduledTaskFromCron([
      { id: 'award-1', commandId: 'award', name: '领取奖励', enabled: true, params: {} }
    ], 'cron-during-shutdown');

    assert.equal(result.success, false);
    assert.match(result.message, /正在关闭/);
    assert.equal(listAgentRuns().length, 0);
  });
});

describe('execution shutdown coordination', () => {
  it('honors an exhausted budget without falling back to the default drain timeout', async () => {
    const { run } = beginAgentRun({ operationId: 'fight' });
    startAgentRun(run.runId);
    const service = createExecutionShutdownService({
      logger: quietLogger,
      runtime: realRunRuntime({ sleep: async () => assert.fail('zero-budget shutdown must not wait for settlement') })
    });
    const summary = await service.drain({ reason: 'deadline-exhausted', timeoutMs: 0 });
    assert.equal(summary.budgetMs, 0);
    assert.deepEqual(summary.interruptedRunIds, [run.runId]);
    assert.equal(requireRun(run.runId).state, 'interrupted');
    assert.equal(summary.flush.ok, true);
  });

  it('releases roguelike progress trackers while draining', async () => {
    configureRoguelikeProgressTrackerRuntimeForTests({
      schedule: () => ({ cancel() {} })
    });
    const { run } = beginAgentRun({ operationId: 'run_task' });
    startAgentRun(run.runId);
    assert.equal(startRoguelikeProgressTracker({
      runId: run.runId,
      checkpoint: { logPath: '/virtual/asst.log', size: 0 },
      command: 'roguelike',
      theme: 'JieGarden',
      mode: null,
      targetRounds: null,
      settlementSupported: null,
      startedAtMs: Date.now()
    }), true);
    assert.ok(getRoguelikeProgress(run.runId));

    const service = createExecutionShutdownService({
      logger: quietLogger,
      runtime: realRunRuntime({ sleep: async () => {} })
    });
    const summary = await service.drain({ reason: 'test', timeoutMs: 0 });

    assert.equal(getRoguelikeProgress(run.runId), null);
    assert.equal(summary.flush.ok, true);
  });

  it('records roguelike progress release failures and finishes the remaining cleanup', async () => {
    const { run } = beginAgentRun({ operationId: 'fight' });
    startAgentRun(run.runId);
    let stopIntentReleases = 0;
    let runStops = 0;
    const service = createExecutionShutdownService({
      logger: quietLogger,
      settleIntervalMs: 5,
      flushReserveMs: 20,
      defaultDrainBudgetMs: 500,
      runtime: realRunRuntime({
        releaseStopIntents: () => {
          stopIntentReleases += 1;
        },
        releaseRoguelikeProgress: () => {
          throw new Error('fixture tracker release failed');
        },
        requestRunStop: runId => {
          runStops += 1;
          return { disposition: requestAgentRunStop(runId).disposition };
        },
        stopDeviceTask: () => stopAgentRun(run.runId, { message: 'stopped' })
      })
    });

    const summary = await service.drain({ reason: 'test', timeoutMs: 500 });

    assert.ok(
      summary.errors.some(error => error.includes('释放肉鸽进度跟踪失败')
        && error.includes('fixture tracker release failed')),
      `errors should contain the progress release failure: ${JSON.stringify(summary.errors)}`
    );
    assert.equal(stopIntentReleases, 1);
    assert.equal(runStops, 1);
    assert.equal(requireRun(run.runId).state, 'stopped');
    assert.equal(summary.flush.ok, true);
  });

  it('stops only this instance’s active runs and keeps the result reported by the executor', async () => {
    const { run: running } = beginAgentRun({ operationId: 'fight' });
    startAgentRun(running.runId);
    const { run: accepted } = beginAgentRun({ operationId: 'run_task' });
    const { run: finished } = beginAgentRun({ operationId: 'fight' });
    startAgentRun(finished.runId);
    completeAgentRun(finished.runId, { ok: true });

    const deviceStops: Array<{ forceKillDelayMs: number }> = [];
    const service = createExecutionShutdownService({
      logger: quietLogger,
      settleIntervalMs: 5,
      flushReserveMs: 20,
      defaultDrainBudgetMs: 1000,
      runtime: realRunRuntime({
        stopDeviceTask: options => {
          deviceStops.push(options);
          // 执行器在子进程退出后按实际结果结算；这里模拟“关闭后子进程被终止”。
          stopAgentRun(running.runId, { message: 'stopped by shutdown' });
        }
      })
    });

    const summary = await service.drain({ reason: 'SIGTERM', timeoutMs: 1000 });

    assert.equal(requireRun(running.runId).state, 'stopped');
    assert.equal(requireRun(accepted.runId).state, 'stopped');
    assert.equal(readRunResult(requireRun(accepted.runId)).canceled, true);
    assert.equal(requireRun(finished.runId).state, 'succeeded');
    assert.deepEqual(summary.interruptedRunIds, []);
    assert.equal(summary.flush.ok, true);
    assert.equal(deviceStops.length, 1);

    const stored = await readStoredRuns();
    assert.equal(requireRunRecord(stored, running.runId).status, 'stopped');
    assert.equal(requireRunRecord(stored, accepted.runId).status, 'stopped');
    assert.equal(requireRunRecord(stored, finished.runId).status, 'succeeded');
  });

  it('records interrupted instead of success when the executor misses the shutdown budget', async () => {
    const { run } = beginAgentRun({ operationId: 'fight' });
    startAgentRun(run.runId);
    const service = createExecutionShutdownService({
      logger: quietLogger,
      settleIntervalMs: 5,
      flushReserveMs: 20,
      defaultDrainBudgetMs: 200,
      runtime: realRunRuntime()
    });

    const summary = await service.drain({ reason: 'SIGTERM', timeoutMs: 120 });

    const interrupted = requireRun(run.runId);
    assert.equal(interrupted.state, 'interrupted');
    assert.equal(interrupted.result, null);
    assert.equal(interrupted.recovery?.source, 'server_shutdown');
    // 关闭先写入停止意图（running → stopping），预算耗尽后再记为中断。
    assert.equal(interrupted.recovery?.previousState, 'stopping');
    assert.equal(interrupted.recovery?.executionResumed, false);
    assert.deepEqual(summary.interruptedRunIds, [run.runId]);
    assert.equal(summary.flush.ok, true);

    const stored = await readStoredRuns();
    assert.equal(requireRunRecord(stored, run.runId).status, 'interrupted');
  });

  it('fails the close step when Run persistence fails, after finishing the remaining cleanup', async () => {
    await shutdownAgentRunStoreForTests();
    let failWrites = false;
    await initializeAgentRunStore({
      filePath: storePath,
      runtimeLogger: quietLogger,
      writeStore: async (path, data) => {
        if (failWrites) throw new Error('fixture disk full');
        await writeJsonFile(path, data);
      }
    });
    const { run } = beginAgentRun({ operationId: 'fight' });
    startAgentRun(run.runId);
    failWrites = true;

    const events: string[] = [];
    const lifecycle = createRuntimeLifecycle({ logger: quietLogger, closeDeadlineMs: 3000 });
    lifecycle.register({
      name: 'after-drain-marker',
      close: () => { events.push('after-drain'); }
    });
    attachExecutionShutdownToLifecycle(lifecycle, {
      logger: quietLogger,
      settleIntervalMs: 5,
      flushReserveMs: 20,
      defaultDrainBudgetMs: 300,
      runtime: realRunRuntime({
        stopDeviceTask: () => stopAgentRun(run.runId, { message: 'stopped' })
      })
    });
    await lifecycle.start();

    const summary = await lifecycle.close('SIGTERM');

    assert.equal(summary.ok, false);
    const step = summary.steps.find(entry => entry.name === 'execution-shutdown');
    assert.ok(step, 'execution-shutdown 步骤应出现在关闭摘要中');
    assert.equal(step.status, 'failed');
    assert.match(step.error ?? '', /磁盘|disk full|Run 持久化失败/);
    assert.ok(events.includes('after-drain'));
  });

  it('reuses the first close summary and does not repeat stop intents', async () => {
    const { run } = beginAgentRun({ operationId: 'fight' });
    startAgentRun(run.runId);
    let stopCalls = 0;
    let deviceStops = 0;
    const lifecycle = createRuntimeLifecycle({ logger: quietLogger, closeDeadlineMs: 2000 });
    attachExecutionShutdownToLifecycle(lifecycle, {
      logger: quietLogger,
      settleIntervalMs: 5,
      flushReserveMs: 20,
      defaultDrainBudgetMs: 500,
      runtime: realRunRuntime({
        requestRunStop: runId => {
          stopCalls += 1;
          return { disposition: requestAgentRunStop(runId).disposition };
        },
        stopDeviceTask: () => {
          deviceStops += 1;
          stopAgentRun(run.runId, { message: 'stopped' });
        }
      })
    });
    await lifecycle.start();

    const first = await lifecycle.close('SIGTERM');
    const second = await lifecycle.close('SIGINT');

    assert.equal(first, second);
    assert.equal(stopCalls, 1);
    assert.equal(deviceStops, 1);
    assert.equal(requireRun(run.runId).state, 'stopped');
  });

  it('stops a waiting manual copilot set and blocks the next entry', async () => {
    const entries = planEntries();
    configureCopilotSetRuntimeForTests({
      buildCopilotPlan: async () => ({ setId: '7', name: 'fixture set', items: [], entries }),
      executeCopilotEntries: async ({ entries: batch, lifecycle }) => {
        assert.ok(batch, '作业集执行应携带待执行条目');
        await lifecycle?.onBeforeStart?.();
        await lifecycle?.onStarted?.();
        for (const entry of batch) {
          lifecycle?.onEntryStarted?.(entry, batch);
          lifecycle?.onEntrySettled?.(entry, 'success');
        }
        return {
          success: true,
          stopped: false,
          error: null,
          completed: batch.map(entry => entry.key),
          results: [],
          pending: [],
          loopTimes: 0,
          summary: {
            totalEntries: batch.length,
            successCount: batch.length,
            failedCount: 0,
            stoppedCount: 0,
            pendingCount: 0,
            taskResults: batch.map(taskResult)
          }
        };
      }
    });
    const { run } = beginAgentRun({ operationId: 'run_copilot_set' });
    const started = await startManualCopilotSet({ runId: run.runId, setId: 7 });
    assert.ok('waitingForNext' in started && started.waitingForNext === true);
    assert.equal(requireRun(run.runId).state, 'waiting');

    const service = createExecutionShutdownService({
      logger: quietLogger,
      settleIntervalMs: 5,
      flushReserveMs: 20,
      defaultDrainBudgetMs: 300,
      runtime: realRunRuntime()
    });
    const summary = await service.drain({ reason: 'SIGTERM', timeoutMs: 300 });

    const stopped = requireRun(run.runId);
    assert.equal(stopped.state, 'stopped');
    const stoppedResult = readRunResult(stopped);
    assert.equal(stoppedResult.stopped, true);
    assert.equal(stoppedResult.waitingForNext, false);
    assert.equal(readRecord(stoppedResult.summary, 'stop summary').pendingCount, 1);
    assert.deepEqual(summary.interruptedRunIds, []);
    assert.equal(hasCopilotSetSession(run.runId), false);
    await assert.rejects(
      continueManualCopilotSet({ runId: run.runId }),
      error => isRecord(error)
        && (error.code === 'AGENT_COPILOT_SET_NOT_WAITING'
          || error.code === 'AGENT_COPILOT_SET_SESSION_LOST')
    );
  });

  it('stops in-process task processes and flows without a Run identity', async () => {
    let deviceRunning = true;
    let scheduleRunning = true;
    const calls = { device: 0, schedule: 0 };
    const service = createExecutionShutdownService({
      logger: quietLogger,
      settleIntervalMs: 5,
      flushReserveMs: 20,
      defaultDrainBudgetMs: 200,
      runtime: realRunRuntime({
        stopDeviceTask: () => {
          calls.device += 1;
          deviceRunning = false;
        },
        stopScheduleFlow: () => {
          calls.schedule += 1;
          scheduleRunning = false;
        },
        isDeviceTaskRunning: () => deviceRunning,
        isScheduleRunning: () => scheduleRunning
      })
    });

    const summary = await service.drain({ reason: 'SIGTERM', timeoutMs: 200 });

    assert.equal(calls.device, 1);
    assert.equal(calls.schedule, 1);
    assert.equal(summary.deviceStopCalls, 1);
    assert.equal(summary.scheduleStopCalls, 1);
    assert.deepEqual(summary.errors, []);
  });

  it('does not consume the next copilot entry when shutdown rejects the lease', async () => {
    const shutdownRejection = Object.assign(new Error('服务正在关闭，不再接受新的设备执行'), {
      code: 'MAA_EXECUTION_SHUTTING_DOWN',
      statusCode: 503,
      retryable: true
    });
    const entries = planEntries();
    let attempts = 0;
    configureCopilotSetRuntimeForTests({
      buildCopilotPlan: async () => ({ setId: '8', name: 'fixture set', items: [], entries }),
      executeCopilotEntries: async ({ entries: batch, lifecycle }) => {
        attempts += 1;
        if (attempts > 1) throw shutdownRejection;
        assert.ok(batch, '作业集执行应携带待执行条目');
        await lifecycle?.onBeforeStart?.();
        await lifecycle?.onStarted?.();
        for (const entry of batch) {
          lifecycle?.onEntryStarted?.(entry, batch);
          lifecycle?.onEntrySettled?.(entry, 'success');
        }
        return {
          success: true,
          stopped: false,
          error: null,
          completed: batch.map(entry => entry.key),
          results: [],
          pending: [],
          loopTimes: 0,
          summary: {
            totalEntries: batch.length,
            successCount: batch.length,
            failedCount: 0,
            stoppedCount: 0,
            pendingCount: 0,
            taskResults: batch.map(taskResult)
          }
        };
      }
    });
    const { run } = beginAgentRun({ operationId: 'run_copilot_set' });
    await startManualCopilotSet({ runId: run.runId, setId: 8 });
    assert.equal(requireRun(run.runId).state, 'waiting');

    await assert.rejects(
      continueManualCopilotSet({ runId: run.runId }),
      error => isRecord(error) && error.code === 'MAA_EXECUTION_SHUTTING_DOWN'
    );

    // 关闭拒绝不消耗条目：run 保持 waiting，下一项仍为 pending。
    assert.equal(requireRun(run.runId).state, 'waiting');
    await flushAgentRunStore();
    const stored = await readStoredRuns();
    assert.equal(requireRunRecord(stored, run.runId).status, 'waiting');
    assert.equal(hasCopilotSetSession(run.runId), true);
  });

  it('keeps shutdown-interrupted records across restart and replays them instead of re-running', async () => {
    const { run } = beginAgentRun({
      operationId: 'fight',
      idempotencyKey: 'shutdown-key',
      input: { stage: '1-7' }
    });
    startAgentRun(run.runId);
    const service = createExecutionShutdownService({
      logger: quietLogger,
      settleIntervalMs: 5,
      flushReserveMs: 20,
      defaultDrainBudgetMs: 100,
      runtime: realRunRuntime()
    });
    await service.drain({ reason: 'SIGTERM', timeoutMs: 80 });
    assert.equal(requireRun(run.runId).state, 'interrupted');

    // 模拟重启：新进程重新读取同一份存储，进程内闸门不存在。
    await shutdownAgentRunStoreForTests();
    clearExecutionAdmissionGateForTests();
    await initializeAgentRunStore({ filePath: storePath, runtimeLogger: quietLogger });

    const restored = requireRun(run.runId);
    assert.equal(restored.state, 'interrupted');
    assert.equal(restored.recovery?.source, 'server_shutdown');

    const replay = beginAgentRun({
      operationId: 'fight',
      idempotencyKey: 'shutdown-key',
      input: { stage: '1-7' }
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.run.runId, run.runId);
    assert.equal(replay.run.state, 'interrupted');
    assert.equal(listAgentRuns().length, 1);

    // 旧 runId 已是终态，按 id 停止不会误停之后的执行。
    const { run: next } = beginAgentRun({ operationId: 'fight', input: { stage: '1-7' } });
    startAgentRun(next.runId);
    assert.equal(requestAgentRunStop(run.runId).disposition, 'terminal');
    assert.equal(requireRun(next.runId).state, 'running');
  });
});

describe('assembled runtime shutdown', () => {
  it('closes admission synchronously when the runtime starts closing', async () => {
    // 生命周期按剩余预算切出的份额既是 drain 的预算，也是 watchdog 的时长：
    // 用墙钟等待时 drain 在内部截止时间后只剩 flushReserveMs 的余量，CI 的
    // 事件循环停顿会让 watchdog 先触发。这里注入时钟推进 drain，并把首个
    // settle 轮询当作同步点，让“关闭中”窗口由事件决定，而不是墙钟预算。
    let clockMs = 0;
    const settlingCompleted = Promise.withResolvers<void>();
    const settlingReached = Promise.withResolvers<void>();
    let settlingBlocked = false;

    const runtime = await startLaPlumaServer({
      env: {},
      host: '127.0.0.1',
      port: 0,
      initializeRunStore: () => initializeAgentRunStore({
        filePath: storePath,
        runtimeLogger: quietLogger
      }),
      initializeRuntime: async () => {},
      logger: quietLogger,
      closeDeadlineMs: 3000,
      executionShutdownOptions: {
        logger: quietLogger,
        settleIntervalMs: 10,
        flushReserveMs: 50,
        defaultDrainBudgetMs: 1000,
        runtime: {
          now: () => clockMs,
          sleep: async ms => {
            clockMs += ms;
            if (settlingBlocked) return;
            settlingBlocked = true;
            settlingReached.resolve();
            await settlingCompleted.promise;
          }
        }
      }
    });

    try {
      // 一个未结算的活动执行让关闭步骤停留在 draining 阶段，传输层尚未断开。
      const { run } = beginAgentRun({ operationId: 'fight' });
      startAgentRun(run.runId);

      const closing = runtime.close('SIGTERM');
      assert.throws(
        () => beginAgentRun({ operationId: 'fight' }),
        error => isRecord(error) && error.code === 'AGENT_EXECUTION_SHUTTING_DOWN'
      );

      // drain 停在 settle 轮询上：执行关闭步骤仍在进行，传输层尚未断开。
      await settlingReached.promise;
      const rejected = await fetch(`http://127.0.0.1:${runtime.port}/api/agent/actions/fight`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: '1-7' })
      });
      assert.equal(rejected.status, 503);
      const body = readRecord(await rejected.json(), 'response body');
      assert.equal(readRecord(body.error, 'error').code, 'AGENT_EXECUTION_SHUTTING_DOWN');
      assert.equal(readRecord(body.error, 'error').retryable, true);

      // 读取路径不经过准入闸门，关闭期间仍可观察已有执行。
      const current = await fetch(`http://127.0.0.1:${runtime.port}/api/agent/runs/current`);
      assert.equal(current.status, 200);

      settlingCompleted.resolve();
      const summary = await closing;
      const step = summary.steps.find(entry => entry.name === 'execution-shutdown');
      assert.ok(step, 'execution-shutdown step should be part of the close summary');
      assert.equal(step.status, 'closed');
      assert.equal(requireRun(run.runId).state, 'interrupted');
      assert.equal(summary.ok, true);
    } finally {
      settlingCompleted.resolve();
      await runtime.close('cleanup');
    }
  });
});

describe('shutdown signal handling', () => {
  it('runs a single close for repeated signals and exits non-zero for an incomplete close', async () => {
    const exits: number[] = [];
    let closeCalls = 0;
    let resolveClose: (value: ShutdownOutcome) => void = () => {};
    const runtime = {
      close: () => {
        closeCalls += 1;
        return new Promise<ShutdownOutcome>(resolve => { resolveClose = resolve; });
      }
    };
    const controller = installShutdownHandlers(runtime, {
      logger: quietLogger,
      exit: code => exits.push(code),
      signals: ['SIGTERM', 'SIGINT']
    });

    try {
      const first = controller.shutdown('SIGTERM');
      const repeated = controller.shutdown('SIGINT');
      assert.equal(first, repeated);
      assert.equal(closeCalls, 1);
      assert.deepEqual(exits, []);

      resolveClose({
        ok: false,
        steps: [{ name: 'execution-shutdown', status: 'failed', error: 'Run 持久化失败' }]
      });
      const summary = await first;
      assert.ok(summary);
      assert.equal(summary.ok, false);
      assert.deepEqual(exits, [1]);

      await controller.shutdown('SIGTERM');
      assert.equal(closeCalls, 1);
      assert.deepEqual(exits, [1]);
    } finally {
      controller.dispose();
    }
  });

  it('exits non-zero when the close rejects', async () => {
    const exits: number[] = [];
    const controller = installShutdownHandlers({
      close: async () => { throw new Error('close exploded'); }
    }, {
      logger: quietLogger,
      exit: code => exits.push(code),
      signals: ['SIGTERM']
    });
    try {
      await controller.shutdown('SIGTERM');
      assert.deepEqual(exits, [1]);
    } finally {
      controller.dispose();
    }
  });

  async function writeHarness(): Promise<void> {
    const serverUrl = pathToFileURL(fileURLToPath(new URL('../../server.ts', import.meta.url))).href;
    const agentRunUrl = pathToFileURL(fileURLToPath(new URL('../agentRunService.ts', import.meta.url))).href;
    const fileHelperUrl = pathToFileURL(fileURLToPath(new URL('../../utils/fileHelper.ts', import.meta.url))).href;
    const source = `import { installShutdownHandlers, startLaPlumaServer } from ${JSON.stringify(serverUrl)};
import { beginAgentRun, getAgentRun, initializeAgentRunStore, startAgentRun, stopAgentRun } from ${JSON.stringify(agentRunUrl)};
import { writeJsonFile } from ${JSON.stringify(fileHelperUrl)};

const quiet = { log() {}, info() {}, warn() {}, error() {} };
const mode = process.env.FIXTURE_MODE;
const storePath = process.env.FIXTURE_RUN_STORE;
let failWrites = false;

const runtime = await startLaPlumaServer({
  env: { ...process.env, PORT: '0' },
  host: '127.0.0.1',
  port: 0,
  initializeRunStore: () => initializeAgentRunStore({
    filePath: storePath,
    runtimeLogger: quiet,
    writeStore: async (path, data) => {
      if (failWrites) throw new Error('fixture disk full');
      await writeJsonFile(path, data);
    }
  }),
  initializeRuntime: async () => {},
  logger: quiet,
  closeDeadlineMs: Number(process.env.FIXTURE_CLOSE_DEADLINE || 3000),
  executionShutdownOptions: {
    logger: quiet,
    settleIntervalMs: 10,
    flushReserveMs: 50,
    forceKillDelayMs: 200,
    defaultDrainBudgetMs: 1200
  }
});

const { run } = beginAgentRun({ operationId: 'fight', input: { fixture: true } });
startAgentRun(run.runId);

if (mode === 'cooperative') {
  const timer = setInterval(() => {
    const current = getAgentRun(run.runId);
    if (current && current.state === 'stopping') {
      stopAgentRun(run.runId, { message: 'stopped by shutdown' });
      clearInterval(timer);
    }
  }, 10);
}

if (mode === 'flush-failure') failWrites = true;
installShutdownHandlers(runtime);
process.stdout.write(JSON.stringify({ runId: run.runId, port: runtime.port }) + '\\n');
`;
    await writeFile(harnessPath, source, 'utf8');
  }

  interface HarnessReady {
    runId: string;
    port: number;
  }

  interface HarnessHandle {
    child: ReturnType<typeof spawn>;
    ready: Promise<HarnessReady>;
    closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
    output(): { stdout: string; stderr: string };
  }

  function runHarness(env: Record<string, string>): HarnessHandle {
    const child = spawn(process.execPath, [harnessPath], {
      cwd: testDir,
      env: { ...process.env, NODE_ENV: 'test', ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });

    const ready = new Promise<HarnessReady>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`fixture did not become ready: ${stderr}`));
      }, 20_000);
      const onData = (): void => {
        // 组装入口还会打印路径配置，这里只认能解析成对象的就绪行。
        for (const line of stdout.split('\n')) {
          if (!line.trim().startsWith('{')) continue;
          try {
            const announced = JSON.parse(line) as HarnessReady;
            clearTimeout(timer);
            child.stdout.off('data', onData);
            resolve(announced);
            return;
          } catch {
            // 继续等待完整的就绪行
          }
        }
      };
      child.stdout.on('data', onData);
      child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', code => {
        clearTimeout(timer);
        reject(new Error(`fixture exited before readiness (${code}): ${stderr}`));
      });
    });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    return { child, ready, closed, output: () => ({ stdout, stderr }) };
  }

  it('settles a cooperative execution and exits cleanly on repeated signals', async () => {
    await writeHarness();
    const fixture = runHarness({
      FIXTURE_MODE: 'cooperative',
      FIXTURE_RUN_STORE: storePath,
      FIXTURE_CLOSE_DEADLINE: '3000'
    });

    const announced = await fixture.ready;
    fixture.child.kill('SIGTERM');
    await new Promise<void>(resolve => { setTimeout(resolve, 30); });
    fixture.child.kill('SIGINT');

    const exit = await fixture.closed;
    assert.equal(exit.code, 0, fixture.output().stderr);
    const stored = await readStoredRuns();
    const record = requireRunRecord(stored, announced.runId);
    assert.equal(record.status, 'stopped');
    assert.equal(readRecord(record.result, 'run result').message, 'stopped by shutdown');
  });

  it('exits non-zero when Run flush fails during shutdown', async () => {
    await writeHarness();
    const fixture = runHarness({
      FIXTURE_MODE: 'flush-failure',
      FIXTURE_RUN_STORE: storePath,
      FIXTURE_CLOSE_DEADLINE: '900'
    });

    await fixture.ready;
    fixture.child.kill('SIGTERM');

    const exit = await fixture.closed;
    assert.equal(exit.code, 1);
    assert.match(fixture.output().stderr, /关闭未完全成功/);
  });
});

function requireRunRecord(stored: Map<string, AgentRunRecord>, runId: string): AgentRunRecord {
  const record = stored.get(runId);
  assert.ok(record, `stored run ${runId} 不存在`);
  return record;
}
