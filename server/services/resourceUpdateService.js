import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { execMaaCommand } from './maaService.js';
import { withMaaExecutionLease } from './executionCoordinatorService.js';
import { clearMaaResourceCache } from './maaResourceDataService.js';

const STALE_RESOURCE_DAYS = 14;
let activeResourceUpdate = null;

export function buildResourceInfo(versionData = {}, modifiedAt = null, now = new Date()) {
  const lastUpdated = typeof versionData.last_updated === 'string' ? versionData.last_updated : null;
  const parsedDate = lastUpdated ? new Date(lastUpdated.replace(' ', 'T').replace(/\.000$/, 'Z')) : null;
  const hasValidDate = parsedDate && Number.isFinite(parsedDate.getTime());
  const ageDays = hasValidDate
    ? Math.max(0, Math.floor((now.getTime() - parsedDate.getTime()) / 86400000))
    : null;
  const status = ageDays === null ? 'unknown' : ageDays > STALE_RESOURCE_DAYS ? 'stale' : 'current';

  return {
    lastUpdated,
    modifiedAt: modifiedAt instanceof Date ? modifiedAt.toISOString() : null,
    ageDays,
    status,
    message: status === 'stale'
      ? `资源已 ${ageDays} 天未更新，建议立即同步`
      : status === 'unknown'
        ? '无法读取资源版本，请重新同步资源'
        : '资源版本正常',
    activity: versionData.activity || null,
    gacha: versionData.gacha || null
  };
}

export async function getMaaResourceInfo() {
  const result = await execMaaCommand('dir', ['resource'], null, null, false, true);
  const versionPath = join(result.stdout.trim(), 'version.json');
  const [content, fileStat] = await Promise.all([
    readFile(versionPath, 'utf-8'),
    stat(versionPath)
  ]);
  return buildResourceInfo(JSON.parse(content), fileStat.mtime);
}

/**
 * Update hot-fixable resources through maa-cli.
 *
 * `maa hot-update` updates the configured resource source (Git or MirrorChyan)
 * and the hot-update files under the CLI cache. The base resource installed
 * with MaaCore is updated by `maa update` / `maa install`, not by this command.
 */
export async function updateMaaResources({
  execute = execMaaCommand,
  getResourceInfo = getMaaResourceInfo
} = {}) {
  if (activeResourceUpdate) return activeResourceUpdate;

  activeResourceUpdate = withMaaExecutionLease({
    source: 'resource-update',
    taskName: '同步 MAA 资源',
    command: 'hot-update'
  }, async () => {
    const result = await execute('hot-update', [], null, null, true);
    clearMaaResourceCache();
    return {
      output: result.stdout || result.stderr || '',
      resource: await getResourceInfo()
    };
  });
  try {
    return await activeResourceUpdate;
  } finally {
    activeResourceUpdate = null;
  }
}
