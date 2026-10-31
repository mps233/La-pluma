import assert from 'node:assert/strict';
import test from 'node:test';
import TOML from '@iarna/toml';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildMaaCliConfigWithChannel,
  getMaaCoreChannel,
  normalizeMaaCoreChannel,
  setMaaCoreChannel
} from '../maaCliConfigService.js';

test('normalizes supported MaaCore channels', () => {
  assert.equal(normalizeMaaCoreChannel('stable'), 'Stable');
  assert.equal(normalizeMaaCoreChannel('BETA'), 'Beta');
  assert.throws(() => normalizeMaaCoreChannel('nightly'), /不支持/);
});

test('builds cli config without dropping existing sections', () => {
  const config = buildMaaCliConfigWithChannel({
    cli: { channel: 'Stable' },
    core: { component: { resource: true } }
  }, 'beta');

  assert.deepEqual(config, {
    cli: { channel: 'Stable' },
    core: { component: { resource: true }, channel: 'Beta' }
  });
});

test('persists the core channel in cli.toml', async () => {
  const root = await mkdtemp(join(tmpdir(), 'la-pluma-cli-config-'));
  const path = join(root, 'cli.toml');
  await writeFile(path, '[cli]\nchannel = "Stable"\n');

  try {
    const channel = await setMaaCoreChannel('beta', { configDir: root });
    assert.equal(channel, 'Beta');
    assert.equal(await getMaaCoreChannel({ configDir: root }), 'Beta');
    const saved = TOML.parse(await readFile(path, 'utf-8'));
    assert.equal(saved.cli.channel, 'Stable');
    assert.equal(saved.core.channel, 'Beta');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
