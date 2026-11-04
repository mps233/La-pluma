import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MAA_MAINTENANCE_TIMEOUT_MS,
  MAX_MAA_MAINTENANCE_TIMEOUT_MS,
  getTaskStatus,
  requiresMaaExecutionLease,
  resolveMaaMaintenanceTimeoutMs,
  setMaaTaskProgress,
  setTaskStatus
} from '../maaService.ts';

test('device tasks and update commands share the global execution lease', () => {
  for (const command of ['fight', 'copilot', 'run', 'install', 'update', 'hot-update']) {
    assert.equal(requiresMaaExecutionLease(command), true, command);
  }
  assert.equal(requiresMaaExecutionLease('version'), false);
  assert.equal(requiresMaaExecutionLease('dir'), false);
});

test('task status exposes the current copilot stage and clears it on completion', () => {
  setTaskStatus(true, '作业集 测试', 'copilot', null);
  setMaaTaskProgress({ currentStage: 'TL-3', currentStep: 3, totalSteps: 10 });
  assert.deepEqual(
    {
      stage: getTaskStatus().currentStage,
      step: getTaskStatus().currentStep,
      total: getTaskStatus().totalSteps,
    },
    { stage: 'TL-3', step: 3, total: 10 }
  );

  setTaskStatus(false);
  assert.equal(getTaskStatus().currentStage, null);
  assert.equal(getTaskStatus().currentStep, null);
  assert.equal(getTaskStatus().totalSteps, null);
});

test('maintenance commands use a configurable long timeout with a hard cap', () => {
  assert.equal(resolveMaaMaintenanceTimeoutMs(undefined), DEFAULT_MAA_MAINTENANCE_TIMEOUT_MS);
  assert.equal(resolveMaaMaintenanceTimeoutMs(''), DEFAULT_MAA_MAINTENANCE_TIMEOUT_MS);
  assert.equal(resolveMaaMaintenanceTimeoutMs('-1'), DEFAULT_MAA_MAINTENANCE_TIMEOUT_MS);
  assert.equal(resolveMaaMaintenanceTimeoutMs('nope'), DEFAULT_MAA_MAINTENANCE_TIMEOUT_MS);
  assert.equal(resolveMaaMaintenanceTimeoutMs('120000'), 120_000);
  assert.equal(resolveMaaMaintenanceTimeoutMs('99999999'), MAX_MAA_MAINTENANCE_TIMEOUT_MS);
});
