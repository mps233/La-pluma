import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { getAgentRun, resetAgentRunsForTests } from '../agentRunService.ts';
import {
  configureManualCopilotRuntimeForTests,
  continueManualCopilotSet,
  resetManualCopilotRuntimeForTests,
  startManualCopilotSet,
  stopManualCopilotSetRun
} from '../copilotManualRunService.ts';

function entry(index: number, completed = false) {
  return {
    key: `${index}:${100 + index}:normal`,
    itemIndex: index,
    copilotId: 100 + index,
    stageId: `stage-${index}`,
    displayStage: `TL-${index + 1}`,
    apCost: 9,
    mode: 'normal',
    presetFormation: false,
    completed
  };
}

let executed: number[] = [];

beforeEach(() => {
  resetAgentRunsForTests();
  resetManualCopilotRuntimeForTests();
  executed = [];
  configureManualCopilotRuntimeForTests({
    buildPlan: async () => ({
      setId: 'set-1',
      name: '手动测试集',
      items: [],
      entries: [entry(0, executed.includes(0)), entry(1, executed.includes(1))]
    }) as never,
    executeStep: (async ({ selectedIndexes }: { selectedIndexes: number[] }) => {
      executed.push(...selectedIndexes);
      return { success: true } as never;
    }) as never
  });
});

afterEach(() => {
  resetAgentRunsForTests();
  resetManualCopilotRuntimeForTests();
});

test('manual set waits between entries on the same run and continues', async () => {
  const started = await startManualCopilotSet({
    setId: 'set-1',
    selectedIndexes: [0, 1]
  });

  assert.equal(started.waitingForNext, true);
  assert.equal(started.nextItemIndex, 1);
  assert.deepEqual(executed, [0]);
  assert.equal(getAgentRun(started.runId)?.state, 'waiting');

  const continued = await continueManualCopilotSet({ runId: started.runId });
  assert.equal(continued.waitingForNext, false);
  assert.equal(continued.finished, true);
  assert.deepEqual(executed, [0, 1]);
  assert.equal(getAgentRun(started.runId)?.state, 'succeeded');
});

test('a waiting manual set can be stopped without continuing', async () => {
  const started = await startManualCopilotSet({
    setId: 'set-1',
    selectedIndexes: [0, 1]
  });
  assert.equal(getAgentRun(started.runId)?.state, 'waiting');

  const stopped = stopManualCopilotSetRun(started.runId);
  assert.equal(stopped?.state, 'stopped');
  assert.deepEqual(executed, [0]);
});
