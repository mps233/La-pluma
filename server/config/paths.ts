import { homedir, platform } from 'os';
import { join } from 'path';

function readDirEnv(env: NodeJS.ProcessEnv | undefined, key: string): string | null {
  const value = env?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function xdgDir(env: NodeJS.ProcessEnv | undefined, key: string, fallback: string): string {
  const value = readDirEnv(env, key);
  return value ? join(value, 'maa') : fallback;
}

/**
 * Resolve the MAA directories using the same rules as maa-dirs.
 *
 * maa-dirs checks `MAA_*_DIR` first, then `XDG_*_HOME` (with a `maa` suffix),
 * then the platform project directories. Empty environment values are treated
 * as unset.
 */
export interface MaaDirs {
  data: string;
  state: string;
  config: string;
  cache: string;
}

export function resolveMaaDirs({
  os = platform(),
  home = homedir(),
  env = process.env
}: { os?: string; home?: string; env?: NodeJS.ProcessEnv } = {}): MaaDirs {
  let data: string;
  let state: string;
  let config: string;
  let cache: string;

  if (os === 'darwin') {
    const support = join(home, 'Library', 'Application Support', 'com.loong.maa');
    data = support;
    state = support;
    config = join(support, 'config');
    cache = join(home, 'Library', 'Caches', 'com.loong.maa');
  } else if (os === 'win32') {
    const roaming = readDirEnv(env, 'APPDATA') || join(home, 'AppData', 'Roaming');
    const local = readDirEnv(env, 'LOCALAPPDATA') || join(home, 'AppData', 'Local');
    data = join(roaming, 'loong', 'maa', 'data');
    state = data;
    config = join(roaming, 'loong', 'maa', 'config');
    cache = join(local, 'loong', 'maa', 'cache');
  } else {
    data = xdgDir(env, 'XDG_DATA_HOME', join(home, '.local', 'share', 'maa'));
    state = xdgDir(env, 'XDG_STATE_HOME', join(home, '.local', 'state', 'maa'));
    config = xdgDir(env, 'XDG_CONFIG_HOME', join(home, '.config', 'maa'));
    cache = xdgDir(env, 'XDG_CACHE_HOME', join(home, '.cache', 'maa'));
  }

  return {
    data: readDirEnv(env, 'MAA_DATA_DIR') || data,
    state: readDirEnv(env, 'MAA_STATE_DIR') || state,
    config: readDirEnv(env, 'MAA_CONFIG_DIR') || config,
    cache: readDirEnv(env, 'MAA_CACHE_DIR') || cache
  };
}

/**
 * 获取 MAA 配置目录路径（跨平台）
 */
export function getMaaConfigDir() {
  return resolveMaaDirs().config;
}

/**
 * 获取 MAA 数据目录路径（存放 MaaCore、资源文件等）
 */
export function getMaaDataDir() {
  return resolveMaaDirs().data;
}

/**
 * 获取 MAA state 目录路径（存放日志等运行时数据）
 */
export function getMaaStateDir() {
  return resolveMaaDirs().state;
}

/**
 * 获取 MAA cache 目录路径（存放活动数据和热更新覆盖层）
 */
export function getMaaCacheDir() {
  return resolveMaaDirs().cache;
}

/**
 * 获取 MAA 日志文件路径
 */
export function getMaaLogPath() {
  return join(getMaaStateDir(), 'debug', 'asst.log');
}

/**
 * 获取 MAA 资源目录路径
 */
export function getMaaResourceDir() {
  return join(getMaaDataDir(), 'resource');
}

/**
 * 获取 MAA 活动数据文件路径
 */
export function getMaaActivityPath() {
  return join(getMaaCacheDir(), 'StageActivityV2.json');
}

/**
 * 获取 MAA 热更新任务覆盖层路径
 */
export function getMaaHotUpdateResourceDir() {
  return join(getMaaCacheDir(), 'resource');
}

/**
 * 获取 MAA 物品索引文件路径
 */
export function getItemIndexPath() {
  return join(getMaaResourceDir(), 'item_index.json');
}

/**
 * 获取游戏物品表文件路径
 */
export function getItemTablePath() {
  return join(getMaaResourceDir(), 'gamedata', 'excel', 'item_table.json');
}

/**
 * 获取 MAA 战斗数据文件路径（包含所有干员）
 */
export function getBattleDataPath() {
  return join(getMaaResourceDir(), 'battle_data.json');
}

/**
 * 获取当前操作系统类型
 */
function getOSType() {
  const os = platform();
  switch (os) {
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'Linux';
    case 'win32':
      return 'Windows';
    default:
      return os;
  }
}

/**
 * 打印路径配置信息（用于调试）
 */
export function printPathConfig() {
  console.log('=== MAA 路径配置 ===');
  console.log('操作系统:', getOSType());
  console.log('配置目录:', getMaaConfigDir());
  console.log('数据目录:', getMaaDataDir());
  console.log('State目录:', getMaaStateDir());
  console.log('Cache目录:', getMaaCacheDir());
  console.log('资源目录:', getMaaResourceDir());
  console.log('日志文件:', getMaaLogPath());
  console.log('==================');
}
