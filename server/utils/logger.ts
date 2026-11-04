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
  enableConsole?: boolean;
}

class Logger {
  name: string;
  enableConsole: boolean;

  constructor(name: string, options: LoggerOptions = {}) {
    this.name = name;
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

}

// 导出全局实例
export const loggerManager = new LoggerManager();

/**
 * 创建 Logger 的便捷函数
 */
export function createLogger(name: string, options?: LoggerOptions): Logger {
  return loggerManager.getLogger(name, options);
}
