import { getErrorMessage } from '../errors.ts';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FileWriteError, JsonFileParseError, readJsonFile, updateJsonFile, writeJsonFile } from '../fileHelper.ts';

async function withTempDir(run: (dir: string) => void | Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'la-pluma-json-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('writeJsonFile atomically replaces the target and removes its temp file', async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, 'config.json');
    await writeJsonFile(filePath, { enabled: true, count: 2 });

    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), { enabled: true, count: 2 });
    assert.deepEqual(await readdir(dir), ['config.json']);
  });
});

test('a failed JSON serialization leaves the previous file intact', async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, 'config.json');
    await writeJsonFile(filePath, { version: 1 });

    await assert.rejects(
      writeJsonFile(filePath, { unsupported: 1n }),
      /写入 JSON 文件失败/
    );

    assert.deepEqual(await readJsonFile(filePath), { version: 1 });
    assert.deepEqual(await readdir(dir), ['config.json']);
  });
});

test('concurrent updates to the same JSON path are serialized', async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, 'counter.json');
    await writeJsonFile(filePath, { count: 0 });

    await Promise.all(Array.from({ length: 20 }, () =>
      updateJsonFile<{ count: number }>(filePath, async (current) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
        return { count: current.count + 1 };
      })
    ));

    assert.deepEqual(await readJsonFile(filePath), { count: 20 });
  });
});


test('corrupt JSON is reported as a parse error without deleting the file', async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, 'config.json');
    await writeFile(filePath, '{not-json');

    await assert.rejects(
      readJsonFile(filePath),
      (error: unknown) => error instanceof JsonFileParseError
        && error.filePath === filePath
        && /读取 JSON 文件失败/.test(getErrorMessage(error))
    );

    assert.equal(await readFile(filePath, 'utf8'), '{not-json');
  });
});

test('a failed write reports committed=false and leaves the target intact', async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, 'config.json');
    await writeJsonFile(filePath, { version: 1 });

    await assert.rejects(
      writeJsonFile(filePath, { unsupported: 1n }),
      (error: unknown) => error instanceof FileWriteError
        && error.committed === false
        && error.filePath === filePath
    );

    assert.deepEqual(await readJsonFile(filePath), { version: 1 });
  });
});
