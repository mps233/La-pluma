import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { isRecord } from '../../utils/errors.ts';

const isWindows = process.platform === 'win32';
const envKeys = [
  'MAA_CLI_PATH',
  'ADB_PATH',
  'ADB_ADDRESS',
  'MAA_LOG',
  'MAA_CONFIG_DIR',
  'ADB_LOG',
  'ADB_DEVICES_DELAY',
  'FAKE_MAA_CRASH_FIGHT',
  'LA_PLUMA_MAA_LOCK_FILE'
];

const maaScript = [
  '#!/bin/sh',
  'log="${MAA_LOG:?}"',
  'printf \'%s\\n\' "$*" >> "$log"',
  'case "$1" in',
  '  dir)',
  '    printf \'%s\\n\' "${MAA_CONFIG_DIR:?}"',
  '    ;;',
  '  fight)',
  '    if [ "${FAKE_MAA_CRASH_FIGHT:-}" = "1" ]; then',
  '      kill -KILL $$',
  '    fi',
  '    ;;',
  '  startup)',
  "    trap 'exit 143' TERM INT",
  '    while :; do sleep 1; done',
  '    ;;',
  'esac',
  'exit 0',
  ''
].join('\n');

const adbScript = [
  '#!/bin/sh',
  'case "$1" in',
  '  version)',
  '    printf \'%s\\n\' \'Android Debug Bridge version 1.0.41\'',
  '    ;;',
  '  devices)',
  '    printf \'devices\\n\' >> "${ADB_LOG:-/dev/null}"',
  '    if [ -n "$ADB_DEVICES_DELAY" ]; then',
  '      sleep "$ADB_DEVICES_DELAY"',
  '    fi',
  '    printf \'List of devices attached\\n%s\\tdevice\\n\' "$ADB_ADDRESS"',
  '    ;;',
  'esac',
  'exit 0',
  ''
].join('\n');

type SchedulerModule = typeof import('../schedulerService.ts');
type MaaModule = typeof import('../maaService.ts');
type ScheduleResult = Awaited<ReturnType<SchedulerModule['executeScheduleNow']>>;

interface ExecutionSummary {
  failedCount?: number;
  skippedCount?: number;
  successCount?: number;
}

function getExecutionSummary(result: ScheduleResult): ExecutionSummary {
  assert.ok(isRecord(result.summary));
  return result.summary as ExecutionSummary;
}

let testDir = '';
let logPath = '';
let adbLogPath = '';
let configDir = '';
let scheduler: SchedulerModule | null = null;
let maaService: MaaModule | null = null;
const previousEnv: Record<string, string | undefined> = {};

async function readLines(filePath: string) {
  const content = await readFile(filePath, 'utf8').catch(() => '');
  return content.split('\n').filter(Boolean);
}

async function readStartupCommands() {
  return (await readLines(logPath)).filter(line => line.startsWith('startup'));
}

async function waitFor(predicate: () => unknown, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await delay(25);
  }
  return false;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function stopEverything() {
  try {
    maaService?.stopCurrentTask();
  } catch {
    // Best-effort cleanup.
  }
  try {
    scheduler?.stopScheduleExecution();
  } catch {
    // Best-effort cleanup.
  }
}

before(async () => {
  if (isWindows) return;

  testDir = await mkdtemp(join(tmpdir(), 'la-pluma-scheduler-stop-'));
  logPath = join(testDir, 'maa.log');
  adbLogPath = join(testDir, 'adb.log');
  configDir = join(testDir, 'maa-config');
  const maaPath = join(testDir, 'maa');
  const adbPath = join(testDir, 'adb');

  await mkdir(configDir, { recursive: true });
  await writeFile(maaPath, maaScript, { mode: 0o755 });
  await writeFile(adbPath, adbScript, { mode: 0o755 });
  await chmod(maaPath, 0o755);
  await chmod(adbPath, 0o755);
  await writeFile(logPath, '');
  await writeFile(adbLogPath, '');

  for (const key of envKeys) previousEnv[key] = process.env[key];
  process.env.MAA_CLI_PATH = maaPath;
  process.env.ADB_PATH = adbPath;
  process.env.ADB_ADDRESS = '127.0.0.1:16384';
  process.env.MAA_LOG = logPath;
  process.env.MAA_CONFIG_DIR = configDir;
  process.env.ADB_LOG = adbLogPath;
  process.env.LA_PLUMA_MAA_LOCK_FILE = join(testDir, 'maa.lock');
  delete process.env.ADB_DEVICES_DELAY;

  scheduler = await import('../schedulerService.ts');
  maaService = await import('../maaService.ts');
});

after(async () => {
  stopEverything();
  if (!testDir) return;

  await delay(50);
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  await rm(testDir, { recursive: true, force: true });
});

test('stopping during StartUp does not relaunch MAA', { skip: isWindows }, async (): Promise<void> => {
  await writeFile(logPath, '');
  await writeFile(adbLogPath, '');
  delete process.env.ADB_DEVICES_DELAY;

  const taskFlow = [{
    id: 'startup-1',
    commandId: 'startup',
    name: '启动游戏',
    enabled: true,
    params: { clientType: 'Official' }
  }];

  let result: ScheduleResult | undefined;
  try {
    const runPromise = scheduler!.executeScheduleNow('stop-startup', taskFlow);
    runPromise.catch(() => undefined);

    const startupStarted = await waitFor(async () => (await readStartupCommands()).length >= 1);
    assert.equal(startupStarted, true, 'maa startup should have started');

    const taskStop = maaService!.stopCurrentTask();
    assert.equal(taskStop.success, true, taskStop.message);
    assert.equal(scheduler!.stopScheduleExecution(), true);

    result = await withTimeout(runPromise, 10000, 'schedule flow did not stop after StartUp was terminated');
  } finally {
    stopEverything();
  }

  assert.ok(result);
  assert.equal(result.success, true);
  assert.equal(result.stopped, true);
  const startupCommands = await readStartupCommands();
  assert.equal(startupCommands.length, 1);
  assert.match(startupCommands[0], /^startup\b/);
});

test('an out-of-band MAA stop also ends the scheduled flow', { skip: isWindows }, async (): Promise<void> => {
  await writeFile(logPath, '');
  await writeFile(adbLogPath, '');
  delete process.env.ADB_DEVICES_DELAY;

  const taskFlow = [{
    id: 'startup-1',
    commandId: 'startup',
    name: '启动游戏',
    enabled: true,
    params: { clientType: 'Official' }
  }];

  let result: ScheduleResult | undefined;
  try {
    const runPromise = scheduler!.executeScheduleNow('stop-out-of-band', taskFlow);
    runPromise.catch(() => undefined);

    const startupStarted = await waitFor(async () => (await readStartupCommands()).length >= 1);
    assert.equal(startupStarted, true, 'maa startup should have started');

    const taskStop = maaService!.stopCurrentTask();
    assert.equal(taskStop.success, true, taskStop.message);
    // Intentionally do not call stopScheduleExecution: only stopCurrentTask is allowed here.

    result = await withTimeout(runPromise, 10000, 'schedule flow did not stop after the MAA task was terminated');
  } finally {
    stopEverything();
  }

  assert.ok(result);
  assert.equal(result.success, true);
  assert.equal(result.stopped, true);
  assert.equal(getExecutionSummary(result).failedCount ?? 0, 0);
  const startupCommands = await readStartupCommands();
  assert.equal(startupCommands.length, 1);
  assert.match(startupCommands[0], /^startup\b/);
});

test('a crashed task is counted as a failure instead of stopping the flow', { skip: isWindows }, async (): Promise<void> => {
  await writeFile(logPath, '');
  await writeFile(adbLogPath, '');
  delete process.env.ADB_DEVICES_DELAY;
  process.env.FAKE_MAA_CRASH_FIGHT = '1';

  const taskFlow = [
    {
      id: 'fight-1',
      commandId: 'fight',
      name: '理智作战',
      enabled: true,
      params: { stages: [{ stage: '1-7', times: '1' }], drops: '' }
    },
    {
      id: 'startup-1',
      commandId: 'startup',
      name: '启动游戏',
      enabled: true,
      params: { clientType: 'Official' }
    }
  ];

  let result: ScheduleResult | undefined;
  try {
    const runPromise = scheduler!.executeScheduleNow('crash-continue', taskFlow);
    runPromise.catch(() => undefined);

    const startupStarted = await waitFor(async () => (await readStartupCommands()).length >= 1);
    assert.equal(startupStarted, true, 'flow should continue to StartUp after the fight crash');

    const taskStop = maaService!.stopCurrentTask();
    assert.equal(taskStop.success, true, taskStop.message);
    assert.equal(scheduler!.stopScheduleExecution(), true);

    result = await withTimeout(runPromise, 10000, 'schedule flow did not stop after the later StartUp stop');
  } finally {
    delete process.env.FAKE_MAA_CRASH_FIGHT;
    stopEverything();
  }

  assert.ok(result);
  assert.equal(result.success, true);
  assert.equal(result.stopped, true);
  const summary = getExecutionSummary(result);
  assert.equal((summary.failedCount ?? 0) + (summary.skippedCount ?? 0), 1);
  assert.equal(summary.successCount, 0);
});

test('stopping during the StartUp preflight does not start MAA', { skip: isWindows }, async (): Promise<void> => {
  await writeFile(logPath, '');
  await writeFile(adbLogPath, '');
  process.env.ADB_DEVICES_DELAY = '1';

  const taskFlow = [{
    id: 'startup-1',
    commandId: 'startup',
    name: '启动游戏',
    enabled: true,
    params: { clientType: 'Official' }
  }];

  let result: ScheduleResult | undefined;
  try {
    const runPromise = scheduler!.executeScheduleNow('stop-preflight', taskFlow);
    runPromise.catch(() => undefined);

    const preflightStarted = await waitFor(async () => (await readLines(adbLogPath)).includes('devices'));
    assert.equal(preflightStarted, true, 'ADB preflight should have started');

    assert.equal(scheduler!.getScheduleExecutionStatus().isRunning, true);
    assert.equal(scheduler!.stopScheduleExecution(), true);

    result = await withTimeout(runPromise, 10000, 'schedule flow did not stop during the StartUp preflight');
  } finally {
    delete process.env.ADB_DEVICES_DELAY;
    stopEverything();
  }

  assert.ok(result);
  assert.equal(result.success, true);
  assert.equal(result.stopped, true);
  assert.deepEqual(await readStartupCommands(), []);
});
