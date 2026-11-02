import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  API_VERSION,
  AGENT_OPERATIONS,
  buildAgentManifest,
  buildOpenApiSpec
} from '../agentContract.ts';

interface TestSchema {
  type?: string | string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  enum?: string[];
  required?: string[];
  const?: unknown;
  additionalProperties?: unknown;
  $ref?: string;
  oneOf?: TestSchema[];
  allOf?: TestSchema[];
  properties: Record<string, TestSchema>;
  [key: string]: unknown;
}

interface TestSafety {
  readOnly?: boolean;
  idempotent?: boolean;
  destructive?: boolean;
  mutatesDevice?: boolean;
  sideEffects?: string[];
}

interface TestExecution {
  producesRun?: boolean;
  runLookupAction?: string;
  dryRun: { supported?: boolean };
  supportsDryRun?: boolean;
  pollAction?: string;
  conflictsWith?: string[];
  idempotency: TestSchema & { appliesWhen?: unknown };
}

interface TestAction {
  id: string;
  method: string;
  path: string;
  description: string;
  body_schema: TestSchema;
  query_schema: TestSchema;
  path_schema: TestSchema;
  header_schema: TestSchema;
  safety: TestSafety;
  execution: TestExecution;
}

interface TestManifest {
  version: string;
  defaults: unknown;
  links: { run: string };
  actions: TestAction[];
}

interface TestParameter {
  name?: string;
  description: string;
  in?: string;
  required?: boolean;
  $ref?: string;
  schema: TestSchema;
}

interface TestResponse {
  $ref?: string;
  content: { 'application/json': { schema: TestSchema } };
  headers: Record<string, { schema: TestSchema }>;
}

interface TestOperation {
  operationId: string;
  tags: unknown;
  requestBody: { required?: boolean; content: { 'application/json': { schema: TestSchema } } };
  parameters: TestParameter[];
  responses: Record<string, TestResponse>;
  'x-la-pluma-safety': unknown;
  'x-la-pluma-execution': unknown;
}

interface TestSpec {
  openapi: string;
  paths: Record<string, Record<string, TestOperation>>;
  components: {
    schemas: Record<string, TestSchema>;
    securitySchemes: Record<string, Record<string, unknown>>;
    parameters: Record<string, TestParameter>;
    responses: Record<string, TestResponse>;
  };
  security: Array<Record<string, unknown>>;
}

const defaults = {
  adbPath: '/custom/platform-tools/adb',
  adbAddress: '127.0.0.1:7555',
  clientType: 'Bilibili'
};

const expectedAdvertisedIds: string[] = [
  'get_status',
  'test_connection',
  'discover_devices',
  'activity_run_preflight',
  'activity_copilot_candidates',
  'run_current_activity_copilots',
  'start_game',
  'fight',
  'run_task',
  'stop_task',
  'get_current_run',
  'get_run',
  'stop_run',
  'get_screenshot',
  'run_daily_flow',
  'recent_logs',
  'maa_callback_summary',
  'webrtc_status',
  'webrtc_devices',
  'webrtc_snapshot',
  'webrtc_start',
  'webrtc_stop',
  'preview_orientation',
  'get_current_activity',
  'list_custom_tools',
  'run_custom_tool'
];

function testManifest(): TestManifest {
  return buildAgentManifest(defaults) as unknown as TestManifest;
}

function testSpec(): TestSpec {
  return buildOpenApiSpec(defaults) as unknown as TestSpec;
}

function actionById(manifest: TestManifest, id: string): TestAction {
  const action = manifest.actions.find(item => item.id === id);
  assert.ok(action, `missing action ${id}`);
  return action;
}

function operationAt(spec: TestSpec, path: string, method: string): TestOperation {
  const operation = spec.paths[path]?.[method];
  assert.ok(operation, `missing operation ${method} ${path}`);
  return operation;
}

function getOpenApiOperation(spec: TestSpec, item: { path: string; method: string }): TestOperation {
  return operationAt(spec, item.path, item.method.toLowerCase());
}

describe('Agent API contract registry', () => {
  it('keeps operation ids and method/path pairs unique', () => {
    assert.equal(AGENT_OPERATIONS.length, 32);
    assert.equal(new Set(AGENT_OPERATIONS.map(item => item.id)).size, AGENT_OPERATIONS.length);
    assert.equal(
      new Set(AGENT_OPERATIONS.map(item => `${item.method} ${item.path}`)).size,
      AGENT_OPERATIONS.length
    );
  });

  it('advertises the existing actions plus retained run lookup', () => {
    const manifest = testManifest();

    assert.equal(manifest.version, API_VERSION);
    assert.deepEqual(manifest.defaults, defaults);
    assert.deepEqual(manifest.actions.map(item => item.id), expectedAdvertisedIds);
    assert.equal(manifest.actions.length, 26);
    assert.ok(!manifest.actions.some(item => item.id === 'get_manifest'));
    assert.ok(!manifest.actions.some(item => item.id === 'get_openapi'));
  });

  it('materializes runtime connection defaults without reading the environment', () => {
    const manifest = testManifest();
    const testConnection = actionById(manifest, 'test_connection');
    const startGame = actionById(manifest, 'start_game');

    assert.equal(testConnection.body_schema.properties.adbPath.default, defaults.adbPath);
    assert.equal(testConnection.body_schema.properties.address.default, defaults.adbAddress);
    assert.equal(startGame.body_schema.properties.clientType.default, defaults.clientType);
    assert.equal(startGame.body_schema.properties.address.default, defaults.adbAddress);
    assert.ok(!JSON.stringify(manifest).includes('x-la-pluma-runtime-default'));
  });

  it('documents profile selection alongside the compatible direct connection fields', () => {
    const manifest = testManifest();

    assert.deepEqual(
      Object.keys(actionById(manifest, 'test_connection').body_schema.properties),
      ['profileId', 'adbPath', 'address']
    );
    assert.equal(actionById(manifest, 'test_connection').body_schema.properties.profileId.maxLength, 64);
    assert.equal(
      actionById(manifest, 'test_connection').body_schema.properties.profileId.pattern,
      '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
    );
    assert.deepEqual(
      Object.keys(actionById(manifest, 'discover_devices').query_schema.properties),
      ['profileId', 'adbPath']
    );
    assert.deepEqual(
      Object.keys(actionById(manifest, 'get_screenshot').body_schema.properties),
      ['profileId', 'adbPath', 'address']
    );
    assert.ok(actionById(manifest, 'webrtc_start').body_schema.properties.profileId);
    assert.ok(actionById(manifest, 'preview_orientation').body_schema.properties.profileId);
  });

  it('publishes recent log options as query schema instead of embedding them in the path', () => {
    const manifest = testManifest();
    const action = actionById(manifest, 'recent_logs');

    assert.equal(action.path, '/api/agent/logs/recent');
    assert.equal(action.query_schema.properties.lines.type, 'integer');
    assert.equal(action.query_schema.properties.lines.default, 80);
    assert.equal(action.query_schema.properties.lines.minimum, 1);
    assert.equal(action.query_schema.properties.lines.maximum, 500);
  });

  it('documents the runtime-compatible task command and dynamic task fields', () => {
    const action = actionById(testManifest(), 'run_task');
    const properties = action.body_schema.properties;

    assert.ok(properties.command.enum?.includes('run'));
    assert.ok(properties.command.enum?.includes('list'));
    const taskConfigOneOf = properties.taskConfig.oneOf;
    assert.ok(taskConfigOneOf?.[0]);
    assert.deepEqual(taskConfigOneOf[0].required, ['name', 'type']);
    assert.equal(taskConfigOneOf[0].properties.params.type, 'object');
    assert.equal(properties.taskName.type, 'string');
    assert.equal(properties.taskType.type, 'string');
    assert.equal(properties.userResource.type, 'boolean');
  });

  it('documents retained run lookup and guarded stopping', () => {
    const manifest = testManifest();
        const getRun = actionById(manifest, 'get_run');

    assert.equal(manifest.links.run, '/api/agent/runs/{runId}');
    assert.equal(getRun.path, '/api/agent/runs/{runId}');
    assert.deepEqual(getRun.path_schema.required, ['runId']);
    assert.equal(getRun.path_schema.properties.runId.format, 'uuid');
    assert.equal(actionById(manifest, 'stop_task').body_schema.properties.runId.format, 'uuid');
  });

  it('advertises restart-safe local idempotency for exactly five execution actions', () => {
    const manifest = testManifest();
    const runActions = manifest.actions.filter(item => item.execution.producesRun);

    assert.deepEqual(runActions.map(item => item.id), [
      'run_current_activity_copilots',
      'start_game',
      'fight',
      'run_task',
      'run_daily_flow',
      'run_custom_tool'
    ]);
    for (const action of runActions) {
      assert.equal(action.execution.runLookupAction, 'get_run');
      assert.equal(action.execution.idempotency.supported, true);
      assert.equal(action.execution.idempotency.header, 'Idempotency-Key');
      assert.equal(action.execution.idempotency.scope, 'local-instance');
      assert.equal(action.execution.idempotency.namespace, 'operationId');
      assert.equal(action.execution.idempotency.survivesRestart, true);
      assert.equal(action.execution.idempotency.restartBehavior, 'active-runs-become-interrupted');
      assert.equal(action.execution.idempotency.retentionSeconds, 86400);
      assert.equal(action.execution.idempotency.retentionMode, 'up-to');
      assert.equal(action.execution.idempotency.maxTerminalRuns, 500);
      assert.equal(action.header_schema.properties['Idempotency-Key'].maxLength, 128);
    }
    assert.deepEqual(
      runActions.find(item => item.id === 'fight')!.execution.idempotency.appliesWhen,
      { dryRun: false }
    );
    assert.deepEqual(
      runActions.find(item => item.id === 'run_daily_flow')!.execution.idempotency.appliesWhen,
      { dryRun: false }
    );
  });

  it('only advertises operations that exist on the mounted Agent router', async () => {
    const source = await readFile(new URL('../agent.ts', import.meta.url), 'utf8');
    const manifest = testManifest();

    for (const action of manifest.actions) {
      const relativePath = action.path
        .replace(/^\/api\/agent/, '')
        .replace(/\{([^}]+)\}/g, ':$1');
      const routeDeclaration = `router.${action.method.toLowerCase()}('${relativePath}'`;
      assert.ok(source.includes(routeDeclaration), `missing router declaration for ${action.method} ${action.path}`);
    }
  });
});

describe('Agent OpenAPI generation', () => {
  it('generates every registered operation from the shared registry', () => {
    const spec = testSpec();

    assert.equal(spec.openapi, '3.1.0');
    for (const item of AGENT_OPERATIONS) {
      const generated = getOpenApiOperation(spec, item);
      assert.ok(generated, `missing ${item.method} ${item.path}`);
      assert.equal(generated.operationId, item.id);
      assert.deepEqual(generated.tags, item.tags);
      assert.deepEqual(generated['x-la-pluma-safety'], item.safety);
      assert.deepEqual(generated['x-la-pluma-execution'], item.execution);
    }
  });

  it('keeps manifest actions and OpenAPI operations in sync', () => {
    const manifest = testManifest();
    const spec = testSpec();

    for (const action of manifest.actions) {
      const generated = spec.paths[action.path]?.[action.method.toLowerCase()];
      assert.ok(generated, `OpenAPI is missing advertised action ${action.id}`);
      assert.equal(generated.operationId, action.id);
      assert.deepEqual(generated['x-la-pluma-safety'], action.safety);
      assert.deepEqual(generated['x-la-pluma-execution'], action.execution);
    }
  });

  it('turns GET schemas into query parameters and never emits a GET request body', () => {
    const spec = testSpec();

    for (const item of AGENT_OPERATIONS.filter(item => item.method === 'GET')) {
      assert.equal(getOpenApiOperation(spec, item).requestBody, undefined, `${item.id} has a request body`);
    }

    const discover = operationAt(spec, '/api/agent/actions/discover-devices', 'get');
    const discoverParameters = Object.fromEntries(discover.parameters.map(item => [item.name, item]));
    assert.equal(discoverParameters.profileId.in, 'query');
    assert.equal(discoverParameters.adbPath.schema.default, defaults.adbPath);

    const logs = operationAt(spec, '/api/agent/logs/recent', 'get');
    const lines = logs.parameters.find(item => item.name === 'lines')!;
    assert.equal(lines.in, 'query');
    assert.equal(lines.schema.default, 80);
    assert.equal(lines.schema.maximum, 500);
  });

  it('turns the run id schema into a required OpenAPI path parameter', () => {
    const spec = testSpec();
    const operation = operationAt(spec, '/api/agent/runs/{runId}', 'get');
    const runId = operation.parameters.find(item => item.name === 'runId')!;

    assert.equal(operation.operationId, 'get_run');
    assert.equal(runId.in, 'path');
    assert.equal(runId.required, true);
    assert.equal(runId.schema.format, 'uuid');
    assert.equal(
      operation.responses['200'].content['application/json'].schema.$ref,
      '#/components/schemas/RunResponse'
    );
  });

  it('turns body schemas into JSON request bodies for mutating operations', () => {
    const spec = testSpec();
    const fight = operationAt(spec, '/api/agent/actions/fight', 'post');
    const schema = fight.requestBody.content['application/json'].schema;

    assert.equal(fight.requestBody.required, true);
    assert.deepEqual(schema.required, ['stages']);
    assert.equal(schema.properties.dryRun.default, false);
  });

  it('describes success, error, and response metadata envelopes', () => {
    const spec = testSpec();
    const schemas = spec.components.schemas;

    assert.deepEqual(schemas.SuccessResponse.required, ['success', 'message', 'data', 'meta']);
    assert.equal(schemas.SuccessResponse.properties.success.const, true);
    assert.equal(schemas.SuccessResponse.properties.meta.$ref, '#/components/schemas/ResponseMeta');
    assert.deepEqual(schemas.ResponseMeta.required, ['requestId', 'dryRun']);
    assert.deepEqual(schemas.ErrorResponse.required, ['success', 'message', 'error', 'meta']);
    assert.equal(schemas.ErrorResponse.properties.success.const, false);
    assert.equal(schemas.ErrorResponse.properties.error.$ref, '#/components/schemas/AgentError');

    for (const item of AGENT_OPERATIONS) {
      const generated = getOpenApiOperation(spec, item);
      for (const status of ['400', '401', '404', '409', '422', '500']) {
        assert.ok(generated.responses[status], `${item.id} is missing ${status}`);
      }
      if (item.responseKind !== 'openapi' && item.responseKind !== 'run') {
        assert.equal(
          generated.responses['200']?.content?.['application/json']?.schema.$ref,
          '#/components/schemas/SuccessResponse'
        );
      }
    }
  });

  it('supports both optional token authentication forms', () => {
    const spec = testSpec();
    const schemes = spec.components.securitySchemes;

    assert.equal(schemes.bearerAuth.type, 'http');
    assert.equal(schemes.bearerAuth.scheme, 'bearer');
    assert.equal(schemes.laPlumaToken.type, 'apiKey');
    assert.equal(schemes.laPlumaToken.in, 'header');
    assert.equal(schemes.laPlumaToken.name, 'X-La-Pluma-Token');
    assert.ok(spec.security.some(requirement => Object.keys(requirement).length === 0));
  });

  it('declares idempotency headers and accepted-run responses on execution actions', () => {
    const spec = testSpec();
    const runOperations = AGENT_OPERATIONS.filter(item => item.execution.producesRun);
    const header = spec.components.parameters.IdempotencyKey;

    assert.equal(header.name, 'Idempotency-Key');
    assert.equal(header.in, 'header');
    assert.equal(header.required, false);
    assert.equal(header.schema.maxLength, 128);
    assert.match(header.description, /across normal process restarts/);
    assert.match(header.description, /within the same operation/);
    assert.match(header.description, /up to 24 hours/);
    assert.match(header.description, /500-terminal-run cap/);
    assert.match(header.description, /are not resumed/);

    for (const item of runOperations) {
      const operation = getOpenApiOperation(spec, item);
      assert.ok(
        operation.parameters.some(parameter => parameter.$ref === '#/components/parameters/IdempotencyKey'),
        `${item.id} is missing Idempotency-Key`
      );
      assert.equal(
        operation.responses['202'].content['application/json'].schema.$ref,
        '#/components/schemas/SuccessResponse'
      );
      assert.equal(operation.responses['202'].headers.Location.schema.format, 'uri-reference');
      assert.equal(operation.responses['202'].headers['X-La-Pluma-Run-Id'].schema.format, 'uuid');
      assert.equal(operation.responses['202'].headers['Idempotency-Replayed'].schema.type, 'boolean');
      assert.equal(operation.responses['503'].$ref, '#/components/responses/ServiceUnavailable');
    }
    assert.equal(
      spec.components.responses.ServiceUnavailable.content['application/json'].schema.$ref,
      '#/components/schemas/ErrorResponse'
    );
  });

  it('describes retained run state and progress DTOs', () => {
    const schemas = testSpec().components.schemas;

    assert.deepEqual(schemas.Run.required, ['runId', 'operationId', 'state', 'acceptedAt', 'links']);
    assert.equal(schemas.Run.properties.runId.format, 'uuid');
    assert.deepEqual(schemas.Run.properties.state.enum, [
      'accepted', 'running', 'succeeded', 'failed', 'stopping', 'stopped', 'interrupted'
    ]);
    assert.equal(schemas.Run.properties.progress.$ref, '#/components/schemas/RunProgress');
    assert.equal(schemas.Run.properties.durationMs.minimum, 0);
    assert.equal(schemas.Run.properties.error.$ref, '#/components/schemas/RunError');
    assert.deepEqual(
      schemas.RunError.required,
      ['code', 'message', 'details', 'retryable', 'statusCode']
    );
    assert.equal(schemas.RunError.additionalProperties, false);
    assert.equal(schemas.RunResponse.allOf?.[1]?.properties.data.$ref, '#/components/schemas/Run');
  });

  it('marks read-only operations and actual dry-run support explicitly', () => {
    const manifest = testManifest();

    assert.equal(actionById(manifest, 'recent_logs').safety.readOnly, true);
    assert.equal(actionById(manifest, 'maa_callback_summary').safety.readOnly, true);
    assert.equal(actionById(manifest, 'get_status').safety.readOnly, false);
    assert.deepEqual(actionById(manifest, 'get_status').safety.sideEffects, ['adb_connect']);
    assert.equal(actionById(manifest, 'get_screenshot').safety.readOnly, false);
    assert.equal(actionById(manifest, 'fight').safety.readOnly, false);
    assert.equal(actionById(manifest, 'fight').execution.dryRun.supported, true);
    assert.equal(actionById(manifest, 'run_daily_flow').execution.supportsDryRun, true);
    assert.equal(actionById(manifest, 'preview_orientation').execution.dryRun.supported, true);
    assert.equal(actionById(manifest, 'run_task').execution.dryRun.supported, false);
    assert.equal(actionById(manifest, 'run_task').execution.pollAction, 'get_current_run');
    assert.deepEqual(actionById(manifest, 'run_task').execution.conflictsWith, ['maa-execution']);
    assert.equal(actionById(manifest, 'stop_task').safety.idempotent, true);
    assert.equal(actionById(manifest, 'stop_task').safety.destructive, true);
    assert.equal(actionById(manifest, 'webrtc_start').safety.mutatesDevice, true);
    assert.equal(actionById(manifest, 'webrtc_stop').safety.mutatesDevice, true);
    assert.equal(actionById(manifest, 'preview_orientation').safety.mutatesDevice, true);
  });
});
