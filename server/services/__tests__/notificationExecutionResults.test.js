import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskCompletionMessage } from '../notificationService.js';

describe('structured execution notifications', () => {
  it('includes task actions, report results and warnings', () => {
    const message = buildTaskCompletionMessage({
      taskName: '晚间流程',
      totalTasks: 4,
      successTasks: 3,
      skippedTasks: 1,
      duration: 12000,
      actions: [
        { task: '理智作战', status: 'success', message: '作战完成：1-7 × 3；获得 2 种掉落' },
        { task: '自动公招', status: 'success', message: '公招处理完成：开始 1 次招募' },
        { task: '基建换班', status: 'success', message: '基建流程完成：已收取产物' },
        { task: '信用收支', status: 'skipped', message: '未启用好友访问、信用购物或信用作战，已跳过' }
      ],
      reports: [
        { provider: 'penguin', status: 'failed', message: '企鹅物流汇报失败' }
      ],
      warnings: ['存在未识别掉落，未发送汇报']
    });

    assert.equal(message.level, 'warning');
    assert.equal(message.title, '任务完成（部分失败/跳过）');
    assert.match(message.content, /执行结果/);
    assert.match(message.content, /作战完成：1-7 × 3/);
    assert.match(message.content, /公招处理完成/);
    assert.match(message.content, /基建流程完成/);
    assert.match(message.content, /信用收支/);
    assert.match(message.content, /掉落汇报/);
    assert.match(message.content, /执行提示/);
    assert.equal(message.data['汇报失败'], 1);
  });

  it('does not duplicate structured failures in the legacy error section', () => {
    const message = buildTaskCompletionMessage({
      failedTasks: 1,
      actions: [
        { task: '自动公招', status: 'failed', message: '自动公招未能进入公招界面' }
      ],
      errors: [
        { task: '自动公招', error: '自动公招未能进入公招界面' }
      ]
    });

    assert.equal(message.content.match(/自动公招未能进入公招界面/g)?.length, 1);
    assert.doesNotMatch(message.content, /失败任务/);
  });

  it('preserves legacy errors that have no structured action', () => {
    const message = buildTaskCompletionMessage({
      failedTasks: 1,
      errors: [{ task: '未知任务', error: '连接失败' }]
    });

    assert.match(message.content, /失败任务/);
    assert.match(message.content, /未知任务 - 连接失败/);
  });
});
