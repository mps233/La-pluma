import type { RoguelikeMode, RoguelikeSelectOption } from '../types'

const DEFAULT_SQUAD: RoguelikeSelectOption = { value: '', label: '默认（指挥分队）' }

/** maa-cli 数字参数使用的 Rust i32 边界。 */
export const MAA_CLI_I32_MIN = -2_147_483_648
export const MAA_CLI_I32_MAX = 2_147_483_647

/** 两个模式支持的主题代号，与 MaaCore 的 RoguelikeTheme/ReclamationTheme 一致。 */
export const ROGUELIKE_THEMES: readonly string[] = [
  'Phantom',
  'Mizuki',
  'Sami',
  'Sarkaz',
  'JieGarden',
  'BlackFlow',
]

export const RECLAMATION_THEMES: readonly string[] = ['Tales', 'RelaunchAnchor']

/**
 * 生息演算默认模式与 CLI 一致：`-m` 缺省为 1（有存档时制作工具）。
 * 模式 0 仅在没有存档时使用，已有存档时可能丢失进度。
 * 重启锚点主题没有 `1`，草稿归一化会回落到该主题模式候选的首项 `16`。
 */
export const DEFAULT_RECLAMATION_MODE = '1'

export interface RoguelikeThemePreset {
  value: string
  label: string
}

const THEME_LABELS: Record<string, string> = {
  Phantom: '傀影',
  Mizuki: '水月',
  Sami: '萨米',
  Sarkaz: '萨卡兹',
  JieGarden: '界园',
  BlackFlow: '黑流树海',
  Tales: '沙洲遗闻',
  RelaunchAnchor: '重启锚点',
}

const themePresets = (themes: readonly string[]): RoguelikeThemePreset[] => themes.map(value => ({
  value,
  label: THEME_LABELS[value] ?? value,
}))

export const ROGUELIKE_THEME_PRESETS: Record<RoguelikeMode, readonly RoguelikeThemePreset[]> = {
  roguelike: themePresets(ROGUELIKE_THEMES),
  reclamation: themePresets(RECLAMATION_THEMES),
}

const COMMON_SQUADS: readonly string[] = [
  '指挥分队',
  '后勤分队',
  '突击战术分队',
  '堡垒战术分队',
  '远程战术分队',
  '破坏战术分队',
]

const THEME_SQUADS: Record<string, readonly string[]> = {
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

const SLOW_AND_STEADY: RoguelikeSelectOption = { value: '稳扎稳打', label: '稳扎稳打（重装、术师、狙击）' }
const FIRST_MOVE_ADVANTAGE: RoguelikeSelectOption = { value: '先手必胜', label: '先手必胜（先锋、狙击、特种）' }
const OVERCOMING_WEAKNESSES: RoguelikeSelectOption = { value: '取长补短', label: '取长补短（近卫、辅助、医疗）' }
const FLEXIBLE_DEPLOYMENT: RoguelikeSelectOption = { value: '灵活部署', label: '灵活部署（先锋、辅助、特种）' }
const UNBREAKABLE: RoguelikeSelectOption = { value: '坚不可摧', label: '坚不可摧（重装、术师、医疗）' }
const AS_YOUR_HEART_DESIRES: RoguelikeSelectOption = { value: '随心所欲', label: '随心所欲（三张随机）' }

const BASE_ROLES: readonly RoguelikeSelectOption[] = [
  SLOW_AND_STEADY,
  FIRST_MOVE_ADVANTAGE,
  OVERCOMING_WEAKNESSES,
]

const THEME_MAX_DIFFICULTY: Record<string, number> = {
  Mizuki: 18,
  Sami: 15,
  Sarkaz: 18,
  JieGarden: 18,
  BlackFlow: 18,
}

export const NUMERIC_DIFFICULTY_THEMES: readonly string[] = ['Mizuki', 'Sami', 'Sarkaz', 'JieGarden', 'BlackFlow']

const EXP_MODE: RoguelikeSelectOption = { value: '0', label: '刷分模式' }
const INVESTMENT_MODE: RoguelikeSelectOption = { value: '1', label: '刷源石锭' }
const COLLECTIBLE_MODE: RoguelikeSelectOption = { value: '4', label: '刷开局' }
const SQUAD_MODE: RoguelikeSelectOption = { value: '6', label: '刷月度小队' }
const EXPLORATION_MODE: RoguelikeSelectOption = { value: '7', label: '刷深入调查' }

const BASE_MODES: readonly RoguelikeSelectOption[] = [
  EXP_MODE,
  INVESTMENT_MODE,
  COLLECTIBLE_MODE,
  SQUAD_MODE,
  EXPLORATION_MODE,
]

const COLLAPSAL_MODE: RoguelikeSelectOption = { value: '5', label: '刷坍缩范式' }
const FAST_PASS_MODE: RoguelikeSelectOption = { value: '10001', label: '快速通过第一层' }
const FIND_PLAYTIME_MODE: RoguelikeSelectOption = { value: '20001', label: '刷常乐节点' }
const BLACKFLOW_ANIMAL_MODE: RoguelikeSelectOption = { value: '30001', label: '刷襁褓动物' }
const BLACKFLOW_START_MODE: RoguelikeSelectOption = { value: '30003', label: '刷开局（保留目标局）' }

const TALES_MODES: readonly RoguelikeSelectOption[] = [
  { value: '0', label: '刷繁荣度（无存档）' },
  { value: '1', label: '制作工具刷繁荣度' },
]

const RELAUNCH_ANCHOR_MODES: readonly RoguelikeSelectOption[] = [
  { value: '16', label: 'RA-1（精耕细作循环）' },
  { value: '32', label: 'RA-15（60 杀任务）' },
  { value: '48', label: 'RA-4（解锁区域并击杀 Boss）' },
]

/** 能直接用 CLI `-t`/`-m` 表达的取值；其余模式与主题只能走动态任务。 */
export const CLI_ROGUELIKE_THEMES: readonly string[] = ROGUELIKE_THEMES
  .filter(theme => theme !== 'BlackFlow')

export const CLI_RECLAMATION_THEMES: readonly string[] = RECLAMATION_THEMES
  .filter(theme => theme !== 'RelaunchAnchor')

export const CLI_ROGUELIKE_MODE_VALUES: readonly string[] = [
  ...BASE_MODES.map(choice => choice.value),
  COLLAPSAL_MODE.value,
]

export const CLI_RECLAMATION_MODE_VALUES: readonly string[] = TALES_MODES.map(choice => choice.value)

export const BLACKFLOW_ANIMALS: readonly RoguelikeSelectOption[] = [
  { value: 'swaddled_cat', label: '襁褓猫' },
  { value: 'swaddled_dog', label: '襁褓狗' },
  { value: 'swaddled_cerberus', label: '襁褓三头犬' },
  { value: 'swaddled_feathered_serpent', label: '襁褓羽蛇' },
]

export const BLACKFLOW_REWARDS: readonly RoguelikeSelectOption[] = [
  { value: 'unnumbered_item', label: '未编号物' },
  { value: 'survey_advance', label: '调查预付款' },
  { value: 'space_lease', label: '空间租赁' },
  { value: 'regression_compensation', label: '退行补偿' },
  { value: 'forest_ride', label: '林间代步' },
  { value: 'nest_parasitism', label: '巢寄生' },
  { value: 'pegasus', label: '襁褓天马' },
  { value: 'hippogriff', label: '襁褓骏鹰' },
  { value: 'dragon', label: '襁褓巨龙' },
  { value: 'hydra', label: '襁褓九头蛇' },
  { value: 'bai_ze', label: '襁褓白泽' },
  { value: 'golden_crow', label: '襁褓金乌' },
]

export const BLACKFLOW_STRATEGIES: readonly RoguelikeSelectOption[] = [
  { value: 'baby_animal', label: '培育襁褓动物' },
  { value: 'investment', label: '第一层投资后速通' },
  { value: 'burn_with_investment', label: '投资后速通到第三层' },
  { value: 'burn', label: '速通到第三层' },
  { value: 'ending1', label: '第一结局刷等级' },
  { value: 'ending2', label: '第二结局刷等级' },
  { value: 'ending3', label: '第三结局刷等级' },
]

export const FIND_PLAYTIME_TARGETS: readonly RoguelikeSelectOption[] = [
  { value: '1', label: '令（掷地有声）' },
  { value: '2', label: '黍（种因得果）' },
  { value: '3', label: '年（三缺一）' },
]

export function getBlackflowAnimalChoices(): RoguelikeSelectOption[] {
  return [...BLACKFLOW_ANIMALS]
}

export function getBlackflowRewardChoices(): RoguelikeSelectOption[] {
  return [...BLACKFLOW_REWARDS]
}

export function squadChoices(theme: string): RoguelikeSelectOption[] {
  const names = [...(THEME_SQUADS[theme] ?? []), ...COMMON_SQUADS, '高规格分队']
  const seen = new Set<string>()
  const squads = names.filter(name => {
    if (seen.has(name)) return false
    seen.add(name)
    return true
  })
  return [DEFAULT_SQUAD, ...squads.map(name => ({ value: name, label: name }))]
}

export function roleChoices(theme: string): RoguelikeSelectOption[] {
  const extra = theme === 'JieGarden' ? [FLEXIBLE_DEPLOYMENT, UNBREAKABLE] : []
  return [...BASE_ROLES, ...extra, AS_YOUR_HEART_DESIRES]
}

export function roguelikeModeChoices(theme: string): RoguelikeSelectOption[] {
  if (theme === 'BlackFlow') {
    return [EXP_MODE, INVESTMENT_MODE, BLACKFLOW_ANIMAL_MODE, BLACKFLOW_START_MODE]
  }
  if (theme === 'Sami') {
    return [...BASE_MODES.slice(0, 3), COLLAPSAL_MODE, ...BASE_MODES.slice(3)]
  }
  if (theme === 'Sarkaz') return [...BASE_MODES, FAST_PASS_MODE]
  if (theme === 'JieGarden') return [...BASE_MODES, FIND_PLAYTIME_MODE]
  return [...BASE_MODES]
}

export function reclamationModeChoices(theme: string): RoguelikeSelectOption[] {
  return theme === 'RelaunchAnchor' ? [...RELAUNCH_ANCHOR_MODES] : [...TALES_MODES]
}

export function modeChoices(theme: string, taskId: string): RoguelikeSelectOption[] {
  return taskId === 'reclamation'
    ? reclamationModeChoices(theme)
    : roguelikeModeChoices(theme)
}

export function difficultyChoices(theme: string): RoguelikeSelectOption[] {
  const max = THEME_MAX_DIFFICULTY[theme] ?? 15
  const choices: RoguelikeSelectOption[] = [{ value: '-1', label: '不切换（沿用游戏内难度）' }]
  for (let level = max; level >= 1; level -= 1) {
    choices.push({ value: String(level), label: String(level) })
  }
  choices.push({ value: '0', label: '0（最低）' })
  return choices
}
