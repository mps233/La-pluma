import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import express from 'express';
import { createMaaAssetsRouter, normalizeMaaAssetKey, selectMaaItemAssetId } from '../maaAssets.js';

const servers = [];
const roots = [];

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lJ0nWQAAAABJRU5ErkJggg==',
  'base64'
);

async function listen(app) {
  const server = createServer(app);
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
  while (roots.length) await rm(roots.pop(), { recursive: true, force: true });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'la-pluma-maa-assets-'));
  roots.push(root);
  await mkdir(join(root, 'template', 'items'), { recursive: true });
  await mkdir(join(root, 'template', 'avatar'), { recursive: true });
  await writeFile(join(root, 'template', 'items', '30012.png'), PNG);
  await writeFile(join(root, 'template', 'avatar', 'char_002_amiya.png'), PNG);
  return root;
}

test('validates asset keys and resolves item icon aliases', () => {
  assert.equal(normalizeMaaAssetKey('30012.png'), '30012');
  assert.equal(normalizeMaaAssetKey('../secret'), null);
  assert.equal(selectMaaItemAssetId('MTL_SL_G2', new Map([['MTL_SL_G2', '30012']])), '30012');
  assert.equal(selectMaaItemAssetId('30012', new Map()), '30012');
});

test('serves direct item ids, icon aliases, and avatars', async () => {
  const root = await createFixture();
  const app = express();
  app.use('/api/maa-assets', createMaaAssetsRouter({
    resourceDir: root,
    loadItemAssetMap: async () => new Map([['MTL_SL_G2', '30012']])
  }));
  const port = await listen(app);
  const baseUrl = `http://127.0.0.1:${port}/api/maa-assets`;

  const direct = await fetch(`${baseUrl}/item/30012`);
  assert.equal(direct.status, 200);
  assert.equal(direct.headers.get('cache-control'), 'public, max-age=3600');

  const alias = await fetch(`${baseUrl}/item/MTL_SL_G2`);
  assert.equal(alias.status, 200);

  const avatar = await fetch(`${baseUrl}/avatar/char_002_amiya`);
  assert.equal(avatar.status, 200);

  const missing = await fetch(`${baseUrl}/avatar/char_missing`);
  assert.equal(missing.status, 404);

  const invalid = await fetch(`${baseUrl}/item/${encodeURIComponent('../secret')}`);
  assert.equal(invalid.status, 400);
});
