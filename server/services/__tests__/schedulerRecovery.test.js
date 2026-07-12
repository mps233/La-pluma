import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  executeScheduledTaskFromCron,
  executeScheduleNow,
  getScheduleExecutionStatus
} from '../schedulerService.js';

let testDir;

before(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'la-pluma-scheduler-'));
  process.env.LA_PLUMA_MAA_LOCK_FILE = join(testDir, 'maa.lock');
});

after(async () => {
  delete process.env.LA_PLUMA_MAA_LOCK_FILE;
  await rm(testDir, { recursive: true, force: true });
});

const malformedTaskFlow = [{ enabled: true, name: 'Malformed task', params: {} }];

test('unexpected execution errors always reset scheduler state', async () => {
  await assert.rejects(
    executeScheduleNow('unexpected-error', malformedTaskFlow),
    error => error instanceof TypeError
  );

  const status = getScheduleExecutionStatus();
  assert.equal(status.isRunning, false);
  assert.equal(status.scheduleId, null);
  assert.equal(status.currentStep, -1);
  assert.equal(status.totalSteps, 0);
  assert.equal(status.currentTask, null);
  assert.equal(status.shouldStop, false);
  assert.match(status.message, /任务流程异常终止/);
});

test('cron execution catches rejected task flows and leaves the scheduler reusable', async () => {
  const result = await executeScheduledTaskFromCron(malformedTaskFlow, 'cron-error');

  assert.equal(result.success, false);
  assert.match(result.message, /split/);
  assert.equal(getScheduleExecutionStatus().isRunning, false);
});
