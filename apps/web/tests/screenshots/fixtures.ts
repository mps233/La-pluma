import { apiFixtures, ok, type ApiFixture } from '../visual/fixtures'

// README 截图展示“尚无最近执行”的空闲状态，避免把视觉基线的示例执行结果带进主图。
const runsCurrentFixture = apiFixtures.find(fixture => fixture.path === '/agent/runs/current')
if (!runsCurrentFixture) throw new Error('缺少 /agent/runs/current 视觉 fixture')
const runsCurrentPayload = runsCurrentFixture.payload as {
  success: boolean
  data: Record<string, unknown>
}
const runsCurrentSchedule = (runsCurrentPayload.data.schedule ?? {}) as Record<string, unknown>

const noRecentExecutionFixture: ApiFixture = {
  path: '/agent/runs/current',
  payload: {
    success: runsCurrentPayload.success,
    data: {
      ...runsCurrentPayload.data,
      schedule: {
        ...runsCurrentSchedule,
        lastResult: null,
      },
    },
  },
}

// README 的侧栏身份固定为阿米娅，不随视觉基线 fixture 调整。
const dailyQuoteFixture: ApiFixture = {
  path: '/operator-quotes/daily',
  payload: ok({
    operatorId: 'char_002_amiya',
    operator: '阿米娅',
    quote: '今天也请多指教',
  }),
}

const automationTaskFixture: ApiFixture = {
  path: '/agent/config/user/automation-tasks',
  payload: ok({
    taskFlow: [
      {
        id: 'readme-startup-1',
        commandId: 'startup',
        name: '启动游戏',
        description: '启动游戏并进入主界面',
        defaultParams: { clientType: 'Official', accountName: '' },
        params: { clientType: 'Official', accountName: '' },
        enabled: true,
      },
      {
        id: 'readme-infrast-2',
        commandId: 'infrast',
        name: '基建换班',
        description: '自动基建换班收菜',
        taskType: 'Infrast',
        defaultParams: {
          mode: '0',
          facility: ['Mfg', 'Trade', 'Power', 'Control', 'Reception', 'Office', 'Dorm'],
          drones: 'SyntheticJade',
          threshold: '0.3',
          replenish: true,
          filename: '',
          plan_index: 0,
          continue_training: false,
          dorm_notstationed_enabled: false,
          dorm_trust_enabled: false,
          reception_message_board: true,
          reception_clue_exchange: true,
          reception_send_clue: true,
        },
        params: {
          mode: '0',
          facility: ['Mfg', 'Trade', 'Power', 'Control', 'Reception', 'Office', 'Dorm'],
          drones: 'SyntheticJade',
          threshold: '0.3',
          replenish: true,
          filename: '',
          plan_index: 0,
          continue_training: false,
          dorm_notstationed_enabled: false,
          dorm_trust_enabled: false,
          reception_message_board: true,
          reception_clue_exchange: true,
          reception_send_clue: true,
        },
        enabled: true,
      },
      {
        id: 'readme-fight-3',
        commandId: 'fight',
        name: '理智作战',
        description: '自动刷关卡消耗理智',
        defaultParams: {
          stage: '1-7',
          stages: [{ stage: '1-7', times: '' }],
          medicine: 0,
          medicineExpireDays: 0,
          stone: 0,
          series: '1',
          drops: '',
          clientType: '',
          DrGrandet: false,
          report_to_penguin: false,
          penguin_id: '',
          report_to_yituliu: false,
          yituliu_id: '',
        },
        params: {
          stage: '1-7',
          stages: [{ stage: '1-7', times: '' }],
          medicine: 0,
          medicineExpireDays: 0,
          stone: 0,
          series: '0',
          drops: '',
          clientType: 'Official',
          DrGrandet: false,
          report_to_penguin: true,
          penguin_id: '',
          report_to_yituliu: false,
          yituliu_id: '',
        },
        enabled: true,
      },
      {
        id: 'readme-recruit-4',
        commandId: 'recruit',
        name: '自动公招',
        description: '自动公开招募',
        taskType: 'Recruit',
        defaultParams: {
          refresh: true,
          force_refresh: true,
          select: [4, 5, 6],
          confirm: [3, 4],
          first_tags: '',
          extra_tags_mode: 0,
          times: '4',
          set_time: true,
          expedite: false,
          expedite_times: 0,
          preserve_tags: '支援机械',
          recruitment_time: { '3': 540, '4': 540 },
        },
        params: {
          refresh: true,
          force_refresh: true,
          select: [4, 5, 6],
          confirm: [3, 4, 5],
          first_tags: '',
          extra_tags_mode: 0,
          times: '4',
          set_time: true,
          expedite: false,
          expedite_times: 0,
          preserve_tags: '',
          recruitment_time: { '3': 540, '4': 540 },
        },
        enabled: true,
      },
      {
        id: 'readme-mall-5',
        commandId: 'mall',
        name: '信用收支',
        description: '访问好友、收取信用',
        taskType: 'Mall',
        defaultParams: {
          visit_friends: true,
          shopping: true,
          buy_first: '',
          blacklist: '',
          force_shopping_if_credit_full: false,
          only_buy_discount: false,
          reserve_max_credit: false,
          credit_fight: false,
          formation_index: 0,
        },
        params: {
          visit_friends: true,
          shopping: true,
          buy_first: '',
          blacklist: '',
          force_shopping_if_credit_full: false,
          only_buy_discount: false,
          reserve_max_credit: false,
          credit_fight: false,
          formation_index: 0,
        },
        enabled: true,
      },
      {
        id: 'readme-award-6',
        commandId: 'award',
        name: '领取奖励',
        description: '领取每日/每周奖励',
        taskType: 'Award',
        defaultParams: {
          award: true,
          mail: true,
          recruit: false,
          orundum: false,
          mining: false,
          specialaccess: false,
        },
        params: {
          award: true,
          mail: true,
          recruit: false,
          orundum: false,
          mining: false,
          specialaccess: false,
        },
        enabled: true,
      },
      {
        id: 'readme-closedown-7',
        commandId: 'closedown',
        name: '关闭游戏',
        description: '关闭游戏客户端',
        defaultParams: { clientType: 'Official', recognizeDepotBeforeClose: false, recognizeOperBoxBeforeClose: false },
        params: { clientType: 'Official', recognizeDepotBeforeClose: true, recognizeOperBoxBeforeClose: false },
        enabled: true,
      },
    ],
    schedule: {
      enabled: true,
      entries: [
        { time: '05:00', enabled: true },
        { time: '12:00', enabled: true },
        { time: '20:00', enabled: true },
      ],
    },
  }),
}

const overrides = [noRecentExecutionFixture, dailyQuoteFixture, automationTaskFixture]

export const readmeApiFixtures: ApiFixture[] = [
  ...apiFixtures.filter(fixture => !overrides.some(override => override.path === fixture.path)),
  ...overrides,
]
