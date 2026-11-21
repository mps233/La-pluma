import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import type { WebrtcSignalingGateway } from '../services/webrtcSignalingGateway.ts';
import type {
  JsonSchema,
  OpenApiOperation,
  RegisteredAgentOperation
} from '../routes/agentContract.ts';

const fixtureDir = await mkdtemp(join(tmpdir(), 'la-pluma-contract-http-'));
const maaLogDir = join(fixtureDir, 'maa-logs');
const maaCacheDir = join(fixtureDir, 'maa-cache');
const xdgDataHome = join(fixtureDir, 'xdg-data');
const xdgStateHome = join(fixtureDir, 'xdg-state');
const xdgConfigHome = join(fixtureDir, 'xdg-config');
const resourceDir = join(xdgDataHome, 'maa', 'resource');
const fakeCliPath = join(fixtureDir, 'fake-maa-cli.js');
const fakeAdbPath = join(fixtureDir, 'fake-adb.js');
const cliCallLog = join(fixtureDir, 'maa-calls.log');
const adbCallLog = join(fixtureDir, 'adb-calls.log');
const userConfigDir = join(fixtureDir, 'user-configs');
const deviceAddress = '127.0.0.1:7555';
const missingRunId = '00000000-0000-4000-8000-000000000000';

// 1x1 PNG：截图用例只依赖 PNG 签名与 IHDR 宽高，不需要真实屏幕内容。
const pngBytes = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
  + '0000000a49444154789c6300010000050001',
  'hex'
);

await mkdir(maaLogDir, { recursive: true });
await mkdir(maaCacheDir, { recursive: true });
await mkdir(resourceDir, { recursive: true });
await mkdir(join(resourceDir, 'tasks', 'Stages'), { recursive: true });
await mkdir(join(xdgConfigHome, 'maa'), { recursive: true });

// 活动导航资源取本地 MAA 资源文件：预检进入 ready 后，缓存活动没有关卡列表，
// 作业发现会在查询上游之前判定 blocked，用例因此不访问 PRTS 或资源更新脚本。
await writeFile(join(resourceDir, 'tasks', 'Stages', 'TEST.json'), JSON.stringify({
  'TEST-OpenOpt': { next: ['TEST-OpenOcr'] },
  'TEST-OpenOcr': { next: ['TEST-Stage'] },
  'TEST-1': { sub: ['TEST-OpenOpt'], next: ['TEST-Stage'] }
}));

await writeFile(fakeCliPath, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'dir') {
  const dirs = {
    cache: ${JSON.stringify(maaCacheDir)},
    log: ${JSON.stringify(maaLogDir)},
    config: ${JSON.stringify(join(xdgConfigHome, 'maa'))},
    resource: ${JSON.stringify(resourceDir)}
  };
  process.stdout.write(dirs[args[1]] || '');
  process.exit(0);
}
if (args[0] === 'version') {
  process.stdout.write('maa-cli v0.7.0\\nMaaCore v6.2.3\\n');
  process.exit(0);
}
// 只记录会改动设备的命令；目录/版本/活动查询不进入副作用断言。
fs.appendFileSync(process.env.FAKE_CONTRACT_CLI_LOG, args.join(' ') + '\\n');
process.exit(0);
`, { mode: 0o755 });

await writeFile(fakeAdbPath, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_CONTRACT_ADB_LOG, args.join(' ') + '\\n');
if (args[0] === 'version') {
  process.stdout.write('Android Debug Bridge version 1.0.41\\n');
} else if (args[0] === 'devices') {
  process.stdout.write('List of devices attached\\n${deviceAddress}\\tdevice\\n');
} else if (args[0] === 'connect') {
  process.stdout.write('connected\\n');
} else if (args[0] === '-s') {
  const shellIndex = args.indexOf('shell');
  const command = shellIndex >= 0 ? args.slice(shellIndex + 1).join(' ') : '';
  if (args.includes('exec-out')) {
    process.stdout.write(Buffer.from('${pngBytes.toString('base64')}', 'base64'));
  } else if (command.startsWith('dumpsys window')) {
    process.stdout.write('mCurrentFocus=Window{1a2b3c com.example/.MainActivity}\\n');
  } else if (command.startsWith('dumpsys display')) {
    process.stdout.write('real 1080 x 1920\\nmCurrentOrientation=0\\n');
  } else if (command.startsWith('settings get')) {
    process.stdout.write('0\\n');
  } else {
    process.stdout.write('');
  }
}
`, { mode: 0o755 });

process.env.MAA_CLI_PATH = fakeCliPath;
process.env.ADB_PATH = fakeAdbPath;
process.env.FAKE_CONTRACT_CLI_LOG = cliCallLog;
process.env.FAKE_CONTRACT_ADB_LOG = adbCallLog;
process.env.MAA_CACHE_DIR = maaCacheDir;
process.env.XDG_DATA_HOME = xdgDataHome;
process.env.XDG_STATE_HOME = xdgStateHome;
process.env.XDG_CONFIG_HOME = xdgConfigHome;
process.env.LA_PLUMA_AGENT_RUN_STORE = join(fixtureDir, 'agent-runs.json');
process.env.LA_PLUMA_MAA_LOCK_FILE = join(fixtureDir, 'maa-execution.lock');
process.env.LA_PLUMA_DROP_RECORDS_DIR = join(fixtureDir, 'drop-records');
process.env.LA_PLUMA_COPILOT_PROGRESS_STORE = join(fixtureDir, 'copilot-progress.json');
process.env.LA_PLUMA_WEBRTC_DIR = join(fixtureDir, 'webrtc');
process.env.LA_PLUMA_WEBRTC_ICE_SERVERS = '';

const { WEBRTC_SIGNALING_PATH } = await import('../services/webrtcSignalingGateway.ts');
const { setConfigStorageDirForTests, saveUserConfig } = await import('../services/configStorageService.ts');
const { loggerManager } = await import('../utils/logger.ts');
const { createLaPlumaApp } = await import('../app.ts');
const { default: agentRouter } = await import('../routes/agent.ts');
const {
  AGENT_OPERATIONS,
  buildAgentManifest,
  buildOpenApiSpec
} = await import('../routes/agentContract.ts');
const { DEFAULT_ADB_ADDRESS, DEFAULT_ADB_PATH, DEFAULT_CLIENT_TYPE } = await import('../config/connectionDefaults.ts');

for (const loggerName of ['Api', 'MaaService', 'AgentRoutes', 'AgentRunService', 'Scheduler', 'DropRecord', 'DataParser']) {
  loggerManager.getLogger(loggerName).enableConsole = false;
}

// 活动缓存写进临时用户配置目录：预检与作业发现读取缓存后直接判定导航资源
// 缺失，不访问 maa activity 之外的外部数据源，也不改写仓库内的运行数据。
setConfigStorageDirForTests(userConfigDir);
const seededAt = Date.now();
await saveUserConfig('activity-cache', {
  [DEFAULT_CLIENT_TYPE]: {
    code: 'TEST',
    name: 'Contract Fixture',
    source: 'fixture',
    startTime: null,
    endTime: null,
    stages: [],
    timestamp: seededAt,
    ttl: 24 * 60 * 60 * 1000
  }
});

const serverDefaults = {
  adbPath: DEFAULT_ADB_PATH,
  adbAddress: DEFAULT_ADB_ADDRESS,
  clientType: DEFAULT_CLIENT_TYPE
};

const openApiSpec = buildOpenApiSpec(serverDefaults);
const manifest = buildAgentManifest(serverDefaults);
const operationsById = new Map<string, RegisteredAgentOperation>(AGENT_OPERATIONS.map(item => [item.id, item]));
const openApiOperationsById = new Map<string, OpenApiOperation>(
  AGENT_OPERATIONS.map(item => [item.id, openApiSpec.paths[item.path][item.method.toLowerCase()]])
);

const documentId = 'la-pluma-agent-contract';
const ajv = new Ajv2020({ strict: false, allErrors: true });
// 插件同时经 module.exports 与 exports.default 暴露；取声明的 default 导出即可调用。
addFormatsModule.default(ajv);
ajv.addSchema({ $id: documentId, components: openApiSpec.components }, documentId);
const compiledSchemas = new Map<string, ValidateFunction>();

function compileSchema(schema: JsonSchema): ValidateFunction {
  const key = schema.$ref ?? JSON.stringify(schema);
  const cached = compiledSchemas.get(key);
  if (cached) return cached;
  const target = schema.$ref
    ? { $ref: `${documentId}#${schema.$ref.slice(1)}` }
    : schema;
  const validate = ajv.compile(target);
  compiledSchemas.set(key, validate);
  return validate;
}

function schemaErrors(schema: JsonSchema, value: unknown): string {
  const validate = compileSchema(schema);
  return validate(value) ? '' : ajv.errorsText(validate.errors, { separator: '; ' });
}

function assertMatchesSchema(schema: JsonSchema, value: unknown, label: string): void {
  const errors = schemaErrors(schema, value);
  assert.equal(errors, '', `${label} must match the published schema: ${errors}`);
}

function assertViolatesSchema(schema: JsonSchema, value: unknown, label: string): void {
  const errors = schemaErrors(schema, value);
  assert.notEqual(errors, '', `${label} must be rejected by the published schema`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' || typeof value === 'function')
    && value !== null
    && !Array.isArray(value);
}

function resolvePointer(document: unknown, pointer: string): unknown {
  return pointer
    .split('/')
    .slice(1)
    .reduce<unknown>((current, segment) => {
      if (!isRecord(current)) return undefined;
      return current[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
    }, document);
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return isRecord(value);
}

function responseSchema(operation: OpenApiOperation, status: number): JsonSchema {
  const response = operation.responses[String(status)];
  assert.ok(response, `${operation.operationId} must declare status ${status}`);
  if (response.$ref) {
    const resolved = resolvePointer(openApiSpec, response.$ref);
    assert.ok(isRecord(resolved), `${operation.operationId} response ref ${response.$ref} must resolve`);
    const schema = isRecord(resolved.content)
      && isRecord(resolved.content['application/json'])
      ? resolved.content['application/json'].schema
      : undefined;
    assert.ok(isJsonSchema(schema), `${operation.operationId} ${status} must publish a JSON schema`);
    return schema;
  }
  const schema = isRecord(response.content) && isRecord(response.content['application/json'])
    ? response.content['application/json'].schema
    : undefined;
  assert.ok(isJsonSchema(schema), `${operation.operationId} ${status} must publish a JSON schema`);
  return schema;
}

interface MountedRoute {
  path: string;
  methods?: Record<string, boolean>;
  stack: unknown[];
}

function isMountedRoute(value: unknown): value is MountedRoute {
  if (!isRecord(value)) return false;
  if (typeof value.path !== 'string') return false;
  if (value.methods !== undefined && !isRecord(value.methods)) return false;
  return Array.isArray(value.stack);
}

function collectMountedRoutes(router: unknown, counts = new Map<string, number>()): Map<string, number> {
  if (!isRecord(router) || !Array.isArray(router.stack)) return counts;
  for (const layer of router.stack) {
    if (!isRecord(layer)) continue;
    if (isMountedRoute(layer.route)) {
      for (const [method, enabled] of Object.entries(layer.route.methods ?? {})) {
        if (!enabled || method === '_all') continue;
        const key = `${method.toUpperCase()} ${layer.route.path}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      continue;
    }
    collectMountedRoutes(layer.handle, counts);
  }
  return counts;
}

const mountedRoutes = collectMountedRoutes(agentRouter);

function relativeAgentPath(path: string): string {
  return path
    .replace(/^\/api\/agent/, '')
    .replace(/\{([^}]+)\}/g, ':$1');
}

interface FixtureQuery {
  [name: string]: string | number;
}

interface RequestFixture {
  operationId: string;
  query?: FixtureQuery;
  body?: unknown;
  pathParams?: Record<string, string>;
  status: number;
  expectRun?: boolean;
}

interface ValidFixture extends RequestFixture {
  note?: string;
}

const validFixtures: readonly ValidFixture[] = [
  { operationId: 'get_manifest', status: 200 },
  { operationId: 'get_openapi', status: 200 },
  { operationId: 'get_status', status: 200, query: { adbPath: fakeAdbPath, address: deviceAddress } },
  {
    operationId: 'get_diagnostics',
    status: 200,
    query: { adbPath: fakeAdbPath, address: deviceAddress, command: 'startup' }
  },
  { operationId: 'test_connection', status: 200, body: { adbPath: fakeAdbPath, address: deviceAddress } },
  { operationId: 'discover_devices', status: 200, query: { adbPath: fakeAdbPath } },
  {
    operationId: 'start_game',
    status: 200,
    body: { clientType: DEFAULT_CLIENT_TYPE, address: deviceAddress },
    expectRun: true
  },
  { operationId: 'fight', status: 200, body: { stages: ['1-7'], dryRun: true } },
  { operationId: 'run_task', status: 200, body: { command: 'reclamation', args: ['Tales', '-m', '1', '-C', '荧光棒'] }, expectRun: true },
  { operationId: 'stop_task', status: 200, body: {} },
  { operationId: 'stop_task', status: 200, body: { mode: 'after-combat' } },
  { operationId: 'get_current_run', status: 200, query: { lines: 2 } },
  { operationId: 'get_run', status: 404, pathParams: { runId: missingRunId } },
  { operationId: 'get_screenshot', status: 200, body: { adbPath: fakeAdbPath, address: deviceAddress } },
  {
    operationId: 'run_daily_flow',
    status: 200,
    body: {
      dryRun: true,
      taskFlow: [{ id: 'award-1', commandId: 'award', name: '领取奖励', enabled: true }]
    }
  },
  { operationId: 'recent_logs', status: 200, query: { lines: 2 } },
  { operationId: 'webrtc_status', status: 200, query: { adbPath: fakeAdbPath, address: deviceAddress } },
  { operationId: 'webrtc_devices', status: 200 },
  // WebRTC 组件目录为空：启动在安装检查处失败，走既有 500 错误出口。
  { operationId: 'webrtc_start', status: 500, body: { adbPath: fakeAdbPath, address: deviceAddress } },
  { operationId: 'webrtc_stop', status: 200, body: { adbPath: fakeAdbPath, address: deviceAddress } },
  { operationId: 'preview_orientation', status: 200, body: { orientation: 'portrait', dryRun: true } },
  { operationId: 'get_current_activity', status: 200, query: { clientType: DEFAULT_CLIENT_TYPE } }
];

interface ErrorFixture extends RequestFixture {
  errorCode: string;
}

const invalidFixtures: readonly ErrorFixture[] = [
  { operationId: 'get_status', status: 400, query: { profileId: 'bad id!' }, errorCode: 'AGENT_VALIDATION_PROFILE_ID_INVALID' },
  { operationId: 'test_connection', status: 400, body: { profileId: 'bad id!' }, errorCode: 'AGENT_VALIDATION_PROFILE_ID_INVALID' },
  { operationId: 'discover_devices', status: 400, query: { profileId: 'bad id!' }, errorCode: 'AGENT_VALIDATION_PROFILE_ID_INVALID' },
  { operationId: 'start_game', status: 400, body: { waitForCompletion: 'later' }, errorCode: 'AGENT_VALIDATION_WAIT_FOR_COMPLETION_INVALID' },
  { operationId: 'fight', status: 400, body: {}, errorCode: 'AGENT_VALIDATION_MISSING_STAGES' },
  { operationId: 'run_task', status: 400, body: { command: 'not-a-command' }, errorCode: 'AGENT_VALIDATION_COMMAND_NOT_ALLOWED' },
  { operationId: 'stop_task', status: 400, body: { runId: 42 }, errorCode: 'AGENT_VALIDATION_RUN_ID_INVALID' },
  { operationId: 'stop_task', status: 400, body: { mode: 'later' }, errorCode: 'AGENT_VALIDATION_STOP_MODE_INVALID' },
  { operationId: 'stop_task', status: 400, body: { mode: null }, errorCode: 'AGENT_VALIDATION_STOP_MODE_INVALID' },
  { operationId: 'get_screenshot', status: 400, body: { profileId: 'bad id!' }, errorCode: 'AGENT_VALIDATION_PROFILE_ID_INVALID' },
  { operationId: 'run_daily_flow', status: 400, body: { dryRun: 'false' }, errorCode: 'AGENT_VALIDATION_DRY_RUN_INVALID' },
  { operationId: 'webrtc_status', status: 400, query: { profileId: 'bad id!' }, errorCode: 'AGENT_VALIDATION_PROFILE_ID_INVALID' },
  { operationId: 'webrtc_start', status: 400, body: { profileId: 'bad id!' }, errorCode: 'AGENT_VALIDATION_PROFILE_ID_INVALID' },
  { operationId: 'webrtc_stop', status: 400, body: { profileId: 'bad id!' }, errorCode: 'AGENT_VALIDATION_PROFILE_ID_INVALID' },
  { operationId: 'preview_orientation', status: 400, body: { orientation: 'sideways' }, errorCode: 'AGENT_VALIDATION_ORIENTATION_INVALID' },
  { operationId: 'get_current_activity', status: 400, query: { profileId: 'bad id!' }, errorCode: 'AGENT_VALIDATION_PROFILE_ID_INVALID' }
];

interface DivergenceFixture extends RequestFixture {
  errorCode?: string;
  reason: string;
}

const divergenceFixtures: readonly DivergenceFixture[] = [
  {
    operationId: 'fight',
    status: 200,
    // 旧调用方仍可传单关卡字段；schema 只公布 stages 数组。
    body: { stage: '1-7', dryRun: true },
    reason: 'legacy single-stage fields stay accepted without being advertised'
  },
  {
    operationId: 'stop_task',
    status: 404,
    // schema 声明 format: uuid，运行时只要求非空字符串并按未知 run 返回 404。
    body: { runId: 'not-a-uuid' },
    errorCode: 'AGENT_RUN_NOT_FOUND',
    reason: 'runtime accepts any non-empty run id although the schema declares uuid'
  },
  {
    operationId: 'recent_logs',
    status: 200,
    // schema 声明 maximum 500；运行时把超界值夹取到上限而不是拒绝。
    query: { lines: 9999 },
    reason: 'out-of-range line counts are clamped instead of rejected'
  }
];

function buildRequest(baseUrl: string, operation: RegisteredAgentOperation, fixture: RequestFixture): {
  url: string;
  init: RequestInit;
} {
  let path = operation.path;
  for (const [name, value] of Object.entries(fixture.pathParams ?? {})) {
    path = path.replace(`{${name}}`, encodeURIComponent(value));
  }
  const url = new URL(path, baseUrl);
  for (const [name, value] of Object.entries(fixture.query ?? {})) {
    url.searchParams.set(name, String(value));
  }
  const init: RequestInit = { method: operation.method };
  if (fixture.body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(fixture.body);
  }
  return { url: url.toString(), init };
}

function assertRequestShape(operation: RegisteredAgentOperation, fixture: RequestFixture): void {
  if (fixture.body !== undefined) {
    assert.ok(operation.body_schema, `${operation.id} declares no body schema`);
    assertMatchesSchema(operation.body_schema, fixture.body, `${operation.id} request body`);
  }
  if (fixture.query) {
    assert.ok(operation.query_schema, `${operation.id} declares no query schema`);
    assertMatchesSchema(operation.query_schema, fixture.query, `${operation.id} request query`);
  }
  if (fixture.pathParams) {
    assert.ok(operation.path_schema, `${operation.id} declares no path schema`);
    assertMatchesSchema(operation.path_schema, fixture.pathParams, `${operation.id} request path`);
  }
}

const servers: Server[] = [];
let baseUrl = '';

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

async function listen(): Promise<void> {
  const app = createLaPlumaApp({ env: {}, signalingGateway: stubSignalingGateway() });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function cliDeviceCalls(): Promise<string[]> {
  const content = await readFile(cliCallLog, 'utf-8').catch(() => '');
  return content.split('\n').filter(Boolean);
}

before(async () => {
  await listen();
});

after(async () => {
  while (servers.length) {
    const server = servers.pop();
    assert.ok(server);
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  setConfigStorageDirForTests(null);
  await rm(fixtureDir, { recursive: true, force: true });
});

describe('Agent API contract registry and mounted routes', () => {
  it('covers every registered operation with a request fixture', () => {
    assert.deepEqual(
      [...new Set(validFixtures.map(fixture => fixture.operationId))].sort(),
      AGENT_OPERATIONS.map(operation => operation.id).sort(),
      'each registry entry needs an HTTP fixture so new operations cannot skip contract coverage'
    );
  });

  it('registers every manifest and OpenAPI operation exactly once on the mounted router', () => {
    for (const operation of AGENT_OPERATIONS) {
      const key = `${operation.method} ${relativeAgentPath(operation.path)}`;
      assert.equal(
        mountedRoutes.get(key),
        1,
        `${operation.id} must be mounted exactly once as ${key}`
      );
    }
  });

  it('detects duplicate mounts instead of collapsing them into one entry', () => {
    const duplicates = [...mountedRoutes.entries()].filter(([, count]) => count > 1);
    assert.deepEqual(duplicates, [], 'the Agent router must not declare the same method/path twice');
  });

  it('keeps Web UI-only routes mounted without forcing them into the advertised manifest', () => {
    const advertisedPaths = new Set(manifest.actions.map(action => `${action.method} ${relativeAgentPath(action.path)}`));
    const webUiOnlyRoutes = [
      'POST /webrtc/install',
      'GET /logs/files',
      'POST /logs/cleanup',
      'GET /training/operators',
      'POST /copilot-sets/:id/execute',
      'GET /device-stats',
      'GET /infrast-schedules',
      'GET /infrast-schedules/document',
      'PUT /infrast-schedules/document',
      // 以下入口的 HTTP 行为测试会触发宿主副作用或上游读取，只在这里守住挂载。
      'POST /actions/open-config-directory',
      'GET /paradox/operators',
      'POST /copilot-sets/:id/reset-progress'
    ];

    for (const key of webUiOnlyRoutes) {
      assert.equal(mountedRoutes.get(key), 1, `${key} must stay mounted for the Web UI`);
      assert.ok(!advertisedPaths.has(key), `${key} is Web UI-only and must not be advertised`);
    }
    assert.deepEqual(
      manifest.actions.map(action => action.id),
      AGENT_OPERATIONS.filter(operation => operation.advertised).map(operation => operation.id)
    );
    for (const action of manifest.actions) {
      const operation = operationsById.get(action.id);
      assert.ok(operation);
      assert.equal(action.method, operation.method);
      assert.equal(action.path, operation.path);
      assert.equal(openApiOperationsById.get(action.id)?.operationId, action.id);
    }
  });

  it('serves the manifest and OpenAPI document generated from the same registry', async () => {
    const manifestResponse = await fetch(`${baseUrl}/api/agent/manifest`);
    assert.equal(manifestResponse.status, 200);
    const manifestBody: unknown = await manifestResponse.json();
    assert.ok(isRecord(manifestBody));
    assert.deepEqual(manifestBody.data, manifest);

    const openApiResponse = await fetch(`${baseUrl}/api/agent/openapi.json`);
    assert.equal(openApiResponse.status, 200);
    const openApiBody: unknown = await openApiResponse.json();
    assert.deepEqual(openApiBody, openApiSpec);
    const documentSchema = openApiSpec.components.schemas.OpenApiDocument;
    assert.ok(documentSchema);
    assertMatchesSchema(documentSchema, openApiBody, 'served OpenAPI document');
    for (const operation of AGENT_OPERATIONS) {
      const generated = openApiOperationsById.get(operation.id);
      assert.ok(generated);
      assert.equal(generated.operationId, operation.id);
      const success = generated.responses['200']?.content?.['application/json']?.schema;
      assert.ok(success);
      compileSchema(success);
    }
  });

  it('serves the seeded activity as an explicit status snapshot', async () => {
    const response = await fetch(`${baseUrl}/api/agent/activity?clientType=${DEFAULT_CLIENT_TYPE}`);
    assert.equal(response.status, 200);
    const payload: unknown = await response.json();
    assert.ok(isRecord(payload));
    assert.equal(payload.success, true);
    const data = payload.data;
    assert.ok(isRecord(data));
    assert.equal(data.status, 'active');
    assert.equal(data.clientType, DEFAULT_CLIENT_TYPE);
    assert.equal(data.available, true);
    assert.equal(data.code, 'TEST');
    assert.equal(data.name, 'Contract Fixture');
    assert.equal(data.source, 'fixture');
    assert.equal(data.startTime, null);
    assert.equal(data.endTime, null);
    assert.deepEqual(data.stages, []);
    assert.equal(data.lastSuccessAt, seededAt);
    assert.equal(data.dataUpdatedAt, null);
    assert.equal(data.failure, null);
    assert.equal(data.message, '当前活动: Contract Fixture');
    assert.ok(isRecord(data.completion));
    assert.equal(data.completion.known, false);
  });

  it('reports an unavailable activity without mapping an unsupported client to CN', async () => {
    const response = await fetch(`${baseUrl}/api/agent/activity?clientType=Txwy`);
    assert.equal(response.status, 200);
    const payload: unknown = await response.json();
    assert.ok(isRecord(payload));
    assert.equal(payload.success, true);
    const data = payload.data;
    assert.ok(isRecord(data));
    assert.equal(data.status, 'unavailable');
    assert.equal(data.clientType, 'Txwy');
    assert.equal(data.available, false);
    assert.equal(data.code, null);
    assert.equal(data.name, null);
    assert.equal(data.lastSuccessAt, null);
    assert.ok(isRecord(data.failure));
    assert.equal(data.failure.source, 'maa');
    assert.match(String(data.failure.message), /备用活动数据源不支持 Txwy/);
    assert.match(String(data.message), /^无法获取活动信息: /);
  });
});

describe('advertised operations over real HTTP', () => {
  for (const fixture of validFixtures) {
    it(`matches the declared request/response contract for ${fixture.operationId}`, async () => {
      const operation = operationsById.get(fixture.operationId);
      assert.ok(operation, `unknown operation ${fixture.operationId}`);
      const generated = openApiOperationsById.get(fixture.operationId);
      assert.ok(generated);
      assertRequestShape(operation, fixture);

      const request = buildRequest(baseUrl, operation, fixture);
      const response = await fetch(request.url, request.init);
      const payload: unknown = await response.json();

      assert.equal(
        response.status,
        fixture.status,
        `${operation.method} ${operation.path} returned ${response.status}: ${JSON.stringify(payload)}`
      );
      assertMatchesSchema(
        responseSchema(generated, response.status),
        payload,
        `${fixture.operationId} ${response.status} response`
      );

      if (fixture.expectRun) {
        assert.equal(response.status, 200);
        assert.match(response.headers.get('x-la-pluma-run-id') ?? '', /^[0-9a-f-]{36}$/i);
        assert.ok(['true', 'false'].includes(response.headers.get('idempotency-replayed') ?? ''));
      }
    });
  }

  it('rejects schema-invalid requests with the declared error envelope before device side effects', async () => {
    const callsBefore = (await cliDeviceCalls()).length;

    for (const fixture of invalidFixtures) {
      const operation = operationsById.get(fixture.operationId);
      assert.ok(operation);
      if (fixture.body !== undefined) {
        assert.ok(operation.body_schema);
        assertViolatesSchema(operation.body_schema, fixture.body, `${fixture.operationId} invalid body`);
      }
      if (fixture.query) {
        assert.ok(operation.query_schema);
        assertViolatesSchema(operation.query_schema, fixture.query, `${fixture.operationId} invalid query`);
      }

      const request = buildRequest(baseUrl, operation, fixture);
      const response = await fetch(request.url, request.init);
      const payload: unknown = await response.json();

      assert.equal(response.status, fixture.status, `${fixture.operationId} invalid request status`);
      assertMatchesSchema(
        responseSchema(openApiOperationsById.get(fixture.operationId)!, response.status),
        payload,
        `${fixture.operationId} ${response.status} error response`
      );
      assert.ok(isRecord(payload) && isRecord(payload.error));
      assert.equal(payload.error.code, fixture.errorCode, `${fixture.operationId} error code`);
    }

    assert.equal((await cliDeviceCalls()).length, callsBefore, 'invalid requests must not reach the MAA CLI');
  });

  it('captures the runtime parsing that is looser than the published request schema', async () => {
    for (const fixture of divergenceFixtures) {
      const operation = operationsById.get(fixture.operationId);
      assert.ok(operation);
      const generated = openApiOperationsById.get(fixture.operationId);
      assert.ok(generated);
      if (fixture.body !== undefined) {
        assert.ok(operation.body_schema);
        assertViolatesSchema(operation.body_schema, fixture.body, `${fixture.operationId}: ${fixture.reason}`);
      }
      if (fixture.query) {
        assert.ok(operation.query_schema);
        assertViolatesSchema(operation.query_schema, fixture.query, `${fixture.operationId}: ${fixture.reason}`);
      }

      const request = buildRequest(baseUrl, operation, fixture);
      const response = await fetch(request.url, request.init);
      const payload: unknown = await response.json();

      assert.equal(response.status, fixture.status, `${fixture.operationId}: ${fixture.reason}`);
      assertMatchesSchema(
        responseSchema(generated, response.status),
        payload,
        `${fixture.operationId} ${response.status} response`
      );
      if (fixture.errorCode) {
        assert.ok(isRecord(payload) && isRecord(payload.error));
        assert.equal(payload.error.code, fixture.errorCode);
      }
    }
  });

  it('returns a retained run that matches the published Run DTO', async () => {
    const runTask = operationsById.get('run_task');
    assert.ok(runTask);
    const created = await fetch(`${baseUrl}/api/agent/actions/run-task`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'startup' })
    });
    assert.equal(created.status, 200);
    const createdBody: unknown = await created.json();
    assert.ok(isRecord(createdBody) && isRecord(createdBody.data));
    const runId = createdBody.data.runId;
    assert.ok(typeof runId === 'string', 'run_task must return a run id');

    const lookup = await fetch(`${baseUrl}/api/agent/runs/${encodeURIComponent(runId)}`);
    assert.equal(lookup.status, 200);
    const lookupBody: unknown = await lookup.json();
    const generated = openApiOperationsById.get('get_run');
    assert.ok(generated);
    assertMatchesSchema(responseSchema(generated, 200), lookupBody, 'retained run response');

    // 同一 Run 也必须满足快照里声明的 Run 结构，避免两处 DTO 漂移。
    const snapshot = await fetch(`${baseUrl}/api/agent/runs/current`);
    assert.equal(snapshot.status, 200);
    const snapshotBody: unknown = await snapshot.json();
    const currentRunOperation = openApiOperationsById.get('get_current_run');
    assert.ok(currentRunOperation);
    assertMatchesSchema(responseSchema(currentRunOperation, 200), snapshotBody, 'run snapshot response');
  });
});

describe('roguelike progress contract', () => {
  const progressFixture = {
    command: 'roguelike',
    theme: 'JieGarden',
    mode: 0,
    phase: 'exploring',
    currentRound: 1,
    roundStartedAt: '2026-11-06T09:00:00.000Z',
    targetRounds: 3,
    roundsStarted: 1,
    roundsEnded: 0,
    roundsSettled: 0,
    roundsPassed: 0,
    settlementSupported: true,
    currentAction: 'StartExplore',
    lastEventKind: 'round',
    lastEventName: null,
    lastEventAt: '2026-11-06T09:00:00.000Z',
    combatCount: 0,
    investment: null,
    recentRounds: [],
    blackflow: null,
    updatedAt: '2026-11-06T09:00:00.000Z',
    degraded: false,
    observed: true
  };

  const blackFlowFixture = {
    floor: 2,
    floorAt: '2026-11-21T21:36:26.402Z',
    currentNode: { id: '562949986975748', name: '应急助力', type: 'employ' },
    currentNodeAt: '2026-11-21T21:36:26.402Z',
    actionPoints: { before: 3, after: 2, at: '2026-11-21T21:36:26.402Z' },
    lastRoute: {
      at: '2026-11-21T21:36:26.402Z',
      floor: 2,
      target: { id: '562949986975746', name: '险路尽头', type: 'final' },
      landing: { id: '562949986975746', name: '险路尽头', type: 'final' },
      movement: 'walk',
      actionPointsBefore: 3,
      actionPointsAfter: 2,
      exactCost: 1,
      predictedCost: 1,
      arrived: true
    },
    lastNodeResolution: {
      at: '2026-11-21T21:36:45.082Z',
      floor: 2,
      node: { id: '562949986975746', name: '险路尽头', type: 'final' },
      eventName: '险路尽头',
      progress: 'completed'
    },
    milestones: [{
      id: 'burn_floor2_final',
      floor: 2,
      progress: 0,
      status: 'available',
      at: '2026-11-21T21:34:31.349Z'
    }],
    strategy: {
      at: '2026-11-21T21:36:50.056Z',
      profile: 'burn_with_investment',
      outcome: 'burn_completed',
      terminationReason: 'third_floor_reached',
      nextAction: 'restart_current_run',
      succeeded: true
    },
    updatedAt: '2026-11-21T21:36:50.056Z'
  };

  it('publishes the live roguelike progress schema on RunProgress', () => {
    const runProgressRef: JsonSchema = { $ref: '#/components/schemas/RunProgress' };
    const published = openApiSpec.components.schemas.RoguelikeProgress;
    assert.ok(published);
    const roguelike: JsonSchema = { $ref: '#/components/schemas/RoguelikeProgress' };

    assertMatchesSchema(roguelike, progressFixture, 'roguelike progress');
    assertMatchesSchema(runProgressRef, {
      currentStep: null,
      totalSteps: null,
      currentTask: 'StartExplore',
      message: '集成战略执行中',
      roguelike: progressFixture
    }, 'run progress with roguelike');
    assertMatchesSchema(roguelike, { ...progressFixture, mode: null }, 'unknown roguelike mode');
    assertMatchesSchema(roguelike, { ...progressFixture, blackflow: null }, 'null black flow');
    assertMatchesSchema(roguelike, {
      ...progressFixture,
      blackflow: blackFlowFixture
    }, 'full black flow progress');
    assertMatchesSchema(roguelike, {
      ...progressFixture,
      command: 'reclamation',
      settlementSupported: null,
      investment: { rounds: 1, count: 2, total: 3, deposit: 4 },
      recentRounds: [{
        index: 1,
        outcome: 'not_passed',
        settled: true,
        floor: 2,
        score: 10,
        endedAt: '2026-11-06T09:10:00.000Z'
      }]
    }, 'reclamation progress with investment and recent rounds');
  });

  it('rejects unknown fields, invalid enums and missing required counters', () => {
    const published = openApiSpec.components.schemas.RoguelikeProgress;
    assert.ok(published);
    const roguelike: JsonSchema = { $ref: '#/components/schemas/RoguelikeProgress' };

    assertViolatesSchema(roguelike, { ...progressFixture, command: 'fight' }, 'unknown command');
    assertViolatesSchema(roguelike, { ...progressFixture, phase: 'running' }, 'unknown phase');
    assertViolatesSchema(roguelike, { ...progressFixture, mode: '0' }, 'non-integer mode');
    assertViolatesSchema(roguelike, { ...progressFixture, unexpected: true }, 'unknown field');
    assertViolatesSchema(roguelike, {
      ...progressFixture,
      recentRounds: [{ index: 1, outcome: 'maybe', settled: false, floor: 1, score: 2, endedAt: null }]
    }, 'unknown round outcome');
    assertViolatesSchema(roguelike, {
      ...progressFixture,
      blackflow: {
        ...blackFlowFixture,
        lastRoute: { ...blackFlowFixture.lastRoute, unexpected: true }
      }
    }, 'unknown black flow route field');
    assertViolatesSchema(roguelike, {
      ...progressFixture,
      blackflow: {
        ...blackFlowFixture,
        lastNodeResolution: { ...blackFlowFixture.lastNodeResolution, progress: 'maybe' }
      }
    }, 'unknown black flow resolution progress');

    const { mode, ...missingMode } = progressFixture;
    assert.equal(mode, 0);
    assertViolatesSchema(roguelike, missingMode, 'missing required mode');

    const { currentRound, ...missingCounter } = progressFixture;
    assert.equal(currentRound, 1);
    assertViolatesSchema(roguelike, missingCounter, 'missing required counter');

    const { blackflow, ...missingBlackFlow } = progressFixture;
    assert.equal(blackflow, null);
    assertViolatesSchema(roguelike, missingBlackFlow, 'missing required black flow');
  });
});
