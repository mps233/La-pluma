import { getErrorCode, getErrorStatus } from '../../utils/errors.ts';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  MaaExecutionBusyError,
  acquireMaaExecutionLease,
  withMaaExecutionLease,
  closeMaaExecutionLeaseAdmission,
  resetMaaExecutionLeaseForTests,
  getMaaExecutionLeaseSnapshot
} from '../executionCoordinatorService.ts';

test('execution lease is exclusive and released after use', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'la-pluma-lock-'));
  process.env.LA_PLUMA_MAA_LOCK_FILE = join(dir, 'maa.lock');
  try {
    const lease = await acquireMaaExecutionLease({ taskName: 'first' });
    await assert.rejects(
      acquireMaaExecutionLease({ taskName: 'second' }),
      (error: unknown) => error instanceof MaaExecutionBusyError && error.owner!.taskName === 'first'
    );
    await lease.release();
    const nextLease = await acquireMaaExecutionLease({ taskName: 'second' });
    await nextLease.release();
  } finally {
    delete process.env.LA_PLUMA_MAA_LOCK_FILE;
    await rm(dir, { recursive: true, force: true });
  }
});

test('execution lease supports nested use in the same async flow', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'la-pluma-lock-'));
  process.env.LA_PLUMA_MAA_LOCK_FILE = join(dir, 'maa.lock');
  try {
    await withMaaExecutionLease({ taskName: 'workflow' }, async outer => {
      await withMaaExecutionLease({ taskName: 'stage' }, async inner => {
        assert.equal(inner.lockPath, outer.lockPath);
        const metadata = JSON.parse(await readFile(outer.lockPath, 'utf8'));
        assert.equal(metadata.taskName, 'workflow');
      });
    });
  } finally {
    delete process.env.LA_PLUMA_MAA_LOCK_FILE;
    await rm(dir, { recursive: true, force: true });
  }
});

test('stale lock owned by a dead process is recovered', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'la-pluma-lock-'));
  const lockPath = join(dir, 'maa.lock');
  process.env.LA_PLUMA_MAA_LOCK_FILE = lockPath;
  try {
    await writeFile(lockPath, JSON.stringify({ pid: 2147483647, taskName: 'stale' }));
    const lease = await acquireMaaExecutionLease({ taskName: 'recovered' });
    assert.equal(lease.owner.taskName, 'recovered');
    await lease.release();
  } finally {
    delete process.env.LA_PLUMA_MAA_LOCK_FILE;
    await rm(dir, { recursive: true, force: true });
  }
});


test('lease metadata carries the run id and rejects unknown lock contents', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'la-pluma-lock-'));
  const lockPath = join(dir, 'maa.lock');
  process.env.LA_PLUMA_MAA_LOCK_FILE = lockPath;
  try {
    const lease = await acquireMaaExecutionLease({ taskName: 'run-bound', runId: 'run-123' });
    const metadata = JSON.parse(await readFile(lockPath, 'utf8'));
    assert.equal(metadata.runId, 'run-123');
    assert.equal(metadata.version, 1);
    assert.equal(typeof metadata.token, 'string');
    await lease.release();
    assert.equal((await getMaaExecutionLeaseSnapshot()).state, 'free');

    await writeFile(lockPath, '{not-json');
    await assert.rejects(
      acquireMaaExecutionLease({ taskName: 'unknown-lock' }),
      (error: unknown) => error instanceof MaaExecutionBusyError && error.owner?.unknown === true
    );
    assert.equal((await getMaaExecutionLeaseSnapshot()).state, 'unknown');
  } finally {
    delete process.env.LA_PLUMA_MAA_LOCK_FILE;
    await rm(dir, { recursive: true, force: true });
  }
});

test('release does not remove a lock now owned by another token', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'la-pluma-lock-'));
  const lockPath = join(dir, 'maa.lock');
  process.env.LA_PLUMA_MAA_LOCK_FILE = lockPath;
  try {
    const lease = await acquireMaaExecutionLease({ taskName: 'owner' });
    await writeFile(lockPath, JSON.stringify({
      version: 1,
      token: 'another-token',
      pid: process.pid,
      host: 'test-host',
      startedAt: new Date().toISOString(),
      source: 'test',
      taskName: 'another',
      command: null,
      runId: null
    }));
    await lease.release();
    assert.equal((await getMaaExecutionLeaseSnapshot()).state, 'held');
  } finally {
    delete process.env.LA_PLUMA_MAA_LOCK_FILE;
    await rm(dir, { recursive: true, force: true });
  }
});

test('shutdown admission rejects new leases until reset', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'la-pluma-lock-'));
  process.env.LA_PLUMA_MAA_LOCK_FILE = join(dir, 'maa.lock');
  try {
    closeMaaExecutionLeaseAdmission('test_shutdown');
    await assert.rejects(
      acquireMaaExecutionLease({ taskName: 'after-shutdown' }),
      (error: unknown) => getErrorCode(error) === 'MAA_EXECUTION_SHUTTING_DOWN' && getErrorStatus(error) === 503
    );
    resetMaaExecutionLeaseForTests();
    const lease = await acquireMaaExecutionLease({ taskName: 'after-reset' });
    await lease.release();
  } finally {
    resetMaaExecutionLeaseForTests();
    delete process.env.LA_PLUMA_MAA_LOCK_FILE;
    await rm(dir, { recursive: true, force: true });
  }
});
