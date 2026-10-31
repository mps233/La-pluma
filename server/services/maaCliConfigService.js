import TOML from '@iarna/toml';
import { mkdir, open, readFile, rename, unlink } from 'fs/promises';
import { join } from 'path';
import { getMaaConfigDir } from './maaService.js';

const CORE_CHANNEL_NAMES = {
  stable: 'Stable',
  beta: 'Beta',
  alpha: 'Alpha'
};

export function normalizeMaaCoreChannel(channel) {
  const normalized = CORE_CHANNEL_NAMES[String(channel || '').trim().toLowerCase()];
  if (!normalized) {
    const error = new Error(`不支持的 MaaCore 更新渠道: ${channel}`);
    error.code = 'MAA_CORE_CHANNEL_INVALID';
    error.statusCode = 400;
    error.retryable = false;
    throw error;
  }
  return normalized;
}

export function buildMaaCliConfigWithChannel(config = {}, channel) {
  const normalized = normalizeMaaCoreChannel(channel);
  return {
    ...config,
    core: {
      ...(config.core && typeof config.core === 'object' && !Array.isArray(config.core)
        ? config.core
        : {}),
      channel: normalized
    }
  };
}

async function readCliConfig(path) {
  try {
    return TOML.parse(await readFile(path, 'utf-8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeCliConfigAtomic(path, config) {
  const content = TOML.stringify(config);
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  let handle;

  try {
    handle = await open(tempPath, 'wx', 0o600);
    await handle.writeFile(content, 'utf-8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tempPath, path);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(tempPath).catch(cleanupError => {
      if (cleanupError?.code !== 'ENOENT') throw cleanupError;
    });
    throw error;
  }
}

function resolveCliConfigPath(configDir) {
  return join(configDir, 'cli.toml');
}

export async function getMaaCoreChannel({ configDir = null } = {}) {
  const dir = configDir || (await getMaaConfigDir()).trim();
  const config = await readCliConfig(resolveCliConfigPath(dir));
  return config.core?.channel || 'Stable';
}

export async function setMaaCoreChannel(channel, { configDir = null } = {}) {
  const dir = configDir || (await getMaaConfigDir()).trim();
  await mkdir(dir, { recursive: true });
  const path = resolveCliConfigPath(dir);
  const config = await readCliConfig(path);
  const updated = buildMaaCliConfigWithChannel(config, channel);
  await writeCliConfigAtomic(path, updated);
  return updated.core.channel;
}
