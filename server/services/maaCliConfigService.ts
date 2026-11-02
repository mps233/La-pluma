import { asErrorWithCode, getErrorCode, isRecord } from '../utils/errors.ts';
import type { ErrorWithCode } from '../utils/errors.ts';
import type { FileHandle } from 'fs/promises';
import TOML from '@iarna/toml';
import { mkdir, open, readFile, rename, unlink } from 'fs/promises';
import { join } from 'path';
import { getMaaConfigDir } from './maaService.ts';

const CORE_CHANNEL_NAMES: Record<string, string> = {
  stable: 'Stable',
  beta: 'Beta',
  alpha: 'Alpha'
};

export function normalizeMaaCoreChannel(channel: unknown): string {
  const normalized = CORE_CHANNEL_NAMES[String(channel || '').trim().toLowerCase()];
  if (!normalized) {
    const error = new Error(`不支持的 MaaCore 更新渠道: ${channel}`) as ErrorWithCode;
    error.code = 'MAA_CORE_CHANNEL_INVALID';
    error.statusCode = 400;
    asErrorWithCode(error).retryable = false;
    throw error;
  }
  return normalized;
}

interface MaaCliConfig {
  core: Record<string, unknown> & { channel: string };
  [key: string]: unknown;
}

export function buildMaaCliConfigWithChannel(config: unknown = {}, channel: unknown): MaaCliConfig {
  const normalized = normalizeMaaCoreChannel(channel);
  const source = isRecord(config) ? config : {};
  return {
    ...source,
    core: {
      ...(isRecord(source.core) ? source.core : {}),
      channel: normalized
    }
  };
}

async function readCliConfig(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed = TOML.parse(await readFile(path, 'utf-8'));
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return {};
    throw error;
  }
}

async function writeCliConfigAtomic(path: string, config: Record<string, unknown>): Promise<void> {
  const content = TOML.stringify(config as Parameters<typeof TOML.stringify>[0]);
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  let handle: FileHandle | null = null;

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
      if (getErrorCode(cleanupError) !== 'ENOENT') throw cleanupError;
    });
    throw error;
  }
}

function resolveCliConfigPath(configDir: string): string {
  return join(configDir, 'cli.toml');
}

export async function getMaaCoreChannel({ configDir = null }: { configDir?: string | null } = {}): Promise<string> {
  const dir = configDir || (await getMaaConfigDir()).trim();
  const config = await readCliConfig(resolveCliConfigPath(dir));
  return isRecord(config.core) && typeof config.core.channel === 'string' ? config.core.channel : 'Stable';
}

export async function setMaaCoreChannel(
  channel: unknown,
  { configDir = null }: { configDir?: string | null } = {}
): Promise<string> {
  const dir = configDir || (await getMaaConfigDir()).trim();
  await mkdir(dir, { recursive: true });
  const path = resolveCliConfigPath(dir);
  const config = await readCliConfig(path);
  const updated = buildMaaCliConfigWithChannel(config, channel);
  await writeCliConfigAtomic(path, updated);
  return updated.core.channel;
}
