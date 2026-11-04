/**
 * 统一日志服务
 * 提供结构化的日志记录和管理
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

export interface LogEntry {
  time: string;
  level: LogLevel;
  message: unknown;
  service?: string;
  data?: unknown;
  sequence?: number;
  runId?: string | null;
  operationId?: string | null;
}

export interface LoggerOptions {
  maxLogs?: number;
  enableConsole?: boolean;
}

class Logger {
  name: string;
  logs: LogEntry[];
  maxLogs: number;
  enableConsole: boolean;

  constructor(name: string, options: LoggerOptions = {}) {
    this.name = name;
    this.logs = [];
    this.maxLogs = options.maxLogs || 1000; // 最多保留的日志条数
    this.enableConsole = options.enableConsole !== false; // 默认输出到控制台
  }

  /**
   * 记录日志
   */
  log(level: LogLevel, message: unknown, data: unknown = null): LogEntry {
    const entry: LogEntry = {
      time: new Date().toISOString(),
      level,
      message,
      service: this.name,
      ...(data ? { data } : {})
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
      console.log(`${emoji} [${this.name}][${level}] ${message}`, data || '');
    }

    return entry;
  }

  /**
   * 获取日志级别对应的 emoji
   */
  getLevelEmoji(level: LogLevel): string {
    const emojis: Record<LogLevel, string> = {
      DEBUG: '🔍',
      INFO: 'ℹ️',
      WARN: '⚠️',
      ERROR: '❌',
      SUCCESS: '✅'
    };
    return emojis[level] || 'ℹ️';
  }

  /**
   * 便捷方法
   */
  debug(message: unknown, data?: unknown): LogEntry {
    return this.log('DEBUG', message, data);
  }

  info(message: unknown, data?: unknown): LogEntry {
    return this.log('INFO', message, data);
  }

  warn(message: unknown, data?: unknown): LogEntry {
    return this.log('WARN', message, data);
  }

  error(message: unknown, data?: unknown): LogEntry {
    return this.log('ERROR', message, data);
  }

  success(message: unknown, data?: unknown): LogEntry {
    return this.log('SUCCESS', message, data);
  }

  /**
   * 获取最近的日志
   */
  getRecentLogs(count = 100): LogEntry[] {
    const startIndex = Math.max(0, this.logs.length - count);
    return this.logs.slice(startIndex);
  }

  /**
   * 获取所有日志
   */
  getAllLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * 清空日志
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * 按级别过滤日志
   */
  filterByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter(log => log.level === level);
  }

  /**
   * 按时间范围过滤日志
   */
  filterByTimeRange(startTime: Date, endTime: Date): LogEntry[] {
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
  private loggers: Map<string, Logger>;

  constructor() {
    this.loggers = new Map();
  }

  /**
   * 获取或创建 Logger 实例
   */
  getLogger(name: string, options?: LoggerOptions): Logger {
    if (!this.loggers.has(name)) {
      this.loggers.set(name, new Logger(name, options));
    }
    return this.loggers.get(name) as Logger;
  }

  /**
   * 获取所有日志（合并所有 Logger）
   */
  getAllLogs(): LogEntry[] {
    const allLogs: LogEntry[] = [];
    for (const logger of this.loggers.values()) {
      allLogs.push(...logger.getAllLogs());
    }
    // 按时间排序
    return allLogs.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  }

  /**
   * 清空所有日志
   */
  clearAll(): void {
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
export function createLogger(name: string, options?: LoggerOptions): Logger {
  return loggerManager.getLogger(name, options);
}
