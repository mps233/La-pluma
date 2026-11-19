import type { TaskCommandId, TaskParams } from '../types'

export interface AutomationTaskDefaults {
  id: TaskCommandId
  name: string
  description: string
  defaultParams: TaskParams
  taskType?: string
}

export const AUTOMATION_TASK_DEFAULTS: readonly AutomationTaskDefaults[] = [
  {
    id: 'startup',
    name: '启动游戏',
    description: '启动游戏并进入主界面',
    defaultParams: {
      clientType: 'Official',
      accountName: '',
      start_game_enabled: true
    },
  },
  {
    id: 'fight',
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
      yituliu_id: ''
    },
  },
  {
    id: 'infrast',
    name: '基建换班',
    description: '自动基建换班收菜',
    defaultParams: {
      mode: '0',
      facility: ['Mfg', 'Trade', 'Power', 'Control', 'Reception', 'Office', 'Dorm'],
      drones: 'Money',
      threshold: '0.3',
      replenish: false,
      filename: '',
      plan_index: 0,
      continue_training: false,
      dorm_notstationed_enabled: false,
      dorm_trust_enabled: false,
      reception_message_board: true,
      reception_clue_exchange: true,
      reception_send_clue: true
    },
    taskType: 'Infrast'
  },
  {
    id: 'recruit',
    name: '自动公招',
    description: '自动公开招募',
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
      level3_recruitment_permit_reserve: 0,
      recruitment_time: { '3': 540, '4': 540 }
    },
    taskType: 'Recruit'
  },
  {
    id: 'mall',
    name: '信用收支',
    description: '访问好友、收取信用',
    defaultParams: {
      visit_friends: true,
      shopping: true,
      buy_first: '',
      blacklist: '',
      force_shopping_if_credit_full: false,
      only_buy_discount: false,
      reserve_max_credit: false,
      credit_fight: false,
      formation_index: 0
    },
    taskType: 'Mall'
  },
  {
    id: 'award',
    name: '领取奖励',
    description: '领取每日/每周奖励',
    defaultParams: {
      award: true,
      mail: true,
      recruit: false,
      orundum: false,
      mining: false,
      specialaccess: false,
      signinevent: false
    },
    taskType: 'Award'
  },
  {
    id: 'operprogress',
    name: '游戏内培养',
    description: '在游戏内提升精英阶段、技能等级或启动专精训练',
    defaultParams: { plans: [] },
    taskType: 'OperProgress',
  },
  {
    id: 'switchtheme',
    name: '更换游戏主题',
    description: '从候选主题中随机选择一个游戏界面主题',
    defaultParams: { themes: [] },
    taskType: 'SwitchTheme',
  },
  {
    id: 'closedown',
    name: '关闭游戏',
    description: '关闭游戏客户端',
    defaultParams: {
      clientType: 'Official',
      recognizeDepotBeforeClose: false,
      recognizeOperBoxBeforeClose: false
    },
  },
]

const AUTOMATION_TASK_DEFAULTS_BY_COMMAND = new Map(
  AUTOMATION_TASK_DEFAULTS.map(task => [task.id, task]),
)

export function findAutomationTaskDefaults(commandId: string): AutomationTaskDefaults | undefined {
  return AUTOMATION_TASK_DEFAULTS_BY_COMMAND.get(commandId as TaskCommandId)
}
