import { loadUserConfig } from './configStorageService.js';
import { resolveConnection } from './connectionService.js';
import { getNotificationConfig, setNotificationConfig } from './notificationService.js';
import { setupAutoUpdate, setupSchedule } from './schedulerService.js';
import { initTelegramBot } from './telegramBotService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('RuntimeInitialization');

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

async function readPersistedConfig(configType, loadConfig, runtimeLogger) {
  try {
    const result = await loadConfig(configType);
    if (!result?.success) {
      runtimeLogger.warn('运行时配置加载失败', { configType, message: result?.message || '未知错误' });
      return null;
    }
    return isObject(result.data) ? result.data : null;
  } catch (error) {
    runtimeLogger.error('运行时配置加载异常', { configType, error: error.message });
    return null;
  }
}

export async function initializeRuntimeState(overrides = {}) {
  const dependencies = {
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

  const summary = {
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
      dependencies.applyNotificationConfig(notificationConfig);
      summary.notification.restored = true;
    } catch (error) {
      summary.notification.error = error.message;
      dependencies.runtimeLogger.error('通知配置恢复失败', { error: error.message });
    }
  }

  const persistedSchedule = automationConfig?.schedule;
  if (persistedSchedule?.enabled) {
    try {
      const result = dependencies.registerSchedule(
        'default',
        Array.isArray(persistedSchedule.times) ? persistedSchedule.times : [],
        Array.isArray(automationConfig.taskFlow) ? automationConfig.taskFlow : []
      );
      summary.schedule = {
        restored: Boolean(result?.success),
        message: result?.message || null
      };
      if (!result?.success) {
        dependencies.runtimeLogger.warn('默认定时任务恢复失败', { message: result?.message || '未知错误' });
      }
    } catch (error) {
      summary.schedule.error = error.message;
      dependencies.runtimeLogger.error('默认定时任务恢复异常', { error: error.message });
    }
  }

  if (autoUpdateConfig?.enabled) {
    try {
      const result = dependencies.registerAutoUpdate(autoUpdateConfig);
      summary.autoUpdate = {
        restored: Boolean(result?.success),
        message: result?.message || null
      };
      if (!result?.success) {
        dependencies.runtimeLogger.warn('自动更新任务恢复失败', { message: result?.message || '未知错误' });
      }
    } catch (error) {
      summary.autoUpdate.error = error.message;
      dependencies.runtimeLogger.error('自动更新任务恢复异常', { error: error.message });
    }
  }

  try {
    const telegramConfig = dependencies.readNotificationConfig()?.channels?.telegram;
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
    summary.telegram.error = error.message;
    dependencies.runtimeLogger.error('Telegram Bot 初始化失败', { error: error.message });
  }

  dependencies.runtimeLogger.info('运行时配置恢复完成', {
    notification: summary.notification.restored,
    schedule: summary.schedule.restored,
    autoUpdate: summary.autoUpdate.restored,
    telegram: summary.telegram.initialized
  });

  return summary;
}
