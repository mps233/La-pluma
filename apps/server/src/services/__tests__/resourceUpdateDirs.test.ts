import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// 候选资源目录必须跟随 cli.toml 的资源源：Git 源读 checkout，MirrorChyan 源按
// current.json 定位代快照；CLI 目录查找失败不能被当成“目录不存在”静默降级。
// 假 CLI 在子进程里按 env/marker 切换输出，导前设置 MAA_CLI_PATH。
const fixtureDir = await mkdtemp(join(tmpdir(), 'la-pluma-resource-dirs-'));
const fakeCliPath = join(fixtureDir, 'fake-maa-cli.js');
const resourceDir = join(fixtureDir, 'maa-resource');
const hotUpdateDir = join(fixtureDir, 'maa-hot-update');
const dataDir = join(fixtureDir, 'maa-data');
const configDir = join(fixtureDir, 'maa-config');
const snapshotRoot = join(dataDir, 'MirrorChyan', 'MaaResource');
const hotUpdateFailMarker = join(fixtureDir, 'fail-hot-update');
const dataFailMarker = join(fixtureDir, 'fail-data');

await mkdir(resourceDir, { recursive: true });
await writeFile(join(resourceDir, 'version.json'), JSON.stringify({
  last_updated: '2026-07-09 23:28:49.000'
}), 'utf-8');

await writeFile(fakeCliPath, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== 'dir') {
  process.exit(1);
}
const name = args[1];
const failMarkers = {
  'hot-update': process.env.FAKE_MAA_HOT_UPDATE_FAIL_MARKER,
  data: process.env.FAKE_MAA_DATA_FAIL_MARKER
};
if (failMarkers[name] && fs.existsSync(failMarkers[name])) {
  process.stderr.write('unknown directory type: ' + name + '\\n');
  process.exit(1);
}
const outputs = {
  resource: process.env.FAKE_MAA_RESOURCE_DIR,
  'hot-update': process.env.FAKE_MAA_HOT_UPDATE_DIR,
  data: process.env.FAKE_MAA_DATA_DIR,
  config: process.env.FAKE_MAA_CONFIG_DIR
};
if (outputs[name] === undefined) {
  process.exit(1);
}
process.stdout.write(outputs[name]);
`, { mode: 0o755 });

process.env.MAA_CLI_PATH = fakeCliPath;
process.env.FAKE_MAA_RESOURCE_DIR = resourceDir;
process.env.FAKE_MAA_HOT_UPDATE_DIR = hotUpdateDir;
process.env.FAKE_MAA_DATA_DIR = dataDir;
process.env.FAKE_MAA_CONFIG_DIR = configDir;
process.env.FAKE_MAA_HOT_UPDATE_FAIL_MARKER = hotUpdateFailMarker;
process.env.FAKE_MAA_DATA_FAIL_MARKER = dataFailMarker;

const {
  createResourceUpdateService,
  getMaaResourceDirs,
  getMaaResourceInfo,
  selectMirrorChyanSnapshotDir
} = await import('../resourceUpdateService.ts');
const { loggerManager } = await import('../../utils/logger.ts');

loggerManager.getLogger('MaaService').enableConsole = false;

async function writeResourceSourceConfig(source: 'git' | 'mirrorchyan'): Promise<void> {
  await mkdir(configDir, { recursive: true });
  const sourceTable = source === 'mirrorchyan' ? '[resource.source]\ntype = "mirrorchyan"\n' : '[resource.source]\ntype = "git"\n';
  await writeFile(join(configDir, 'cli.toml'), sourceTable, 'utf-8');
}

async function writeSnapshotGeneration(generation: string, lastUpdated: string): Promise<string> {
  const resourcePath = join(snapshotRoot, generation, 'resource');
  await mkdir(resourcePath, { recursive: true });
  await writeFile(join(resourcePath, 'version.json'), JSON.stringify({ last_updated: lastUpdated }), 'utf-8');
  await writeFile(join(snapshotRoot, 'current.json'), JSON.stringify(generation), 'utf-8');
  return resourcePath;
}

async function writeLegacySnapshot(lastUpdated: string): Promise<string> {
  const resourcePath = join(snapshotRoot, 'resource');
  await mkdir(resourcePath, { recursive: true });
  await writeFile(join(resourcePath, 'version.json'), JSON.stringify({ last_updated: lastUpdated }), 'utf-8');
  await rm(join(snapshotRoot, 'current.json'), { force: true });
  return resourcePath;
}

test.after(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

test('lists the Git checkout for the Git source', async () => {
  await writeResourceSourceConfig('git');
  assert.deepEqual(await getMaaResourceDirs(), [
    resourceDir,
    join(hotUpdateDir, 'resource')
  ]);
});

test('locates the active MirrorChyan snapshot instead of the idle Git checkout', async () => {
  await writeResourceSourceConfig('mirrorchyan');
  const fixedNow = new Date('2026-11-06T00:00:00.000Z');
  const snapshotResourceDir = await writeSnapshotGeneration('snapshot-abc123', '2026-11-05 10:00:00.000');
  try {
    assert.deepEqual(await getMaaResourceDirs(), [
      resourceDir,
      snapshotResourceDir
    ]);
    const info = await createResourceUpdateService({ now: () => fixedNow }).getResourceInfo();
    assert.equal(info.lastUpdated, '2026-11-05 10:00:00.000');
    assert.equal(info.ageDays, 0);
    assert.equal(info.status, 'current');
  } finally {
    await rm(snapshotRoot, { recursive: true, force: true });
  }
});

test('falls back to the legacy snapshot root when current.json is missing', async () => {
  await writeResourceSourceConfig('mirrorchyan');
  const legacyResourceDir = await writeLegacySnapshot('2026-11-01 08:00:00.000');
  try {
    assert.deepEqual(await getMaaResourceDirs(), [
      resourceDir,
      legacyResourceDir
    ]);
  } finally {
    await rm(snapshotRoot, { recursive: true, force: true });
  }
});

test('keeps a malformed pointer inside the snapshot root', async () => {
  await writeResourceSourceConfig('mirrorchyan');
  const legacyResourceDir = await writeLegacySnapshot('2026-11-01 08:00:00.000');
  try {
    for (const pointer of ['"../escape"', '"snapshot-a/b"', '"not json"']) {
      await writeFile(join(snapshotRoot, 'current.json'), pointer, 'utf-8');
      assert.deepEqual(await getMaaResourceDirs(), [
        resourceDir,
        legacyResourceDir
      ]);
    }
  } finally {
    await rm(snapshotRoot, { recursive: true, force: true });
  }
});

test('treats an empty hot-update directory as no Git base resource', async () => {
  await writeResourceSourceConfig('git');
  const previous = process.env.FAKE_MAA_HOT_UPDATE_DIR;
  process.env.FAKE_MAA_HOT_UPDATE_DIR = '';
  try {
    assert.deepEqual(await getMaaResourceDirs(), [resourceDir]);
  } finally {
    process.env.FAKE_MAA_HOT_UPDATE_DIR = previous;
  }
});

test('rejects resource info instead of silently dropping a failing directory lookup', async () => {
  await writeResourceSourceConfig('git');
  await writeFile(hotUpdateFailMarker, '1', 'utf-8');
  try {
    await assert.rejects(getMaaResourceDirs(), /命令执行失败/);
    await assert.rejects(getMaaResourceInfo(), /命令执行失败/);
  } finally {
    await rm(hotUpdateFailMarker, { force: true });
  }
});

test('rejects a failing data directory lookup for the MirrorChyan source', async () => {
  await writeResourceSourceConfig('mirrorchyan');
  await writeFile(dataFailMarker, '1', 'utf-8');
  try {
    await assert.rejects(getMaaResourceDirs(), /命令执行失败/);
  } finally {
    await rm(dataFailMarker, { force: true });
  }
});

test('selectMirrorChyanSnapshotDir only follows single-segment snapshot generations', () => {
  const root = '/data/MirrorChyan/MaaResource';
  assert.equal(selectMirrorChyanSnapshotDir(root, '"snapshot-xyz"'), join(root, 'snapshot-xyz'));
  assert.equal(selectMirrorChyanSnapshotDir(root, null), root);
  for (const pointer of ['"../escape"', '"/snapshot-absolute"', '"snapshot-a/b"', '"not json"']) {
    assert.equal(selectMirrorChyanSnapshotDir(root, pointer), root);
  }
  assert.equal(selectMirrorChyanSnapshotDir('', '"snapshot-xyz"'), '');
});

test('probes both sources when the resource source configuration is unreadable', async () => {
  const snapshotResourceDir = await writeSnapshotGeneration('snapshot-abc123', '2026-11-05 10:00:00.000');
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, 'cli.toml'), '[core\nchannel = ', 'utf-8');
  try {
    assert.deepEqual(await getMaaResourceDirs(), [
      resourceDir,
      join(hotUpdateDir, 'resource'),
      snapshotResourceDir
    ]);
  } finally {
    await rm(snapshotRoot, { recursive: true, force: true });
    await rm(join(configDir, 'cli.toml'), { force: true });
  }
});
