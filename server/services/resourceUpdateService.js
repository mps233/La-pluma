import { spawn } from 'child_process';
import { readFile, stat } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execMaaCommand } from './maaService.js';

const serviceDir = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(serviceDir, '..');
const updateScriptPath = join(serverDir, 'scripts', 'update-maa-resources.js');
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

async function performResourceUpdate() {
  const output = await new Promise((resolvePromise, reject) => {
    const child = spawn('node', [updateScriptPath], {
      cwd: serverDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('close', code => {
      if (code === 0) {
        resolvePromise(stdout);
      } else {
        reject(new Error(stderr || stdout || `资源更新进程退出码 ${code}`));
      }
    });
    child.on('error', reject);
  });

  return {
    output,
    resource: await getMaaResourceInfo()
  };
}

export async function updateMaaResources() {
  if (activeResourceUpdate) return activeResourceUpdate;

  activeResourceUpdate = performResourceUpdate();
  try {
    return await activeResourceUpdate;
  } finally {
    activeResourceUpdate = null;
  }
}
