import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  setNotificationConfig,
  shouldCaptureNotificationScreenshot
} from '../notificationService.js';

describe('notification screenshots', () => {
  it('does not capture when notifications are disabled', () => {
    setNotificationConfig({
      enabled: false,
      channels: { telegram: { enabled: true, botToken: 'token', chatId: 'chat' } }
    });
    assert.equal(shouldCaptureNotificationScreenshot(), false);
  });

  it('does not capture for an incomplete Telegram channel', () => {
    setNotificationConfig({
      enabled: true,
      channels: { telegram: { enabled: true, botToken: '', chatId: 'chat' } }
    });
    assert.equal(shouldCaptureNotificationScreenshot(), false);
  });

  it('captures only for an enabled and configured image channel', () => {
    setNotificationConfig({
      enabled: true,
      channels: { telegram: { enabled: true, botToken: 'token', chatId: 'chat' } }
    });
    assert.equal(shouldCaptureNotificationScreenshot(), true);
  });
});
