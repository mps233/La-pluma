import { describe, expect, it } from 'vitest'
import {
  annotateLog,
  buildLogContentFingerprint,
  buildLogView,
  filterLogsByRunId,
  formatLogRawDetail,
  formatLogTime,
  getLogIdentity,
  normalizeLevel,
  parseHistoryContent,
  parseHistoryLine,
  parseRealtimeLog,
} from './logModel'
import type { LogEntry } from '../types'

const entry = (message: string, level: LogEntry['level'] = 'INFO', time = '10:00:00'): LogEntry => ({ time, level, message })
const callback = (event: string, payload: unknown) => entry(`Assistant::append_callback | ${event} ${JSON.stringify(payload)}`)
const options = { events: 'key', level: 'all', search: '', collapseRepeats: false } as const

describe('log facts', () => {
  it('normalizes known aliases and falls back safely', () => {
    expect(['err', 'WARNING', 'trc', 'LOUD', undefined].map(normalizeLevel))
      .toEqual(['ERROR', 'WARN', 'DEBUG', 'INFO', 'INFO'])
    expect(formatLogTime('2026-07-22T10:11:12')).toBe('10:11:12')
    expect(formatLogTime('not-a-date')).toBe('')
  })

  it('keeps historical date, milliseconds, prefix and exact source text', () => {
    const line = '[2026-07-22 10:11:12.345][WRN][thread-1] 警告消息  '
    expect(parseHistoryLine(line)).toEqual({
      time: '10:11:12', timestamp: '2026-07-22 10:11:12.345', level: 'WARN',
      message: '警告消息  ', source: 'history', sourceText: line,
    })
    expect(parseHistoryLine('[2026-07-22 10:11:12 DBG] 调试消息'))
      .toMatchObject({ timestamp: '2026-07-22 10:11:12', level: 'DEBUG', message: '调试消息' })
  })

  it('preserves blank source lines and source order with stable row identities', () => {
    const logs = parseHistoryContent('first\n\n last \n')
    expect(logs.map(log => log.sourceText)).toEqual(['first', '', ' last '])
    expect(logs.map(log => log.id)).toEqual(['history:0', 'history:1', 'history:2'])
    expect(parseHistoryContent('\n')).toHaveLength(1)
    expect(parseHistoryContent('')).toEqual([])
    expect(parseHistoryContent(undefined)).toEqual([])
    expect(parseHistoryContent('[2026-07-22 10:11:12][INF] windows\r\n')[0])
      .toMatchObject({ timestamp: '2026-07-22 10:11:12', message: 'windows', sourceText: '[2026-07-22 10:11:12][INF] windows\r' })
  })

  it('keeps the realtime envelope intact instead of overwriting it with inner prefixes', () => {
    const envelope = {
      id: 'source:1', sequence: 1, time: '2026-07-22T23:59:59.987Z', level: 'ERROR',
      message: '[2026-07-22 10:11:12.345][INF][thread] 内层消息', runId: 'run-1', operationId: 'op-1',
    }
    const log = parseRealtimeLog(envelope)
    expect(log).toMatchObject({
      id: 'source:1', sequence: 1, timestamp: envelope.time, level: 'ERROR', message: '内层消息',
      source: 'realtime', sourceText: envelope.message, envelope, runId: 'run-1', operationId: 'op-1',
    })
    expect(annotateLog(log).level).toBe('ERROR')
    expect(log.envelope).not.toBe(envelope)
  })

  it('ignores invalid correlation fields and tolerates missing envelopes', () => {
    const log = parseRealtimeLog({ message: '普通消息', runId: 42, operationId: null })
    expect(log.runId).toBeUndefined()
    expect(log.operationId).toBeUndefined()
    expect(parseRealtimeLog(null)).toMatchObject({ time: '', level: 'INFO', message: '', sourceText: '' })
  })

  it('uses stable server identity and source facts for legacy fallback', () => {
    expect(getLogIdentity({ ...entry('a'), id: 'event-1' })).toBe('event-1')
    expect(getLogIdentity(entry('a'))).toBe(getLogIdentity({ ...entry('a') }))
    expect(getLogIdentity({ ...entry('a'), runId: 'run-1' })).not.toBe(getLogIdentity(entry('a')))
    expect(buildLogContentFingerprint([entry('a'), entry('b')]))
      .not.toBe(buildLogContentFingerprint([entry('x'), entry('b')]))
  })
})

describe('semantic annotations', () => {
  it.each([
    ['TaskChainStart', { taskchain: 'Fight' }, '任务开始：作战（Fight）'],
    ['TaskChainCompleted', { taskchain: 'Fight' }, '任务完成：作战'],
    ['TaskChainError', { taskchain: 'Fight' }, '任务失败：作战'],
    ['SubTaskError', { subtask: 'Infrast' }, '执行步骤失败：基建换班'],
    ['SubTaskExtraInfo', { what: 'DepotInfo' }, '仓库识别数据已生成'],
    ['SubTaskExtraInfo', { what: 'CopilotListLoadTaskFileSuccess', details: { stage_name: '1-7', file_name: 'crowd.json' } }, '开始作业：1-7（crowd.json）'],
    ['SubTaskExtraInfo', { what: 'CopilotListLoadTaskFileSuccess', details: {} }, '开始加载作业文件'],
    ['SubTaskExtraInfo', { what: 'CopilotAction', details: { target: '山', elapsed_time: 1234 } }, '战斗进行中：山 · 已用 1234ms'],
    ['SubTaskExtraInfo', { what: 'CopilotAction', details: {} }, '战斗进行中'],
    ['SubTaskExtraInfo', { what: 'StageDrops', details: { drops: [{ itemName: '固源岩', quantity: 2 }, { itemName: '龙门币', quantity: 360 }] } }, '掉落：固源岩 ×2、龙门币 ×360'],
    ['SubTaskStart', { details: { task: 'StageDrops-Stars-3' } }, '三星通关'],
    ['SubTaskExtraInfo', { what: 'StageDrops-Adverse' }, '险情通关'],
    ['SubTaskStart', { details: { task: 'FightMissionFailed' } }, '作战失败'],
    ['SubTaskExtraInfo', { what: 'RoguelikeSettlement', details: { floor: 4, step: 23, recruit: 6, score: 128 } }, '肉鸽结算：4层 23步 · 招募 6 · 得分 128'],
    ['SubTaskExtraInfo', { what: 'RoguelikeSettlement', details: {} }, '肉鸽结算完成'],
    ['SubTaskExtraInfo', { what: 'RoguelikeInvestment', details: { count: 2, deposit: 433 } }, '投资：2（存款 433）'],
    ['SubTaskExtraInfo', { what: 'RoguelikeInvestment', details: { count: 1, deposit: -1 } }, '投资：1'],
    ['SubTaskExtraInfo', { what: 'RoguelikeEvent', details: { name: '不和谐之音' } }, '事件：不和谐之音'],
    ['SubTaskExtraInfo', { what: 'BlackFlowRoutingDecision', details: { floor: 3, action_points_before: 6, action_points_after: 4, node_name: '险路狭道' } }, '第 3 层 · 行动点 6→4 · 险路狭道'],
    ['AsyncCallInfo', { what: 'Connect', details: { ret: true, cost: 120 } }, '设备连接完成，耗时 120 ms'],
    ['AsyncCallInfo', { what: 'Connect', details: { ret: false } }, '设备连接失败'],
    ['ConnectionInfo', { what: 'Connected', details: { address: '127.0.0.1:5555' } }, '设备连接成功：127.0.0.1:5555'],
    ['ConnectionInfo', { what: 'ResolutionInfo', details: { width: 1280, height: 720 } }, '设备分辨率：1280 x 720'],
  ])('summarizes %s without modifying the fact', (event, payload, summary) => {
    const fact = callback(event, payload)
    const before = { ...fact }
    const annotation = annotateLog(fact)
    expect(annotation.summary).toBe(summary)
    expect(annotation.record).toBe(fact)
    expect(fact).toEqual(before)
    expect(annotation.keyEvent).toBe(true)
  })

  it.each([
    ['任务状态更新: {"isRunning":true,"taskType":"StartUp"}', '任务开始：启动游戏'],
    ['任务状态更新: {"isRunning":false}', '任务执行结束'],
    ['执行命令: maa run --config foo, 等待完成: true', '开始执行：自动化任务'],
    ['命令执行完成: maa fight, 退出码: 0', 'MAA 命令执行完成'],
    ['命令执行完成: maa fight, 退出码: 2', 'MAA 命令执行失败，退出码 2'],
    ['stdout:  结果 ', 'MAA 输出：结果'],
    ['stderr: 提示', 'MAA 提示：提示'],
    ['append_task Fight {', '任务已加入队列：作战'],
    ['Start | block', '任务执行开始'],
    ['Stop | block', '任务执行结束'],
    ['timeout when waiting socket connection', '截图通道连接超时，正在切换备用方案'],
    ['Killing child `adb`', '已终止超时的截图进程'],
    ['Call `x` failed', 'ADB 调用失败，正在尝试备用方案'],
    ['data is empty!', '截图数据为空，正在切换备用方案'],
  ])('summarizes lifecycle and integration messages: %s', (message, summary) => {
    expect(annotateLog(entry(message)).summary).toBe(summary)
  })

  it('hides only identified routine events and debug by default', () => {
    const records = [entry('debug', 'DEBUG'), entry('load resource'), entry('执行命令: maa dir log'),
      callback('AllTasksCompleted', {}), callback('SubTaskStart', { details: { task: 'StartButton2' } })]
    expect(records.map(log => annotateLog(log).keyEvent)).toEqual([false, false, false, false, false])
  })

  it('reads the maa-cli task summary as readable events and drops its separators', () => {
    const records = ['Summary', '----------------------------------------',
      '[Roguelike] 13:56:00 - Unfinished', 'Explorations:', '1. Unknown;', 'Summary:',
      'Unknown 1', 'Total invest 0 originium ingotes', 'Total gained 0 exp',
      'Error: Interrupted by user!'].map(line => annotateLog(entry(line)))
    expect(records[0]!.keyEvent).toBe(false)
    expect(records[1]!.keyEvent).toBe(false)
    expect(records[2]!.summary).toBe('任务总结：集成战略 · 13:56:00 开始 · 未完成')
    expect(records[3]!.summary).toBe('探索记录')
    expect(records[4]!.summary).toBe('第 1 次探索：未知')
    expect(records[5]!.keyEvent).toBe(false)
    expect(records[6]!.summary).toBe('结局：未知 1')
    expect(records[7]!.summary).toBe('累计投资 0 源石锭')
    expect(records[8]!.summary).toBe('累计获得 0 经验')
    expect(records[9]).toMatchObject({ summary: '任务已按请求停止', level: 'WARN', keyEvent: true })
  })

  it('summarizes the coalesced task report as one row', () => {
    const block = ['Summary', '----------------------------------------',
      '[Roguelike] 13:56:00 - Unfinished', 'Explorations:', '1. Unknown;', 'Summary:',
      'Unknown 1', 'Total invest 0 originium ingotes', 'Total gained 0 exp'].join('\n')
    expect(annotateLog(entry(block))).toMatchObject({
      summary: [
        '任务总结：集成战略 · 13:56:00 开始 · 未完成',
        '结局：未知 1',
        '投资 0 源石锭',
        '经验 0',
      ].join('\n'),
      keyEvent: true,
      parseStatus: 'parsed',
    })
  })

  it('keeps a coalesced fight report to one line', () => {
    const block = ['Summary', '----------------------------------------',
      '[Fight] 10:00:00 - 10:05:30 (5m 30s) Completed',
      'Fight 1-7 3 times, drops:', '1. 源岩 × 2, 龙门币 × 360',
      'total drops: 源岩 × 2, 龙门币 × 360'].join('\n')
    expect(annotateLog(entry(block)).summary)
      .toBe([
        '任务总结：作战 · 10:00:00 开始 · 10:05:30 结束 · 耗时 5m 30s · 完成',
        '作战 1-7 ×3',
        '合计掉落：源岩 × 2、龙门币 × 360',
      ].join('\n'))
  })

  it('keeps summary timing and stop or failure semantics explicit', () => {
    expect(annotateLog(entry('[Fight] 10:00:00 - 10:05:30 (5m 30s) Completed')).summary)
      .toBe('任务总结：作战 · 10:00:00 开始 · 10:05:30 结束 · 耗时 5m 30s · 完成')
    expect(annotateLog(entry('Error: Some error occurred during running task!')))
      .toMatchObject({ summary: '任务执行期间发生错误', level: 'ERROR' })
    expect(annotateLog(entry('命令执行已停止: maa fight')))
      .toMatchObject({ summary: 'MAA 命令已停止', level: 'WARN' })
  })

  it('retains unknown, timeless, warning and error records with a source fallback', () => {
    const records = [callback('FutureEvent', {}), callback('SubTaskExtraInfo', { what: 'FutureDetail' }),
      entry('timeless message', 'INFO', ''), entry('{}', 'WARN'), entry('load resource', 'ERROR'),
      entry('{"unknown":"payload"}'), entry('{"truncated":')]
    for (const record of records) {
      const annotation = annotateLog(record)
      expect(annotation.keyEvent).toBe(true)
      expect(annotation.summary).toBe(record.message)
    }
    expect(annotateLog(records[0]!).parseStatus).toBe('unrecognized')
  })

  it.each([
    'Assistant::append_callback | TaskChainStart {not-json}',
    'Assistant::append_callback | TaskChainStart {"taskchain":',
    'Assistant::append_callback | TaskChainStart',
    '任务状态更新: {not-json}',
  ])('keeps malformed payloads visible: %s', message => {
    expect(annotateLog(entry(message, 'DEBUG'))).toMatchObject({ summary: message, keyEvent: true, parseStatus: 'malformed' })
  })

  it('never downgrades severity and never promotes plain debug by accident', () => {
    expect(annotateLog(entry('stderr: error', 'ERROR')).level).toBe('ERROR')
    expect(annotateLog(callback('TaskChainError', {})).level).toBe('ERROR')
    expect(annotateLog(parseRealtimeLog({ level: 'DEBUG', message: 'ordinary debug' })).level).toBe('DEBUG')
    expect(annotateLog(parseRealtimeLog({ level: 'INFO', message: '[2026-07-22 10:11:12][ERR] source error' })).level).toBe('ERROR')
  })

  it('uses source fallbacks when required state or callback fields are missing', () => {
    for (const record of [entry('任务状态更新: {}'), callback('TaskChainCompleted', {}),
      callback('TaskChainStart', { taskchain: [] }), callback('AsyncCallInfo', { what: 'Connect', details: {} }),
      callback('SubTaskStart', {}), callback('SubTaskStart', { details: {} }),
      callback('SubTaskStart', { subtask: 'ProcessTask', details: {} }),
      callback('SubTaskCompleted', { subtask: 42 }), callback('AsyncCallInfo', {}),
      callback('AsyncCallInfo', { what: ['Click'], details: { ret: true } }),
      callback('AsyncCallInfo', { what: 'Click', details: {} })]) {
      expect(annotateLog(record)).toMatchObject({ summary: record.message, keyEvent: true, parseStatus: 'unrecognized' })
    }
    expect(annotateLog(callback('TaskChainError', {})).level).toBe('ERROR')
  })

  it('only hides identified successful async calls and retains failures and future call types', () => {
    for (const what of ['AttachWindow', 'Click', 'Screencap']) {
      expect(annotateLog(callback('AsyncCallInfo', { what, details: { ret: true } })).keyEvent).toBe(false)
      expect(annotateLog(callback('AsyncCallInfo', { what, details: { ret: false } })).keyEvent).toBe(true)
    }
    expect(annotateLog(callback('AsyncCallInfo', { what: 'FutureCall', details: { ret: true } })).keyEvent).toBe(true)
    expect(annotateLog(callback('AsyncCallInfo', { what: 'Click', details: { ret: true, error: 'unexpected' } })).keyEvent).toBe(true)
  })
})

describe('unified log selection and grouping', () => {
  const records = [callback('TaskChainError', { taskchain: 'Fight' }), entry('load resource'), entry('plain')]

  it('filters by effective severity and shows the semantic summary', () => {
    const errors = buildLogView(records, { ...options, level: 'ERROR' })
    expect(errors.selected).toEqual([records[0]])
    expect(errors.visible.map(log => log.message)).toEqual(['任务失败：作战'])
    expect(buildLogView(records, { ...options, level: 'INFO' }).selected).toEqual([records[2]])
  })

  it('selects only key events unless all events are requested', () => {
    expect(buildLogView(records, options).selected).toEqual([records[0], records[2]])
    expect(buildLogView(records, { ...options, events: 'all' }).selected).toEqual(records)
  })

  it('searches both semantic and source text', () => {
    expect(buildLogView(records, { ...options, search: 'taskchain' }).selected).toEqual([records[0]])
    expect(buildLogView(records, { ...options, search: '任务失败' }).selected).toEqual([records[0]])
  })

  it('reports source matches hidden by the key-event filter', () => {
    const hidden = buildLogView(records, { ...options, search: ' resource ' })
    expect(hidden.hiddenMatchCount).toBe(1)
    expect(hidden.selected).toEqual([])
    const all = buildLogView(records, { ...options, events: 'all', search: 'resource' })
    expect(all.hiddenMatchCount).toBe(0)
    expect(all.selected).toEqual([records[1]])
  })

  it('preserves members and times when folding identical source payloads', () => {
    const members = [entry('same'), entry('same', 'INFO', '10:00:01')]
    const view = buildLogView(members, { ...options, collapseRepeats: true })
    expect(view.selected).toEqual(members)
    expect(view.visible).toHaveLength(1)
    expect(view.visible[0]!.count).toBe(2)
    expect(view.visible[0]!.time).toBe('10:00:00')
    expect(view.visible[0]!.members.map(member => member.record)).toEqual(members)
  })

  it('groups consecutive routine warnings in the key-event view but not in all events', () => {
    const operWarning = (name: string) => entry(
      `parse oper: ${name} has multiple roles, but still not specific any`,
      'WARN',
    )
    const logs = [operWarning('A'), operWarning('B'), operWarning('C')]
    const key = buildLogView(logs, { ...options, collapseRepeats: true })
    expect(key.visible).toHaveLength(1)
    expect(key.visible[0]).toMatchObject({
      message: '干员多职业标签警告',
      count: 3,
      level: 'WARN',
    })
    expect(key.visible[0]!.members.map(member => member.record)).toEqual(logs)
    expect(key.selected).toEqual(logs)

    const all = buildLogView(logs, { ...options, events: 'all', collapseRepeats: true })
    expect(all.visible).toHaveLength(3)
  })

  it('groups BlackFlow resource warnings and task JSON continuations separately', () => {
    const logs = [
      entry('Optional BlackFlow map model is missing, path: /a', 'WARN'),
      entry('Optional BlackFlow map perception metadata is missing, path: /b', 'WARN'),
      entry('"credit_fight": false,', 'INFO', ''),
      entry('"shopping": true', 'INFO', ''),
      entry('}', 'INFO', ''),
    ]
    const view = buildLogView(logs, { ...options, collapseRepeats: true })
    expect(view.visible.map(group => [group.message, group.count])).toEqual([
      ['BlackFlow 可选资源缺失警告', 2],
      ['任务参数（JSON）', 3],
    ])
  })

  it('does not group routine warnings across runs or timestamped JSON lines', () => {
    const logs = [
      { ...entry('parse oper: A has multiple roles, but still not specific any', 'WARN'), runId: 'run-a' },
      { ...entry('parse oper: B has multiple roles, but still not specific any', 'WARN'), runId: 'run-b' },
      entry('"credit_fight": false,', 'INFO'),
      entry('"shopping": true', 'INFO'),
    ]
    const view = buildLogView(logs, { ...options, collapseRepeats: true })
    expect(view.visible).toHaveLength(4)
  })

  it('does not fold across Run, operation or distinct payloads with the same summary', () => {
    const source = callback('TaskChainCompleted', { taskchain: 'Fight', taskid: 1 })
    const otherPayload = callback('TaskChainCompleted', { taskchain: 'Fight', taskid: 2 })
    const logs = [{ ...source, runId: 'run-a', operationId: 'op-a' },
      { ...source, runId: 'run-b', operationId: 'op-a' },
      { ...source, runId: 'run-b', operationId: 'op-b' },
      { ...otherPayload, runId: 'run-b', operationId: 'op-b' }]
    expect(buildLogView(logs, { ...options, collapseRepeats: true }).visible).toHaveLength(4)
  })

  it('keeps Run scope explicit and leaves unassociated records unassociated', () => {
    const logs = [{ ...entry('a'), runId: 'run-a' }, { ...entry('b'), runId: 'run-b' }, entry('no owner')]
    expect(filterLogsByRunId(logs, 'run-a')).toEqual([logs[0]])
    expect(filterLogsByRunId(logs, null)).toBe(logs)
    expect(filterLogsByRunId(logs, 'missing')).toEqual([])
  })

  it('returns an explicit empty view', () => {
    expect(buildLogView([], options)).toEqual({ annotations: [], selected: [], visible: [], hiddenMatchCount: 0 })
  })
})

describe('detail formatting', () => {
  it('pretty-prints callback JSON without changing source facts', () => {
    expect(formatLogRawDetail('Assistant::append_callback | SubTaskExtraInfo {"what":"test"}'))
      .toBe('SubTaskExtraInfo\n{\n  "what": "test"\n}')
    expect(formatLogRawDetail('plain')).toBe('plain')
    expect(formatLogRawDetail('Assistant::append_callback | TaskChainStart {not-json}'))
      .toBe('Assistant::append_callback | TaskChainStart {not-json}')
  })
})
