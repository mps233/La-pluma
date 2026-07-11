import { homedir, platform } from 'os';
import { join } from 'path';

/**
 * 获取 MAA 配置目录路径（跨平台）
 */
function getMaaConfigDir() {
  const home = homedir();
  const os = platform();
  
  switch (os) {
    case 'darwin': // macOS
      return join(home, 'Library', 'Application Support', 'com.loong.maa');
    
    case 'linux':
      // Linux 使用 XDG 标准
      const xdgConfigHome = process.env.XDG_CONFIG_HOME || join(home, '.config');
      return join(xdgConfigHome, 'maa');
    
    case 'win32': // Windows
      const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
      return join(appData, 'maa');
    
    default:
      // 默认使用 Linux 风格
      return join(home, '.config', 'maa');
  }
}

/**
 * 获取 MAA 数据目录路径（存放 MaaCore、资源文件等）
 */
function getMaaDataDir() {
  const home = homedir();
  const os = platform();
  
  switch (os) {
    case 'darwin': // macOS
      return join(home, 'Library', 'Application Support', 'com.loong.maa');
    
    case 'linux':
      // Linux 使用 XDG 标准
      const xdgDataHome = process.env.XDG_DATA_HOME || join(home, '.local', 'share');
      return join(xdgDataHome, 'maa');
    
    case 'win32': // Windows
      const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
      return join(localAppData, 'maa');
    
    default:
      // 默认使用 Linux 风格
      return join(home, '.local', 'share', 'maa');
  }
}

/**
 * 获取 MAA state 目录路径（存放日志、缓存等运行时数据）
 */
function getMaaStateDir() {
  const home = homedir();
  const os = platform();
  
  switch (os) {
    case 'darwin': // macOS
      return join(home, 'Library', 'Application Support', 'com.loong.maa');
    
    case 'linux':
      // Linux 使用 XDG 标准
      const xdgStateHome = process.env.XDG_STATE_HOME || join(home, '.local', 'state');
      return join(xdgStateHome, 'maa');
    
    case 'win32': // Windows
      const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
      return join(localAppData, 'maa');
    
    default:
      // 默认使用 Linux 风格
      return join(home, '.local', 'state', 'maa');
  }
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
export function getOSType() {
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
  console.log('资源目录:', getMaaResourceDir());
  console.log('日志文件:', getMaaLogPath());
  console.log('==================');
}
