import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanupLogs, type MaaLogFileEntry } from '../maaLogFileService.ts';
import { loggerManager } from '../../utils/logger.ts';

loggerManager.getLogger('MaaService').enableConsole = false;

const MB = 1024 * 1024;

const file = (name: string, sizeMB: number, modified: string): MaaLogFileEntry => ({
  name,
  path: `/logs/${name}`,
  size: sizeMB * MB,
  modified,
});

const runCleanup = async (
  files: MaaLogFileEntry[],
  maxSizeMB = 10
): Promise<{ result: Awaited<ReturnType<typeof cleanupLogs>>; removed: string[] }> => {
  const removed: string[] = [];
  const result = await cleanupLogs(maxSizeMB, {
    resolveLogDir: async () => '/logs',
    collectFiles: async () => files,
    remove: async (path) => {
      removed.push(path);
    },
  });
  return { result, removed };
};

describe('MAA log cleanup', () => {
  it('keeps the newest file and never deletes it even when it exceeds the limit', async () => {
    const { result, removed } = await runCleanup([
      file('asst.log', 49, '2026-11-24T10:00:00.000Z'),
      file('asst.bak.log', 65, '2026-11-23T10:00:00.000Z'),
    ]);

    assert.deepEqual(removed, ['/logs/asst.bak.log']);
    assert.equal(result.deletedCount, 1);
    assert.equal(result.freedSpace, 65 * MB);
  });

  it('keeps the newest files while removing older files until the limit is met', async () => {
    const { result, removed } = await runCleanup([
      file('newest.log', 2, '2026-11-24T10:00:00.000Z'),
      file('middle.log', 2, '2026-11-23T10:00:00.000Z'),
      file('oldest.log', 7, '2026-11-22T10:00:00.000Z'),
    ]);

    assert.deepEqual(removed, ['/logs/oldest.log']);
    assert.equal(result.deletedCount, 1);
    assert.equal(result.freedSpace, 7 * MB);
  });

  it('does nothing when the total already fits the limit', async () => {
    const { result, removed } = await runCleanup([
      file('newest.log', 8, '2026-11-24T10:00:00.000Z'),
      file('older.log', 1, '2026-11-23T10:00:00.000Z'),
    ]);

    assert.deepEqual(removed, []);
    assert.deepEqual(result, { deletedCount: 0, freedSpace: 0 });
  });

  it('removes only the older file when the newest plus one older exceeds the limit', async () => {
    const { result, removed } = await runCleanup([
      file('newest.log', 8, '2026-11-24T10:00:00.000Z'),
      file('older.log', 3, '2026-11-23T10:00:00.000Z'),
    ]);

    assert.deepEqual(removed, ['/logs/older.log']);
    assert.equal(result.deletedCount, 1);
    assert.equal(result.freedSpace, 3 * MB);
  });

  it('handles an empty directory and validates the size limit', async () => {
    const empty = await runCleanup([]);
    assert.deepEqual(empty.result, { deletedCount: 0, freedSpace: 0 });

    await assert.rejects(runCleanup([], 0), /日志保留上限必须在 1 到 1024 MB 之间/);
  });
});
