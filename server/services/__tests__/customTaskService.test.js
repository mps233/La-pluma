import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCustomToolTaskConfig,
  listCustomTools
} from '../customTaskService.js';

test('lists the supported custom tools', () => {
  const tools = listCustomTools();
  assert.equal(tools.length, 5);
  assert.ok(tools.some(tool => tool.id === 'pixel-paint'));
  assert.ok(tools.some(tool => tool.id === 'event-shop-blacklist'));
});

test('builds a pixel paint Custom task', () => {
  const config = buildCustomToolTaskConfig('pixel-paint', {
    groups: [{ color: 7, points: [[0, 1], [3, 4]] }],
    swipe: false,
    grid_delay: 20
  });

  assert.equal(config.type, 'Custom');
  assert.deepEqual(config.params.task_names, ['MiniGame@PixelPaint@Begin']);
  assert.deepEqual(config.params.pixel_paint, {
    groups: [{ color: 7, points: [[0, 1], [3, 4]] }],
    swipe: false,
    grid_delay: 20
  });
});

test('rejects invalid pixel paint coordinates and colors', () => {
  assert.throws(
    () => buildCustomToolTaskConfig('pixel-paint', { groups: [{ color: 40, points: [[0, 0]] }] }),
    error => error.code === 'AGENT_CUSTOM_TOOL_PARAMS_INVALID'
  );
  assert.throws(
    () => buildCustomToolTaskConfig('pixel-paint', { groups: [{ color: 1, points: [[24, 0]] }] }),
    error => error.code === 'AGENT_CUSTOM_TOOL_PARAMS_INVALID'
  );
});

test('builds auto potential and event shop tasks', () => {
  assert.deepEqual(buildCustomToolTaskConfig('auto-raise-potential', { use_normal_token: true }), {
    name: '自动提升潜能',
    type: 'Custom',
    params: {
      task_names: ['MiniGame@AutoRaisePotential@Begin'],
      auto_raise_potential: { use_normal_token: true }
    }
  });

  assert.deepEqual(buildCustomToolTaskConfig('event-shop-blacklist', {
    blacklist: [' 固源岩 ', '固源岩', '']
  }).params.event_shop, {
    blacklist: ['固源岩']
  });
});

test('rejects unknown custom tools', () => {
  assert.throws(
    () => buildCustomToolTaskConfig('missing-tool'),
    error => error.code === 'AGENT_CUSTOM_TOOL_NOT_FOUND' && error.statusCode === 404
  );
});
