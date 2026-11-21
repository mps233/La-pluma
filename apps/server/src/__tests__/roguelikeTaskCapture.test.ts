import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ExecutionOutcome,
  RoguelikeTaskCapturePorts,
  RoguelikeTaskCaptureRun,
  TrackedExecutionLifecycle
} from '../controllers/agentExecutionController.ts';
import { runRoguelikeTaskWithCapture } from '../controllers/agentExecutionController.ts';
import { MaaExecutionBusyError } from '../services/executionCoordinatorService.ts';
import type { MaaExecutionLease } from '../services/executionCoordinatorService.ts';
import type { RoguelikeProgressSnapshot } from '../services/roguelikeProgressService.ts';
import type { RoguelikeProgressTrackerInput } from '../services/roguelikeProgressTrackerService.ts';

const ROGUELIKE_SESSION_LOG = [
  'Assistant::append_callback | SubTaskStart {"taskchain":"Roguelike"}',
  'Assistant::append_callback | SubTaskExtraInfo {"taskchain":"Roguelike","what":"RoguelikeSettlement","details":{"floor":4,"step":23,"score":128}}',
  'Assistant::append_callback | TaskChainCompleted {"taskchain":"Roguelike"}'
].join('\n');

const PROGRESS_SNAPSHOT: RoguelikeProgressSnapshot = {
  command: 'roguelike',
  theme: 'Sarkaz',
  mode: 0,
  phase: 'exploring',
  currentRound: 2,
  roundStartedAt: new Date(0).toISOString(),
  targetRounds: 3,
  roundsStarted: 2,
  roundsEnded: 1,
  roundsSettled: 1,
  roundsPassed: 1,
  settlementSupported: true,
  currentAction: 'StartExplore',
  lastEventKind: 'round',
  lastEventName: null,
  lastEventAt: new Date(0).toISOString(),
  combatCount: 0,
  investment: null,
  recentRounds: [],
  blackflow: null,
  updatedAt: new Date(0).toISOString(),
  degraded: false,
  observed: true
};

const RUN: Omit<RoguelikeTaskCaptureRun, 'execute'> = {
  runId: 'run-1',
  target: {
    command: 'roguelike',
    args: ['Sarkaz'],
    theme: 'Sarkaz',
    startCount: 3,
    mode: 0
  },
  lease: { source: 'agent', taskName: 'Agent: roguelike', command: 'roguelike' },
  waitForCompletion: true,
  lifecycle: {}
};

function fakeLease(events: string[]): MaaExecutionLease {
  return {
    owner: {
      pid: process.pid,
      source: 'agent',
      taskName: 'Agent: roguelike',
      command: 'roguelike',
      startedAt: new Date(0).toISOString()
    },
    lockPath: '/virtual/maa-execution.lock',
    reentrant: false,
    release: async () => {
      events.push('release');
    }
  };
}

function progressPorts(
  events: string[]
): Pick<RoguelikeTaskCapturePorts, 'startProgress' | 'finalizeProgress' | 'releaseProgress'> {
  return {
    startProgress: (input: RoguelikeProgressTrackerInput) => {
      events.push(`start:${input.runId}:${input.targetRounds}:${input.settlementSupported}:${input.mode}`);
      return true;
    },
    finalizeProgress: async (runId: string) => {
      events.push(`finalize:${runId}`);
      return PROGRESS_SNAPSHOT;
    },
    releaseProgress: (runId: string) => {
      events.push(`release-progress:${runId}`);
    }
  };
}

function incrementalPorts(
  events: string[],
  readLog: () => string,
  overrides: Partial<RoguelikeTaskCapturePorts> = {}
): RoguelikeTaskCapturePorts {
  const lease = fakeLease(events);
  return {
    acquireLease: async request => {
      events.push(`acquire:${request.command}`);
      return lease;
    },
    runWithLease: (_lease, callback) => callback(),
    createCheckpoint: async () => {
      events.push('checkpoint');
      return { logPath: '/virtual/asst.log', size: readLog().length };
    },
    readLogSince: async checkpoint => {
      events.push('read');
      return readLog().slice(checkpoint?.size ?? 0);
    },
    ...progressPorts(events),
    ...overrides
  };
}

function summaryOf(value: unknown): {
  status?: string;
  observed?: boolean;
  progress?: RoguelikeProgressSnapshot | null;
} | undefined {
  return (value as {
    summary?: { status?: string; observed?: boolean; progress?: RoguelikeProgressSnapshot | null };
  } | null)?.summary;
}

function errorSummaryOf(error: unknown): {
  status?: string;
  observed?: boolean;
  progress?: RoguelikeProgressSnapshot | null;
} | undefined {
  const details = (error as {
    details?: { summary?: { status?: string; observed?: boolean; progress?: RoguelikeProgressSnapshot | null } };
  } | null)?.details;
  return details?.summary;
}

test('同步执行在租约内创建检查点，并在释放租约前采集摘要', async () => {
  const events: string[] = [];
  let logText = 'previous session tail\n';

  const result = await runRoguelikeTaskWithCapture(
    {
      ...RUN,
      execute: async lifecycle => {
        events.push('execute');
        await lifecycle.onBeforeStart?.();
        lifecycle.onStarted?.();
        logText += `${ROGUELIKE_SESSION_LOG}\n`;
        return { ok: true };
      }
    },
    incrementalPorts(events, () => logText)
  );

  assert.deepEqual(events, [
    'acquire:roguelike',
    'checkpoint',
    'execute',
    'start:run-1:3:true:0',
    'finalize:run-1',
    'read',
    'release-progress:run-1',
    'release'
  ]);
  const summary = summaryOf(result);
  assert.equal(summary?.status, 'success');
  assert.equal(summary?.observed, true);
  assert.deepEqual(summary?.progress, PROGRESS_SNAPSHOT);
});

test('把 Run 目标 mode 透传给进度跟踪器', async () => {
  const events: string[] = [];

  await runRoguelikeTaskWithCapture(
    {
      ...RUN,
      target: { ...RUN.target, mode: 10001 },
      execute: async lifecycle => {
        lifecycle.onStarted?.();
        return { ok: true };
      }
    },
    incrementalPorts(events, () => ROGUELIKE_SESSION_LOG)
  );

  assert.deepEqual(events, [
    'acquire:roguelike',
    'checkpoint',
    'start:run-1:3:false:10001',
    'finalize:run-1',
    'read',
    'release-progress:run-1',
    'release'
  ]);
});

test('同步失败同样在释放租约前读取本次增量并挂到错误详情', async () => {
  const events: string[] = [];
  let logText = 'previous session tail\n';
  const failure = Object.assign(new Error('任务已终止'), { stopped: true });

  await assert.rejects(
    runRoguelikeTaskWithCapture(
      {
        ...RUN,
        execute: async lifecycle => {
          lifecycle.onStarted?.();
          logText += `${ROGUELIKE_SESSION_LOG}\n`;
          throw failure;
        }
      },
      incrementalPorts(events, () => logText)
    ),
    error => {
      assert.equal(error, failure);
      assert.equal(errorSummaryOf(failure)?.status, 'success');
      assert.deepEqual(errorSummaryOf(failure)?.progress, PROGRESS_SNAPSHOT);
      return true;
    }
  );

  assert.deepEqual(events, [
    'acquire:roguelike',
    'checkpoint',
    'start:run-1:3:true:0',
    'finalize:run-1',
    'read',
    'release-progress:run-1',
    'release'
  ]);
});

test('异步执行在租约内采集摘要后再结算并释放租约', async () => {
  const events: string[] = [];
  const settled: ExecutionOutcome[] = [];
  let logText = 'previous session tail\n';
  const capturedLifecycle: { current: TrackedExecutionLifecycle | null } = { current: null };

  await runRoguelikeTaskWithCapture(
    {
      ...RUN,
      waitForCompletion: false,
      lifecycle: {
        onSettled: async outcome => {
          events.push('settle');
          settled.push(outcome);
        }
      },
      execute: async lifecycle => {
        capturedLifecycle.current = lifecycle;
        lifecycle.onStarted?.();
        events.push('started');
        logText += `${ROGUELIKE_SESSION_LOG}\n`;
        return { accepted: true };
      }
    },
    incrementalPorts(events, () => logText)
  );

  assert.deepEqual(events, ['acquire:roguelike', 'checkpoint', 'start:run-1:3:true:0', 'started']);
  assert.equal(settled.length, 0);

  await capturedLifecycle.current?.onSettled?.({ ok: true, result: { accepted: true } });

  assert.deepEqual(events, [
    'acquire:roguelike',
    'checkpoint',
    'start:run-1:3:true:0',
    'started',
    'finalize:run-1',
    'read',
    'settle',
    'release-progress:run-1',
    'release'
  ]);
  assert.equal(settled.length, 1);
  const summary = summaryOf(settled[0]?.result);
  assert.equal(summary?.status, 'success');
  assert.equal(summary?.observed, true);
  assert.deepEqual(summary?.progress, PROGRESS_SNAPSHOT);
});

test('设备占用被拒的请求不创建检查点、不读取日志、不产生摘要', async () => {
  const events: string[] = [];
  const busy = new MaaExecutionBusyError({
    pid: 424242,
    source: 'agent',
    taskName: '其它 Run',
    command: 'roguelike',
    startedAt: new Date(0).toISOString()
  });

  await assert.rejects(
    runRoguelikeTaskWithCapture(
      {
        ...RUN,
        execute: async () => {
          events.push('execute');
          return { ok: true };
        }
      },
      {
        acquireLease: async () => {
          events.push('acquire');
          throw busy;
        },
        runWithLease: (_lease, callback) => callback(),
        createCheckpoint: async () => {
          events.push('checkpoint');
          return { logPath: '/virtual/asst.log', size: 0 };
        },
        readLogSince: async () => {
          events.push('read');
          return ROGUELIKE_SESSION_LOG;
        }
      }
    ),
    error => {
      assert.equal(error, busy);
      assert.equal(busy.code, 'MAA_EXECUTION_BUSY');
      assert.equal(errorSummaryOf(busy), undefined);
      return true;
    }
  );

  assert.deepEqual(events, ['acquire']);
});

test('被前启动门禁拒绝的执行跳过摘要采集并释放租约', async () => {
  const events: string[] = [];
  const gateError = Object.assign(new Error('Run 已停止'), { code: 'AGENT_RUN_STOPPED' });

  await assert.rejects(
    runRoguelikeTaskWithCapture(
      {
        ...RUN,
        execute: async lifecycle => {
          events.push('execute');
          await lifecycle.onBeforeStart?.();
          throw gateError;
        }
      },
      {
        ...incrementalPorts(events, () => ROGUELIKE_SESSION_LOG),
        createCheckpoint: async () => {
          events.push('checkpoint');
          return { logPath: '/virtual/asst.log', size: 0 };
        }
      }
    ),
    error => {
      assert.equal(error, gateError);
      assert.equal((gateError as { details?: { summary?: unknown } }).details?.summary, undefined);
      return true;
    }
  );

  assert.deepEqual(events, [
    'acquire:roguelike',
    'checkpoint',
    'execute',
    'release-progress:run-1',
    'release'
  ]);
});

test('检查点创建失败时保留执行本身，仅跳过摘要', async () => {
  const events: string[] = [];
  const lease = fakeLease(events);

  const result = await runRoguelikeTaskWithCapture(
    {
      ...RUN,
      execute: async lifecycle => {
        lifecycle.onStarted?.();
        return { ok: true };
      }
    },
    {
      acquireLease: async () => lease,
      runWithLease: (_lease, callback) => callback(),
      createCheckpoint: async () => {
        throw new Error('no log dir');
      },
      readLogSince: async () => {
        events.push('read');
        return ROGUELIKE_SESSION_LOG;
      },
      ...progressPorts(events)
    }
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events, ['release-progress:run-1', 'release']);
});

test('进度跟踪启动返回 false 时不产出 progress 且不 finalize', async () => {
  const events: string[] = [];
  let logText = 'previous session tail\n';

  const result = await runRoguelikeTaskWithCapture(
    {
      ...RUN,
      execute: async lifecycle => {
        lifecycle.onStarted?.();
        logText += `${ROGUELIKE_SESSION_LOG}\n`;
        return { ok: true };
      }
    },
    incrementalPorts(events, () => logText, {
      startProgress: () => {
        events.push('start-false');
        return false;
      }
    })
  );

  assert.deepEqual(events, [
    'acquire:roguelike',
    'checkpoint',
    'start-false',
    'read',
    'release-progress:run-1',
    'release'
  ]);
  const summary = summaryOf(result);
  assert.equal(summary?.status, 'success');
  assert.equal(summary?.progress ?? null, null);
});

test('进度跟踪启动抛错只记录警告，不影响执行与摘要', async () => {
  const events: string[] = [];
  let logText = 'previous session tail\n';

  const result = await runRoguelikeTaskWithCapture(
    {
      ...RUN,
      execute: async lifecycle => {
        lifecycle.onStarted?.();
        logText += `${ROGUELIKE_SESSION_LOG}\n`;
        return { ok: true };
      }
    },
    incrementalPorts(events, () => logText, {
      startProgress: () => {
        throw new Error('tracker unavailable');
      }
    })
  );

  assert.deepEqual(events, [
    'acquire:roguelike',
    'checkpoint',
    'read',
    'release-progress:run-1',
    'release'
  ]);
  const summary = summaryOf(result);
  assert.equal(summary?.status, 'success');
  assert.equal(summary?.progress ?? null, null);
});

test('finalize 抛错只记录警告，摘要仍挂载且 tracker 被释放', async () => {
  const events: string[] = [];
  let logText = 'previous session tail\n';

  const result = await runRoguelikeTaskWithCapture(
    {
      ...RUN,
      execute: async lifecycle => {
        lifecycle.onStarted?.();
        logText += `${ROGUELIKE_SESSION_LOG}\n`;
        return { ok: true };
      }
    },
    incrementalPorts(events, () => logText, {
      finalizeProgress: async runId => {
        events.push(`finalize-error:${runId}`);
        throw new Error('finalize failed');
      }
    })
  );

  assert.deepEqual(events, [
    'acquire:roguelike',
    'checkpoint',
    'start:run-1:3:true:0',
    'finalize-error:run-1',
    'read',
    'release-progress:run-1',
    'release'
  ]);
  const summary = summaryOf(result);
  assert.equal(summary?.status, 'success');
  assert.equal(summary?.progress ?? null, null);
});

test('后台执行缺少 settle 回调时在 finally 收尾并释放 tracker', async () => {
  const events: string[] = [];
  let logText = 'previous session tail\n';

  await runRoguelikeTaskWithCapture(
    {
      ...RUN,
      waitForCompletion: false,
      execute: async lifecycle => {
        lifecycle.onStarted?.();
        logText += `${ROGUELIKE_SESSION_LOG}\n`;
        return { accepted: true };
      }
    },
    incrementalPorts(events, () => logText)
  );

  assert.deepEqual(events, [
    'acquire:roguelike',
    'checkpoint',
    'start:run-1:3:true:0',
    'finalize:run-1',
    'release-progress:run-1',
    'release'
  ]);
});
