import { getErrorMessage } from '../utils/errors.ts';
import { loadUserConfig } from './configStorageService.ts';
import { resolveConnection } from './connectionService.ts';
import { getNotificationConfig, setNotificationConfig } from './notificationService.ts';
import type { NotificationConfig } from './notificationService.ts';
import { setupAutoUpdate, setupSchedule } from './schedulerService.ts';
import { initTelegramBot } from './telegramBotService.ts';
import { createLogger } from '../utils/logger.ts';
import { isRecord } from '../utils/errors.ts';

const logger = createLogger('RuntimeInitialization');

interface RuntimeLogger {
  warn(message: string, data?: unknown): unknown;
  error(message: string, data?: unknown): unknown;
  info(message: string, data?: unknown): unknown;
}

interface RuntimeDependencies {
  loadConfig: typeof loadUserConfig;
  applyNotificationConfig: typeof setNotificationConfig;
  readNotificationConfig: typeof getNotificationConfig;
  registerSchedule: typeof setupSchedule;
  registerAutoUpdate: typeof setupAutoUpdate;
  resolveRuntimeConnection: typeof resolveConnection;
  startTelegramBot: typeof initTelegramBot;
  runtimeLogger: RuntimeLogger;
}

interface RuntimeSummary {
  notification: { restored: boolean; error?: string };
  schedule: { restored: boolean; message?: string | null; error?: string };
  autoUpdate: { restored: boolean; message?: string | null; error?: string };
  telegram: { initialized: boolean; error?: string };
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

async function readPersistedConfig(
  configType: string,
  loadConfig: RuntimeDependencies['loadConfig'],
  runtimeLogger: RuntimeLogger
): Promise<Record<string, unknown> | null> {
  try {
    const result = await loadConfig(configType);
    if (!isRecord(result) || !result.success) {
      runtimeLogger.warn('运行时配置加载失败', { configType, message: isRecord(result) && result.message ? result.message : '未知错误' });
      return null;
    }
    return isObject(result.data) ? result.data : null;
  } catch (error) {
    runtimeLogger.error('运行时配置加载异常', { configType, error: getErrorMessage(error) });
    return null;
  }
}

export async function initializeRuntimeState(
  overrides: Partial<RuntimeDependencies> = {}
): Promise<RuntimeSummary> {
  const dependencies: RuntimeDependencies = {
    loadConfig: loadUserConfig,
    applyNotificationConfig: setNotificationConfig,
    readNotificationConfig: getNotificationConfig,
    registerSchedule: setupSchedule,
    registerAutoUpdate: setupAutoUpdate,
    resolveRuntimeConnection: resolveConnection,
    startTelegramBot: initTelegramBot,
    runtimeLogger: logger,
    ...overrides
  };

  const summary: RuntimeSummary = {
    notification: { restored: false },
    schedule: { restored: false },
    autoUpdate: { restored: false },
    telegram: { initialized: false }
  };

  const [notificationConfig, automationConfig, autoUpdateConfig] = await Promise.all([
    readPersistedConfig('notification', dependencies.loadConfig, dependencies.runtimeLogger),
    readPersistedConfig('automation-tasks', dependencies.loadConfig, dependencies.runtimeLogger),
    readPersistedConfig('auto-update', dependencies.loadConfig, dependencies.runtimeLogger)
  ]);

  if (notificationConfig) {
    try {
      dependencies.applyNotificationConfig(notificationConfig as unknown as NotificationConfig);
      summary.notification.restored = true;
    } catch (error) {
      summary.notification.error = getErrorMessage(error);
      dependencies.runtimeLogger.error('通知配置恢复失败', { error: getErrorMessage(error) });
    }
  }

  const persistedSchedule = automationConfig && isRecord(automationConfig.schedule) ? automationConfig.schedule : null;
  if (persistedSchedule?.enabled) {
    try {
      const result = dependencies.registerSchedule(
        'default',
        Array.isArray(persistedSchedule.times) ? persistedSchedule.times : [],
        Array.isArray(automationConfig?.taskFlow) ? automationConfig.taskFlow : []
      );
      const record: Record<string, unknown> = isRecord(result) ? result : {};
      summary.schedule = {
        restored: Boolean(record.success),
        message: typeof record.message === 'string' ? record.message : null
      };
      if (!record.success) {
        dependencies.runtimeLogger.warn('默认定时任务恢复失败', { message: typeof record.message === 'string' ? record.message : '未知错误' });
      }
    } catch (error) {
      summary.schedule.error = getErrorMessage(error);
      dependencies.runtimeLogger.error('默认定时任务恢复异常', { error: getErrorMessage(error) });
    }
  }

  if (autoUpdateConfig?.enabled) {
    try {
      const result = dependencies.registerAutoUpdate(autoUpdateConfig);
      const record: Record<string, unknown> = isRecord(result) ? result : {};
      summary.autoUpdate = {
        restored: Boolean(record.success),
        message: typeof record.message === 'string' ? record.message : null
      };
      if (!record.success) {
        dependencies.runtimeLogger.warn('自动更新任务恢复失败', { message: typeof record.message === 'string' ? record.message : '未知错误' });
      }
    } catch (error) {
      summary.autoUpdate.error = getErrorMessage(error);
      dependencies.runtimeLogger.error('自动更新任务恢复异常', { error: getErrorMessage(error) });
    }
  }

  try {
    const notificationConfig = dependencies.readNotificationConfig();
    const telegramConfig = notificationConfig?.channels?.telegram;
    if (telegramConfig) {
      const connection = await dependencies.resolveRuntimeConnection();
      dependencies.startTelegramBot({
        ...telegramConfig,
        adbPath: connection.adbPath,
        adbAddress: connection.address
      });
      summary.telegram.initialized = Boolean(
        telegramConfig.enabled && telegramConfig.botToken && telegramConfig.chatId
      );
    }
  } catch (error) {
    summary.telegram.error = getErrorMessage(error);
    dependencies.runtimeLogger.error('Telegram Bot 初始化失败', { error: getErrorMessage(error) });
  }

  dependencies.runtimeLogger.info('运行时配置恢复完成', {
    notification: summary.notification.restored,
    schedule: summary.schedule.restored,
    autoUpdate: summary.autoUpdate.restored,
    telegram: summary.telegram.initialized
  });

  return summary;
}
