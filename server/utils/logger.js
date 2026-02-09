/**
 * 统一日志服务
 * 提供结构化的日志记录和管理
 */

export class Logger {
  constructor(name, options = {}) {
    this.name = name;
    this.logs = [];
    this.maxLogs = options.maxLogs || 1000; // 最多保留的日志条数
    this.enableConsole = options.enableConsole !== false; // 默认输出到控制台
  }

  /**
   * 记录日志
   */
  log(level, message, data = null) {
    const entry = {
      time: new Date().toISOString(),
      level,
      message,
      service: this.name,
      ...(data && { data })
    };

    // 添加到内存日志
    this.logs.push(entry);

    // 限制日志数量
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // 输出到控制台
    if (this.enableConsole) {
      const emoji = this.getLevelEmoji(level);
      const color = this.getLevelColor(level);
      console.log(`${emoji} [${this.name}][${level}] ${message}`, data || '');
    }

    return entry;
  }

  /**
   * 获取日志级别对应的 emoji
   */
  getLevelEmoji(level) {
    const emojis = {
      DEBUG: '🔍',
      INFO: 'ℹ️',
      WARN: '⚠️',
      ERROR: '❌',
      SUCCESS: '✅'
    };
    return emojis[level] || 'ℹ️';
  }

  /**
   * 获取日志级别对应的颜色（用于终端输出）
   */
  getLevelColor(level) {
    const colors = {
      DEBUG: '\x1b[36m', // 青色
      INFO: '\x1b[37m',  // 白色
      WARN: '\x1b[33m',  // 黄色
      ERROR: '\x1b[31m', // 红色
      SUCCESS: '\x1b[32m' // 绿色
    };
    return colors[level] || '\x1b[37m';
  }

  /**
   * 便捷方法
   */
  debug(message, data) {
    return this.log('DEBUG', message, data);
  }

  info(message, data) {
    return this.log('INFO', message, data);
  }

  warn(message, data) {
    return this.log('WARN', message, data);
  }

  error(message, data) {
    return this.log('ERROR', message, data);
  }

  success(message, data) {
    return this.log('SUCCESS', message, data);
  }

  /**
   * 获取最近的日志
   */
  getRecentLogs(count = 100) {
    const startIndex = Math.max(0, this.logs.length - count);
    return this.logs.slice(startIndex);
  }

  /**
   * 获取所有日志
   */
  getAllLogs() {
    return [...this.logs];
  }

  /**
   * 清空日志
   */
  clear() {
    this.logs = [];
  }

  /**
   * 按级别过滤日志
   */
  filterByLevel(level) {
    return this.logs.filter(log => log.level === level);
  }

  /**
   * 按时间范围过滤日志
   */
  filterByTimeRange(startTime, endTime) {
    return this.logs.filter(log => {
      const logTime = new Date(log.time);
      return logTime >= startTime && logTime <= endTime;
    });
  }
}

/**
 * 全局日志管理器
 */
class LoggerManager {
  constructor() {
    this.loggers = new Map();
  }

  /**
   * 获取或创建 Logger 实例
   */
  getLogger(name, options) {
    if (!this.loggers.has(name)) {
      this.loggers.set(name, new Logger(name, options));
    }
    return this.loggers.get(name);
  }

  /**
   * 获取所有 Logger
   */
  getAllLoggers() {
    return Array.from(this.loggers.values());
  }

  /**
   * 获取所有日志（合并所有 Logger）
   */
  getAllLogs() {
    const allLogs = [];
    for (const logger of this.loggers.values()) {
      allLogs.push(...logger.getAllLogs());
    }
    // 按时间排序
    return allLogs.sort((a, b) => new Date(a.time) - new Date(b.time));
  }

  /**
   * 清空所有日志
   */
  clearAll() {
    for (const logger of this.loggers.values()) {
      logger.clear();
    }
  }
}

// 导出全局实例
export const loggerManager = new LoggerManager();

/**
 * 创建 Logger 的便捷函数
 */
export function createLogger(name, options) {
  return loggerManager.getLogger(name, options);
}

// 导出默认 Logger
export default createLogger('app');
