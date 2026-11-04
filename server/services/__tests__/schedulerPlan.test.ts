import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildScheduledTaskFlowPlan, validateScheduledTaskFlow } from '../schedulerService.ts'
import { isRecord } from '../../utils/errors.ts'

type PlanResult = ReturnType<typeof buildScheduledTaskFlowPlan>
type PlanStep = NonNullable<PlanResult['steps']>[number]

interface PlannedTaskConfig {
  name?: unknown
  type?: unknown
  client_type?: unknown
  params?: Record<string, unknown>
  condition?: unknown
  variants?: unknown
  tasks?: PlannedTaskConfig[]
}

function firstStep(result: PlanResult): PlanStep {
  assert.equal(result.success, true)
  assert.ok(result.steps)
  return result.steps[0]
}

function configOf(step: PlanStep): PlannedTaskConfig {
  assert.ok(isRecord(step.taskConfig))
  return step.taskConfig as PlannedTaskConfig
}

describe('scheduled task flow planning', () => {
  it('uses the same dynamic task config as execution for MaaCore task types', () => {
    const step = firstStep(buildScheduledTaskFlowPlan([{
      id: 'recruit-1',
      commandId: 'recruit',
      name: '自动公招',
      enabled: true,
      taskType: 'Recruit',
      params: {
        refresh: true,
        times: '4',
        recruitment_time: { 3: '540', 4: 540 }
      }
    }]))

    assert.deepEqual(step, {
      index: 1,
      id: 'recruit-1',
      name: '自动公招',
      command: 'run',
      args: ['recruit'],
      dynamicTask: true,
      taskConfig: {
        name: '自动公招',
        type: 'Recruit',
        client_type: 'Official',
        params: {
          refresh: true,
          times: 4,
          recruitment_time: { 3: 540, 4: 540 }
        }
      }
    })
  })

  it('passes maa-cli condition and variants into dynamic task configs', () => {
    const step = firstStep(buildScheduledTaskFlowPlan([{
      id: 'award-1',
      commandId: 'award',
      name: '领取奖励',
      enabled: true,
      taskType: 'Award',
      condition: { type: 'Weekday', weekdays: [3] },
      variants: [{ condition: { type: 'Time', start: '18:00:00' }, params: { mail: true } }],
      params: { award: true }
    }]));

    const config = configOf(step);
    assert.deepEqual(config.condition, { type: 'Weekday', weekdays: [3] });
    assert.deepEqual(config.variants, [{
      condition: { type: 'Time', start: '18:00:00' },
      params: { mail: true }
    }]);
  });

  it('emits calculation-only Recruit params from the explicit switch', () => {
    const step = firstStep(buildScheduledTaskFlowPlan([{
      id: 'recruit-1',
      commandId: 'recruit',
      name: '自动公招',
      enabled: true,
      taskType: 'Recruit',
      params: { refresh: true, times: '4', confirm: [3, 4], calculationOnly: true }
    }]))

    assert.deepEqual(configOf(step).params, {
      refresh: true,
      times: 0,
      confirm: [],
      set_time: false
    })
  })

  it('uses a dynamic StartUp task when client launch is disabled', () => {
    const step = firstStep(buildScheduledTaskFlowPlan([{
      id: 'startup-1',
      commandId: 'startup',
      name: '启动游戏',
      enabled: true,
      params: { clientType: 'Bilibili', accountName: '4567', startGameEnabled: false }
    }]))

    const config = configOf(step);
    assert.equal(step.command, 'run')
    assert.deepEqual(step.args, ['startup'])
    assert.equal(step.dynamicTask, true)
    assert.equal(config.type, 'StartUp')
    assert.equal(config.client_type, 'Bilibili')
    assert.deepEqual(config.params, {
      start_game_enabled: false,
      account_name: '4567'
    })
  })

  it('switches fight to a multi-task dynamic config for new Core-only fields', () => {
    const step = firstStep(buildScheduledTaskFlowPlan([{
      id: 'fight-1',
      commandId: 'fight',
      name: '理智作战',
      enabled: true,
      params: {
        stages: [{ stage: '1-7', times: 3 }, { stage: 'CE-6', times: '' }],
        medicine: 2,
        medicineExpireDays: 2,
        server: 'JP',
        stone: 1,
        series: 7,
        drops: '30011=10,30062=5'
      }
    }]))

    const config = configOf(step);
    assert.equal(step.command, 'run')
    assert.deepEqual(step.args, ['fight'])
    assert.equal(step.dynamicTask, true)
    assert.equal(config.type, 'Fight')
    assert.ok(config.tasks)
    assert.equal(config.tasks.length, 2)
    assert.deepEqual(config.tasks[0].params, {
      medicine: 2,
      medicine_expire_days: 2,
      stone: 1,
      series: 7,
      drops: { 30011: 10, 30062: 5 },
      server: 'JP',
      stage: '1-7',
      times: 3
    })
    assert.equal(config.tasks[1].params?.stage, 'CE-6')
  })

  it('switches series above the CLI limit to a dynamic fight task', () => {
    const step = firstStep(buildScheduledTaskFlowPlan([{
      id: 'fight-1',
      commandId: 'fight',
      name: '理智作战',
      enabled: true,
      params: { stages: [{ stage: '1-7', times: 2 }], series: 8 }
    }]))

    const config = configOf(step);
    assert.equal(step.dynamicTask, true)
    assert.ok(config.tasks)
    assert.equal(config.tasks[0].params?.series, 8)
  })

  it('includes every advanced fight argument in the confirmation plan', () => {
    const step = firstStep(buildScheduledTaskFlowPlan([{
      id: 'fight-1',
      commandId: 'fight',
      name: '理智作战',
      enabled: true,
      params: {
        stages: [{ stage: '1-7', times: 3 }, { stage: 'CE-6', times: '' }],
        medicine: 2,
        expiringMedicine: 1,
        stone: 0,
        series: 2,
        drops: '30011=10,30062=5',
        clientType: 'Bilibili',
        DrGrandet: true,
        report_to_penguin: true,
        penguin_id: 'penguin-user',
        report_to_yituliu: true,
        yituliu_id: 'yituliu-user'
      }
    }]))

    assert.deepEqual(step.args, [
      '1-7:3,CE-6', '-m', '2', '--expiring-medicine', '1', '--stone', '0', '--series=2',
      '-D30011=10', '-D30062=5', '--client-type', 'Bilibili', '--dr-grandet',
      '--report-to-penguin', '--penguin-id', 'penguin-user',
      '--report-to-yituliu', '--yituliu-id', 'yituliu-user'
    ])
  })

  it('includes the resolved connection and visible pre-actions', () => {
    const result = buildScheduledTaskFlowPlan([{
      id: 'startup-1',
      commandId: 'startup',
      name: '启动游戏',
      enabled: true,
      params: { clientType: 'Official', accountName: '4567' }
    }, {
      id: 'closedown-1',
      commandId: 'closedown',
      name: '关闭游戏',
      enabled: true,
      params: { clientType: 'Official', recognizeDepotBeforeClose: true }
    }], { address: '127.0.0.1:16384' })

    assert.equal(result.success, true)
    assert.ok(result.steps)
    assert.deepEqual(result.steps[0].args, ['-a', '127.0.0.1:16384', '--account-name', '4567', 'Official'])
    assert.deepEqual(result.steps[1].preActions, [{ action: 'depot-recognition' }])
  })

  it('runs the scheduler validation during dry-run planning', () => {
    const invalidInfrast = [{
      id: 'infrast-1',
      enabled: true,
      taskType: 'Infrast',
      params: { mode: 10000, filename: '' }
    }]
    const invalidDrops = [{
      id: 'fight-1',
      commandId: 'fight',
      enabled: true,
      params: { stage: '1-7', drops: 'invalid-target' }
    }]

    assert.equal(validateScheduledTaskFlow(invalidInfrast).success, false)
    assert.match(buildScheduledTaskFlowPlan(invalidInfrast).message ?? '', /排班文件/)
    assert.match(buildScheduledTaskFlowPlan(invalidDrops).message ?? '', /掉落目标格式/)
  })

  it('rejects malformed task entries without throwing', () => {
    assert.deepEqual(validateScheduledTaskFlow([null]), {
      success: false,
      message: '任务流程中的每一项都必须是对象',
      details: { index: 0 }
    })
    assert.equal(buildScheduledTaskFlowPlan([[]]).success, false)
  })
})
