import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  beginAgentRun,
  completeAgentRun,
  discardAgentRun,
  failAgentRun,
  fingerprintAgentRunInput,
  getAgentRun,
  getCurrentAgentRun,
  listAgentRuns,
  markAgentRunStopping,
  releaseAgentRunIdempotency,
  resetAgentRunsForTests,
  setAgentRunAcceptedResult,
  startAgentRun,
  stopAgentRun
} from '../agentRunService.js';

describe('agent run registry', () => {
  beforeEach(() => resetAgentRunsForTests());
  afterEach(() => resetAgentRunsForTests());

  it('creates UUID runs and moves them through the success lifecycle', () => {
    const { run, replayed } = beginAgentRun({
      operationId: 'run_task',
      input: { command: 'fight', args: ['1-7'] },
      metadata: { taskName: '理智作战' }
    });

    assert.equal(replayed, false);
    assert.match(run.runId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(run.state, 'accepted');
    assert.ok(run.acceptedAt);
    assert.deepEqual(run.links, {
      self: `/api/agent/runs/${run.runId}`,
      stop: '/api/agent/actions/stop'
    });
    for (const internalField of ['idempotencyKey', 'inputFingerprint', 'input', 'metadata', 'status', 'createdAt', 'updatedAt']) {
      assert.equal(Object.hasOwn(run, internalField), false, internalField);
    }
    assert.equal(startAgentRun(run.runId).state, 'running');

    const terminal = completeAgentRun(run.runId, { stdout: 'ok' });
    assert.equal(terminal.state, 'succeeded');
    assert.deepEqual(terminal.result, { stdout: 'ok' });
    assert.ok(terminal.finishedAt);
    assert.equal(typeof terminal.durationMs, 'number');
    assert.equal(getCurrentAgentRun(), null);
  });

  it('uses a stable recursive JSON fingerprint', () => {
    const left = { z: [{ b: 2, a: 1 }], a: { y: true, x: null } };
    const right = { a: { x: null, y: true }, z: [{ a: 1, b: 2 }] };

    assert.equal(fingerprintAgentRunInput(left), fingerprintAgentRunInput(right));
    assert.notEqual(fingerprintAgentRunInput(left), fingerprintAgentRunInput({ ...right, z: [] }));
  });

  it('replays the same operation, key and input without creating a new run', () => {
    const first = beginAgentRun({
      operationId: 'run_daily_flow',
      idempotencyKey: 'daily:2026-07-12',
      input: { b: 2, a: 1 }
    });
    startAgentRun(first.run.runId);

    const replay = beginAgentRun({
      operationId: 'run_daily_flow',
      idempotencyKey: 'daily:2026-07-12',
      input: { a: 1, b: 2 },
      metadata: { ignoredForReplay: true }
    });

    assert.equal(replay.replayed, true);
    assert.equal(replay.run.runId, first.run.runId);
    assert.equal(replay.run.state, 'running');
    assert.equal(listAgentRuns().length, 1);
  });

  it('rejects reuse of an operation key with different input', () => {
    beginAgentRun({
      operationId: 'run_task',
      idempotencyKey: 'request_1',
      input: { command: 'award' }
    });

    assert.throws(
      () => beginAgentRun({
        operationId: 'run_task',
        idempotencyKey: 'request_1',
        input: { command: 'fight' }
      }),
      error => {
        assert.equal(error.code, 'AGENT_IDEMPOTENCY_KEY_REUSED');
        assert.equal(error.statusCode, 409);
        assert.equal(error.retryable, false);
        assert.equal(error.details.operationId, 'run_task');
        assert.equal(error.details.idempotencyKey, 'request_1');
        return true;
      }
    );
  });

  it('scopes the same key to its operation', () => {
    const first = beginAgentRun({ operationId: 'fight', idempotencyKey: 'same:key', input: { stage: '1-7' } });
    const second = beginAgentRun({ operationId: 'award', idempotencyKey: 'same:key', input: { stage: '1-7' } });

    assert.notEqual(first.run.runId, second.run.runId);
    assert.equal(second.replayed, false);
  });

  it('validates the documented idempotency key format', () => {
    const valid = 'A.b_c~d:e-1';
    const first = beginAgentRun({ operationId: 'fight', idempotencyKey: valid });
    assert.equal(beginAgentRun({ operationId: 'fight', idempotencyKey: valid }).run.runId, first.run.runId);

    for (const idempotencyKey of ['', '-starts-with-dash', 'has space', 'x'.repeat(129)]) {
      assert.throws(
        () => beginAgentRun({ operationId: 'fight', idempotencyKey }),
        error => error.code === 'AGENT_IDEMPOTENCY_KEY_INVALID' && error.statusCode === 400
      );
    }
  });

  it('supports stopping, failed and stopped terminal states', () => {
    const stoppingRun = beginAgentRun({ operationId: 'fight' }).run;
    startAgentRun(stoppingRun.runId);
    assert.equal(markAgentRunStopping(stoppingRun.runId).state, 'stopping');
    const stopped = stopAgentRun(stoppingRun.runId, { signal: 'SIGTERM' });
    assert.equal(stopped.state, 'stopped');
    assert.deepEqual(stopped.result, { signal: 'SIGTERM' });

    const failedRun = beginAgentRun({ operationId: 'award' }).run;
    const failure = new Error('MAA exited with code 1');
    failure.code = 'MAA_EXIT_FAILED';
    failure.statusCode = 409;
    const failed = failAgentRun(failedRun.runId, failure);
    assert.equal(failed.state, 'failed');
    assert.equal(failed.error.code, 'MAA_EXIT_FAILED');
    assert.equal(failed.error.message, failure.message);
    assert.equal(failed.error.statusCode, 409);
  });

  it('retains the accepted response for active replays', () => {
    const run = beginAgentRun({
      operationId: 'fight',
      idempotencyKey: 'fight:accepted',
      input: { stage: '1-7' }
    }).run;
    startAgentRun(run.runId);
    const updated = setAgentRunAcceptedResult(run.runId, { command: 'fight 1-7', plan: { stage: '1-7' } });

    assert.deepEqual(updated.result, { command: 'fight 1-7', plan: { stage: '1-7' } });
    assert.deepEqual(
      beginAgentRun({ operationId: 'fight', idempotencyKey: 'fight:accepted', input: { stage: '1-7' } }).run.result,
      updated.result
    );
  });

  it('keeps a rejected run queryable while allowing its key to retry', () => {
    const first = beginAgentRun({
      operationId: 'fight',
      idempotencyKey: 'fight:busy',
      input: { stage: '1-7' }
    }).run;
    const error = new Error('MAA 正在被其他任务使用');
    error.code = 'MAA_EXECUTION_BUSY';
    error.statusCode = 409;
    failAgentRun(first.runId, error);
    releaseAgentRunIdempotency(first.runId);

    assert.equal(getAgentRun(first.runId).state, 'failed');
    const retry = beginAgentRun({
      operationId: 'fight',
      idempotencyKey: 'fight:busy',
      input: { stage: '1-7' }
    });
    assert.equal(retry.replayed, false);
    assert.notEqual(retry.run.runId, first.runId);
  });

  it('rejects conflicting transitions while keeping same-state completion idempotent', () => {
    const run = beginAgentRun({ operationId: 'fight' }).run;
    startAgentRun(run.runId);
    const completed = completeAgentRun(run.runId, { ok: true });
    assert.deepEqual(completeAgentRun(run.runId, { changed: true }), completed);

    assert.throws(
      () => markAgentRunStopping(run.runId),
      error => error.code === 'AGENT_RUN_STATE_CONFLICT' && error.statusCode === 409
    );
  });

  it('discards pre-execution runs and releases their idempotency keys', () => {
    const accepted = beginAgentRun({
      operationId: 'run_task',
      idempotencyKey: 'startup:retry',
      input: { command: 'startup' }
    }).run;
    const discardedAccepted = discardAgentRun(accepted.runId);
    assert.equal(discardedAccepted.runId, accepted.runId);
    assert.equal(getAgentRun(accepted.runId), null);

    const retried = beginAgentRun({
      operationId: 'run_task',
      idempotencyKey: 'startup:retry',
      input: { command: 'startup' }
    });
    assert.equal(retried.replayed, false);
    assert.notEqual(retried.run.runId, accepted.runId);

    startAgentRun(retried.run.runId);
    discardAgentRun(retried.run.runId);
    assert.equal(getAgentRun(retried.run.runId), null);
  });

  it('does not discard stopping or terminal runs', () => {
    const stopping = beginAgentRun({ operationId: 'fight' }).run;
    markAgentRunStopping(stopping.runId);
    assert.throws(
      () => discardAgentRun(stopping.runId),
      error => error.code === 'AGENT_RUN_STATE_CONFLICT' && error.statusCode === 409
    );

    const terminal = beginAgentRun({ operationId: 'award' }).run;
    completeAgentRun(terminal.runId);
    assert.throws(
      () => discardAgentRun(terminal.runId),
      error => error.code === 'AGENT_RUN_STATE_CONFLICT' && error.statusCode === 409
    );
  });

  it('returns copies from begin, get, list, current and transitions', () => {
    const input = { nested: { value: 1 } };
    const metadata = { owner: { name: 'agent' } };
    const created = beginAgentRun({
      operationId: 'run_task',
      idempotencyKey: 'copy:test',
      input,
      metadata
    }).run;
    input.nested.value = 99;
    metadata.owner.name = 'mutated';
    created.links.self = '/mutated';

    const current = getCurrentAgentRun();
    current.links.stop = '/mutated';
    const listed = listAgentRuns();
    listed[0].links.self = '/also-mutated';

    const stored = getAgentRun(created.runId);
    assert.equal(stored.links.self, `/api/agent/runs/${created.runId}`);
    const replay = beginAgentRun({
      operationId: 'run_task',
      idempotencyKey: 'copy:test',
      input: { nested: { value: 1 } }
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.run.runId, created.runId);

    const started = startAgentRun(created.runId);
    started.state = 'failed';
    assert.equal(getAgentRun(created.runId).state, 'running');
  });

  it('keeps at most 500 terminal runs and removes evicted idempotency entries', () => {
    let first;
    for (let index = 0; index < 501; index += 1) {
      const begun = beginAgentRun({
        operationId: 'bounded',
        idempotencyKey: `key:${index}`,
        input: { index }
      });
      if (index === 0) first = begun.run;
      completeAgentRun(begun.run.runId, { index });
    }

    assert.equal(listAgentRuns().length, 500);
    assert.equal(getAgentRun(first.runId), null);
    const recreated = beginAgentRun({
      operationId: 'bounded',
      idempotencyKey: 'key:0',
      input: { index: 0 }
    });
    assert.equal(recreated.replayed, false);
    assert.notEqual(recreated.run.runId, first.runId);
  });

  it('expires terminal runs after 24 hours without expiring active runs', () => {
    const originalNow = Date.now;
    let now = Date.parse('2026-07-12T00:00:00.000Z');
    Date.now = () => now;
    try {
      const terminal = beginAgentRun({ operationId: 'old-terminal' }).run;
      completeAgentRun(terminal.runId);
      const active = beginAgentRun({ operationId: 'old-active' }).run;

      now += 24 * 60 * 60 * 1000 + 1;

      assert.equal(getAgentRun(terminal.runId), null);
      assert.equal(getAgentRun(active.runId).state, 'accepted');
    } finally {
      Date.now = originalNow;
    }
  });

  it('supports filtered newest-first listing and missing-run errors', () => {
    const first = beginAgentRun({ operationId: 'fight' }).run;
    const second = beginAgentRun({ operationId: 'award' }).run;
    startAgentRun(second.runId);

    assert.deepEqual(listAgentRuns({ state: 'accepted' }).map(run => run.runId), [first.runId]);
    assert.deepEqual(listAgentRuns({ limit: 1 }).map(run => run.runId), [second.runId]);
    assert.equal(getCurrentAgentRun().runId, second.runId);
    assert.throws(
      () => startAgentRun('missing'),
      error => error.code === 'AGENT_RUN_NOT_FOUND' && error.statusCode === 404
    );
  });
});
