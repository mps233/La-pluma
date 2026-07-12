import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deleteUserConfig,
  loadUserConfig,
  saveUserConfig,
  validateConfigType
} from '../configStorageService.js';

test('user config storage accepts only its explicit config types', () => {
  assert.equal(validateConfigType('automation-tasks'), 'automation-tasks');
  assert.equal(validateConfigType('notification'), 'notification');
  assert.throws(() => validateConfigType('skland-account'), /配置类型不合法/);
  assert.throws(() => validateConfigType('../../package'), /配置类型不合法/);
});

test('path traversal values cannot read, write, or delete outside user configs', async () => {
  const traversal = '../../package';
  const readResult = await loadUserConfig(traversal);
  const writeResult = await saveUserConfig(traversal, { name: 'overwritten' });
  const deleteResult = await deleteUserConfig(traversal);

  assert.equal(readResult.success, false);
  assert.equal(readResult.data, undefined);
  assert.equal(writeResult.success, false);
  assert.equal(deleteResult.success, false);
});
