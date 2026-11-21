/** 两个模式各自有独立的主题目录与高级字段。 */
export type RoguelikeMode = 'roguelike' | 'reclamation'

export interface RoguelikeTask {
  id: RoguelikeMode
  name: string
  command: string
  placeholder: string
  icon: string
}

/** 下拉项：value 是写入命令的原始值，label 是界面文案。 */
export interface RoguelikeSelectOption {
  value: string
  label: string
}

/** 字段依赖：条件不满足时既不下发也不显示。 */
export interface RoguelikeOptionRequirement {
  key: string
  /** 需要依赖字段为 true，或等于给定值；省略时要求字段为真/非空。 */
  equals?: string | boolean
  /** 需要依赖字段取所列值之一；用于分队等存在多个合法取值的条件。 */
  oneOf?: readonly string[]
}

export type RoguelikeAdvancedOptionType = 'text' | 'number' | 'select' | 'checkbox' | 'list' | 'operator'

/** 字段写入 MaaCore 动态任务时的值类型；省略时按字段 type 推断。 */
export type RoguelikeCoreValueType = 'string' | 'number' | 'boolean' | 'string-list' | 'reward-bitmask'

export interface RoguelikeAdvancedOption {
  key: string
  label: string
  type: RoguelikeAdvancedOptionType
  /** maa-cli 参数名；省略表示 CLI 无法表达，只能通过动态任务下发。 */
  param?: string
  /** MaaCore 动态任务参数名。 */
  coreParam: string
  /** 动态任务的 值类型；省略时按字段 type 推断。 */
  coreType?: RoguelikeCoreValueType
  /** 为 true 时动态任务写入取反后的布尔值（CLI 开关与 Core 字段语义相反）。 */
  coreInvert?: boolean
  placeholder?: string
  options?: readonly RoguelikeSelectOption[]
  /** 取值随主题变化的选项表，优先于 `options`。 */
  choices?: 'modes' | 'difficulty' | 'squads' | 'roles'
  /**
   * 声明后，缺失或空字符串在显示、草稿归一化与命令构造三处都解析为该值，
   * 并始终显式写入命令参数。未声明时保持“未设置即省略”的行为。
   * select 的默认值不在当前主题候选表内时回落到候选表首项。
   */
  defaultValue?: string
  hint?: string
  /** 字段在设置栅格中的跨度；省略时占一列，'full' 时独占一整行。 */
  span?: 'full'
  /** number 字段的闭区间；省略时按 CLI 的 i32 范围校验。 */
  numberRange?: { min: number; max: number }
  /** 仅在这些主题下显示与下发；省略表示所有主题。 */
  themes?: readonly string[]
  /** 仅在这些模式下显示与下发；省略表示所有模式。 */
  modes?: readonly string[]
  /** 依赖另一字段；条件不满足时既不下发也不显示。 */
  requires?: RoguelikeOptionRequirement
  /** list 字段允许的取值；value 是协议值，label 是可输入的中文别名。省略时不限制。 */
  listChoices?: readonly RoguelikeSelectOption[]
  /** list 字段允许的最大项数；省略时不限制。 */
  listMaxItems?: number
}

export interface RoguelikeTaskInputs {
  [taskId: string]: string
}

export interface RoguelikeAdvancedValues {
  [key: string]: string | number | boolean
}

export interface RoguelikeAdvancedParams {
  [taskId: string]: RoguelikeAdvancedValues
}
