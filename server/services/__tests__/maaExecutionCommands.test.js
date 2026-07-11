import assert from 'node:assert/strict';
import test from 'node:test';
import { requiresMaaExecutionLease } from '../maaService.js';

test('device tasks and update commands share the global execution lease', () => {
  for (const command of ['fight', 'copilot', 'run', 'install', 'update', 'hot-update']) {
    assert.equal(requiresMaaExecutionLease(command), true, command);
  }
  assert.equal(requiresMaaExecutionLease('version'), false);
  assert.equal(requiresMaaExecutionLease('dir'), false);
});
