import assert from 'node:assert/strict';
import test from 'node:test';
import { loadParadoxOperators, resolveStageSearchKeyword } from '../copilotService.ts';

test('resolves a stage name or code through the MaaResource catalog', async () => {
  assert.equal(
    await resolveStageSearchKeyword('1-7', {
      findStage: async () => ({ code: '1-7', name: '暴君', stageId: 'main_01-07#f#', levelId: null })
    }),
    'main_01-07'
  );
  assert.equal(
    await resolveStageSearchKeyword('暴君', {
      findStage: async () => ({ code: '1-7', name: '暴君', stageId: 'main_01-07', levelId: null })
    }),
    'main_01-07'
  );
});

test('keeps the raw search term when the MaaResource catalog cannot resolve it', async () => {
  assert.equal(
    await resolveStageSearchKeyword('TL-9', { findStage: async (): Promise<null> => null }),
    'TL-9'
  );
  assert.equal(
    await resolveStageSearchKeyword('TL-9', {
      findStage: async () => {
        throw new Error('resource unavailable');
      }
    }),
    'TL-9'
  );
});

test('loads paradox operators from MaaResource without external data', async () => {
  const derived = [{ id: 'char_009_12fce', name: '12F', stage_id: 'mem_12fce_1', stage_name: '生还者' }];

  const result = await loadParadoxOperators({
    loadDerived: async () => derived
  });

  assert.deepEqual(result, derived);
});

test('returns an empty paradox list when MaaResource cannot derive it', async () => {
  const result = await loadParadoxOperators({
    loadDerived: async () => {
      throw new Error('resource unavailable');
    }
  });

  assert.deepEqual(result, []);
});
