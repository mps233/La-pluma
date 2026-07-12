import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AGENT_TASK_COMMANDS,
  createDailyFlowExecutionError,
  executeAgentTask,
  normalizeDailyFlowRequest
} from '../agentActionService.js';

function createExecutors() {
  const calls = [];
  return {
    calls,
    dependencies: {
      execMaaCommand: async (...args) => {
        calls.push({ executor: 'command', args });
        return { success: true, executor: 'command' };
      },
      execDynamicTask: async (...args) => {
        calls.push({ executor: 'dynamic', args });
        return { success: true, executor: 'dynamic' };
      }
    }
  };
}

describe('executeAgentTask', () => {
  it('executes a dynamic task with normalized config and all metadata', async () => {
    const { calls, dependencies } = createExecutors();

    const result = await executeAgentTask({
      command: 'run',
      args: ['custom-task'],
      taskConfig: JSON.stringify({ name: '自定义作战', type: 'Fight', params: { stage: '1-7' } }),
      taskName: '自定义作战',
      taskType: 'automation',
      waitForCompletion: false,
      userResource: true
    }, dependencies);

    assert.equal(result.executor, 'dynamic');
    assert.deepEqual(calls, [{
      executor: 'dynamic',
      args: [
        'custom-task',
        { name: '自定义作战', type: 'Fight', params: { stage: '1-7' } },
        '自定义作战',
        'automation',
        false,
        true
      ]
    }]);
  });

  it('falls back to the command for a dynamic depot task without args', async () => {
    const { calls, dependencies } = createExecutors();

    await executeAgentTask({ command: 'depot', taskConfig: { name: '仓库识别', type: 'Depot' } }, dependencies);

    assert.deepEqual(calls[0], {
      executor: 'dynamic',
      args: ['depot', { name: '仓库识别', type: 'Depot', params: {} }, 'Agent: depot', 'agent', true, false]
    });
  });

  it('executes a regular task with string args and caller metadata', async () => {
    const { calls, dependencies } = createExecutors();

    await executeAgentTask({
      command: 'fight',
      args: ['1-7', 3],
      taskName: '刷固源岩',
      taskType: 'combat',
      waitForCompletion: false
    }, dependencies);

    assert.deepEqual(calls[0], {
      executor: 'command',
      args: ['fight', ['1-7', '3'], '刷固源岩', 'combat', false]
    });
  });

  it('allows the list command', async () => {
    const { calls, dependencies } = createExecutors();

    await executeAgentTask({ command: 'list' }, dependencies);

    assert.ok(AGENT_TASK_COMMANDS.includes('list'));
    assert.deepEqual(calls[0], {
      executor: 'command',
      args: ['list', [], null, null, true]
    });
  });

  it('runs read-only activity queries without overwriting tracked task state', async () => {
    const { calls, dependencies } = createExecutors();

    await executeAgentTask({
      command: 'activity',
      taskName: '不应进入状态栏',
      taskType: 'agent',
      waitForCompletion: false
    }, dependencies);

    assert.deepEqual(calls[0], {
      executor: 'command',
      args: ['activity', [], null, null, true]
    });
  });

  it('rejects commands outside the allowlist', async () => {
    const { dependencies } = createExecutors();

    await assert.rejects(
      executeAgentTask({ command: 'install' }, dependencies),
      error => {
        assert.equal(error.code, 'AGENT_VALIDATION_COMMAND_NOT_ALLOWED');
        assert.equal(error.statusCode, 400);
        assert.equal(error.retryable, false);
        assert.equal(error.details.command, 'install');
        assert.deepEqual(error.details.allowed, [...AGENT_TASK_COMMANDS]);
        return true;
      }
    );
  });

  it('rejects malformed and non-object task configs', async () => {
    const { dependencies } = createExecutors();

    for (const taskConfig of ['{bad json', '[]', 'null', 42, {}, { name: '任务', type: 'Fight', params: [] }]) {
      await assert.rejects(
        executeAgentTask({ command: 'run', taskConfig }, dependencies),
        error => error.code === 'AGENT_VALIDATION_TASK_CONFIG_INVALID' && error.statusCode === 400
      );
    }
  });

  it('rejects dynamic task ids that could escape the task directory', async () => {
    const { dependencies } = createExecutors();

    await assert.rejects(
      executeAgentTask({
        command: 'run',
        args: ['../outside'],
        taskConfig: { name: '理智作战', type: 'Fight' }
      }, dependencies),
      error => {
        assert.equal(error.code, 'AGENT_VALIDATION_TASK_ID_INVALID');
        assert.equal(error.statusCode, 400);
        assert.equal(error.details.taskId, '../outside');
        return true;
      }
    );
  });

  it('rejects non-array args instead of silently discarding them', async () => {
    const { dependencies } = createExecutors();

    await assert.rejects(
      executeAgentTask({ command: 'fight', args: '1-7' }, dependencies),
      error => {
        assert.equal(error.code, 'AGENT_VALIDATION_ARGS_INVALID');
        assert.equal(error.statusCode, 400);
        assert.deepEqual(error.details, { receivedType: 'string' });
        return true;
      }
    );
  });

  it('rejects task metadata and execution flags with the wrong types', async () => {
    const { dependencies } = createExecutors();

    await assert.rejects(
      executeAgentTask({ command: 'award', taskName: { text: '领取奖励' } }, dependencies),
      error => error.code === 'AGENT_VALIDATION_TASK_NAME_INVALID'
    );
    await assert.rejects(
      executeAgentTask({ command: 'award', waitForCompletion: 'false' }, dependencies),
      error => error.code === 'AGENT_VALIDATION_WAIT_FOR_COMPLETION_INVALID'
    );
    await assert.rejects(
      executeAgentTask({ command: 'run', taskConfig: {}, userResource: 1 }, dependencies),
      error => error.code === 'AGENT_VALIDATION_USER_RESOURCE_INVALID'
    );
  });
});

describe('normalizeDailyFlowRequest', () => {
  it('normalizes the optional daily flow inputs', () => {
    assert.deepEqual(normalizeDailyFlowRequest({ scheduleId: '  morning  ', dryRun: true }), {
      dryRun: true,
      scheduleId: 'morning',
      taskFlow: null
    });
  });

  it('rejects ambiguous daily flow input types', () => {
    assert.throws(
      () => normalizeDailyFlowRequest({ dryRun: 'false' }),
      error => error.code === 'AGENT_VALIDATION_DRY_RUN_INVALID'
    );
    assert.throws(
      () => normalizeDailyFlowRequest({ taskFlow: {} }),
      error => error.code === 'AGENT_VALIDATION_TASK_FLOW_INVALID'
    );
    assert.throws(
      () => normalizeDailyFlowRequest({ scheduleId: { id: 'morning' } }),
      error => error.code === 'AGENT_VALIDATION_SCHEDULE_ID_INVALID'
    );
  });
});

describe('createDailyFlowExecutionError', () => {
  it('returns a retryable conflict for an occupied executor', () => {
    const owner = { taskName: '仓库识别', command: 'run' };
    const error = createDailyFlowExecutionError({
      success: false,
      busy: true,
      message: 'MAA 正在执行：仓库识别',
      owner
    });

    assert.equal(error.code, 'AGENT_EXECUTION_BUSY');
    assert.equal(error.statusCode, 409);
    assert.equal(error.retryable, true);
    assert.deepEqual(error.details, { owner });
  });

  it('recognizes the scheduler already-running message as busy', () => {
    const error = createDailyFlowExecutionError({
      success: false,
      message: '已有任务流程正在执行'
    });

    assert.equal(error.code, 'AGENT_EXECUTION_BUSY');
    assert.equal(error.statusCode, 409);
    assert.deepEqual(error.details, { owner: null });
  });

  it('returns a non-retryable validation error for other rejections', () => {
    const result = { success: false, message: '自定义换班需要填写排班文件路径' };
    const error = createDailyFlowExecutionError(result);

    assert.equal(error.code, 'AGENT_DAILY_FLOW_REJECTED');
    assert.equal(error.statusCode, 400);
    assert.equal(error.retryable, false);
    assert.deepEqual(error.details, { result });
  });

  it('returns null for successful or absent results', () => {
    assert.equal(createDailyFlowExecutionError({ success: true }), null);
    assert.equal(createDailyFlowExecutionError(null), null);
  });
});
