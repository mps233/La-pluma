import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { execMaaCommand } from './maaService.ts';
import { withMaaExecutionLease } from './executionCoordinatorService.ts';
import { clearMaaResourceCache } from './maaResourceDataService.ts';

const STALE_RESOURCE_DAYS = 14;

export interface MaaResourceInfo {
  lastUpdated: string | null;
  modifiedAt: string | null;
  ageDays: number | null;
  status: 'unknown' | 'stale' | 'current';
  message: string;
  activity: unknown;
  gacha: unknown;
}

export interface ResourceUpdateResult {
  output: string;
  resource: MaaResourceInfo;
}

export type ResourceExecutor = (
  command: string,
  args?: string[],
  taskName?: string | null,
  taskType?: string | null,
  waitForCompletion?: boolean
) => Promise<{ stdout?: string; stderr?: string }>;

let activeResourceUpdate: Promise<ResourceUpdateResult> | null = null;

export function buildResourceInfo(
  versionData: unknown = {},
  modifiedAt: unknown = null,
  now: Date = new Date()
): MaaResourceInfo {
  const source = versionData && typeof versionData === 'object' && !Array.isArray(versionData)
    ? versionData as Record<string, unknown>
    : {};
  const lastUpdated = typeof source.last_updated === 'string' ? source.last_updated : null;
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
    activity: source.activity || null,
    gacha: source.gacha || null
  };
}

export async function getMaaResourceInfo(): Promise<MaaResourceInfo> {
  const result = await execMaaCommand('dir', ['resource'], null, null, false, true);
  const versionPath = join(result.stdout.trim(), 'version.json');
  const [content, fileStat] = await Promise.all([
    readFile(versionPath, 'utf-8'),
    stat(versionPath)
  ]);
  return buildResourceInfo(JSON.parse(content) as unknown, fileStat.mtime);
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
}: {
  execute?: ResourceExecutor;
  getResourceInfo?: typeof getMaaResourceInfo;
} = {}): Promise<ResourceUpdateResult> {
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
