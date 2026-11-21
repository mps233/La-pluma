import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, describe, it } from 'node:test';
import type { ApiErrorResponse, ApiSuccessResponse } from '../utils/apiHelper.ts';
import type { WebrtcSignalingGateway } from '../services/webrtcSignalingGateway.ts';

const fixtureDir = await mkdtemp(join(tmpdir(), 'la-pluma-execution-http-'));
const maaLogDir = join(fixtureDir, 'maa-logs');
const xdgDataHome = join(fixtureDir, 'xdg-data');
const xdgStateHome = join(fixtureDir, 'xdg-state');
const xdgConfigHome = join(fixtureDir, 'xdg-config');
const fakeCliPath = join(fixtureDir, 'fake-maa-cli.js');
const maaCacheDir = join(fixtureDir, 'maa-cache');
const fakeAdbPath = join(fixtureDir, 'fake-adb.js');
const cliCallLog = join(fixtureDir, 'maa-calls.log');

await mkdir(maaLogDir, { recursive: true });
await writeFile(join(maaLogDir, 'asst.log'), '');
await mkdir(maaCacheDir, { recursive: true });
await mkdir(join(xdgConfigHome, 'maa'), { recursive: true });

await writeFile(fakeCliPath, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'dir') {
  const dirs = {
    cache: process.env.FAKE_MAA_CACHE_DIR,
    log: process.env.FAKE_MAA_LOG_DIR,
    config: process.env.FAKE_MAA_CONFIG_DIR,
    resource: process.env.FAKE_MAA_RESOURCE_DIR
  };
  process.stdout.write(dirs[args[1]] || '');
  process.exit(0);
}
fs.appendFileSync(process.env.FAKE_MAA_LOG, args.join(' ') + '\\n');
if (args[0] === 'run') {
  const path = require('node:path');
  const taskFile = path.join(process.env.FAKE_MAA_CONFIG_DIR, 'tasks', args[1] + '.toml');
  if (fs.existsSync(taskFile)) {
    const taskContent = fs.readFileSync(taskFile, 'utf8');
    fs.appendFileSync(process.env.FAKE_MAA_TASK_LOG, taskContent + '\\n');
    if (taskContent.includes('type = "FailTask"')) {
      process.stderr.write('fake task failure\\n');
      process.exit(3);
    }
  }
}
if (args[0] === 'fight' && args[1] === 'FAIL-FIGHT') {
  process.stderr.write('fake fight failure\\n');
  process.exit(7);
}
const finish = () => {
  if (process.env.FAKE_MAA_CALLBACK) {
    const path = require('node:path');
    fs.appendFileSync(path.join(process.env.FAKE_MAA_LOG_DIR, 'asst.log'), process.env.FAKE_MAA_CALLBACK + '\\n');
  }
  process.stdout.write('fake output\\n');
  process.exit(Number(process.env.FAKE_MAA_EXIT_CODE || 0));
};
if (process.env.FAKE_MAA_EARLY_CALLBACK) {
  const path = require('node:path');
  fs.appendFileSync(path.join(process.env.FAKE_MAA_LOG_DIR, 'asst.log'), process.env.FAKE_MAA_EARLY_CALLBACK + '\\n');
}
const delay = Number(process.env.FAKE_MAA_SLEEP_MS || 0);
if (delay > 0) {
  setTimeout(finish, delay);
} else {
  finish();
}
`, { mode: 0o755 });

await writeFile(fakeAdbPath, `#!${process.execPath}
process.stdout.write('Android Debug Bridge version 1.0.41\\n');
`, { mode: 0o755 });

process.env.MAA_CLI_PATH = fakeCliPath;
process.env.ADB_PATH = fakeAdbPath;
process.env.FAKE_MAA_LOG = cliCallLog;
process.env.FAKE_MAA_TASK_LOG = join(fixtureDir, 'task-files.log');
process.env.MAA_CACHE_DIR = maaCacheDir;
process.env.FAKE_MAA_CACHE_DIR = maaCacheDir;
process.env.FAKE_MAA_LOG_DIR = maaLogDir;
process.env.FAKE_MAA_CONFIG_DIR = join(xdgConfigHome, 'maa');
process.env.FAKE_MAA_RESOURCE_DIR = join(xdgDataHome, 'maa', 'resource');
process.env.XDG_DATA_HOME = xdgDataHome;
process.env.XDG_STATE_HOME = xdgStateHome;
process.env.XDG_CONFIG_HOME = xdgConfigHome;
process.env.LA_PLUMA_AGENT_RUN_STORE = join(fixtureDir, 'agent-runs.json');
process.env.LA_PLUMA_MAA_LOCK_FILE = join(fixtureDir, 'maa-execution.lock');
process.env.LA_PLUMA_WEBRTC_DIR = join(fixtureDir, 'webrtc');
process.env.LA_PLUMA_WEBRTC_ICE_SERVERS = '';
process.env.LA_PLUMA_COPILOT_PROGRESS_STORE = join(fixtureDir, 'copilot-progress.json');

const { createLaPlumaApp } = await import('../app.ts');
const { listAgentRuns } = await import('../services/agentRunService.ts');
const {
  getRoguelikeProgress,
  resetRoguelikeProgressTrackerForTests
} = await import('../services/roguelikeProgressTrackerService.ts');
const { WEBRTC_SIGNALING_PATH } = await import('../services/webrtcSignalingGateway.ts');
const { loggerManager } = await import('../utils/logger.ts');

// 真实 HTTP 用例会触发服务日志；控制台输出关闭，避免门禁输出被诊断行淹没。
for (const loggerName of ['Api', 'MaaService', 'AgentRoutes', 'Scheduler', 'AgentRunService']) {
  loggerManager.getLogger(loggerName).enableConsole = false;
}

const servers: Server[] = [];

interface RoguelikeBlackFlowPayload {
  floor: number | null;
  currentNode: { id: string; name: string | null; type: string | null } | null;
  actionPoints: { before: number | null; after: number | null; at: string | null } | null;
  lastRoute: { target: { id: string; name: string | null; type: string | null } | null } | null;
  strategy: { profile: string | null; outcome: string | null } | null;
}

interface RoguelikeProgressPayload {
  command: string;
  theme: string;
  phase: string;
  currentRound: number | null;
  targetRounds: number | null;
  roundsStarted: number;
  roundsEnded: number;
  roundsSettled: number;
  roundsPassed: number;
  settlementSupported: boolean | null;
  observed: boolean;
  degraded: boolean;
  blackflow?: RoguelikeBlackFlowPayload | null;
}

interface RunProgressPayload {
  message: string;
  currentTask: string | null;
  roguelike?: RoguelikeProgressPayload;
}

interface RunSnapshotPayload {
  run: { runId: string; state: string; progress?: RunProgressPayload } | null;
  activeRuns: Array<{ runId: string }>;
  lastRun?: {
    runId: string;
    result?: { summary?: RunSummaryPayload };
  } | null;
}

interface RunSummaryPayload {
  command: string;
  theme: string;
  status: string;
  observed: boolean;
  message: string;
  settlement: { floor: number | null; step: number | null; score: number | null } | null;
  progress?: RoguelikeProgressPayload | null;
}

interface RunLookupPayload {
  runId: string;
  state: string;
  result?: {
    actions?: Array<{ status: string; observed: boolean }>;
    tasks?: Array<{ index: number; name: string; status: string; stdout: string; stderr: string }>;
    summary?: RunSummaryPayload;
  };
  error?: {
    code: string;
    details: {
      actions?: Array<{ status: string }>;
      tasks?: Array<{ index: number; name: string; status: string; stdout: string; stderr: string }>;
      summary?: RunSummaryPayload;
    };
  };
}

interface DryRunPlanPayload {
  dryRun?: boolean;
  plan: unknown;
}

interface ErrorPayload {
  code?: string;
}

interface TaskExecutorPayload {
  runId: string;
  run: { state: string };
}

interface FightExecutorPayload extends TaskExecutorPayload {
  plan: { stages: Array<{ args: string[] }> };
  stages: Array<{ stage: string; status: string; stdout: string; stderr: string }>;
  stdout: string;
}

function isApiSuccess(value: unknown): value is ApiSuccessResponse<unknown> {
  return typeof value === 'object'
    && value !== null
    && (value as { success?: unknown }).success === true;
}

function isApiError(value: unknown): value is ApiErrorResponse {
  return typeof value === 'object'
    && value !== null
    && (value as { success?: unknown }).success === false;
}

async function readSuccess<T>(response: Response): Promise<ApiSuccessResponse<T>> {
  const body: unknown = await response.json();
  assert.ok(isApiSuccess(body), `unexpected API envelope: ${JSON.stringify(body)}`);
  return body as ApiSuccessResponse<T>;
}

async function readError(response: Response): Promise<ApiErrorResponse> {
  const body: unknown = await response.json();
  assert.ok(isApiError(body));
  return body;
}

function stubSignalingGateway(): WebrtcSignalingGateway {
  return {
    proxyPath: WEBRTC_SIGNALING_PATH,
    async handleLogin(_request, response) {
      response.json({ token: 'stub' });
    },
    async handleUpgrade() {},
    attach() {},
    close() {}
  };
}

async function listen(app: ReturnType<typeof createLaPlumaApp>): Promise<number> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

function authorizedHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: 'Bearer api-secret', ...extra };
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authorizedHeaders(headers) },
    body: JSON.stringify(body)
  });
}

async function callCliLog(): Promise<string> {
  return await readFile(cliCallLog, 'utf-8').catch(() => '');
}

async function waitForFightCalls(count: number, timeoutMs = 8000): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const calls = (await callCliLog()).split('\n').filter(line => line.startsWith('fight '));
    if (calls.length >= count) return calls;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`fight CLI calls did not reach ${count} before timeout`);
}

async function waitForRunState(
  baseUrl: string,
  runId: string,
  states: readonly string[],
  timeoutMs = 8000
): Promise<RunLookupPayload> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/agent/runs/${runId}`, {
      headers: authorizedHeaders()
    });
    if (response.ok) {
      const body = await readSuccess<RunLookupPayload>(response);
      if (states.includes(body.data.state)) return body.data;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`run ${runId} did not reach ${states.join('/')} before timeout`);
}

async function waitForRoguelikeProgress(
  baseUrl: string,
  runId: string,
  predicate: (progress: RoguelikeProgressPayload) => boolean,
  timeoutMs = 8000
): Promise<{ run: { runId: string; state: string; progress?: RunProgressPayload } }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/agent/runs/current`, {
      headers: authorizedHeaders()
    });
    if (response.ok) {
      const body = await readSuccess<RunSnapshotPayload>(response);
      const run = body.data.run;
      if (run?.runId === runId && run.progress?.roguelike && predicate(run.progress.roguelike)) {
        return { run };
      }
    }
    await new Promise<void>(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`run ${runId} did not expose the expected roguelike progress before timeout`);
}

async function currentSnapshot(baseUrl: string): Promise<RunSnapshotPayload> {
  const response = await fetch(`${baseUrl}/api/agent/runs/current`, {
    headers: authorizedHeaders()
  });
  return (await readSuccess<RunSnapshotPayload>(response)).data;
}

async function waitForProgressRelease(runId: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getRoguelikeProgress(runId) === null) return;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`roguelike progress tracker for ${runId} was not released before timeout`);
}

afterEach(async () => {
  delete process.env.FAKE_MAA_SLEEP_MS;
  delete process.env.FAKE_MAA_CALLBACK;
  delete process.env.FAKE_MAA_EARLY_CALLBACK;
  delete process.env.FAKE_MAA_EXIT_CODE;
  resetRoguelikeProgressTrackerForTests();
  while (servers.length) {
    const server = servers.pop();
    assert.ok(server);
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  await writeFile(cliCallLog, '', 'utf-8').catch(() => {});
});

after(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

describe('agent execution HTTP adapter', () => {
  it('executes both game task types and preserves their actual outcomes in foreground and background Runs', async () => {
    const port = await listen(createLaPlumaApp({ env: {}, signalingGateway: stubSignalingGateway() }));
    const baseUrl = `http://127.0.0.1:${port}`;
    const scenarios = [
      {
        config: { name: '游戏内培养', type: 'OperProgress', params: { plans: [{ name: '阿米娅', role: 'Caster', elite: 2 }] } },
        callback: 'SubTaskExtraInfo {"taskchain":"OperProgress","what":"OperProgressSummary","details":{"success":1,"failed":0,"skipped":0}}',
        state: 'succeeded', status: 'success'
      },
      {
        config: { name: '游戏内培养', type: 'OperProgress', params: { plans: [{ name: '阿米娅', elite: 2 }] } },
        callback: 'SubTaskExtraInfo {"taskchain":"OperProgress","what":"OperProgressSummary","details":{"success":1,"failed":1,"skipped":0}}',
        state: 'failed', status: 'failed'
      },
      {
        config: { name: '游戏主题', type: 'SwitchTheme', params: { themes: ['默认'] } },
        callback: 'SubTaskCompleted {"taskchain":"SwitchTheme","details":{"task":"SwitchThemeByNameConfirmTheme"}}',
        state: 'succeeded', status: 'success'
      },
      {
        config: { name: '游戏主题', type: 'SwitchTheme', params: { themes: [] } },
        callback: 'SubTaskExtraInfo {"taskchain":"SwitchTheme","what":"SwitchThemeSkipped"}',
        state: 'succeeded', status: 'skipped'
      }
    ];
    for (const waitForCompletion of [true, false]) {
      for (const scenario of scenarios) {
        process.env.FAKE_MAA_CALLBACK = `Assistant::append_callback | ${scenario.callback}`;
        process.env.FAKE_MAA_SLEEP_MS = waitForCompletion ? '0' : '75';
        const response = await postJson(`${baseUrl}/api/agent/actions/run-task`, {
          command: 'run', args: ['game-task'], taskConfig: scenario.config, waitForCompletion,
          taskName: scenario.config.name, taskType: 'automation'
        });
        let runId: string;
        if (waitForCompletion && scenario.state === 'failed') {
          assert.equal(response.status, 422);
          const body = await readError(response);
          assert.equal(body.error.code, 'AGENT_GAME_TASK_FAILED');
          runId = String(body.error.details.runId);
        } else {
          assert.equal(response.status, waitForCompletion ? 200 : 202);
          runId = (await readSuccess<TaskExecutorPayload>(response)).data.runId;
        }
        const terminal = await waitForRunState(baseUrl, runId, [scenario.state]);
        assert.equal(terminal.state, scenario.state);
        if (scenario.state === 'failed') {
          assert.equal(terminal.error?.code, 'AGENT_GAME_TASK_FAILED');
          assert.equal(terminal.error?.details.actions?.[0].status, 'failed');
        } else {
          assert.equal(terminal.result?.actions?.[0].status, scenario.status);
          assert.equal(terminal.result?.actions?.[0].observed, true);
        }
      }
    }
    const submittedTasks = await readFile(process.env.FAKE_MAA_TASK_LOG || '', 'utf8');
    assert.match(submittedTasks, /type = "OperProgress"/);
    assert.match(submittedTasks, /plans = \[\{ "name" = "阿米娅"/);
    assert.match(submittedTasks, /type = "SwitchTheme"/);
  });

  it('passes the connected profile client type to generated dynamic task files', async () => {
    const profileDir = join(process.env.FAKE_MAA_CONFIG_DIR || '', 'profiles');
    const profilePath = join(profileDir, 'default.toml');
    await mkdir(profileDir, { recursive: true });
    await writeFile(profilePath, '[connection]\nclient_type = "YoStarEN"\n', 'utf-8');
    try {
      const port = await listen(createLaPlumaApp({ env: {}, signalingGateway: stubSignalingGateway() }));
      const response = await postJson(`http://127.0.0.1:${port}/api/agent/actions/run-task`, {
        command: 'run',
        taskConfig: { name: '领取奖励', type: 'Award', params: { award: true } },
        waitForCompletion: true
      });
      assert.equal(response.status, 200);
      await readSuccess(response);
      const submittedTasks = await readFile(process.env.FAKE_MAA_TASK_LOG || '', 'utf8');
      assert.match(submittedTasks, /^client_type = "YoStarEN"$/m);
    } finally {
      await rm(profilePath, { force: true });
    }
  });

  it('executes ordered dynamic tasks and archives every result under result.tasks', async () => {
    const port = await listen(createLaPlumaApp({ env: {}, signalingGateway: stubSignalingGateway() }));
    const baseUrl = `http://127.0.0.1:${port}`;
    const tasks = [
      { name: '领取奖励', type: 'Award', params: { award: true } },
      {
        name: '基建换班',
        type: 'Infrast',
        params: { mode: 10000 },
        strategy: 'merge',
        variants: [
          { condition: { type: 'Time', start: '18:00:00' }, params: { plan_index: 0 } },
          { params: { plan_index: 1 } }
        ]
      }
    ];

    for (const waitForCompletion of [true, false]) {
      const response = await postJson(`${baseUrl}/api/agent/actions/run-task`, {
        command: 'run',
        args: ['multi'],
        taskConfig: { tasks },
        waitForCompletion
      });
      assert.equal(response.status, waitForCompletion ? 200 : 202);
      const submission = await readSuccess<TaskExecutorPayload>(response);
      const terminal = await waitForRunState(baseUrl, submission.data.runId, ['succeeded']);
      assert.equal(terminal.state, 'succeeded');
      assert.deepEqual(terminal.result?.tasks?.map(step => [step.index, step.name, step.status]), [
        [0, '领取奖励', 'success'],
        [1, '基建换班', 'success']
      ]);
    }

    const submittedTasks = await readFile(process.env.FAKE_MAA_TASK_LOG || '', 'utf8');
    assert.match(submittedTasks, /strategy = "merge"/);
    assert.match(submittedTasks, /\[\[tasks\.variants\]\]/);
    assert.match(submittedTasks, /condition = \{ "type" = "Time"/);
  });

  it('keeps per-task results when a later task fails', async () => {
    const port = await listen(createLaPlumaApp({ env: {}, signalingGateway: stubSignalingGateway() }));
    const baseUrl = `http://127.0.0.1:${port}`;
    const response = await postJson(`${baseUrl}/api/agent/actions/run-task`, {
      command: 'run',
      args: ['multi-fail'],
      taskConfig: {
        tasks: [
          { name: '领取奖励', type: 'Award', params: {} },
          { name: '失败任务', type: 'FailTask', params: {} },
          { name: '仓库识别', type: 'Depot', params: {} }
        ]
      }
    });

    assert.equal(response.status, 500);
    const body = await readError(response);
    assert.equal(body.error.code, 'AGENT_DYNAMIC_TASKS_FAILED');
    const details = body.error.details as {
      runId?: unknown;
      tasks?: Array<{ index: number; name: string; status: string }>;
    };
    assert.deepEqual(details.tasks?.map(step => step.status), ['success', 'failed', 'success']);
    assert.equal(details.tasks?.[0].name, '领取奖励');
    assert.equal(details.tasks?.[2].name, '仓库识别');

    const terminal = await waitForRunState(baseUrl, String(details.runId), ['failed']);
    assert.equal(terminal.error?.code, 'AGENT_DYNAMIC_TASKS_FAILED');
    assert.deepEqual(terminal.error?.details.tasks?.map(step => step.status), ['success', 'failed', 'success']);
  });

  it('stops a multi-task background run without starting later tasks', async () => {
    process.env.FAKE_MAA_SLEEP_MS = '500';
    const port = await listen(createLaPlumaApp({ env: {}, signalingGateway: stubSignalingGateway() }));
    const baseUrl = `http://127.0.0.1:${port}`;
    const submit = await postJson(`${baseUrl}/api/agent/actions/run-task`, {
      command: 'run',
      args: ['multi-stop'],
      taskConfig: {
        tasks: [
          { name: '领取奖励', type: 'Award', params: {} },
          { name: '仓库识别', type: 'Depot', params: {} }
        ]
      },
      waitForCompletion: false
    });
    assert.equal(submit.status, 202);
    const runId = (await readSuccess<TaskExecutorPayload>(submit)).data.runId;

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const calls = (await callCliLog()).split('\n').filter(line => line.startsWith('run '));
      if (calls.length >= 1) break;
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    }

    const stop = await postJson(`${baseUrl}/api/agent/actions/stop`, { runId });
    assert.equal(stop.status, 200);
    const terminal = await waitForRunState(baseUrl, runId, ['stopped']);
    assert.deepEqual(terminal.result?.tasks?.map(step => step.status), ['stopped', 'pending']);

    await new Promise<void>(resolve => setTimeout(resolve, 200));
    const runCalls = (await callCliLog()).split('\n').filter(line => line.startsWith('run '));
    assert.equal(runCalls.length, 1, 'remaining tasks must not start after stop');
  });

  it('requires the API token before parsing any execution entry', async () => {
    const port = await listen(createLaPlumaApp({
      env: { LA_PLUMA_TOKEN: 'api-secret' },
      signalingGateway: stubSignalingGateway(),
      loginRateLimit: { maxAuthFailures: 100 }
    }));
    const baseUrl = `http://127.0.0.1:${port}`;
    const executionRoutes: ReadonlyArray<readonly [string, string]> = [
      ['/api/agent/copilot-sets/42/execute', JSON.stringify({ mode: 'continuous' })],
      ['/api/agent/actions/continue-copilot-set', JSON.stringify({ runId: 'unknown-run' })],
      ['/api/agent/schedules/manual/execute', JSON.stringify({ taskFlow: [] })],
      ['/api/agent/actions/start-game', JSON.stringify({})],
      ['/api/agent/actions/run-daily-flow', JSON.stringify({ dryRun: true })],
      ['/api/agent/actions/fight', JSON.stringify({ stage: '1-7' })],
      ['/api/agent/actions/run-task', JSON.stringify({ command: 'startup' })],
      ['/api/agent/actions/stop', JSON.stringify({ runId: 'unknown-run' })]
    ];

    for (const [path, body] of executionRoutes) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body
      });
      assert.equal(response.status, 401, `${path} must require the API token`);
      const payload = await readError(response);
      assert.equal(payload.error.code, 'AGENT_AUTH_REQUIRED');
    }

    assert.equal(await callCliLog(), '');
  });

  it('rejects malformed bodies with the existing codes before creating a run or spawn', async () => {
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;
    const invalidRequests: ReadonlyArray<readonly [string, unknown, string]> = [
      ['/api/agent/copilot-sets/42/execute', { mode: 'auto' }, 'AGENT_VALIDATION_COPILOT_SET_MODE_INVALID'],
      ['/api/agent/copilot-sets/42/execute', { selectedIndexes: [-1] }, 'AGENT_VALIDATION_COPILOT_SET_SELECTION_INVALID'],
      ['/api/agent/actions/continue-copilot-set', {}, 'AGENT_VALIDATION_RUN_ID_INVALID'],
      ['/api/agent/schedules/manual/execute', { taskFlow: {} }, 'AGENT_VALIDATION_TASK_FLOW_INVALID'],
      ['/api/agent/schedules/manual/execute', { taskFlow: [], waitForCompletion: 'false' }, 'AGENT_VALIDATION_WAIT_FOR_COMPLETION_INVALID'],
      ['/api/agent/actions/start-game', { waitForCompletion: 'later' }, 'AGENT_VALIDATION_WAIT_FOR_COMPLETION_INVALID'],
      ['/api/agent/actions/run-daily-flow', { dryRun: 'false' }, 'AGENT_VALIDATION_DRY_RUN_INVALID'],
      ['/api/agent/actions/run-daily-flow', { taskFlow: {} }, 'AGENT_VALIDATION_TASK_FLOW_INVALID'],
      ['/api/agent/actions/fight', {}, 'AGENT_VALIDATION_MISSING_STAGES'],
      ['/api/agent/actions/run-task', {
        command: 'run',
        taskConfig: { name: '游戏内培养', type: 'OperProgress', params: { plans: [] } }
      }, 'AGENT_VALIDATION_TASK_CONFIG_INVALID'],
      ['/api/agent/actions/run-task', {
        command: 'run',
        taskConfig: { name: '游戏内培养', type: 'OperProgress', params: { plans: [{ name: '阿米娅' }] } }
      }, 'AGENT_VALIDATION_TASK_CONFIG_INVALID'],
      ['/api/agent/actions/run-task', {
        command: 'run',
        taskConfig: { name: '动态任务', type: 42 }
      }, 'AGENT_VALIDATION_TASK_CONFIG_INVALID'],
      ['/api/agent/actions/run-task', {
        command: 'run',
        taskConfig: { name: '动态任务', type: 'Bad Type' }
      }, 'AGENT_VALIDATION_TASK_TYPE_INVALID'],
      ['/api/agent/actions/run-task', {
        command: 'run',
        taskConfig: { tasks: [] }
      }, 'AGENT_VALIDATION_TASK_CONFIG_INVALID'],
      ['/api/agent/actions/run-task', {
        command: 'run',
        taskConfig: { tasks: [{ name: '动态任务', type: 'Award', condition: { type: 'Time' } }] }
      }, 'AGENT_VALIDATION_TASK_CONFIG_INVALID'],
      ['/api/agent/actions/run-task', {
        command: 'run',
        taskConfig: { tasks: [{ name: '动态任务', type: 'Award', strategy: 'all' }] }
      }, 'AGENT_VALIDATION_TASK_CONFIG_INVALID'],
      ['/api/agent/actions/run-task', {
        command: 'fight',
        taskConfig: { name: '动态任务', type: 'Award' }
      }, 'AGENT_VALIDATION_COMMAND_COMBINATION_INVALID'],
      ['/api/agent/actions/run-task', {
        command: 'run',
        userResource: true
      }, 'AGENT_VALIDATION_COMMAND_COMBINATION_INVALID'],
      ['/api/agent/actions/stop', { runId: 42 }, 'AGENT_VALIDATION_RUN_ID_INVALID']
    ];

    const runCountBefore = listAgentRuns({ operationId: 'run_task' }).length;
    for (const [path, body, code] of invalidRequests) {
      const response = await postJson(`${baseUrl}${path}`, body);
      assert.equal(response.status, 400, `${path} must reject malformed input`);
      const payload = await readError(response);
      assert.equal(payload.error.code, code, `${path} error code`);
    }
    assert.equal(
      listAgentRuns({ operationId: 'run_task' }).length,
      runCountBefore,
      'invalid requests must not create run records'
    );

    const snapshot = await fetch(`${baseUrl}/api/agent/runs/current`, {
      headers: authorizedHeaders()
    });
    const snapshotBody = await readSuccess<RunSnapshotPayload>(snapshot);
    assert.equal(snapshotBody.data.run, null);
    assert.deepEqual(snapshotBody.data.activeRuns, []);
    assert.equal(await callCliLog(), '');
  });

  it('returns the unified error envelope for unknown runs and invalid JSON', async () => {
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;

    const stop = await postJson(`${baseUrl}/api/agent/actions/stop`, {
      runId: '00000000-0000-4000-8000-000000000000'
    });
    assert.equal(stop.status, 404);
    assert.equal((await readError(stop)).error.code, 'AGENT_RUN_NOT_FOUND');

    const resume = await postJson(`${baseUrl}/api/agent/actions/continue-copilot-set`, {
      runId: '00000000-0000-4000-8000-000000000000'
    });
    assert.equal(resume.status, 404);
    assert.equal((await readError(resume)).error.code, 'AGENT_RUN_NOT_FOUND');

    const malformed = await fetch(`${baseUrl}/api/agent/actions/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authorizedHeaders() },
      body: '{'
    });
    assert.equal(malformed.status, 400);
    const malformedPayload = await readError(malformed);
    assert.equal(malformedPayload.error.code, 'AGENT_REQUEST_BODY_INVALID');

    assert.equal(await callCliLog(), '');
  });

  it('serves daily-flow and fight dry runs without creating a run or calling the CLI', async () => {
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;

    const dailyFlow = await postJson(`${baseUrl}/api/agent/actions/run-daily-flow`, {
      dryRun: true,
      scheduleId: 'contract-test',
      taskFlow: [{ id: 'award-1', commandId: 'award', name: '领取奖励', enabled: true }]
    });
    assert.equal(dailyFlow.status, 200);
    const dailyFlowBody = await readSuccess<DryRunPlanPayload & { scheduleId: string; totalSteps: number }>(dailyFlow);
    assert.equal(dailyFlowBody.meta.dryRun, true);
    assert.equal(dailyFlowBody.data.dryRun, true);
    assert.equal(dailyFlowBody.data.scheduleId, 'contract-test');
    assert.equal(dailyFlowBody.data.totalSteps, 1);
    assert.deepEqual(dailyFlowBody.data.plan, [{
      index: 1,
      id: 'award-1',
      name: '领取奖励',
      command: 'award',
      args: [],
      dynamicTask: false
    }]);

    const fight = await postJson(`${baseUrl}/api/agent/actions/fight`, {
      dryRun: true,
      stage: '1-7',
      times: 3
    });
    assert.equal(fight.status, 200);
    const fightBody = await readSuccess<{ plan: { command: string; args: string[]; stages: Array<{ args: string[] }> } }>(fight);
    assert.equal(fightBody.meta.dryRun, true);
    assert.equal(fightBody.data.plan.command, 'fight');
    // 缺省数值参数仍显式输出 0；dryRun 只展示计划。
    assert.deepEqual(fightBody.data.plan.args, [
      '1-7', '--times', '3', '-m', '0', '--medicine-expire-days', '0', '--stone', '0', '--series=0'
    ]);
    assert.deepEqual(fightBody.data.plan.stages.map(stage => stage.args), [fightBody.data.plan.args]);

    const snapshot = await fetch(`${baseUrl}/api/agent/runs/current`, { headers: authorizedHeaders() });
    const snapshotBody = await readSuccess<RunSnapshotPayload>(snapshot);
    assert.equal(snapshotBody.data.run, null);
    assert.equal(await callCliLog(), '');
  });

  it('accepts the legacy expiry-medicine count and rejects out-of-range fight options', async () => {
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;

    const legacy = await postJson(`${baseUrl}/api/agent/actions/fight`, {
      dryRun: true,
      stage: '1-7',
      expiringMedicine: 5
    });
    assert.equal(legacy.status, 200);
    const legacyBody = await readSuccess<{ plan: { args: string[] } }>(legacy);
    assert.deepEqual(legacyBody.data.plan.args, [
      '1-7', '-m', '0', '--expiring-medicine', '5', '--stone', '0', '--series=0'
    ]);

    const expiryDays = await postJson(`${baseUrl}/api/agent/actions/fight`, {
      dryRun: true,
      stage: '1-7',
      medicineExpireDays: 2
    });
    const expiryDaysBody = await readSuccess<{ plan: { args: string[] } }>(expiryDays);
    assert.deepEqual(expiryDaysBody.data.plan.args, [
      '1-7', '-m', '0', '--medicine-expire-days', '2', '--stone', '0', '--series=0'
    ]);

    const invalidSeries = await postJson(`${baseUrl}/api/agent/actions/fight`, {
      dryRun: true,
      stage: '1-7',
      series: 11
    });
    assert.equal(invalidSeries.status, 400);
    assert.equal((await readError(invalidSeries)).error.code, 'AGENT_VALIDATION_FIGHT_OPTIONS_INVALID');

    const invalidExpiryDays = await postJson(`${baseUrl}/api/agent/actions/fight`, {
      dryRun: true,
      stage: '1-7',
      medicineExpireDays: -1
    });
    assert.equal(invalidExpiryDays.status, 400);
    assert.match((await readError(invalidExpiryDays)).message, /medicine_expire_days/);
  });

  it('replays one idempotent task submission over real HTTP without executing twice', async () => {
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = { 'Idempotency-Key': 'http-task:replay:1' };

    const first = await postJson(`${baseUrl}/api/agent/actions/run-task`, { command: 'startup' }, headers);
    assert.equal(first.status, 200);
    const firstBody = await readSuccess<TaskExecutorPayload>(first);
    assert.equal(firstBody.data.run.state, 'succeeded');
    assert.equal(first.headers.get('Idempotency-Replayed'), 'false');
    const runId = firstBody.data.runId;

    const replay = await postJson(`${baseUrl}/api/agent/actions/run-task`, { command: 'startup' }, headers);
    assert.equal(replay.status, 200);
    const replayBody = await readSuccess<TaskExecutorPayload>(replay);
    assert.equal(replayBody.data.runId, runId);
    assert.equal(replay.headers.get('Idempotency-Replayed'), 'true');
    assert.equal(replayBody.data.run.state, 'succeeded');

    const calls = (await callCliLog()).split('\n').filter(line => line.startsWith('startup'));
    assert.equal(calls.length, 1, 'the idempotent replay must not spawn a second command');
  });

  it('executes every fight stage as its own command under one foreground run', async () => {
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;

    const response = await postJson(`${baseUrl}/api/agent/actions/fight`, {
      stages: [{ stage: '1-7', times: 3 }, { stage: 'CE-6', times: 2 }],
      medicine: 1,
      series: 1,
      waitForCompletion: true
    });
    assert.equal(response.status, 200);
    const body = await readSuccess<FightExecutorPayload>(response);
    assert.equal(body.data.run.state, 'succeeded');
    assert.deepEqual(body.data.plan.stages.map(stage => stage.args), [
      ['1-7', '--times', '3', '-m', '1', '--medicine-expire-days', '0', '--stone', '0'],
      ['CE-6', '--times', '2', '-m', '1', '--medicine-expire-days', '0', '--stone', '0']
    ]);
    assert.deepEqual(body.data.stages.map(stage => stage.status), ['success', 'success']);
    assert.equal(body.data.stdout, 'fake output\nfake output');

    const calls = (await callCliLog()).split('\n').filter(line => line.startsWith('fight '));
    assert.deepEqual(calls, [
      'fight 1-7 --times 3 -m 1 --medicine-expire-days 0 --stone 0',
      'fight CE-6 --times 2 -m 1 --medicine-expire-days 0 --stone 0'
    ]);
  });

  it('keeps a background multi-stage fight in one run until every stage settles', async () => {
    process.env.FAKE_MAA_SLEEP_MS = '20';
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;

    const response = await postJson(`${baseUrl}/api/agent/actions/fight`, {
      stages: [{ stage: '1-7', times: 3 }, { stage: 'CE-6', times: 2 }],
      medicine: 1,
      series: 1,
      waitForCompletion: false
    });
    assert.equal(response.status, 202);
    const body = await readSuccess<FightExecutorPayload>(response);
    assert.equal(body.data.run.state, 'running');

    const terminal = await waitForRunState(baseUrl, body.data.runId, ['succeeded'], 12_000);
    assert.equal(terminal.state, 'succeeded');
    const calls = await waitForFightCalls(2);
    assert.deepEqual(calls, [
      'fight 1-7 --times 3 -m 1 --medicine-expire-days 0 --stone 0',
      'fight CE-6 --times 2 -m 1 --medicine-expire-days 0 --stone 0'
    ]);
  });

  it('fails the whole run and does not start later stages when one fight stage fails', async () => {
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;

    const response = await postJson(`${baseUrl}/api/agent/actions/fight`, {
      stages: [{ stage: '1-7', times: 1 }, { stage: 'FAIL-FIGHT', times: 1 }, { stage: 'CE-6', times: 1 }],
      medicine: 1,
      series: 1,
      waitForCompletion: true
    });
    assert.equal(response.status, 500);
    const payload = await readError(response);
    assert.equal(payload.error.code, 'AGENT_RUN_FAILED');
    const run = payload.error.details?.run as { state: string; error: { details: { stage: string; stages: Array<{ stage: string; status: string }> } } };
    assert.equal(run.state, 'failed');
    assert.equal(run.error.details.stage, 'FAIL-FIGHT');
    assert.deepEqual(run.error.details.stages.map(stage => [stage.stage, stage.status]), [
      ['1-7', 'success'],
      ['FAIL-FIGHT', 'failed'],
      ['CE-6', 'pending']
    ]);

    const calls = (await callCliLog()).split('\n').filter(line => line.startsWith('fight '));
    assert.deepEqual(calls, [
      'fight 1-7 --times 1 -m 1 --medicine-expire-days 0 --stone 0',
      'fight FAIL-FIGHT --times 1 -m 1 --medicine-expire-days 0 --stone 0'
    ]);
  });

  it('stops a multi-stage fight before the next stage starts and settles the run as stopped', async () => {
    process.env.FAKE_MAA_SLEEP_MS = '20';
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;

    const started = await postJson(`${baseUrl}/api/agent/actions/fight`, {
      stages: [{ stage: '1-7', times: 3 }, { stage: 'CE-6', times: 2 }],
      medicine: 1,
      series: 1,
      waitForCompletion: false
    });
    assert.equal(started.status, 202);
    const startedBody = await readSuccess<FightExecutorPayload>(started);
    assert.equal(startedBody.data.run.state, 'running');
    await waitForFightCalls(1);

    const stopped = await postJson(`${baseUrl}/api/agent/actions/stop`, { runId: startedBody.data.runId });
    assert.equal(stopped.status, 200);
    const stoppedBody = await readSuccess<{ stopRequested: boolean; run: { state: string } }>(stopped);
    assert.equal(stoppedBody.data.stopRequested, true);

    const terminal = await waitForRunState(baseUrl, startedBody.data.runId, ['stopped'], 12_000);
    assert.equal(terminal.state, 'stopped');
    const calls = (await callCliLog()).split('\n').filter(line => line.startsWith('fight '));
    assert.deepEqual(calls, ['fight 1-7 --times 3 -m 1 --medicine-expire-days 0 --stone 0']);
  });

  it('stops the current fight stage and prevents the next stage from starting', async () => {
    process.env.FAKE_MAA_SLEEP_MS = '3000';
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;

    const started = await postJson(`${baseUrl}/api/agent/actions/fight`, {
      stages: [{ stage: '1-7', times: 3 }, { stage: 'CE-6', times: 2 }],
      medicine: 1,
      series: 1,
      waitForCompletion: false
    });
    assert.equal(started.status, 202);
    const startedBody = await readSuccess<FightExecutorPayload>(started);
    await waitForFightCalls(1);

    const stopped = await postJson(`${baseUrl}/api/agent/actions/stop`, { runId: startedBody.data.runId });
    assert.equal(stopped.status, 200);
    const terminal = await waitForRunState(baseUrl, startedBody.data.runId, ['stopped'], 12_000);
    assert.equal(terminal.state, 'stopped');

    const calls = (await callCliLog()).split('\n').filter(line => line.startsWith('fight '));
    assert.deepEqual(calls, ['fight 1-7 --times 3 -m 1 --medicine-expire-days 0 --stone 0']);
  });

  it('stops a targeted background run over real HTTP', async () => {
    process.env.FAKE_MAA_SLEEP_MS = '3000';
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;

    const started = await postJson(`${baseUrl}/api/agent/actions/run-task`, {
      command: 'startup',
      waitForCompletion: false
    });
    if (started.status !== 202) {
      const failure = await readError(started);
      assert.fail(`unexpected status ${started.status}: ${failure.message} ${failure.error.code}`);
    }
    const startedBody = await readSuccess<TaskExecutorPayload>(started);
    const runId = startedBody.data.runId;
    assert.equal(startedBody.data.run.state, 'running');
    assert.equal(started.headers.get('Location'), `/api/agent/runs/${runId}`);

    const stopped = await postJson(`${baseUrl}/api/agent/actions/stop`, { runId });
    assert.equal(stopped.status, 200);
    const stoppedBody = await readSuccess<{ stopRequested: boolean; deviceStopRequested: boolean; run: { state: string } }>(stopped);
    assert.equal(stoppedBody.data.stopRequested, true);
    assert.equal(stoppedBody.data.deviceStopRequested, true);
    assert.equal(stoppedBody.data.run.state, 'stopping');

    const terminal = await waitForRunState(baseUrl, runId, ['stopped']);
    assert.equal(terminal.state, 'stopped');

    const repeated = await postJson(`${baseUrl}/api/agent/actions/stop`, { runId });
    assert.equal(repeated.status, 200);
    const repeatedBody = await readSuccess<{ alreadyTerminal: boolean }>(repeated);
    assert.equal(repeatedBody.data.alreadyTerminal, true);
  });

  it('attaches roguelike and reclamation result summaries to foreground and background Runs', async () => {
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;
    const scenarios = [
      {
        command: 'roguelike',
        args: ['Mizuki'],
        callbacks: [
          'Assistant::append_callback | SubTaskStart {"taskchain":"Roguelike"}',
          'Assistant::append_callback | SubTaskExtraInfo {"taskchain":"Roguelike","what":"RoguelikeSettlement","details":{"floor":4,"step":23,"score":128}}',
          'Assistant::append_callback | TaskChainCompleted {"taskchain":"Roguelike"}'
        ],
        settlement: { floor: 4, step: 23, score: 128 }
      },
      {
        command: 'reclamation',
        args: ['Tales', '-C', '荧光棒'],
        callbacks: [
          'Assistant::append_callback | SubTaskStart {"taskchain":"Reclamation"}',
          'Assistant::append_callback | TaskChainCompleted {"taskchain":"Reclamation"}'
        ],
        settlement: null
      }
    ];

    for (const waitForCompletion of [true, false]) {
      for (const scenario of scenarios) {
        process.env.FAKE_MAA_CALLBACK = scenario.callbacks.join('\n');
        process.env.FAKE_MAA_SLEEP_MS = waitForCompletion ? '0' : '60';
        const response = await postJson(`${baseUrl}/api/agent/actions/run-task`, {
          command: scenario.command,
          args: scenario.args,
          waitForCompletion,
          taskType: scenario.command
        });
        assert.equal(response.status, waitForCompletion ? 200 : 202);
        const runId = (await readSuccess<TaskExecutorPayload>(response)).data.runId;
        const terminal = await waitForRunState(baseUrl, runId, ['succeeded']);

        assert.equal(terminal.result?.summary?.command, scenario.command);
        assert.equal(terminal.result?.summary?.theme, scenario.args[0]);
        assert.equal(terminal.result?.summary?.status, 'success');
        assert.equal(terminal.result?.summary?.observed, true);
        if (scenario.settlement) {
          assert.equal(terminal.result?.summary?.settlement?.floor, scenario.settlement.floor);
          assert.equal(terminal.result?.summary?.settlement?.step, scenario.settlement.step);
          assert.equal(terminal.result?.summary?.settlement?.score, scenario.settlement.score);
        } else {
          assert.equal(terminal.result?.summary?.settlement, null);
        }
      }
    }
  });

  it('projects live roguelike progress and copies the final snapshot into the terminal summary', async () => {
    process.env.FAKE_MAA_EARLY_CALLBACK = [
      'Assistant::append_callback | SubTaskExtraInfo {"taskchain":"Roguelike","what":"BlackFlowStrategyStarted","details":{"profile":"burn_with_investment"}}',
      'Assistant::append_callback | TaskChainStart {"taskchain":"Roguelike"}',
      'Assistant::append_callback | SubTaskStart {"taskchain":"Roguelike","details":{"task":"StartExplore","exec_times":1,"max_times":3}}',
      'Assistant::append_callback | SubTaskExtraInfo {"taskchain":"Roguelike","what":"BlackFlowMapSummary","details":{"run_revision":2,"map_revision":1,"observation_id":"BF-O1","floor":1,"current_node":281475010265088}}',
      'Assistant::append_callback | SubTaskExtraInfo {"taskchain":"Roguelike","what":"BlackFlowRoutingDecision","details":{"run_revision":2,"map_revision":1,"observation_id":"BF-O1","floor":1,"decision_id":"BF-D2-1","transaction_id":"BF-T2-1","profile":"burn_with_investment","source":281475010265088,"target":281475010265090,"landing":281475010265090,"node_name":"作战","node_type":"battle_normal","movement":"walk","exact_cost":1,"predicted_cost":1,"action_points_before":5,"action_points_after":4}}',
      'Assistant::append_callback | SubTaskExtraInfo {"taskchain":"Roguelike","what":"RoguelikeSettlement","details":{"game_pass":true,"floor":4,"score":128}}',
      'Assistant::append_callback | SubTaskStart {"taskchain":"Roguelike","details":{"task":"StartExplore","exec_times":2,"max_times":3}}',
      'Assistant::append_callback | TaskChainCompleted {"taskchain":"Roguelike"}'
    ].join('\n');
    process.env.FAKE_MAA_SLEEP_MS = '2000';
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;

    const response = await postJson(`${baseUrl}/api/agent/actions/run-task`, {
      command: 'roguelike',
      args: ['Mizuki', '--start-count', '3', '--mode', '0'],
      waitForCompletion: false,
      taskType: 'roguelike'
    });
    assert.equal(response.status, 202);
    const runId = (await readSuccess<TaskExecutorPayload>(response)).data.runId;

    const live = await waitForRoguelikeProgress(
      baseUrl,
      runId,
      progress => progress.roundsStarted === 2 && progress.currentRound === 2
    );
    assert.equal(live.run.progress?.message, '集成战略执行中');
    assert.equal(typeof live.run.progress?.currentTask, 'string');
    const liveProgress = live.run.progress?.roguelike;
    assert.ok(liveProgress);
    assert.equal(liveProgress.command, 'roguelike');
    assert.equal(liveProgress.theme, 'Mizuki');
    assert.equal(liveProgress.targetRounds, 3);
    assert.equal(liveProgress.settlementSupported, true);
    assert.equal(liveProgress.roundsSettled, 1);
    assert.equal(liveProgress.roundsPassed, 1);
    assert.equal(liveProgress.observed, true);
    assert.equal(liveProgress.blackflow?.floor, 1);
    assert.deepEqual(liveProgress.blackflow?.currentNode, {
      id: '281475010265088',
      name: null,
      type: null
    });
    assert.deepEqual(liveProgress.blackflow?.actionPoints, {
      before: 5,
      after: 4,
      at: null
    });
    assert.deepEqual(liveProgress.blackflow?.lastRoute?.target, {
      id: '281475010265090',
      name: '作战',
      type: 'battle_normal'
    });
    assert.equal(liveProgress.blackflow?.strategy?.profile, 'burn_with_investment');

    const terminal = await waitForRunState(baseUrl, runId, ['succeeded'], 12_000);
    assert.equal(terminal.result?.summary?.progress?.roundsStarted, 2);
    assert.equal(terminal.result?.summary?.progress?.roundsSettled, 1);
    assert.equal(terminal.result?.summary?.progress?.targetRounds, 3);
    assert.equal(terminal.result?.summary?.progress?.settlementSupported, true);
    assert.equal(terminal.result?.summary?.progress?.blackflow?.floor, 1);
    assert.deepEqual(terminal.result?.summary?.progress?.blackflow?.lastRoute?.target, {
      id: '281475010265090',
      name: '作战',
      type: 'battle_normal'
    });

    const snapshot = await currentSnapshot(baseUrl);
    assert.equal(snapshot.lastRun?.runId, runId);
    assert.equal(snapshot.lastRun?.result?.summary?.progress?.roundsStarted, 2);
    await waitForProgressRelease(runId);
  });

  it('reads CLI target flags in the equals form', async () => {
    process.env.FAKE_MAA_EARLY_CALLBACK = [
      'Assistant::append_callback | TaskChainStart {"taskchain":"Roguelike"}',
      'Assistant::append_callback | SubTaskStart {"taskchain":"Roguelike","details":{"task":"StartExplore","exec_times":1}}'
    ].join('\n');
    process.env.FAKE_MAA_SLEEP_MS = '3000';
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;

    const startRun = async (args: string[]): Promise<string> => {
      const response = await postJson(`${baseUrl}/api/agent/actions/run-task`, {
        command: 'roguelike',
        args,
        waitForCompletion: false,
        taskType: 'roguelike'
      });
      assert.equal(response.status, 202);
      return (await readSuccess<TaskExecutorPayload>(response)).data.runId;
    };

    const measuredRunId = await startRun(['Phantom', '--start-count=3', '--mode=0']);
    const measured = await waitForRoguelikeProgress(
      baseUrl,
      measuredRunId,
      progress => progress.observed
    );
    assert.equal(measured.run.progress?.roguelike?.targetRounds, 3);
    assert.equal(measured.run.progress?.roguelike?.settlementSupported, true);

    const stopMeasured = await postJson(`${baseUrl}/api/agent/actions/stop`, { runId: measuredRunId });
    assert.equal(stopMeasured.status, 200);
    await waitForRunState(baseUrl, measuredRunId, ['stopped']);
    await waitForProgressRelease(measuredRunId);

    const unboundedRunId = await startRun(['Phantom', '--starts-count=2147483647', '--mode=0']);
    const unbounded = await waitForRoguelikeProgress(
      baseUrl,
      unboundedRunId,
      progress => progress.observed
    );
    assert.equal(unbounded.run.progress?.roguelike?.targetRounds, null);
    assert.equal(unbounded.run.progress?.roguelike?.settlementSupported, true);

    const stopUnbounded = await postJson(`${baseUrl}/api/agent/actions/stop`, { runId: unboundedRunId });
    assert.equal(stopUnbounded.status, 200);
    await waitForRunState(baseUrl, unboundedRunId, ['stopped']);
    await waitForProgressRelease(unboundedRunId);
  });

  it('releases roguelike progress after a stopped background run', async () => {
    process.env.FAKE_MAA_EARLY_CALLBACK = [
      'Assistant::append_callback | TaskChainStart {"taskchain":"Roguelike"}',
      'Assistant::append_callback | SubTaskStart {"taskchain":"Roguelike","details":{"task":"StartExplore","exec_times":1}}'
    ].join('\n');
    process.env.FAKE_MAA_SLEEP_MS = '3000';
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;

    const response = await postJson(`${baseUrl}/api/agent/actions/run-task`, {
      command: 'roguelike',
      args: ['Mizuki'],
      waitForCompletion: false,
      taskType: 'roguelike'
    });
    assert.equal(response.status, 202);
    const runId = (await readSuccess<TaskExecutorPayload>(response)).data.runId;
    await waitForRoguelikeProgress(baseUrl, runId, progress => progress.roundsStarted === 1);

    const stop = await postJson(`${baseUrl}/api/agent/actions/stop`, { runId });
    assert.equal(stop.status, 200);
    await waitForRunState(baseUrl, runId, ['stopped']);
    await waitForProgressRelease(runId);
  });

  it('releases roguelike progress after a failed background run and keeps the error summary', async () => {
    process.env.FAKE_MAA_EARLY_CALLBACK = [
      'Assistant::append_callback | TaskChainStart {"taskchain":"Roguelike"}',
      'Assistant::append_callback | SubTaskStart {"taskchain":"Roguelike","details":{"task":"StartExplore","exec_times":1}}'
    ].join('\n');
    process.env.FAKE_MAA_SLEEP_MS = '300';
    process.env.FAKE_MAA_EXIT_CODE = '3';
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;

    const response = await postJson(`${baseUrl}/api/agent/actions/run-task`, {
      command: 'roguelike',
      args: ['Mizuki'],
      waitForCompletion: false,
      taskType: 'roguelike'
    });
    assert.equal(response.status, 202);
    const runId = (await readSuccess<TaskExecutorPayload>(response)).data.runId;

    const terminal = await waitForRunState(baseUrl, runId, ['failed']);
    assert.equal(terminal.error?.details.summary?.progress?.roundsStarted, 1);
    await waitForProgressRelease(runId);
  });

  it('attaches roguelike and reclamation result summaries to dynamic run taskConfigs', async () => {
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;
    const roguelikeCallbacks = [
      'Assistant::append_callback | SubTaskStart {"taskchain":"Roguelike"}',
      'Assistant::append_callback | TaskChainCompleted {"taskchain":"Roguelike"}'
    ];
    const scenarios = [
      {
        taskId: 'roguelike',
        config: { name: '萨卡兹肉鸽', type: 'Roguelike', params: { theme: 'Sarkaz', mode: 10001, starts_count: 3 } },
        command: 'roguelike',
        theme: 'Sarkaz',
        targetRounds: 3,
        settlementSupported: false,
        callbacks: [
          'Assistant::append_callback | SubTaskStart {"taskchain":"Roguelike"}',
          'Assistant::append_callback | SubTaskExtraInfo {"taskchain":"Roguelike","what":"RoguelikeSettlement","details":{"floor":5,"step":31,"score":256}}',
          'Assistant::append_callback | TaskChainCompleted {"taskchain":"Roguelike"}'
        ],
        settlement: { floor: 5, step: 31, score: 256 }
      },
      {
        taskId: 'roguelike',
        config: { name: '界园肉鸽', type: 'Roguelike', params: { theme: 'JieGarden', mode: 20001, find_playTime_target: 1 } },
        command: 'roguelike',
        theme: 'JieGarden',
        targetRounds: null,
        settlementSupported: false,
        callbacks: roguelikeCallbacks,
        settlement: null
      },
      {
        taskId: 'roguelike',
        config: { name: '黑流树海', type: 'Roguelike', params: { theme: 'BlackFlow', mode: 30001 } },
        command: 'roguelike',
        theme: 'BlackFlow',
        targetRounds: null,
        settlementSupported: true,
        callbacks: roguelikeCallbacks,
        settlement: null
      },
      {
        taskId: 'roguelike',
        config: {
          name: '黑流树海 终局',
          type: 'Roguelike',
          params: {
            theme: 'BlackFlow',
            mode: 30003,
            blackflow_start_animals: [],
            blackflow_start_rewards: 0
          }
        },
        command: 'roguelike',
        theme: 'BlackFlow',
        targetRounds: null,
        settlementSupported: true,
        callbacks: roguelikeCallbacks,
        settlement: null
      },
      {
        taskId: 'reclamation',
        config: { name: '重塑锚点', type: 'Reclamation', params: { theme: 'RelaunchAnchor', mode: 16 } },
        command: 'reclamation',
        theme: 'RelaunchAnchor',
        targetRounds: null,
        settlementSupported: false,
        callbacks: [
          'Assistant::append_callback | SubTaskStart {"taskchain":"Reclamation"}',
          'Assistant::append_callback | TaskChainCompleted {"taskchain":"Reclamation"}'
        ],
        settlement: null
      },
      {
        taskId: 'roguelike',
        config: { name: '默认主题肉鸽', type: 'Roguelike', params: { mode: 0 } },
        command: 'roguelike',
        theme: '',
        targetRounds: null,
        settlementSupported: true,
        callbacks: roguelikeCallbacks,
        settlement: null
      }
    ];

    for (const waitForCompletion of [true, false]) {
      for (const scenario of scenarios) {
        process.env.FAKE_MAA_CALLBACK = scenario.callbacks.join('\n');
        process.env.FAKE_MAA_SLEEP_MS = waitForCompletion ? '0' : '60';
        const response = await postJson(`${baseUrl}/api/agent/actions/run-task`, {
          command: 'run',
          args: [scenario.taskId],
          taskConfig: scenario.config,
          taskName: scenario.config.name,
          waitForCompletion
        });
        assert.equal(response.status, waitForCompletion ? 200 : 202);
        const runId = (await readSuccess<TaskExecutorPayload>(response)).data.runId;
        const terminal = await waitForRunState(baseUrl, runId, ['succeeded']);

        assert.equal(terminal.result?.summary?.command, scenario.command);
        assert.equal(terminal.result?.summary?.theme, scenario.theme);
        assert.equal(terminal.result?.summary?.status, 'success');
        assert.equal(terminal.result?.summary?.observed, true);
        assert.equal(terminal.result?.summary?.progress?.targetRounds, scenario.targetRounds);
        assert.equal(terminal.result?.summary?.progress?.settlementSupported, scenario.settlementSupported);
        if (scenario.settlement) {
          assert.equal(terminal.result?.summary?.settlement?.floor, scenario.settlement.floor);
          assert.equal(terminal.result?.summary?.settlement?.step, scenario.settlement.step);
          assert.equal(terminal.result?.summary?.settlement?.score, scenario.settlement.score);
        } else {
          assert.equal(terminal.result?.summary?.settlement, null);
        }
      }
    }

    const submittedTasks = await readFile(process.env.FAKE_MAA_TASK_LOG || '', 'utf8');
    assert.match(submittedTasks, /type = "Roguelike"/);
    assert.match(submittedTasks, /type = "Reclamation"/);
    assert.match(submittedTasks, /theme = "Sarkaz"/);
    assert.match(submittedTasks, /find_playTime_target = 1/);
    assert.match(submittedTasks, /blackflow_start_animals = \[\]/);
    assert.match(submittedTasks, /mode = 30003/);
  });

  it('resolves dynamic target round and settlement boundaries', async () => {
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;
    process.env.FAKE_MAA_CALLBACK = [
      'Assistant::append_callback | TaskChainStart {"taskchain":"Roguelike"}',
      'Assistant::append_callback | TaskChainCompleted {"taskchain":"Roguelike"}'
    ].join('\n');
    process.env.FAKE_MAA_SLEEP_MS = '0';
    const scenarios = [
      {
        name: '缺失起点与模式',
        params: { theme: 'Phantom' },
        targetRounds: null,
        settlementSupported: null
      },
      {
        name: '合法正整数起点',
        params: { theme: 'Phantom', starts_count: 3 },
        targetRounds: 3,
        settlementSupported: null
      },
      {
        name: '无限起点哨兵',
        params: { theme: 'Phantom', starts_count: 2147483647 },
        targetRounds: null,
        settlementSupported: null
      },
      {
        name: '模式 0',
        params: { theme: 'Phantom', mode: 0 },
        targetRounds: null,
        settlementSupported: true
      },
      {
        name: '模式 1',
        params: { theme: 'Phantom', mode: 1 },
        targetRounds: null,
        settlementSupported: false
      },
      {
        name: '模式 30001',
        params: { theme: 'BlackFlow', mode: 30001 },
        targetRounds: null,
        settlementSupported: true
      },
      {
        name: '模式 30003',
        params: {
          theme: 'BlackFlow',
          mode: 30003,
          blackflow_start_animals: [],
          blackflow_start_rewards: 0
        },
        targetRounds: null,
        settlementSupported: true
      }
    ];

    for (const scenario of scenarios) {
      const response = await postJson(`${baseUrl}/api/agent/actions/run-task`, {
        command: 'run',
        args: ['roguelike'],
        taskConfig: { name: scenario.name, type: 'Roguelike', params: scenario.params },
        taskName: scenario.name,
        waitForCompletion: true
      });
      assert.equal(response.status, 200, scenario.name);
      const runId = (await readSuccess<TaskExecutorPayload>(response)).data.runId;
      const terminal = await waitForRunState(baseUrl, runId, ['succeeded']);

      assert.equal(terminal.result?.summary?.progress?.targetRounds, scenario.targetRounds, scenario.name);
      assert.equal(terminal.result?.summary?.progress?.settlementSupported, scenario.settlementSupported, scenario.name);
    }

    const runCountBefore = listAgentRuns({ operationId: 'run_task' }).length;
    const invalid = await postJson(`${baseUrl}/api/agent/actions/run-task`, {
      command: 'run',
      args: ['roguelike'],
      taskConfig: {
        name: '非法起点',
        type: 'Roguelike',
        params: { theme: 'Phantom', starts_count: 1.5 }
      },
      waitForCompletion: true
    });
    assert.equal(invalid.status, 400);
    const failure = await readError(invalid);
    assert.equal(failure.error.code, 'AGENT_VALIDATION_TASK_CONFIG_INVALID');
    assert.match(failure.message, /starts_count/);
    assert.equal(listAgentRuns({ operationId: 'run_task' }).length, runCountBefore);

    const snapshot = await currentSnapshot(baseUrl);
    assert.equal(snapshot.run, null);
    assert.deepEqual(snapshot.activeRuns, []);
  });

  it('rejects a run while the device lease is held without reusing the holder summary', async () => {
    process.env.FAKE_MAA_CALLBACK = [
      'Assistant::append_callback | SubTaskStart {"taskchain":"Roguelike"}',
      'Assistant::append_callback | SubTaskExtraInfo {"taskchain":"Roguelike","what":"RoguelikeSettlement","details":{"floor":4,"step":23,"score":128}}',
      'Assistant::append_callback | TaskChainCompleted {"taskchain":"Roguelike"}'
    ].join('\n');
    process.env.FAKE_MAA_SLEEP_MS = '1500';
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;

    const accepted = await postJson(`${baseUrl}/api/agent/actions/run-task`, {
      command: 'roguelike',
      args: ['Mizuki'],
      waitForCompletion: false,
      taskType: 'roguelike'
    });
    assert.equal(accepted.status, 202);
    const holderRunId = (await readSuccess<TaskExecutorPayload>(accepted)).data.runId;

    const rejected = await postJson(`${baseUrl}/api/agent/actions/run-task`, {
      command: 'roguelike',
      args: ['Sami'],
      waitForCompletion: true,
      taskType: 'roguelike'
    });
    assert.equal(rejected.status, 409);
    const failure = await readError(rejected);
    assert.equal(failure.error.code, 'MAA_EXECUTION_BUSY');
    const details = typeof failure.error.details === 'object' && failure.error.details !== null
      ? failure.error.details as Record<string, unknown>
      : {};
    assert.equal(details.summary, undefined);
    const rejectedRun = typeof details.run === 'object' && details.run !== null
      ? details.run as Record<string, unknown>
      : {};
    assert.equal(rejectedRun.state, 'failed');

    const holder = await waitForRunState(baseUrl, holderRunId, ['succeeded']);
    assert.equal(holder.result?.summary?.status, 'success');
    assert.deepEqual(
      (await callCliLog()).split('\n').filter(line => line.startsWith('roguelike ')),
      ['roguelike Mizuki']
    );
  });

  it('keeps dynamic run submissions outside single Roguelike/Reclamation taskConfigs free of result summaries', async () => {
    const port = await listen(createLaPlumaApp({
      env: {},
      signalingGateway: stubSignalingGateway()
    }));
    const baseUrl = `http://127.0.0.1:${port}`;
    process.env.FAKE_MAA_CALLBACK = [
      'Assistant::append_callback | SubTaskStart {"taskchain":"Roguelike"}',
      'Assistant::append_callback | SubTaskExtraInfo {"taskchain":"Roguelike","what":"RoguelikeSettlement","details":{"floor":3,"step":12,"score":64}}',
      'Assistant::append_callback | TaskChainCompleted {"taskchain":"Roguelike"}'
    ].join('\n');
    const submissions = [
      {
        args: ['award'],
        taskConfig: { name: '领取奖励', type: 'Award', params: { award: true } }
      },
      {
        args: ['multi-roguelike'],
        taskConfig: {
          tasks: [
            { name: '萨卡兹肉鸽', type: 'Roguelike', params: { theme: 'Sarkaz', mode: 10001 } },
            { name: '领取奖励', type: 'Award', params: { award: true } }
          ]
        }
      }
    ];

    for (const waitForCompletion of [true, false]) {
      for (const submission of submissions) {
        const response = await postJson(`${baseUrl}/api/agent/actions/run-task`, {
          command: 'run',
          args: submission.args,
          taskConfig: submission.taskConfig,
          waitForCompletion
        });
        assert.equal(response.status, waitForCompletion ? 200 : 202);
        const runId = (await readSuccess<TaskExecutorPayload>(response)).data.runId;
        const terminal = await waitForRunState(baseUrl, runId, ['succeeded']);
        assert.equal(terminal.result?.summary, undefined);
      }
    }
  });
});
