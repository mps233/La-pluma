import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { initializeRuntimeState } from '../runtimeInitializationService.js';

const silentLogger = {
  info() {},
  warn() {},
  error() {}
};

describe('runtime initialization', () => {
  it('restores persisted runtime state before initializing Telegram', async () => {
    const notification = {
      enabled: true,
      channels: {
        telegram: {
          enabled: true,
          botToken: 'persisted-token',
          chatId: 'persisted-chat',
          allowedUserIds: ['42']
        }
      }
    };
    const automation = {
      taskFlow: [{ id: 'award-1', enabled: true, commandId: 'award' }],
      schedule: { enabled: true, times: ['04:30', '12:00'] }
    };
    const autoUpdate = {
      enabled: true,
      time: '03:00',
      updateCore: true,
      updateCli: false
    };
    const persisted = {
      notification,
      'automation-tasks': automation,
      'auto-update': autoUpdate
    };
    const calls = {};
    let activeNotification = null;

    const summary = await initializeRuntimeState({
      loadConfig: async configType => ({ success: true, data: persisted[configType] }),
      applyNotificationConfig: config => {
        calls.notification = config;
        activeNotification = config;
      },
      readNotificationConfig: () => activeNotification,
      registerSchedule: (scheduleId, times, taskFlow) => {
        calls.schedule = { scheduleId, times, taskFlow };
        return { success: true, message: 'restored schedule' };
      },
      registerAutoUpdate: config => {
        calls.autoUpdate = config;
        return { success: true, message: 'restored auto update' };
      },
      resolveRuntimeConnection: async () => ({ adbPath: '/usr/bin/adb', address: 'emulator:5555' }),
      startTelegramBot: config => {
        calls.telegram = config;
      },
      runtimeLogger: silentLogger
    });

    assert.deepEqual(calls.notification, notification);
    assert.deepEqual(calls.schedule, {
      scheduleId: 'default',
      times: ['04:30', '12:00'],
      taskFlow: automation.taskFlow
    });
    assert.deepEqual(calls.autoUpdate, autoUpdate);
    assert.deepEqual(calls.telegram, {
      ...notification.channels.telegram,
      adbPath: '/usr/bin/adb',
      adbAddress: 'emulator:5555'
    });
    assert.deepEqual(summary, {
      notification: { restored: true },
      schedule: { restored: true, message: 'restored schedule' },
      autoUpdate: { restored: true, message: 'restored auto update' },
      telegram: { initialized: true }
    });
  });

  it('isolates restore failures so other persisted jobs still start', async () => {
    const calls = [];
    const summary = await initializeRuntimeState({
      loadConfig: async configType => {
        if (configType === 'notification') throw new Error('notification storage unavailable');
        if (configType === 'automation-tasks') {
          return {
            success: true,
            data: { taskFlow: [], schedule: { enabled: true, times: ['05:00'] } }
          };
        }
        return {
          success: true,
          data: { enabled: true, time: '06:00', updateCore: true, updateCli: true }
        };
      },
      applyNotificationConfig: () => calls.push('notification'),
      readNotificationConfig: () => ({ channels: {} }),
      registerSchedule: () => {
        calls.push('schedule');
        throw new Error('invalid schedule');
      },
      registerAutoUpdate: () => {
        calls.push('auto-update');
        return { success: true, message: 'auto update restored' };
      },
      resolveRuntimeConnection: async () => {
        calls.push('connection');
        return {};
      },
      startTelegramBot: () => calls.push('telegram'),
      runtimeLogger: silentLogger
    });

    assert.deepEqual(calls, ['schedule', 'auto-update']);
    assert.equal(summary.notification.restored, false);
    assert.equal(summary.schedule.restored, false);
    assert.equal(summary.schedule.error, 'invalid schedule');
    assert.equal(summary.autoUpdate.restored, true);
    assert.equal(summary.telegram.initialized, false);
  });

  it('initializes Telegram from the current config when no persisted notification exists', async () => {
    let telegramConfig = null;
    const currentTelegram = {
      enabled: true,
      botToken: 'environment-token',
      chatId: 'environment-chat'
    };

    const summary = await initializeRuntimeState({
      loadConfig: async () => ({ success: true, data: null }),
      applyNotificationConfig: () => assert.fail('no persisted notification should be applied'),
      readNotificationConfig: () => ({ channels: { telegram: currentTelegram } }),
      registerSchedule: () => assert.fail('no schedule should be registered'),
      registerAutoUpdate: () => assert.fail('no auto update should be registered'),
      resolveRuntimeConnection: async () => ({ adbPath: '/env/adb', address: 'env-device:5555' }),
      startTelegramBot: config => {
        telegramConfig = config;
      },
      runtimeLogger: silentLogger
    });

    assert.deepEqual(telegramConfig, {
      ...currentTelegram,
      adbPath: '/env/adb',
      adbAddress: 'env-device:5555'
    });
    assert.equal(summary.notification.restored, false);
    assert.equal(summary.telegram.initialized, true);
  });
});
