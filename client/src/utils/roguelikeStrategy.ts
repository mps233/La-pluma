import type { RoguelikeAdvancedOption } from '@/types/components'

const DEFAULT_SQUAD = { value: '', label: '默认（由 MAA 选择）' }

const COMMON_SQUADS = [
  '指挥分队',
  '后勤分队',
  '突击战术分队',
  '堡垒战术分队',
  '远程战术分队',
  '破坏战术分队',
]

const THEME_SQUADS: Record<string, string[]> = {
  Phantom: ['集群分队', '矛头分队', '研究分队'],
  Mizuki: ['集群分队', '矛头分队', '心胜于物分队', '物尽其用分队', '以人为本分队', '研究分队'],
  Sami: ['集群分队', '矛头分队', '永恒狩猎分队', '生活至上分队', '科学主义分队', '特训分队'],
  Sarkaz: [
    '集群分队',
    '矛头分队',
    '魂灵护送分队',
    '博闻广记分队',
    '蓝图测绘分队',
    '因地制宜分队',
    '异想天开分队',
    '点刺成锭分队',
    '拟态学者分队',
    '专业人士分队',
  ],
  JieGarden: [
    '特勤分队',
    '高台突破分队',
    '地面突破分队',
    '游客分队',
    '司岁台分队',
    '天师府分队',
    '花团锦簇分队',
    '棋行险着分队',
    '岁影回音分队',
    '知学分队',
    '商贾分队',
  ],
}

const BASE_ROLES = [
  { value: '稳扎稳打', label: '稳扎稳打（重装、术师、狙击）' },
  { value: '先手必胜', label: '先手必胜（先锋、狙击、特种）' },
  { value: '取长补短', label: '取长补短（近卫、辅助、医疗）' },
]

const JIE_GARDEN_ROLES = [
  { value: '灵活部署', label: '灵活部署（先锋、辅助、特种）' },
  { value: '坚不可摧', label: '坚不可摧（重装、术师、医疗）' },
]

const RANDOM_ROLE = { value: '随心所欲', label: '随心所欲（三张随机）' }

const BASE_MODES = [
  { value: '0', label: '刷分 / 奖励点数' },
  { value: '1', label: '刷源石锭' },
  { value: '4', label: '凹开局' },
  { value: '6', label: '月度小队' },
  { value: '7', label: '深入调查' },
]

const THEME_MODES: Record<string, Array<{ value: string; label: string }>> = {
  Sami: [{ value: '5', label: '刷坍缩范式（萨米）' }],
  Sarkaz: [{ value: '10001', label: '快速第一层（萨卡兹）' }],
  JieGarden: [{ value: '20001', label: '常乐节点（界园）' }],
  BlackFlow: [
    { value: '30001', label: '刷襁褓动物（黑流树海）' },
    { value: '30003', label: '刷开局（黑流树海）' },
  ],
}

function insertBeforeLastModes(
  modes: Array<{ value: string; label: string }>,
  extra: Array<{ value: string; label: string }>,
): Array<{ value: string; label: string }> {
  return [...modes.slice(0, 3), ...extra, ...modes.slice(3)]
}

export function getRoguelikeModeChoices(theme: string): Array<{ value: string; label: string }> {
  const extra = THEME_MODES[theme]
  return extra ? insertBeforeLastModes(BASE_MODES, extra) : [...BASE_MODES]
}

export function getRoguelikeSquadChoices(theme: string): Array<{ value: string; label: string }> {
  const names = [...(THEME_SQUADS[theme] ?? []), ...COMMON_SQUADS, '高规格分队']
  const seen = new Set<string>()
  return [
    DEFAULT_SQUAD,
    ...names
      .filter(name => {
        if (seen.has(name)) return false
        seen.add(name)
        return true
      })
      .map(name => ({ value: name, label: name })),
  ]
}

export function getRoguelikeRoleChoices(theme: string): Array<{ value: string; label: string }> {
  return [
    ...BASE_ROLES,
    ...(theme === 'JieGarden' ? JIE_GARDEN_ROLES : []),
    RANDOM_ROLE,
  ]
}

/**
 * 字段是否适用于当前主题/模式/依赖状态。隐藏字段既不在界面上显示，
 * 也不会进入命令参数。
 */
export function isRoguelikeOptionVisible(
  option: RoguelikeAdvancedOption | undefined,
  theme: string,
  mode: string,
  advanced: Record<string, unknown>,
): boolean {
  if (!option) return true
  if (option.themes && !option.themes.includes(theme)) return false
  if (option.modes && !option.modes.includes(mode)) return false
  if (!option.requires) return true
  const value = advanced[option.requires.key]
  if (option.requires.equals !== undefined) return value === option.requires.equals
  if (option.requires.oneOf) return option.requires.oneOf.includes(value as string | number | boolean)
  return Boolean(value)
}
