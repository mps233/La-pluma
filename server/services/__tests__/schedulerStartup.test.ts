import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  'MAA_TASK_LOG',
  'FAKE_ADB_FOREGROUND',
  'FAKE_ADB_ACTIVITY',
  'LA_PLUMA_MAA_LOCK_FILE'
];

// `run --batch <file>` copies the generated task file so the test can inspect
// the actual StartUp config that was handed to maa-cli.
const maaScript = [
  '#!/bin/sh',
  'log="${MAA_LOG:?}"',
  'printf \'%s\\n\' "$*" >> "$log"',
  'case "$1" in',
  '  dir)',
  '    printf \'%s\\n\' "${MAA_CONFIG_DIR:?}"',
  '    ;;',
  '  run)',
  '    if [ "$2" = "--batch" ]; then',
  '      cat "${MAA_CONFIG_DIR:?}/tasks/$3.json" >> "${MAA_TASK_LOG:?}"',
  '    fi',
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
  '    printf \'List of devices attached\\n%s\\tdevice\\n\' "${ADB_ADDRESS:?}"',
  '    ;;',
  '  -s)',
  '    if [ "$3" = "shell" ] && [ "$4" = "dumpsys" ] && [ "$5" = "window" ]; then',
  '      printf \'  mCurrentFocus=Window{1 u0 %s/%s}\\n\' "${FAKE_ADB_FOREGROUND:-com.hypergryph.arknights}" "${FAKE_ADB_ACTIVITY:-com.u8.sdk.U8UnityContext}"',
  '    fi',
  '    ;;',
  'esac',
  'exit 0',
  ''
].join('\n');

type SchedulerModule = typeof import('../schedulerService.ts');
type ScheduleResult = Awaited<ReturnType<SchedulerModule['executeScheduleNow']>>;

interface ExecutionSummary {
  failedCount?: number;
  skippedCount?: number;
  successCount?: number;
  actions?: Array<{ action?: string; status?: string; message?: string }>;
  taskResults?: Array<{ id?: string; state?: string }>;
}

function getExecutionSummary(result: ScheduleResult): ExecutionSummary {
  assert.ok(isRecord(result.summary));
  return result.summary as ExecutionSummary;
}

let testDir = '';
let logPath = '';
let taskLogPath = '';
let configDir = '';
let scheduler: SchedulerModule | null = null;
const previousEnv: Record<string, string | undefined> = {};

async function readLines(filePath: string) {
  const content = await readFile(filePath, 'utf8').catch(() => '');
  return content.split('\n').filter(Boolean);
}

async function resetLogs() {
  await writeFile(logPath, '');
  await writeFile(taskLogPath, '');
}

function startupTask(params: Record<string, unknown>) {
  return {
    id: 'startup-1',
    commandId: 'startup',
    name: '启动游戏',
    enabled: true,
    params: { clientType: 'Official', ...params }
  };
}

before(async () => {
  if (isWindows) return;

  testDir = await mkdtemp(join(tmpdir(), 'la-pluma-scheduler-startup-'));
  logPath = join(testDir, 'maa.log');
  taskLogPath = join(testDir, 'maa-tasks.log');
  configDir = join(testDir, 'maa-config');
  const maaPath = join(testDir, 'maa');
  const adbPath = join(testDir, 'adb');

  await mkdir(configDir, { recursive: true });
  await writeFile(maaPath, maaScript, { mode: 0o755 });
  await writeFile(adbPath, adbScript, { mode: 0o755 });
  await chmod(maaPath, 0o755);
  await chmod(adbPath, 0o755);
  await resetLogs();

  for (const key of envKeys) previousEnv[key] = process.env[key];
  process.env.MAA_CLI_PATH = maaPath;
  process.env.ADB_PATH = adbPath;
  process.env.ADB_ADDRESS = '127.0.0.1:16384';
  process.env.MAA_LOG = logPath;
  process.env.MAA_CONFIG_DIR = configDir;
  process.env.MAA_TASK_LOG = taskLogPath;
  process.env.LA_PLUMA_MAA_LOCK_FILE = join(testDir, 'maa.lock');
  delete process.env.FAKE_ADB_FOREGROUND;
  delete process.env.FAKE_ADB_ACTIVITY;

  scheduler = await import('../schedulerService.ts');
});

after(async () => {
  if (!testDir) return;

  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  await rm(testDir, { recursive: true, force: true });
});

test('startGameEnabled=false executes the dynamic StartUp task instead of `maa run startup`', { skip: isWindows }, async (): Promise<void> => {
  await resetLogs();
  process.env.FAKE_ADB_FOREGROUND = 'com.hypergryph.arknights';

  const result = await scheduler!.executeScheduleNow(
    'startup-connect-only',
    [startupTask({ startGameEnabled: false })]
  );

  assert.equal(result.success, true);
  const summary = getExecutionSummary(result);
  assert.equal(summary.failedCount ?? 0, 0);
  assert.equal(summary.successCount, 1);

  const commands = await readLines(logPath);
  assert.equal(
    commands.includes('run startup'),
    false,
    `startup must not call "maa run startup"; commands: ${commands.join(' | ')}`
  );
  const dynamicCommands = commands.filter(line => /^run --batch _lapluma\/startup_temp_/.test(line));
  assert.equal(
    dynamicCommands.length,
    1,
    `expected one dynamic StartUp command; commands: ${commands.join(' | ')}`
  );

  const taskConfigs = (await readLines(taskLogPath)).join('\n');
  assert.match(taskConfigs, /"type": "StartUp"/);
  assert.match(taskConfigs, /"start_game_enabled": false/);

  const leftovers = await readdir(join(configDir, 'tasks', '_lapluma')).catch(() => []);
  assert.deepEqual(leftovers, [], 'temporary dynamic task files should be cleaned up');
});

test('startGameEnabled=false fails fast with a clear message when the game is not in the foreground', { skip: isWindows }, async (): Promise<void> => {
  // Let the previous flow's fire-and-forget cleanup finish before starting a new one.
  await delay(200);
  await resetLogs();
  process.env.FAKE_ADB_FOREGROUND = 'app.lawnchair';
  process.env.FAKE_ADB_ACTIVITY = 'app.lawnchair.LawnchairLauncher';

  const result = await scheduler!.executeScheduleNow(
    'startup-connect-only-not-running',
    [startupTask({ startGameEnabled: false })]
  );

  assert.equal(result.success, true);
  const summary = getExecutionSummary(result);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.successCount ?? 0, 0);

  const startupAction = summary.actions?.find(action => action.action === 'startup');
  assert.ok(startupAction, 'startup action should be reported');
  assert.equal(startupAction.status, 'failed');
  assert.match(String(startupAction.message || ''), /启动游戏客户端未勾选/);
  assert.match(String(startupAction.message || ''), /app\.lawnchair/);

  const commands = await readLines(logPath);
  assert.equal(
    commands.some(line => line === 'run startup' || line.startsWith('run --batch ')),
    false,
    `MAA must not start when the game is not in the foreground; commands: ${commands.join(' | ')}`
  );
});

test('a failed startup skips the remaining game tasks but still runs closedown', { skip: isWindows }, async (): Promise<void> => {
  await resetLogs();
  process.env.FAKE_ADB_FOREGROUND = 'app.lawnchair';
  process.env.FAKE_ADB_ACTIVITY = 'app.lawnchair.LawnchairLauncher';

  const result = await scheduler!.executeScheduleNow('startup-failed-skip', [
    startupTask({ startGameEnabled: false }),
    { id: 'infrast-1', commandId: 'infrast', name: '基建换班', enabled: true, params: { mode: '0' } },
    { id: 'recruit-1', commandId: 'recruit', name: '自动公招', enabled: true, params: { refresh: true, times: '4', confirm: [3, 4] } },
    { id: 'closedown-1', commandId: 'closedown', name: '关闭游戏', enabled: true, params: { clientType: 'Official', recognizeDepotBeforeClose: false } }
  ]);

  assert.equal(result.success, true);
  const summary = getExecutionSummary(result);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.skippedCount, 2);
  assert.equal(summary.successCount, 1);
  assert.match(result.message, /1 项任务失败/);
  assert.match(result.message, /2 项任务跳过/);

  const actions = summary.actions || [];
  assert.equal(actions.find(action => action.action === 'startup')?.status, 'failed');
  for (const actionName of ['infrast', 'recruit']) {
    const skippedAction = actions.find(action => action.action === actionName);
    assert.equal(skippedAction?.status, 'skipped', `${actionName} should be skipped`);
    assert.match(String(skippedAction?.message || ''), /启动游戏失败/);
  }
  assert.equal(actions.find(action => action.action === 'closedown')?.status, 'success');

  const taskStates = new Map((summary.taskResults || []).map(task => [task.id, task.state]));
  assert.equal(taskStates.get('startup-1'), 'failed');
  assert.equal(taskStates.get('infrast-1'), 'skipped');
  assert.equal(taskStates.get('recruit-1'), 'skipped');
  assert.equal(taskStates.get('closedown-1'), 'success');

  const commands = await readLines(logPath);
  assert.equal(
    commands.some(line => line.startsWith('run --batch ')),
    false,
    `skipped game tasks must not start MAA; commands: ${commands.join(' | ')}`
  );
  assert.equal(
    commands.some(line => /^closedown\b/.test(line)),
    true,
    `closedown should still run; commands: ${commands.join(' | ')}`
  );
});

test('startGameEnabled=true keeps using the regular `maa startup` command', { skip: isWindows }, async (): Promise<void> => {
  await resetLogs();
  process.env.FAKE_ADB_FOREGROUND = 'com.hypergryph.arknights';

  const result = await scheduler!.executeScheduleNow(
    'startup-launch-game',
    [startupTask({ startGameEnabled: true })]
  );

  assert.equal(result.success, true);
  const summary = getExecutionSummary(result);
  assert.equal(summary.failedCount ?? 0, 0);
  assert.equal(summary.successCount, 1);

  const commands = await readLines(logPath);
  assert.equal(
    commands.some(line => /^startup\b/.test(line)),
    true,
    `expected "maa startup"; commands: ${commands.join(' | ')}`
  );
  assert.equal(
    commands.some(line => line.startsWith('run --batch ')),
    false,
    `launch mode must not use a dynamic run task; commands: ${commands.join(' | ')}`
  );
});