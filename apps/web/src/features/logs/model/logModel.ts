import type { LogEntry } from '../types'
import { asRecord, getTaskName, summarizeCallback } from './logCallbackSummary'
import { summarizeMaaCliMessage, summarizeMaaCliSummaryBlock } from './logCliSummary'

export type LogFilter = 'all' | LogEntry['level']
export type LogEventFilter = 'key' | 'all'

export interface LogAnnotation {
  readonly record: LogEntry
  readonly summary: string
  readonly level: LogEntry['level']
  readonly keyEvent: boolean
  readonly parseStatus: 'parsed' | 'unrecognized' | 'malformed'
}

export interface VisibleLog {
  readonly time: string
  readonly level: LogEntry['level']
  readonly message: string
  readonly count: number
  readonly members: readonly LogAnnotation[]
  readonly routine?: RoutineGroup
}

export type RoutineGroup = 'oper-roles' | 'blackflow-resources' | 'task-json'

const ROUTINE_GROUP_LABELS: Record<RoutineGroup, string> = {
  'oper-roles': '干员多职业标签警告',
  'blackflow-resources': 'BlackFlow 可选资源缺失警告',
  'task-json': '任务参数（JSON）',
}

function classifyRoutineGroup(annotation: LogAnnotation): RoutineGroup | null {
  const record = annotation.record
  const message = record.message.trim()
  if (record.level === 'WARN' && /^parse oper: .+ has multiple roles, but still not specific any$/.test(message)) {
    return 'oper-roles'
  }
  if (record.level === 'WARN' && /^Optional BlackFlow map (?:model|perception metadata) is missing, path: /.test(message)) {
    return 'blackflow-resources'
  }
  if (record.level === 'INFO' && record.time === '' && (/^"[^"]+"\s*:/.test(message) || /^(?:\{|\}|\[|\]|,)+$/.test(message))) {
    return 'task-json'
  }
  return null
}

export interface LogViewOptions {
  readonly events?: LogEventFilter
  readonly level: LogFilter
  readonly search: string
  readonly collapseRepeats: boolean
}

export interface LogView {
  readonly annotations: readonly LogAnnotation[]
  /** 同一批选中事实用于列表呈现和导出；不受重复折叠影响。 */
  readonly selected: readonly LogEntry[]
  readonly visible: readonly VisibleLog[]
  readonly hiddenMatchCount: number
}

export const LOG_LEVELS: readonly LogEntry['level'][] = ['ERROR', 'WARN', 'INFO', 'DEBUG']

const LOG_LEVEL_ALIASES: Record<string, LogEntry['level']> = {
  ERR: 'ERROR', ERROR: 'ERROR', WRN: 'WARN', WARN: 'WARN', WARNING: 'WARN',
  INF: 'INFO', INFO: 'INFO', DBG: 'DEBUG', DEBUG: 'DEBUG', TRC: 'DEBUG', TRACE: 'DEBUG',
}

export function normalizeLevel(value: unknown): LogEntry['level'] {
  return LOG_LEVEL_ALIASES[String(value || '').toUpperCase()] ?? 'INFO'
}

export function formatLogTime(value: unknown): string {
  const date = new Date(String(value || ''))
  if (Number.isNaN(date.getTime())) return ''
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map(part => part.toString().padStart(2, '0')).join(':')
}

function readLogIdentity(log: Record<string, unknown>): Pick<LogEntry, 'id' | 'sequence' | 'runId' | 'operationId'> {
  return {
    ...(typeof log.id === 'string' && log.id ? { id: log.id } : {}),
    ...(typeof log.sequence === 'number' && Number.isSafeInteger(log.sequence) ? { sequence: log.sequence } : {}),
    ...(typeof log.runId === 'string' && log.runId ? { runId: log.runId } : {}),
    ...(typeof log.operationId === 'string' && log.operationId ? { operationId: log.operationId } : {}),
  }
}

export function parseRealtimeLog(value: unknown): LogEntry {
  const envelope = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  const sourceText = String(envelope.message ?? '')
  const inner = parseHistoryLine(sourceText)
  const timestamp = typeof envelope.time === 'string' ? envelope.time : ''
  return {
    time: formatLogTime(timestamp),
    timestamp,
    level: normalizeLevel(envelope.level),
    message: inner.message,
    source: 'realtime',
    sourceText,
    envelope: { ...envelope },
    ...readLogIdentity(envelope),
  }
}

export function parseHistoryLine(line: string): LogEntry {
  const body = line.endsWith('\r') ? line.slice(0, -1) : line
  const match = body.match(/^\[(\d{4}-\d{2}-\d{2} (\d{2}:\d{2}:\d{2})(?:\.\d+)?)\]\[([A-Za-z]+)\](?:\[[^\]]*\])*\s*(.*)$/)
    ?? body.match(/^\[(\d{4}-\d{2}-\d{2} (\d{2}:\d{2}:\d{2})(?:\.\d+)?) ([A-Za-z]+)\] (.*)$/)
  return {
    time: match?.[2] ?? '',
    timestamp: match?.[1] ?? '',
    level: normalizeLevel(match?.[3]),
    message: match?.[4] ?? line,
    source: 'history',
    sourceText: line,
  }
}

export function parseHistoryContent(content: unknown): LogEntry[] {
  if (typeof content !== 'string' || content === '') return []
  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.map((line, index) => ({ ...parseHistoryLine(line), id: `history:${index}` }))
}

/** 旧服务端没有 id 时按原事实比较，不能把摘要当作事件身份。 */
export function getLogIdentity(log: LogEntry): string {
  return log.id ?? JSON.stringify([
    log.source, log.timestamp ?? log.time, log.level, log.message,
    log.runId, log.operationId, log.sourceText,
  ])
}

export function getLogSourceText(log: LogEntry): string {
  return log.sourceText ?? log.message
}

function summarizeKnownMessage(log: LogEntry): LogEntry | null {
  const callback = summarizeCallback(log)
  if (log.message.startsWith('Assistant::append_callback |')) return callback

  const message = log.message.trim()
  if (!message) return null

  // 任务总结是 maa-cli 的报告而不是事件：分隔线和块标题没有信息，其余行转成可读文案。
  if (/^-{10,}$/.test(message) || message === 'Summary' || message === 'Summary:') return null
  const report = summarizeMaaCliSummaryBlock(message)
  if (report) return { ...log, ...report, level: report.level ?? log.level }
  const cliSummary = summarizeMaaCliMessage(message)
  if (cliSummary) return { ...log, ...cliSummary, level: cliSummary.level ?? log.level }

  if (/^执行命令:\s+maa\s+(?:dir log|activity\b)/.test(message)) return null

  const stateUpdate = message.match(/^任务状态更新:\s+(\{.*\})$/)
  if (stateUpdate) {
    try {
      const state = asRecord(JSON.parse(stateUpdate[1] || '{}'))
      if (typeof state.isRunning !== 'boolean') return log
      return state.isRunning === true
        ? { ...log, message: `任务开始：${getTaskName(state.taskName || state.taskType)}` }
        : { ...log, message: '任务执行结束' }
    } catch {
      return null
    }
  }

  if (message.startsWith('临时任务文件已创建:')) return null
  if (message.startsWith('stdout:')) return { ...log, message: `MAA 输出：${message.slice(7).trim()}` }
  if (message.startsWith('stderr:')) return { ...log, level: 'WARN', message: `MAA 提示：${message.slice(7).trim()}` }

  const queuedTask = message.match(/^append_task\s+(\w+)\s*\{?$/)
  if (queuedTask) return { ...log, message: `任务已加入队列：${getTaskName(queuedTask[1])}` }

  if (message === 'Start | block') return { ...log, message: '任务执行开始' }
  if (message === 'Stop | block') return { ...log, message: '任务执行结束' }
  if (message.startsWith('timeout when waiting socket connection')) {
    return { ...log, level: 'WARN', message: '截图通道连接超时，正在切换备用方案' }
  }
  if (message.startsWith('Killing child `')) {
    return { ...log, level: 'ERROR', message: '已终止超时的截图进程' }
  }
  if (message.startsWith('Call `') && message.endsWith('failed')) {
    return { ...log, level: 'WARN', message: 'ADB 调用失败，正在尝试备用方案' }
  }
  if (message === 'data is empty!') {
    return { ...log, level: 'WARN', message: '截图数据为空，正在切换备用方案' }
  }

  const noisyInfo = /^(Call `|record path |load |already loaded |load ret |set_instance_option |append_task \| task_id|Candidate templates count:|Item id:|command server start |touch_program |pipe str|minitouch key props|adb -s |Try to find |Raw\w+ is not supported|screencap_end_of_line|Encode cost |The fastest way is )/
  if (log.level === 'INFO' && noisyInfo.test(message)) return null

  return { ...log, message }
}

function isRoutineCallback(message: string): boolean {
  const match = message.match(/^Assistant::append_callback \| (\w+)\s+(\{.*\})$/)
  if (!match) return false
  let payload: Record<string, unknown>
  try { payload = asRecord(JSON.parse(match[2] || '{}')) } catch { return false }
  if (match[1] === 'AllTasksCompleted') return true
  if (match[1] === 'SubTaskStart' || match[1] === 'SubTaskCompleted') {
    const task = asRecord(payload.details).task
    const subtask = payload.subtask
    return (typeof task === 'string' && task.trim() !== '')
      || (typeof subtask === 'string' && subtask.trim() !== '' && subtask.trim() !== 'ProcessTask')
  }
  if (match[1] === 'AsyncCallInfo') {
    const details = asRecord(payload.details)
    return typeof payload.what === 'string' && ['AttachWindow', 'Click', 'Screencap'].includes(payload.what)
      && details.ret === true && !details.error
  }
  return false
}

function isMalformedMessage(message: string): boolean {
  if (!message.startsWith('Assistant::append_callback |') && !message.startsWith('任务状态更新:')) return false
  const start = message.indexOf('{')
  if (start < 0) return true
  try {
    const payload: unknown = JSON.parse(message.slice(start))
    return !payload || typeof payload !== 'object' || Array.isArray(payload)
  } catch { return true }
}

function highestLevel(...levels: readonly LogEntry['level'][]): LogEntry['level'] {
  return levels.reduce((highest, level) => LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(highest) ? level : highest, 'DEBUG')
}

/** 语义解释不会覆盖事实或删除记录；降级状态显式可见。 */
export function annotateLog(record: LogEntry): LogAnnotation {
  const message = record.message.trim()
  const malformed = isMalformedMessage(message)
  const interpreted = malformed ? null : summarizeKnownMessage(record)
  const inner = record.source === 'realtime' && record.sourceText
    ? parseHistoryLine(record.sourceText) : null
  const innerLevel = inner?.timestamp ? inner.level : record.level
  const level = highestLevel(record.level, innerLevel, interpreted?.level ?? record.level)
  const callback = message.startsWith('Assistant::append_callback |')
  const knownRoutine = callback ? !interpreted && isRoutineCallback(message) : interpreted === null
  const unrecognized = !malformed && (
    (callback && !interpreted && !knownRoutine)
    || interpreted?.message === record.message
  )
  const keyEvent = malformed || level === 'ERROR' || level === 'WARN'
    || (!knownRoutine && record.level !== 'DEBUG' && message !== '')
  return {
    record,
    summary: interpreted?.message ?? record.message,
    level,
    keyEvent,
    parseStatus: malformed ? 'malformed' : unrecognized ? 'unrecognized' : 'parsed',
  }
}

function canCollapse(previous: LogAnnotation, next: LogAnnotation): boolean {
  return previous.level === next.level
    && previous.summary === next.summary
    && previous.record.level === next.record.level
    && getLogSourceText(previous.record) === getLogSourceText(next.record)
    && previous.record.runId === next.record.runId
    && previous.record.operationId === next.record.operationId
    && previous.record.source === next.record.source
}

function canMergeRoutine(previous: VisibleLog, next: LogAnnotation): boolean {
  if (!previous.routine || classifyRoutineGroup(next) !== previous.routine) return false
  const lastMember = previous.members[previous.members.length - 1]
  if (!lastMember) return false
  return lastMember.level === next.level
    && lastMember.record.level === next.record.level
    && lastMember.record.runId === next.record.runId
    && lastMember.record.operationId === next.record.operationId
    && lastMember.record.source === next.record.source
}

export interface CollapseRepeatedLogsOptions {
  readonly groupRoutine?: boolean
}

/** 分组保留所有成员的事实和时间，既不跨 Run，也不合并不同载荷。 */
export function collapseRepeatedLogs(
  annotations: readonly LogAnnotation[],
  options: CollapseRepeatedLogsOptions = {},
): VisibleLog[] {
  const groups: VisibleLog[] = []
  for (const annotation of annotations) {
    const previous = groups[groups.length - 1]
    const lastMember = previous?.members[previous.members.length - 1]
    if (previous && lastMember && canCollapse(lastMember, annotation)) {
      groups[groups.length - 1] = {
        ...previous,
        count: previous.count + 1,
        members: [...previous.members, annotation],
      }
    } else if (options.groupRoutine && previous && canMergeRoutine(previous, annotation)) {
      groups[groups.length - 1] = {
        ...previous,
        message: ROUTINE_GROUP_LABELS[previous.routine!],
        count: previous.count + 1,
        members: [...previous.members, annotation],
      }
    } else {
      groups.push(presentLog(annotation))
    }
  }
  return groups
}

function presentLog(annotation: LogAnnotation): VisibleLog {
  return {
    time: annotation.record.time,
    level: annotation.level,
    message: annotation.summary,
    count: 1,
    members: [annotation],
    routine: classifyRoutineGroup(annotation) ?? undefined,
  }
}

export function buildLogContentFingerprint(logs: readonly LogEntry[]): string {
  return JSON.stringify(logs.map(getLogIdentity))
}

/** 指定 Run 与其活动/终态无关；缺失 runId 的事实保持未关联。 */
export function filterLogsByRunId(logs: readonly LogEntry[], runId: string | null): readonly LogEntry[] {
  return runId ? logs.filter(log => log.runId === runId) : logs
}

/** 格式化只服务详情；完整源文本仍保存在事实中。 */
export function formatLogRawDetail(raw: string): string {
  const marker = 'Assistant::append_callback | '
  if (!raw.startsWith(marker)) return raw
  const jsonStart = raw.indexOf('{', marker.length)
  if (jsonStart === -1) return raw
  try {
    const parsed: unknown = JSON.parse(raw.slice(jsonStart))
    return `${raw.slice(marker.length, jsonStart).trim()}\n${JSON.stringify(parsed, null, 2)}`
  } catch { return raw }
}

export function buildLogView(logs: readonly LogEntry[], options: LogViewOptions): LogView {
  const annotations = logs.map(annotateLog)
  const query = options.search.trim().toLocaleLowerCase('zh-CN')
  const matches = annotations.filter(annotation => {
    const { record } = annotation
    return (options.level === 'all' || annotation.level === options.level)
      && (!query || [record.time, record.timestamp, record.level, annotation.level,
        annotation.summary, getLogSourceText(record), record.runId, record.operationId]
        .join(' ').replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN').includes(query))
  })
  const selectedAnnotations = options.events === 'all' ? matches : matches.filter(annotation => annotation.keyEvent)
  return {
    annotations,
    selected: selectedAnnotations.map(annotation => annotation.record),
    visible: options.collapseRepeats
      ? collapseRepeatedLogs(selectedAnnotations, { groupRoutine: options.events === 'key' })
      : selectedAnnotations.map(presentLog),
    hiddenMatchCount: query ? matches.length - selectedAnnotations.length : 0,
  }
}
