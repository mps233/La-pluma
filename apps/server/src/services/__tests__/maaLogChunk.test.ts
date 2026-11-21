import assert from 'node:assert/strict';
import { appendFile, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { createMaaLogCheckpoint, readMaaLogChunk } from '../maaLogFileService.ts';
import type { MaaLogCheckpoint, MaaLogFileHandle } from '../maaLogFileService.ts';
import { loggerManager } from '../../utils/logger.ts';

loggerManager.getLogger('MaaService').enableConsole = false;

const temporaryDirectories: string[] = [];

after(async () => {
  for (const directory of temporaryDirectories) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createCheckpoint(directory: string): Promise<MaaLogCheckpoint> {
  const checkpoint = await createMaaLogCheckpoint({ resolveLogDir: async () => directory });
  assert.ok(checkpoint);
  return checkpoint;
}

describe('MAA log chunk cursor', () => {
  it('reads every appended line once and leaves a trailing partial line for the next call', async () => {
    const directory = await createTemporaryDirectory('la-pluma-log-chunk-append-');
    const logPath = join(directory, 'asst.log');
    await writeFile(logPath, 'first\n', 'utf-8');
    const checkpoint = await createCheckpoint(directory);

    await appendFile(logPath, 'second\npartial', 'utf-8');
    const first = await readMaaLogChunk(checkpoint, 1024);
    assert.equal(first.status, 'ok');
    assert.equal(first.text, 'second\n');
    assert.equal(first.caughtUp, true);
    assert.equal(first.nextCheckpoint.size, Buffer.byteLength('first\nsecond\n'));
    assert.deepEqual(first.nextCheckpoint.identity, checkpoint.identity);
    assert.equal(first.nextCheckpoint.anchor?.length, Buffer.byteLength('first\nsecond\n'));

    const pending = await readMaaLogChunk(first.nextCheckpoint, 1024);
    assert.equal(pending.status, 'ok');
    assert.equal(pending.text, '');
    assert.equal(pending.caughtUp, true);
    assert.equal(pending.nextCheckpoint.size, first.nextCheckpoint.size);

    await appendFile(logPath, ' done\n', 'utf-8');
    const completed = await readMaaLogChunk(pending.nextCheckpoint, 1024);
    assert.equal(completed.status, 'ok');
    assert.equal(completed.text, 'partial done\n');
    assert.equal(completed.caughtUp, true);
    assert.equal(completed.nextCheckpoint.size, Buffer.byteLength('first\nsecond\npartial done\n'));
  });

  it('returns a forward line-aligned prefix when the byte budget is exceeded', async () => {
    const directory = await createTemporaryDirectory('la-pluma-log-chunk-budget-');
    const logPath = join(directory, 'asst.log');
    await writeFile(logPath, 'start\n', 'utf-8');
    const checkpoint = await createCheckpoint(directory);
    const lines = ['line-0\n', 'line-1\n', 'line-2\n', 'line-3\n', 'line-4\n'];
    await appendFile(logPath, lines.join(''), 'utf-8');

    const budget = 16;
    let chunk = await readMaaLogChunk(checkpoint, budget);
    assert.equal(chunk.status, 'truncated');
    assert.equal(chunk.caughtUp, false);
    assert.equal(chunk.text, 'line-0\nline-1\n');
    assert.ok(chunk.nextCheckpoint.size - checkpoint.size <= budget);

    let collected = chunk.text;
    let iterations = 0;
    while (!chunk.caughtUp) {
      chunk = await readMaaLogChunk(chunk.nextCheckpoint, budget);
      collected += chunk.text;
      iterations += 1;
      assert.ok(iterations < 10, 'chunk reads must make progress');
    }

    assert.equal(collected, lines.join(''));
    assert.equal(chunk.status, 'ok');
  });

  it('never splits a multibyte character at the window boundary', async () => {
    const directory = await createTemporaryDirectory('la-pluma-log-chunk-utf8-');
    const logPath = join(directory, 'asst.log');
    await writeFile(logPath, '', 'utf-8');
    const checkpoint = await createCheckpoint(directory);
    const firstLine = '第一行\n';
    await appendFile(logPath, `${firstLine}中文第二行\n`, 'utf-8');

    const chunk = await readMaaLogChunk(checkpoint, Buffer.byteLength(firstLine) + 2);
    assert.equal(chunk.status, 'truncated');
    assert.equal(chunk.text, firstLine);
    assert.equal(chunk.text.includes('\uFFFD'), false);
    assert.equal(chunk.nextCheckpoint.size, checkpoint.size + Buffer.byteLength(firstLine));

    const rest = await readMaaLogChunk(chunk.nextCheckpoint, 1024);
    assert.equal(rest.status, 'ok');
    assert.equal(rest.text, '中文第二行\n');
    assert.equal(rest.text.includes('\uFFFD'), false);
  });

  it('handles empty, newline-less and newline-terminated logs', async () => {
    const directory = await createTemporaryDirectory('la-pluma-log-chunk-edges-');
    const logPath = join(directory, 'asst.log');
    await writeFile(logPath, '', 'utf-8');
    const checkpoint = await createCheckpoint(directory);

    const empty = await readMaaLogChunk(checkpoint, 1024);
    assert.equal(empty.status, 'ok');
    assert.equal(empty.text, '');
    assert.equal(empty.caughtUp, true);
    assert.equal(empty.nextCheckpoint.size, 0);

    await appendFile(logPath, 'unfinished', 'utf-8');
    const unfinished = await readMaaLogChunk(empty.nextCheckpoint, 1024);
    assert.equal(unfinished.status, 'ok');
    assert.equal(unfinished.text, '');
    assert.equal(unfinished.caughtUp, true);
    assert.equal(unfinished.nextCheckpoint.size, 0);

    await appendFile(logPath, '\n', 'utf-8');
    const completed = await readMaaLogChunk(unfinished.nextCheckpoint, 1024);
    assert.equal(completed.status, 'ok');
    assert.equal(completed.text, 'unfinished\n');
    assert.equal(completed.caughtUp, true);
    assert.equal(completed.nextCheckpoint.size, Buffer.byteLength('unfinished\n'));

    await appendFile(logPath, 'terminated\n', 'utf-8');
    const terminated = await readMaaLogChunk(completed.nextCheckpoint, 1024);
    assert.equal(terminated.status, 'ok');
    assert.equal(terminated.text, 'terminated\n');
    assert.equal(terminated.caughtUp, true);
    assert.equal(terminated.nextCheckpoint.size, Buffer.byteLength('unfinished\nterminated\n'));
  });

  it('recovers a rotation through the backup and continues in the replacement log', async () => {
    const directory = await createTemporaryDirectory('la-pluma-log-chunk-rotated-');
    const logPath = join(directory, 'asst.log');
    await writeFile(logPath, 'old-session\n'.padEnd(2000, '.'), 'utf-8');
    const checkpoint = await createCheckpoint(directory);

    await appendFile(logPath, 'before rotation\n', 'utf-8');
    await rename(logPath, join(directory, 'asst.bak.log'));
    await writeFile(logPath, 'after rotation\n', 'utf-8');

    const chunk = await readMaaLogChunk(checkpoint, 4096);
    assert.equal(chunk.status, 'rotated');
    assert.equal(chunk.text, 'before rotation\nafter rotation\n');
    assert.equal(chunk.caughtUp, true);
    assert.equal(chunk.nextCheckpoint.size, Buffer.byteLength('after rotation\n'));
    assert.notDeepEqual(chunk.nextCheckpoint.identity, checkpoint.identity);
    assert.ok(chunk.nextCheckpoint.anchor);

    await appendFile(logPath, 'next\n', 'utf-8');
    const next = await readMaaLogChunk(chunk.nextCheckpoint, 4096);
    assert.equal(next.status, 'ok');
    assert.equal(next.text, 'next\n');
    assert.equal(next.caughtUp, true);
  });

  it('degrades into the replacement log when the backup is unavailable', async () => {
    const directory = await createTemporaryDirectory('la-pluma-log-chunk-rotated-degraded-');
    const logPath = join(directory, 'asst.log');
    await writeFile(logPath, 'old\n', 'utf-8');
    const checkpoint = await createCheckpoint(directory);

    await rename(logPath, join(directory, 'other.log'));
    await writeFile(logPath, 'fresh\n', 'utf-8');

    const chunk = await readMaaLogChunk(checkpoint, 4096);
    assert.equal(chunk.status, 'rotated');
    assert.equal(chunk.text, 'fresh\n');
    assert.equal(chunk.caughtUp, true);
    assert.equal(chunk.nextCheckpoint.size, Buffer.byteLength('fresh\n'));
    assert.ok(chunk.nextCheckpoint.identity);

    await appendFile(logPath, 'more\n', 'utf-8');
    const next = await readMaaLogChunk(chunk.nextCheckpoint, 4096);
    assert.equal(next.status, 'ok');
    assert.equal(next.text, 'more\n');
  });

  it('ignores a backup whose checkpoint bytes were rewritten', async () => {
    const directory = await createTemporaryDirectory('la-pluma-log-chunk-backup-rewritten-');
    const logPath = join(directory, 'asst.log');
    const backupPath = join(directory, 'asst.bak.log');
    await writeFile(logPath, 'old\n', 'utf-8');
    const checkpoint = await createCheckpoint(directory);

    await rename(logPath, backupPath);
    await writeFile(backupPath, 'rewritten\n', 'utf-8');
    await writeFile(logPath, 'unverified\n', 'utf-8');

    const chunk = await readMaaLogChunk(checkpoint, 4096);
    assert.equal(chunk.status, 'rotated');
    assert.equal(chunk.text, 'unverified\n');
    assert.equal(chunk.caughtUp, true);
    assert.equal(chunk.nextCheckpoint.size, Buffer.byteLength('unverified\n'));
  });

  it('treats an in-place rewrite as a rotation and resumes from the new content', async () => {
    const directory = await createTemporaryDirectory('la-pluma-log-chunk-rewritten-');
    const logPath = join(directory, 'asst.log');
    await writeFile(logPath, 'old-session\n'.padEnd(2000, '.'), 'utf-8');
    const checkpoint = await createCheckpoint(directory);

    await writeFile(logPath, 'new-session\n'.padEnd(4000, 'y'), 'utf-8');

    const chunk = await readMaaLogChunk(checkpoint, 4096);
    assert.equal(chunk.status, 'rotated');
    assert.equal(chunk.text, 'new-session\n');
    assert.equal(chunk.caughtUp, true);
    assert.equal(chunk.nextCheckpoint.size, Buffer.byteLength('new-session\n'));

    const resumed = await readMaaLogChunk(chunk.nextCheckpoint, 4096);
    assert.equal(resumed.status, 'ok');
    assert.equal(resumed.text, '');
    assert.equal(resumed.caughtUp, true);
    assert.equal(resumed.nextCheckpoint.size, chunk.nextCheckpoint.size);
  });

  it('recovers the backup when the active log rotates during the read', async () => {
    const directory = await createTemporaryDirectory('la-pluma-log-chunk-rotation-during-read-');
    const logPath = join(directory, 'asst.log');
    await writeFile(logPath, 'old\n', 'utf-8');
    const checkpoint = await createCheckpoint(directory);
    await appendFile(logPath, 'before rotation\n', 'utf-8');

    let rotated = false;
    const chunk = await readMaaLogChunk(checkpoint, 4096, {
      open: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          stat: () => handle.stat(),
          read: async (buffer, offset, length, position) => {
            const result = await handle.read(buffer, offset, length, position);
            if (!rotated && path === logPath && position === checkpoint.size) {
              rotated = true;
              await rename(logPath, join(directory, 'asst.bak.log'));
              await writeFile(logPath, 'after rotation\n', 'utf-8');
            }
            return result;
          },
          close: () => handle.close()
        };
      }
    });

    assert.equal(rotated, true);
    assert.equal(chunk.status, 'rotated');
    assert.equal(chunk.text, 'before rotation\nafter rotation\n');
    assert.equal(chunk.caughtUp, true);
    assert.equal(chunk.nextCheckpoint.size, Buffer.byteLength('after rotation\n'));
  });

  it('returns unreadable with the original checkpoint when the log cannot be read', async () => {
    const checkpoint: MaaLogCheckpoint = { logPath: '/virtual/asst.log', size: 10 };

    const openFailure = await readMaaLogChunk(checkpoint, 64, {
      open: async () => {
        throw new Error('denied');
      }
    });
    assert.deepEqual(openFailure, {
      status: 'unreadable',
      text: '',
      nextCheckpoint: checkpoint,
      caughtUp: false
    });

    const statFailure = await readMaaLogChunk(checkpoint, 64, {
      stat: async () => {
        throw new Error('denied');
      },
      open: async () => ({
        read: async () => {
          throw new Error('denied');
        },
        close: async () => {}
      })
    });
    assert.deepEqual(statFailure, {
      status: 'unreadable',
      text: '',
      nextCheckpoint: checkpoint,
      caughtUp: false
    });

    const readFailure = await readMaaLogChunk(checkpoint, 64, {
      stat: async () => ({ size: 20 }),
      open: async () => ({
        read: async () => {
          throw new Error('denied');
        },
        close: async () => {}
      })
    });
    assert.deepEqual(readFailure, {
      status: 'unreadable',
      text: '',
      nextCheckpoint: checkpoint,
      caughtUp: false
    });
  });

  it('normalizes an invalid byte budget to the 256 KiB default', async () => {
    const directory = await createTemporaryDirectory('la-pluma-log-chunk-budget-default-');
    const logPath = join(directory, 'asst.log');
    await writeFile(logPath, '', 'utf-8');
    const checkpoint = await createCheckpoint(directory);
    const line = `${'x'.repeat(999)}\n`;
    await appendFile(logPath, line.repeat(300), 'utf-8');

    for (const budget of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const chunk = await readMaaLogChunk(checkpoint, budget);
      assert.equal(chunk.status, 'truncated');
      assert.equal(chunk.caughtUp, false);
      assert.equal(Buffer.byteLength(chunk.text), 262_000);
      assert.equal(chunk.nextCheckpoint.size, 262_000);
    }
  });

  it('marks a short read truncated and returns only complete lines', async () => {
    const source = Buffer.from('line\npart', 'utf-8');
    const handle: MaaLogFileHandle = {
      read: async (buffer, offset, length, position) => {
        const slice = source.subarray(position, position + length);
        const bytesRead = Math.min(length, slice.length);
        slice.copy(buffer, offset, 0, bytesRead);
        return { bytesRead, buffer };
      },
      close: async () => {}
    };

    const checkpoint: MaaLogCheckpoint = { logPath: '/virtual/asst.log', size: 0 };
    const chunk = await readMaaLogChunk(checkpoint, 64, {
      stat: async () => ({ size: 64 }),
      open: async () => handle
    });

    assert.equal(chunk.status, 'truncated');
    assert.equal(chunk.text, 'line\n');
    assert.equal(chunk.caughtUp, false);
    assert.equal(chunk.nextCheckpoint.size, Buffer.byteLength('line\n'));
    assert.equal(chunk.nextCheckpoint.anchor?.length, Buffer.byteLength('line\n'));
  });
});
