import assert from 'node:assert/strict';
import test from 'node:test';
import { getTaskStatus, requiresMaaExecutionLease, setMaaTaskProgress, setTaskStatus } from '../maaService.ts';

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
