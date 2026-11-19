import Icons from '@/shared/components/Icons'
import { GraduationCap, Palette } from 'lucide-react'
import { AUTOMATION_TASK_DEFAULTS } from '../model/automationTaskDefaults'
import type { AutomationAvailableTask, TaskCommandId, TaskParamField } from '../types'

const TASK_ICONS: Record<TaskCommandId, AutomationAvailableTask['icon']> = {
  startup: <Icons.Play />,
  fight: <Icons.Sword />,
  infrast: <Icons.Building />,
  recruit: <Icons.Users />,
  mall: <Icons.Cash />,
  award: <Icons.Gift />,
  operprogress: <GraduationCap size={16} />,
  switchtheme: <Palette size={16} />,
  closedown: <Icons.Stop />,
}

const TASK_PARAM_FIELDS: Record<TaskCommandId, TaskParamField[]> = {
  startup: [
    { key: 'clientType', label: '客户端类型', type: 'select', options: [
      { value: 'Official', label: '官服' },
      { value: 'Bilibili', label: 'B服' },
      { value: 'YoStarEN', label: '美服' },
      { value: 'YoStarJP', label: '日服' },
      { value: 'YoStarKR', label: '韩服' },
      { value: 'Txwy', label: '繁中服' }
    ]},
    { key: 'accountName', label: '切换账号', type: 'text', placeholder: '留空则不切换', helper: '输入已登录账号的部分字符即可，如 "123****4567" 可输入 "4567"', helperPlacement: 'tooltip' },
    { key: 'start_game_enabled', label: '启动游戏客户端', type: 'checkbox', helper: '关闭后只连接设备并进入已有游戏的主界面，不会启动游戏客户端', helperPlacement: 'tooltip' }
  ],
  fight: [
    { key: 'stages', label: '关卡', type: 'multi-stages', placeholder: '1-7 或 HD-7', timesPlaceholder: '次数', helper: '使用 HD-数字代表当前活动关卡；置顶关卡会优先执行。次数为该关卡的累计作战局数上限（连战中的每一局都计 1），留空表示不限制局数', helperPlacement: 'tooltip' },
    { key: 'drops', label: '掉落目标', type: 'text', placeholder: '30011=10,30062=5', helper: '任一物品达到目标数量后停止；格式为物品 ID=数量，多个目标用逗号分隔', helperPlacement: 'tooltip' },
    { key: 'medicine', label: '理智药', type: 'number', placeholder: '0', helper: '使用理智药数量', helperPlacement: 'tooltip' },
    { key: 'medicineExpireDays', label: '临期药天数', type: 'number', placeholder: '0', helper: '使用将在指定天数内过期的理智药；0 表示不使用临期药', helperPlacement: 'tooltip' },
    { key: 'stone', label: '源石', type: 'number', placeholder: '0', helper: '使用源石数量', helperPlacement: 'tooltip' },
    { key: 'series', label: '连战', type: 'select', options: [
      { value: '-1', label: '禁用' },
      { value: '0', label: '自动' },
      { value: '1', label: '1次' },
      { value: '2', label: '2次' },
      { value: '3', label: '3次' },
      { value: '4', label: '4次' },
      { value: '5', label: '5次' },
      { value: '6', label: '6次' },
      { value: '7', label: '7次' },
      { value: '8', label: '8次' },
      { value: '9', label: '9次' },
      { value: '10', label: '10次' }
    ], helper: '本任务所有关卡共用的连战倍率，范围 -1 至 10（旧资源只支持 -1 至 6）；与各关卡次数同时生效：固定倍率时次数少于倍率不会开始任何一局（0 局）；指定倍率不能整除剩余次数时最后一轮连战不会开始，实际局数会少于次数；选“自动”会按剩余次数调整', helperPlacement: 'tooltip' },
  ],
  infrast: [
    { key: 'mode', label: '换班模式', type: 'select', options: [
      { value: '0', label: '默认换班' },
      { value: '10000', label: '自定义换班' },
      { value: '20000', label: '一键轮换' }
    ], helper: '一键轮换使用游戏内队列，并保留无人机、会客室等基础操作', helperPlacement: 'tooltip' },
    { key: 'facility', label: '设施选择', type: 'facility-select' },
    { key: 'drones', label: '无人机用途', type: 'select', options: [
      { value: '_NotUse', label: '不使用无人机' },
      { value: 'Money', label: '龙门币' },
      { value: 'SyntheticJade', label: '合成玉' },
      { value: 'CombatRecord', label: '作战记录' },
      { value: 'PureGold', label: '赤金' },
      { value: 'OriginStone', label: '源石碎片' },
      { value: 'Chip', label: '芯片' }
    ], hiddenWhen: { key: 'mode', value: '10000' } },
    { key: 'threshold', label: '心情阈值', type: 'number', placeholder: '0.3', step: '0.1', min: '0', max: '1' },
    { key: 'replenish', label: '自动补货', type: 'checkbox' },
    { key: 'filename', label: '自定义排班', type: 'infrast-schedule', helper: '在 MAA 配置目录的 infrast 文件夹中选择或新建排班文件；相对路径与 maa-cli 一致', visibleWhen: { key: 'mode', value: '10000' } },
  ],
  recruit: [
    { key: 'refresh', label: '刷新标签', type: 'checkbox' },
    { key: 'force_refresh', label: '无许可时仍刷新', type: 'checkbox', helper: '招聘许可耗尽后，仍会使用可用刷新次数', helperPlacement: 'tooltip', visibleWhen: { key: 'refresh', value: true } },
    { key: 'select', label: '招募星级', type: 'star-select', helper: '支持 6 星自动公招；勾选 6 星后会保留高价值标签并自动选择对应组合', helperPlacement: 'tooltip' },
    { key: 'confirm', label: '确认星级', type: 'star-select', helper: '建议至少保留 5/6 星确认，避免高价值标签被跳过；不勾选任何星级时只计算标签，不会确认招募', helperPlacement: 'tooltip' },
    { key: 'times', label: '招募次数', type: 'number', placeholder: '4', helper: '设为 0 时只计算标签，不执行招募', helperPlacement: 'tooltip' },
    { key: 'set_time', label: '设置时间', type: 'checkbox' },
    { key: 'expedite', label: '使用加急', type: 'checkbox' },
    { key: 'expedite_times', label: '加急次数', type: 'number', placeholder: '0', visibleWhen: { key: 'expedite', value: true } },
    { key: 'preserve_tags', label: '保留标签', type: 'text', placeholder: '支援机械,高级资深干员', helper: '识别到任一标签时保留该公招槽位，多个标签用逗号分隔', helperPlacement: 'tooltip' },
    { key: 'level3_recruitment_permit_reserve', label: '3 星保留招聘许可', type: 'number', placeholder: '0', min: '0', helper: '自动确认 3 星时保留的招聘许可数量；剩余许可小于等于该值时跳过 3 星招募，0 表示不保留', helperPlacement: 'tooltip' },
  ],
  mall: [
    { key: 'visit_friends', label: '访问好友', type: 'checkbox' },
    { key: 'shopping', label: '自动购物', type: 'checkbox' },
    { key: 'buy_first', label: '优先购买', type: 'text', placeholder: '招聘许可,龙门币（逗号分隔）', visibleWhen: { key: 'shopping', value: true } },
    { key: 'blacklist', label: '黑名单', type: 'text', placeholder: '家具零件,碳（逗号分隔）', visibleWhen: { key: 'shopping', value: true } },
    { key: 'only_buy_discount', label: '只买折扣商品', type: 'checkbox', helper: '仅影响优先购买之外的普通购物', helperPlacement: 'tooltip', visibleWhen: { key: 'shopping', value: true } },
    { key: 'reserve_max_credit', label: '保留 300 信用', type: 'checkbox', helper: '普通购物时信用低于 300 就停止购买', helperPlacement: 'tooltip', visibleWhen: { key: 'shopping', value: true } },
    { key: 'force_shopping_if_credit_full', label: '信用溢出时无视黑名单', type: 'checkbox', visibleWhen: { key: 'shopping', value: true } },
    { key: 'credit_fight', label: '信用助战', type: 'checkbox', helper: '借助战完成一次 OF-1，以便次日获得更多信用', helperPlacement: 'tooltip' },
    { key: 'formation_index', label: '助战编队', type: 'select', options: [
      { value: '0', label: '当前编队' },
      { value: '1', label: '编队 1' },
      { value: '2', label: '编队 2' },
      { value: '3', label: '编队 3' },
      { value: '4', label: '编队 4' }
    ], visibleWhen: { key: 'credit_fight', value: true } },
  ],
  award: [
    { key: 'award', label: '日常与周常奖励', type: 'checkbox' },
    { key: 'mail', label: '邮件奖励', type: 'checkbox' },
    { key: 'recruit', label: '限定池免费单抽', type: 'checkbox', helper: '活动期间领取限定池赠送的每日免费单抽；没有免费次数时不抽取', helperPlacement: 'tooltip' },
    { key: 'orundum', label: '合成玉奖励', type: 'checkbox' },
    { key: 'mining', label: '采矿奖励', type: 'checkbox' },
    { key: 'specialaccess', label: '周年赠送月卡', type: 'checkbox', helper: '领取周年活动赠送的月卡奖励', helperPlacement: 'tooltip' },
    { key: 'signinevent', label: '限时签到活动奖励', type: 'checkbox', helper: '领取限时签到活动的每日奖励（仅支持常见横向版型）', helperPlacement: 'tooltip' },
  ],
  operprogress: [{ key: 'plans', label: '培养计划', type: 'oper-progress-plans' }],
  switchtheme: [{ key: 'themes', label: '候选主题', type: 'theme-list' }],
  closedown: [
    { key: 'clientType', label: '客户端类型', type: 'select', options: [
      { value: 'Official', label: '官服' },
      { value: 'Bilibili', label: 'B服' },
      { value: 'YoStarEN', label: '美服' },
      { value: 'YoStarJP', label: '日服' },
      { value: 'YoStarKR', label: '韩服' },
      { value: 'Txwy', label: '繁中服' }
    ]},
    { key: 'recognizeDepotBeforeClose', label: '关闭前识别仓库', type: 'checkbox' },
    { key: 'recognizeOperBoxBeforeClose', label: '关闭前识别干员', type: 'checkbox' }
  ],
}

export const AVAILABLE_TASKS: AutomationAvailableTask[] = AUTOMATION_TASK_DEFAULTS.map(task => ({
  ...task,
  icon: TASK_ICONS[task.id],
  paramFields: TASK_PARAM_FIELDS[task.id],
}))
