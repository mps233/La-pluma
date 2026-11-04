/**
 * maa-cli 任务总结与命令行错误的语义文案。
 *
 * maa-cli 在命令结束时打印 Summary 块；服务端会把整块作为一条 stdout 日志。
 * 这里把外部文本改写成可读摘要，未识别的行返回 null，由调用方保留原文。
 */

export interface LogMessageRewrite {
  message: string
  level?: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'
}

const TASK_NAMES: Record<string, string> = {
  StartUp: '启动游戏',
  CloseDown: '关闭游戏',
  Fight: '作战',
  Award: '领取奖励',
  Mall: '信用商店',
  Recruit: '自动公招',
  Infrast: '基建换班',
  Depot: '仓库识别',
  Roguelike: '集成战略',
  ReclamationAlgorithm: '生息演算',
  Copilot: '作业执行',
  SSSCopilot: '保全作业',
}

function getTaskName(value: unknown): string {
  const name = String(value || '').trim()
  return TASK_NAMES[name] || name.replace(/Task(?:Plugin)?$/, '') || '未知任务'
}

const SUMMARY_BLOCK_TITLE = 'Summary'
const SUMMARY_BLOCK_SEPARATOR = /^-{10,}$/

const TASK_SUMMARY_REASONS: Record<string, LogMessageRewrite> = {
  Completed: { message: '完成' },
  Stopped: { message: '已停止', level: 'WARN' },
  Error: { message: '失败', level: 'ERROR' },
  Unfinished: { message: '未完成' },
  Unstarted: { message: '未开始' },
}

const EXPLORATION_STATE_TEXT: Record<string, string> = {
  Passed: '通过',
  Failed: '失败',
  Abandoned: '放弃',
  Unknown: '未知',
}

function summarizeTaskSummaryLine(message: string): LogMessageRewrite | null {
  const match = message.match(/^\[([^\]]+)\](.*)$/)
  const reason = match?.[2]?.match(/\s(Completed|Stopped|Error|Unfinished|Unstarted)$/)?.[1]
  const reasonText = reason ? TASK_SUMMARY_REASONS[reason] : undefined
  if (!match || !reasonText) return null

  const tail = match[2] ?? ''
  const times = [...tail.matchAll(/\b\d{2}:\d{2}:\d{2}\b/g)].map(item => item[0])
  const duration = tail.match(/\(([^)]+)\)/)?.[1]
  const parts = [
    `任务总结：${getTaskName(match[1]!)}`,
    times[0] ? `${times[0]} 开始` : null,
    times[1] ? `${times[1]} 结束` : null,
    duration ? `耗时 ${duration}` : null,
    reasonText.message,
  ]
  return { message: parts.filter(Boolean).join(' · '), level: reasonText.level }
}

function summarizeSummaryDetail(message: string): LogMessageRewrite | null {
  if (message === 'Explorations:') return { message: '探索记录' }
  if (message === 'Detected tags:') return { message: '识别候选标签' }

  const exploration = message.match(/^(\d+)\.\s+(Passed|Failed|Abandoned|Unknown);$/)
  if (exploration) {
    return { message: `第 ${exploration[1]} 次探索：${EXPLORATION_STATE_TEXT[exploration[2]!]}` }
  }

  const states = message.match(/^(?:(?:Passed|Failed|Abandoned|Unknown) \d+)(?:, (?:Passed|Failed|Abandoned|Unknown) \d+)*$/)
  if (states) {
    return {
      message: `结局：${message
        .replace(/(Passed|Failed|Abandoned|Unknown) (\d+)/g,
          (_all, state: string, count: string) => `${EXPLORATION_STATE_TEXT[state]} ${count}`)
        .replace(/, /g, ' · ')}`,
    }
  }

  const invest = message.match(/^Total invest (-?\d+) originium ingotes$/)
  if (invest) return { message: `累计投资 ${invest[1]} 源石锭` }
  const experience = message.match(/^Total gained (-?\d+) exp$/)
  if (experience) return { message: `累计获得 ${experience[1]} 经验` }

  const fight = message.match(/^Fight (\S+?)(?: (\d+) times)?(?:, used (\d+) medicine)?(?: \(\d+ expiring\))?(?:, used (\d+) stone)?(, drops:)?$/)
  if (fight) {
    const parts = [`作战 ${fight[1]}${fight[2] ? ` ×${fight[2]}` : ''}`]
    if (fight[3]) parts.push(`使用 ${fight[3]} 瓶理智药`)
    if (fight[4]) parts.push(`使用 ${fight[4]} 源石`)
    if (fight[5]) parts.push('掉落：')
    return { message: parts.join(' · ') }
  }

  const totalDrops = message.match(/^total drops: (.+)$/)
  if (totalDrops) return { message: `合计掉落：${totalDrops[1]!.replace(/,\s*/g, '、')}` }

  const recruit = message.match(/^(\d+)\. (★+) (.+)$/)
  if (recruit) {
    const tail = recruit[3]!
    const state = tail.match(/, (Refreshed|Recruited)$/)?.[1]
    const tags = tail.replace(/, (Refreshed|Recruited)$/, '').replace(/, /g, '、')
    const suffix = state === 'Refreshed' ? '（已刷新）' : state === 'Recruited' ? '（已招募）' : ''
    return { message: `第 ${recruit[1]} 条：${recruit[2]} ${tags}${suffix}` }
  }

  const dropList = message.match(/^(\d+)\. (.+ × \d+(?:, .+ × \d+)*)$/)
  if (dropList) return { message: `第 ${dropList[1]} 次：${dropList[2]!.replace(/, /g, '、')}` }

  const recruited = message.match(/^Recruited (\d+) times$/)
  if (recruited) return { message: `已招募 ${recruited[1]} 次` }
  const refreshed = message.match(/^Refreshed (\d+) times$/)
  if (refreshed) return { message: `已刷新 ${refreshed[1]} 次` }

  return null
}

function summarizeCliError(message: string): LogMessageRewrite | null {
  const match = message.match(/^Error: (.+)$/)
  if (!match) return null
  const detail = match[1]!
  if (detail === 'Interrupted by user!') {
    return { message: '任务已按请求停止', level: 'WARN' }
  }
  return {
    message: detail === 'Some error occurred during running task!'
      ? '任务执行期间发生错误'
      : `MAA 执行出错：${detail}`,
    level: 'ERROR',
  }
}

const COMMAND_NAMES: Record<string, string> = {
  run: '自动化任务',
  startup: '启动游戏',
  fight: '理智作战',
  roguelike: '集成战略',
  copilot: '作业执行',
  dir: '读取配置',
  log: '读取日志',
  activity: '读取活动',
  version: '读取版本',
}

function summarizeCommand(message: string): LogMessageRewrite | null {
  const start = message.match(/^执行命令:\s+maa\s+(\w+)(?:\s+.*?)?,\s*等待完成:\s*(?:true|false)$/)
  if (start) {
    const command = start[1] || ''
    return { message: `开始执行：${COMMAND_NAMES[command] || command}` }
  }

  if (message.startsWith('命令执行已停止:')) {
    return { message: 'MAA 命令已停止', level: 'WARN' }
  }

  const end = message.match(/^命令执行完成:\s+maa\s+(.+?),\s*退出码:\s*(-?\d+)$/)
  if (!end) return null
  const exitCode = Number(end[2])
  return exitCode === 0
    ? { message: 'MAA 命令执行完成' }
    : { message: `MAA 命令执行失败，退出码 ${exitCode}`, level: 'ERROR' }
}

function compactSummaryDetails(details: readonly string[]): string[] {
  const hasTotalDrops = details.some(text => text.startsWith('合计掉落：'))
  const explorations = details.filter(text => /^第 \d+ 次探索：/.test(text))
  return details
    .filter(text => !(hasTotalDrops && /^第 \d+ 次：/.test(text)))
    .filter(text => !(explorations.length === 1 && text === explorations[0]
      && details.some(item => item.startsWith('结局：'))))
    .map(text => text
      .replace(/^累计投资 (.+) 源石锭$/, '投资 $1 源石锭')
      .replace(/^累计获得 (.+) 经验$/, '经验 $1')
      .replace(/ · 掉落：$/, ''))
}

/** 服务端合并后的任务报告块；整块转成一行摘要。 */
export function summarizeMaaCliSummaryBlock(message: string): LogMessageRewrite | null {
  const lines = String(message || '').split('\n').map(line => line.trim()).filter(Boolean)
  if (lines[0] !== SUMMARY_BLOCK_TITLE) return null

  let header: LogMessageRewrite | null = null
  const details: string[] = []
  for (const line of lines.slice(1)) {
    if (SUMMARY_BLOCK_SEPARATOR.test(line) || line === 'Summary:') continue
    const task = summarizeTaskSummaryLine(line)
    if (task) {
      header = task
      continue
    }
    const detail = summarizeSummaryDetail(line)
    if (detail && detail.message !== '探索记录' && detail.message !== '识别候选标签') {
      details.push(detail.message)
    }
  }
  if (!header) return null
  return {
    message: [header.message, ...compactSummaryDetails(details)].join('\n'),
    level: header.level,
  }
}

/** 任务总结、明细、命令行错误与命令生命周期共用一次改写。 */
export function summarizeMaaCliMessage(message: string): LogMessageRewrite | null {
  return summarizeTaskSummaryLine(message)
    ?? summarizeSummaryDetail(message)
    ?? summarizeCliError(message)
    ?? summarizeCommand(message)
}
