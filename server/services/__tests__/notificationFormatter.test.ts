import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatTelegramMessage } from '../notificationService.ts';

const fixedTime = new Date('2026-07-26T12:34:56.000Z');
const formattedTime = fixedTime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

describe('Telegram notification formatting', () => {
  it('formats the level, content, structured details and timestamp once', () => {
    const text = formatTelegramMessage(
      '任务完成',
      '自动化流程已完成',
      'success',
      { 成功: 3, 耗时: '12 秒' },
      fixedTime
    );

    assert.equal(text, [
      '✅ *任务完成*',
      '',
      '自动化流程已完成',
      '',
      '📊 *详细信息*',
      '• 成功: 3',
      '• 耗时: 12 秒',
      '',
      `🕐 ${formattedTime}`
    ].join('\n'));
  });

  it('falls back to the info icon and omits an absent detail section', () => {
    const text = formatTelegramMessage('状态', '没有额外数据', 'unknown', null, fixedTime);

    assert.match(text, /^ℹ️ \*状态\*\n\n没有额外数据/);
    assert.doesNotMatch(text, /详细信息/);
    assert.equal(text.match(/🕐/g)?.length, 1);
  });
});
