import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildResourceInfo, updateMaaResources } from '../resourceUpdateService.js';

const now = new Date('2026-07-10T12:00:00.000Z');

describe('buildResourceInfo', () => {
  it('marks recently updated resources as current', () => {
    const result = buildResourceInfo(
      { last_updated: '2026-07-09 23:28:49.000' },
      new Date('2026-07-10T00:00:00.000Z'),
      now
    );

    assert.equal(result.status, 'current');
    assert.equal(result.ageDays, 0);
    assert.equal(result.message, '资源版本正常');
  });

  it('marks resources older than two weeks as stale', () => {
    const result = buildResourceInfo(
      { last_updated: '2026-06-20 00:00:00.000' },
      new Date('2026-06-20T00:00:00.000Z'),
      now
    );

    assert.equal(result.status, 'stale');
    assert.equal(result.ageDays, 20);
    assert.match(result.message, /建议立即同步/);
  });

  it('handles missing version metadata', () => {
    const result = buildResourceInfo({}, null, now);

    assert.equal(result.status, 'unknown');
    assert.equal(result.ageDays, null);
    assert.match(result.message, /无法读取资源版本/);
  });
});

describe('updateMaaResources', () => {
  it('runs maa hot-update and returns the refreshed resource info', async () => {
    const calls = [];
    const result = await updateMaaResources({
      execute: async (...args) => {
        calls.push(args);
        return { stdout: 'hot update completed' };
      },
      getResourceInfo: async () => ({ lastUpdated: '2026-10-31 12:00:00.000', status: 'current' })
    });

    assert.deepEqual(calls, [['hot-update', [], null, null, true]]);
    assert.equal(result.output, 'hot update completed');
    assert.equal(result.resource.status, 'current');
  });

  it('shares one in-flight update between concurrent callers', async () => {
    let releases = 0;
    let executions = 0;
    const execute = async () => {
      executions += 1;
      await new Promise(resolve => setTimeout(resolve, 20));
      return { stdout: 'done' };
    };
    const getResourceInfo = async () => {
      releases += 1;
      return { status: 'current' };
    };

    const [first, second] = await Promise.all([
      updateMaaResources({ execute, getResourceInfo }),
      updateMaaResources({ execute, getResourceInfo })
    ]);

    assert.equal(executions, 1);
    assert.equal(releases, 1);
    assert.equal(first, second);
  });
});
