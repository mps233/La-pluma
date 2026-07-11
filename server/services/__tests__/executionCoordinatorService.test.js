import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  MaaExecutionBusyError,
  acquireMaaExecutionLease,
  withMaaExecutionLease
} from '../executionCoordinatorService.js';

test('execution lease is exclusive and released after use', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'la-pluma-lock-'));
  process.env.LA_PLUMA_MAA_LOCK_FILE = join(dir, 'maa.lock');
  try {
    const lease = await acquireMaaExecutionLease({ taskName: 'first' });
    await assert.rejects(
      acquireMaaExecutionLease({ taskName: 'second' }),
      error => error instanceof MaaExecutionBusyError && error.owner.taskName === 'first'
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
