import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { clearJsonFileCache, readJsonFileCached } from '../jsonCache.ts';

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
  clearJsonFileCache();
});

test('reuses the parsed value until mtime or size changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'la-pluma-json-cache-'));
  dirs.push(dir);
  const file = join(dir, 'fixture.json');

  await writeFile(file, JSON.stringify({ value: 1 }), 'utf8');
  const first = await readJsonFileCached<{ value: number }>(file);
  const second = await readJsonFileCached<{ value: number }>(file);
  assert.equal(first, second);
  assert.deepEqual(first, { value: 1 });

  await writeFile(file, JSON.stringify({ value: 22 }), 'utf8');
  const third = await readJsonFileCached<{ value: number }>(file);
  assert.deepEqual(third, { value: 22 });
  assert.notEqual(third, first);

  clearJsonFileCache(file);
  const fourth = await readJsonFileCached<{ value: number }>(file);
  assert.deepEqual(fourth, { value: 22 });
  assert.notEqual(fourth, third);
});

test('falls back to the default for a missing file and does not cache it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'la-pluma-json-cache-'));
  dirs.push(dir);
  const file = join(dir, 'missing.json');

  assert.equal(await readJsonFileCached(file, 'fallback'), 'fallback');
  await writeFile(file, JSON.stringify({ value: 3 }), 'utf8');
  assert.deepEqual(await readJsonFileCached(file, 'fallback'), { value: 3 });
});