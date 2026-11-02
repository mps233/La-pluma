import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { initializeRuntimeState } from '../runtimeInitializationService.ts';
import type { NotificationConfig } from '../notificationService.ts';

type RuntimeOverrides = NonNullable<Parameters<typeof initializeRuntimeState>[0]>;
type RuntimeDependencies = Required<RuntimeOverrides>;
type TelegramConfig = NonNullable<Parameters<RuntimeDependencies['startTelegramBot']>[0]>;

const silentLogger: RuntimeDependencies['runtimeLogger'] = {
  info() {},
  warn() {},
  error() {}
};

interface RuntimeCalls {
  notification?: unknown;
  schedule?: unknown;
  autoUpdate?: unknown;
  telegram?: unknown;
}

interface AutomationConfigFixture {
  taskFlow: Array<{ id: string; enabled: boolean; commandId: string }>;
  schedule: { enabled: boolean; times: string[] };
}

interface AutoUpdateConfigFixture {
  enabled: boolean;
  time: string;
  updateCore: boolean;
  updateCli: boolean;
}

describe('runtime initialization', () => {
  it('restores persisted runtime state before initializing Telegram', async () => {
    const notification: NotificationConfig = {
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
    const automation: AutomationConfigFixture = {
      taskFlow: [{ id: 'award-1', enabled: true, commandId: 'award' }],
      schedule: { enabled: true, times: ['04:30', '12:00'] }
    };
    const autoUpdate: AutoUpdateConfigFixture = {
      enabled: true,
      time: '03:00',
      updateCore: true,
      updateCli: false
    };
    const persisted: Record<string, unknown> = {
      notification,
      'automation-tasks': automation,
      'auto-update': autoUpdate
    };
    const calls: RuntimeCalls = {};
    let activeNotification: NotificationConfig | null = null;

    const summary = await initializeRuntimeState({
      loadConfig: async configType => ({
        success: true,
        message: '',
        data: typeof configType === 'string' ? persisted[configType] : undefined,
        meta: { requestId: null, dryRun: false }
      }),
      applyNotificationConfig: config => {
        calls.notification = config;
        activeNotification = config;
      },
      readNotificationConfig: () => activeNotification ?? { enabled: false, channels: {} },
      registerSchedule: (scheduleId, times, taskFlow) => {
        calls.schedule = { scheduleId, times, taskFlow };
        return { success: true, message: 'restored schedule' };
      },
      registerAutoUpdate: config => {
        calls.autoUpdate = config;
        return { success: true, message: 'restored auto update' };
      },
      resolveRuntimeConnection: async () => ({ profileId: 'default', adbPath: '/usr/bin/adb', address: 'emulator:5555', clientType: 'Official' }),
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
    const calls: string[] = [];
    const summary = await initializeRuntimeState({
      loadConfig: async configType => {
        if (configType === 'notification') throw new Error('notification storage unavailable');
        if (configType === 'automation-tasks') {
          return {
            success: true,
            message: '',
            data: { taskFlow: [], schedule: { enabled: true, times: ['05:00'] } },
            meta: { requestId: null, dryRun: false }
          };
        }
        return {
          success: true,
          message: '',
          data: { enabled: true, time: '06:00', updateCore: true, updateCli: true },
          meta: { requestId: null, dryRun: false }
        };
      },
      applyNotificationConfig: () => calls.push('notification'),
      readNotificationConfig: () => ({ enabled: false, channels: {} }),
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
        return { profileId: 'default', adbPath: '/bin/adb', address: 'device:5555', clientType: 'Official' };
      },
      startTelegramBot: () => {
        calls.push('telegram');
      },
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
    let telegramConfig: TelegramConfig | null = null;
    const currentTelegram = {
      enabled: true,
      botToken: 'environment-token',
      chatId: 'environment-chat'
    };

    const summary = await initializeRuntimeState({
      loadConfig: async () => ({ success: true, message: '', data: null, meta: { requestId: null, dryRun: false } }),
      applyNotificationConfig: () => assert.fail('no persisted notification should be applied'),
      readNotificationConfig: () => ({ enabled: false, channels: { telegram: currentTelegram } }),
      registerSchedule: () => assert.fail('no schedule should be registered'),
      registerAutoUpdate: () => assert.fail('no auto update should be registered'),
      resolveRuntimeConnection: async () => ({ profileId: 'default', adbPath: '/env/adb', address: 'env-device:5555', clientType: 'Official' }),
      startTelegramBot: config => {
        telegramConfig = config ?? null;
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
