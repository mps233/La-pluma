import { asErrorWithCode } from '../../utils/errors.ts';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const isWindows = process.platform === 'win32';
const envKeys = ['MAA_CLI_PATH', 'LA_PLUMA_MAA_LOCK_FILE', 'MAA_LOG', 'MAA_CONFIG_DIR', 'FAKE_MAA_MODE'];

const maaScript = [
  '#!/bin/sh',
  'log="${MAA_LOG:?}"',
  'printf \'%s\\n\' "$*" >> "$log"',
  'case "$1" in',
  '  dir)',
  '    printf \'%s\\n\' "${MAA_CONFIG_DIR:?}"',
  '    ;;',
  '  run)',
  '    case "${FAKE_MAA_MODE:-}" in',
  '      crash)',
  '        kill -KILL $$',
  '        ;;',
  '      sleep)',
  "        trap 'exit 143' TERM INT",
  '        while :; do sleep 1; done',
  '        ;;',
  '    esac',
  '    ;;',
  'esac',
  'exit 0',
  ''
].join('\n');

let testDir = '';
let logPath = '';
let configDir = '';
let maaService: typeof import('../maaService.ts') | null = null;
const previousEnv: Record<string, string | undefined> = {};

async function readLines() {
  const content = await readFile(logPath, 'utf8').catch(() => '');
  return content.split('\n').filter(Boolean);
}

async function waitFor(predicate: () => unknown, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await delay(25);
  }
  return false;
}

before(async () => {
  if (isWindows) return;

  testDir = await mkdtemp(join(tmpdir(), 'la-pluma-maa-stop-'));
  logPath = join(testDir, 'maa.log');
  configDir = join(testDir, 'maa-config');
  const maaPath = join(testDir, 'maa');

  await mkdir(configDir, { recursive: true });
  await writeFile(maaPath, maaScript, { mode: 0o755 });
  await chmod(maaPath, 0o755);
  await writeFile(logPath, '');

  for (const key of envKeys) previousEnv[key] = process.env[key];
  process.env.MAA_CLI_PATH = maaPath;
  process.env.MAA_LOG = logPath;
  process.env.MAA_CONFIG_DIR = configDir;
  process.env.LA_PLUMA_MAA_LOCK_FILE = join(testDir, 'maa.lock');
  delete process.env.FAKE_MAA_MODE;

  maaService = await import('../maaService.ts');
});

after(async () => {
  try {
    maaService?.stopCurrentTask();
  } catch {
    // Best-effort cleanup.
  }
  if (!testDir) return;

  await delay(50);
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  await rm(testDir, { recursive: true, force: true });
});

test('a signal-killed MAA process is not reported as a user stop', { skip: isWindows }, async () => {
  await writeFile(logPath, '');
  process.env.FAKE_MAA_MODE = 'crash';

  await assert.rejects(
    maaService!.execMaaCommand('run', [], 'crash-task', null, true),
    (error: unknown) => {
      assert.equal(asErrorWithCode(error).stopped, true);
      assert.equal(asErrorWithCode(error).stopRequested, false);
      return true;
    }
  );
});

test('a stopCurrentTask kill is reported as a user stop', { skip: isWindows }, async (): Promise<void> => {
  await writeFile(logPath, '');
  process.env.FAKE_MAA_MODE = 'sleep';

  const command = maaService!.execMaaCommand('run', [], 'stop-task', null, true);
  command.catch(() => undefined);
  try {
    const started = await waitFor(() => maaService!.getTaskStatus().isRunning);
    assert.equal(started, true, 'MAA command should have started');

    const stopResult = maaService!.stopCurrentTask();
    assert.equal(stopResult.success, true, stopResult.message);

    await assert.rejects(command, (error: unknown) => {
      assert.equal(asErrorWithCode(error).stopped, true);
      assert.equal(asErrorWithCode(error).stopRequested, true);
      return true;
    });
  } finally {
    delete process.env.FAKE_MAA_MODE;
    maaService!.stopCurrentTask();
  }
});

test('a dynamic task aborts before spawning MAA when the stop predicate flips', { skip: isWindows }, async () => {
  await writeFile(logPath, '');
  delete process.env.FAKE_MAA_MODE;

  let checks = 0;
  const shouldAbort = () => {
    checks += 1;
    return checks >= 2;
  };

  await assert.rejects(
    maaService!.execDynamicTask(
      'abort-dynamic',
      JSON.stringify({ name: '测试任务', type: 'Fight', params: { stage: '1-7' } }),
      '测试任务',
      'fight',
      true,
      false,
      { shouldAbort }
    ),
    (error: unknown) => {
      assert.equal(asErrorWithCode(error).stopped, true);
      assert.equal(asErrorWithCode(error).stopRequested, true);
      return true;
    }
  );

  const lines = await readLines();
  assert.equal(lines.some(line => line.startsWith('dir config')), true);
  assert.equal(lines.some(line => line.startsWith('run')), false);
  assert.ok(checks >= 2);
});
