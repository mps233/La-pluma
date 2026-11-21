import {
  isActiveRunState,
  isTerminalRunState,
  type AgentRun,
} from '@/features/task-execution'
import { readRoguelikeRunSummary, type RoguelikeRunSummary } from './runSummary'

export type RoguelikeCommand = 'roguelike' | 'reclamation'
export type RoguelikeRoundOutcome = 'passed' | 'not_passed' | 'unknown'
export type RoguelikeProgressPhase = 'starting' | 'exploring' | 'ended' | 'unknown'
export type RoguelikeLastEventKind = 'round' | 'combat' | 'event' | 'investment' | 'task'
export type RoguelikeBlackFlowNodeType = string
export type BlackFlowFreshness = 'current' | 'recent' | 'stale' | 'unknown' | 'terminal'

export interface RoguelikeBlackFlowNode {
  id: string
  name: string | null
  type: RoguelikeBlackFlowNodeType | null
}

export interface RoguelikeBlackFlowActionPoints {
  before: number | null
  after: number | null
  at: string | null
}

export interface RoguelikeBlackFlowRoute {
  at: string | null
  floor: number | null
  target: RoguelikeBlackFlowNode | null
  landing: RoguelikeBlackFlowNode | null
  movement: string | null
  actionPointsBefore: number | null
  actionPointsAfter: number | null
  exactCost: number | null
  predictedCost: number | null
  arrived: boolean
}

export interface RoguelikeBlackFlowNodeResolution {
  at: string | null
  floor: number | null
  node: RoguelikeBlackFlowNode | null
  eventName: string | null
  progress: 'active' | 'completed' | 'removed' | null
}

export interface RoguelikeBlackFlowMilestone {
  id: string
  floor: number | null
  progress: number | null
  status: string
  at: string | null
}

export interface RoguelikeBlackFlowStrategy {
  at: string | null
  profile: string | null
  outcome: string | null
  terminationReason: string | null
  nextAction: string | null
  succeeded: boolean | null
}

export interface RoguelikeBlackFlowProgress {
  floor: number | null
  floorAt: string | null
  currentNode: RoguelikeBlackFlowNode | null
  currentNodeAt: string | null
  actionPoints: RoguelikeBlackFlowActionPoints | null
  lastRoute: RoguelikeBlackFlowRoute | null
  lastNodeResolution: RoguelikeBlackFlowNodeResolution | null
  milestones: RoguelikeBlackFlowMilestone[]
  strategy: RoguelikeBlackFlowStrategy | null
  updatedAt: string | null
}

export type BlackFlowLastAction =
  | { kind: 'route'; route: RoguelikeBlackFlowRoute }
  | { kind: 'node'; resolution: RoguelikeBlackFlowNodeResolution }

export interface RoguelikeProgressRound {
  index: number | null
  outcome: RoguelikeRoundOutcome
  settled: boolean
  floor: number | null
  score: number | null
  endedAt: string | null
}

export interface RoguelikeProgressInvestment {
  rounds: number
  count: number
  total: number | null
  deposit: number | null
}

export interface RoguelikeProgressSnapshot {
  command: RoguelikeCommand
  theme: string
  mode: number | null
  phase: RoguelikeProgressPhase
  currentRound: number | null
  roundStartedAt: string | null
  targetRounds: number | null
  roundsStarted: number
  roundsEnded: number
  roundsSettled: number
  roundsPassed: number
  settlementSupported: boolean | null
  currentAction: string | null
  lastEventKind: RoguelikeLastEventKind | null
  lastEventName: string | null
  lastEventAt: string | null
  combatCount: number
  investment: RoguelikeProgressInvestment | null
  recentRounds: RoguelikeProgressRound[]
  blackflow?: RoguelikeBlackFlowProgress | null
  updatedAt: string
  degraded: boolean
  observed: boolean
}

export interface RoguelikeProgressView {
  status: 'loading' | 'idle' | 'active' | 'terminal'
  command: RoguelikeCommand
  progress: RoguelikeProgressSnapshot | null
  run: AgentRun | null
  summary: RoguelikeRunSummary | null
  fromLastRun: boolean
  taskName: string | null
}

export interface RoguelikeProgressViewInput {
  mode: RoguelikeCommand
  run: AgentRun | null
  lastRun: AgentRun | null
  hasSnapshot: boolean
  taskName?: string | null
}

const COMMAND_SET: ReadonlySet<string> = new Set(['roguelike', 'reclamation'])
const PHASE_SET: ReadonlySet<string> = new Set(['starting', 'exploring', 'ended', 'unknown'])
const OUTCOME_SET: ReadonlySet<string> = new Set(['passed', 'not_passed', 'unknown'])
const LAST_EVENT_KIND_SET: ReadonlySet<string> = new Set(['round', 'combat', 'event', 'investment', 'task'])

const OUTCOME_LABELS: Record<RoguelikeRoundOutcome, string> = {
  passed: '通关',
  not_passed: '未通关',
  unknown: '未确认',
}

const MAX_RECENT_ROUNDS = 5
const JUST_NOW_MS = 5_000
const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const MAX_BLACKFLOW_MILESTONES = 5
const BLACKFLOW_CURRENT_MS = 60_000
const BLACKFLOW_RECENT_MS = 180_000
const BLACKFLOW_STALE_MS = 300_000
const MAX_SAFE_NODE_ID_TEXT = '9007199254740991'
const NODE_ID_PATTERN = /^[0-9]+$/
const NODE_RESOLUTION_PROGRESS_SET: ReadonlySet<string> = new Set(['active', 'completed', 'removed'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const readFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const readBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null

const readText = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

const readNonEmptyText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null

const parseTimestamp = (value: string | null): number | null => {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

const readNodeId = (value: unknown): string | null => {
  if (typeof value === 'string') {
    if (!NODE_ID_PATTERN.test(value)) return null
    const significant = value.replace(/^0+(?=\d)/, '')
    if (significant.length > MAX_SAFE_NODE_ID_TEXT.length) return null
    if (
      significant.length === MAX_SAFE_NODE_ID_TEXT.length
      && significant > MAX_SAFE_NODE_ID_TEXT
    ) {
      return null
    }
    return value
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value)
  }
  return null
}

const readMode = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null

const isCommand = (value: unknown): value is RoguelikeCommand =>
  typeof value === 'string' && COMMAND_SET.has(value)

const readPhase = (value: unknown): RoguelikeProgressPhase =>
  typeof value === 'string' && PHASE_SET.has(value)
    ? value as RoguelikeProgressPhase
    : 'unknown'

const readOutcome = (value: unknown): RoguelikeRoundOutcome =>
  typeof value === 'string' && OUTCOME_SET.has(value)
    ? value as RoguelikeRoundOutcome
    : 'unknown'

const readLastEventKind = (value: unknown): RoguelikeLastEventKind | null =>
  typeof value === 'string' && LAST_EVENT_KIND_SET.has(value)
    ? value as RoguelikeLastEventKind
    : null

function parseRound(value: unknown): RoguelikeProgressRound | null {
  if (!isRecord(value)) return null
  const settled = readBoolean(value.settled)
  if (settled === null) return null
  return {
    index: readFiniteNumber(value.index),
    outcome: readOutcome(value.outcome),
    settled,
    floor: readFiniteNumber(value.floor),
    score: readFiniteNumber(value.score),
    endedAt: readText(value.endedAt),
  }
}

function readRecentRounds(value: unknown): RoguelikeProgressRound[] {
  if (!Array.isArray(value)) return []
  const rounds: RoguelikeProgressRound[] = []
  for (const entry of value) {
    const round = parseRound(entry)
    if (!round) continue
    rounds.push(round)
    if (rounds.length === MAX_RECENT_ROUNDS) break
  }
  return rounds
}

function parseInvestment(value: unknown): RoguelikeProgressInvestment | null {
  if (!isRecord(value)) return null
  const rounds = readFiniteNumber(value.rounds)
  const count = readFiniteNumber(value.count)
  if (rounds === null || count === null) return null
  return {
    rounds,
    count,
    total: readFiniteNumber(value.total),
    deposit: readFiniteNumber(value.deposit),
  }
}

function parseBlackFlowNode(value: unknown): RoguelikeBlackFlowNode | null {
  if (!isRecord(value)) return null
  const id = readNodeId(value.id)
  if (id === null) return null
  return {
    id,
    name: readText(value.name),
    type: readText(value.type),
  }
}

function parseBlackFlowActionPoints(value: unknown): RoguelikeBlackFlowActionPoints | null {
  if (!isRecord(value)) return null
  const before = readFiniteNumber(value.before)
  const after = readFiniteNumber(value.after)
  const at = readText(value.at)
  if (before === null && after === null && at === null) return null
  return { before, after, at }
}

function parseBlackFlowRoute(value: unknown): RoguelikeBlackFlowRoute | null {
  if (!isRecord(value)) return null
  const at = readText(value.at)
  const floor = readFiniteNumber(value.floor)
  const target = parseBlackFlowNode(value.target)
  const landing = parseBlackFlowNode(value.landing)
  const movement = readText(value.movement)
  const actionPointsBefore = readFiniteNumber(value.actionPointsBefore)
  const actionPointsAfter = readFiniteNumber(value.actionPointsAfter)
  const exactCost = readFiniteNumber(value.exactCost)
  const predictedCost = readFiniteNumber(value.predictedCost)
  const arrived = readBoolean(value.arrived) ?? false
  if (
    at === null
    && floor === null
    && target === null
    && landing === null
    && movement === null
    && actionPointsBefore === null
    && actionPointsAfter === null
    && exactCost === null
    && predictedCost === null
  ) {
    return null
  }
  return {
    at,
    floor,
    target,
    landing,
    movement,
    actionPointsBefore,
    actionPointsAfter,
    exactCost,
    predictedCost,
    arrived,
  }
}

function readNodeResolutionProgress(value: unknown): RoguelikeBlackFlowNodeResolution['progress'] {
  return typeof value === 'string' && NODE_RESOLUTION_PROGRESS_SET.has(value)
    ? value as RoguelikeBlackFlowNodeResolution['progress']
    : null
}

function parseBlackFlowNodeResolution(value: unknown): RoguelikeBlackFlowNodeResolution | null {
  if (!isRecord(value)) return null
  const at = readText(value.at)
  const floor = readFiniteNumber(value.floor)
  const node = parseBlackFlowNode(value.node)
  const eventName = readText(value.eventName)
  const progress = readNodeResolutionProgress(value.progress)
  if (at === null && floor === null && node === null && eventName === null && progress === null) {
    return null
  }
  return { at, floor, node, eventName, progress }
}

function readBlackFlowMilestones(value: unknown): RoguelikeBlackFlowMilestone[] {
  if (!Array.isArray(value)) return []
  const milestones: RoguelikeBlackFlowMilestone[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const id = readNonEmptyText(entry.id)
    const status = readNonEmptyText(entry.status)
    if (id === null || status === null || seen.has(id)) continue
    seen.add(id)
    milestones.push({
      id,
      floor: readFiniteNumber(entry.floor),
      progress: readFiniteNumber(entry.progress),
      status,
      at: readText(entry.at),
    })
    if (milestones.length === MAX_BLACKFLOW_MILESTONES) break
  }
  return milestones
}

function parseBlackFlowStrategy(value: unknown): RoguelikeBlackFlowStrategy | null {
  if (!isRecord(value)) return null
  const at = readText(value.at)
  const profile = readText(value.profile)
  const outcome = readText(value.outcome)
  const terminationReason = readText(value.terminationReason)
  const nextAction = readText(value.nextAction)
  const succeeded = readBoolean(value.succeeded)
  if (
    at === null
    && profile === null
    && outcome === null
    && terminationReason === null
    && nextAction === null
    && succeeded === null
  ) {
    return null
  }
  return { at, profile, outcome, terminationReason, nextAction, succeeded }
}

function parseBlackFlowProgress(value: unknown): RoguelikeBlackFlowProgress | null {
  if (!isRecord(value)) return null
  const floor = readFiniteNumber(value.floor)
  const floorAt = readText(value.floorAt)
  const currentNode = parseBlackFlowNode(value.currentNode)
  const currentNodeAt = readText(value.currentNodeAt)
  const actionPoints = parseBlackFlowActionPoints(value.actionPoints)
  const lastRoute = parseBlackFlowRoute(value.lastRoute)
  const lastNodeResolution = parseBlackFlowNodeResolution(value.lastNodeResolution)
  const milestones = readBlackFlowMilestones(value.milestones)
  const strategy = parseBlackFlowStrategy(value.strategy)
  const updatedAt = readText(value.updatedAt)
  if (
    floor === null
    && floorAt === null
    && currentNode === null
    && currentNodeAt === null
    && actionPoints === null
    && lastRoute === null
    && lastNodeResolution === null
    && milestones.length === 0
    && strategy === null
    && updatedAt === null
  ) {
    return null
  }
  return {
    floor,
    floorAt,
    currentNode,
    currentNodeAt,
    actionPoints,
    lastRoute,
    lastNodeResolution,
    milestones,
    strategy,
    updatedAt,
  }
}

function parseSnapshot(value: unknown): RoguelikeProgressSnapshot | null {
  if (!isRecord(value) || !isCommand(value.command)) return null

  const theme = readText(value.theme)
  const roundsStarted = readFiniteNumber(value.roundsStarted)
  const roundsEnded = readFiniteNumber(value.roundsEnded)
  const roundsSettled = readFiniteNumber(value.roundsSettled)
  const roundsPassed = readFiniteNumber(value.roundsPassed)
  const combatCount = readFiniteNumber(value.combatCount)
  const updatedAt = readText(value.updatedAt)
  const degraded = readBoolean(value.degraded)
  const observed = readBoolean(value.observed)
  if (
    theme === null
    || roundsStarted === null
    || roundsEnded === null
    || roundsSettled === null
    || roundsPassed === null
    || combatCount === null
    || updatedAt === null
    || degraded === null
    || observed === null
  ) {
    return null
  }

  return {
    command: value.command,
    theme,
    mode: readMode(value.mode),
    phase: readPhase(value.phase),
    currentRound: readFiniteNumber(value.currentRound),
    roundStartedAt: readText(value.roundStartedAt),
    targetRounds: readFiniteNumber(value.targetRounds),
    roundsStarted,
    roundsEnded,
    roundsSettled,
    roundsPassed,
    settlementSupported: readBoolean(value.settlementSupported),
    currentAction: readText(value.currentAction),
    lastEventKind: readLastEventKind(value.lastEventKind),
    lastEventName: readText(value.lastEventName),
    lastEventAt: readText(value.lastEventAt),
    combatCount,
    investment: parseInvestment(value.investment),
    recentRounds: readRecentRounds(value.recentRounds),
    blackflow: parseBlackFlowProgress(value.blackflow),
    updatedAt,
    degraded,
    observed,
  }
}

function readNestedProgress(container: unknown): unknown {
  if (!isRecord(container)) return undefined
  const summary = container.summary
  if (!isRecord(summary)) return undefined
  return summary.progress
}

export function readRoguelikeRunProgress(run: AgentRun | null): RoguelikeProgressSnapshot | null {
  if (!run) return null
  return parseSnapshot(run.progress?.roguelike)
}

export function readRoguelikeSummaryProgress(run: AgentRun | null): RoguelikeProgressSnapshot | null {
  if (!run) return null
  return parseSnapshot(readNestedProgress(run.result))
    ?? parseSnapshot(readNestedProgress(run.error?.details))
}

function createView(
  status: RoguelikeProgressView['status'],
  command: RoguelikeCommand,
  progress: RoguelikeProgressSnapshot | null,
  run: AgentRun | null,
  summary: RoguelikeRunSummary | null,
  fromLastRun: boolean,
  taskName: string | null,
): RoguelikeProgressView {
  return { status, command, progress, run, summary, fromLastRun, taskName }
}

function selectActiveRun(
  run: AgentRun,
  mode: RoguelikeCommand,
  taskName: string | null,
): RoguelikeProgressView | null {
  const progress = readRoguelikeRunProgress(run)
  if (!progress) return createView('active', mode, null, run, null, false, taskName)
  if (progress.command !== mode) return null
  return createView('active', mode, progress, run, null, false, taskName)
}

function selectTerminalRun(
  run: AgentRun,
  mode: RoguelikeCommand,
  taskName: string | null,
): RoguelikeProgressView | null {
  const progress = readRoguelikeSummaryProgress(run)
  const summary = readRoguelikeRunSummary(run)
  const progressCommand = progress?.command ?? null
  const summaryCommand = summary?.command ?? null

  if (progressCommand === null && summaryCommand === null) {
    return createView('terminal', mode, null, run, null, false, taskName)
  }
  if (progressCommand !== mode && summaryCommand !== mode) return null

  return createView(
    'terminal',
    mode,
    progressCommand === mode ? progress : null,
    run,
    summaryCommand === mode ? summary : null,
    false,
    taskName,
  )
}

function selectLastRun(
  lastRun: AgentRun | null,
  mode: RoguelikeCommand,
): RoguelikeProgressView | null {
  if (!lastRun || lastRun.operationId !== 'run_task') return null
  const summary = readRoguelikeRunSummary(lastRun)
  if (summary?.command !== mode) return null
  const progress = readRoguelikeSummaryProgress(lastRun)
  return createView(
    'terminal',
    mode,
    progress?.command === mode ? progress : null,
    lastRun,
    summary,
    true,
    null,
  )
}

export function selectRoguelikeProgressView({
  mode,
  run,
  lastRun,
  hasSnapshot,
  taskName = null,
}: RoguelikeProgressViewInput): RoguelikeProgressView {
  const name = taskName ?? null

  if (run && isActiveRunState(run.state)) {
    const active = selectActiveRun(run, mode, name)
    if (active) return active
  } else if (run && isTerminalRunState(run.state)) {
    const terminal = selectTerminalRun(run, mode, name)
    if (terminal) return terminal
  }

  const previous = selectLastRun(lastRun, mode)
  if (previous) return previous

  return createView(hasSnapshot ? 'idle' : 'loading', mode, null, null, null, false, name)
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

export function formatRoguelikeElapsed(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null
  const totalSeconds = Math.floor(ms / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60)
    return `${hours}:${pad2(totalMinutes % 60)}:${pad2(seconds)}`
  }
  return `${pad2(totalMinutes)}:${pad2(seconds)}`
}

export function formatRoguelikeRelativeTime(atMs: number | null, nowMs: number): string | null {
  if (atMs === null || !Number.isFinite(atMs) || !Number.isFinite(nowMs)) return null
  const elapsed = nowMs - atMs
  if (elapsed < 0) return null
  if (elapsed < JUST_NOW_MS) return '刚刚'
  if (elapsed < MINUTE_MS) return `${Math.floor(elapsed / 1000)} 秒前`
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} 分钟前`
  return `${Math.floor(elapsed / HOUR_MS)} 小时前`
}

export function calculateRoguelikeSuccessRate(passed: number, ended: number): number | null {
  if (!Number.isFinite(passed) || !Number.isFinite(ended) || ended <= 0) return null
  return Math.round((passed / ended) * 100)
}

export function describeRoguelikeRoundOutcome(outcome: RoguelikeRoundOutcome): string {
  return OUTCOME_LABELS[outcome]
}

export function describeBlackFlowFreshness(
  at: string | null,
  nowMs: number,
  terminal: boolean,
): BlackFlowFreshness {
  if (terminal) return 'terminal'
  if (!Number.isFinite(nowMs)) return 'unknown'
  const atMs = parseTimestamp(at)
  if (atMs === null) return 'unknown'
  const elapsed = nowMs - atMs
  if (elapsed < 0) return 'unknown'
  if (elapsed <= BLACKFLOW_CURRENT_MS) return 'current'
  if (elapsed <= BLACKFLOW_RECENT_MS) return 'recent'
  if (elapsed <= BLACKFLOW_STALE_MS) return 'stale'
  return 'unknown'
}

export function selectBlackFlowAction(
  progress: RoguelikeBlackFlowProgress | null,
): BlackFlowLastAction | null {
  if (!progress) return null
  const route = progress.lastRoute
  const resolution = progress.lastNodeResolution
  if (!route) return resolution ? { kind: 'node', resolution } : null
  if (!resolution) return { kind: 'route', route }
  const routeAtMs = parseTimestamp(route.at)
  const resolutionAtMs = parseTimestamp(resolution.at)
  if (routeAtMs !== null && resolutionAtMs !== null && resolutionAtMs > routeAtMs) {
    return { kind: 'node', resolution }
  }
  return { kind: 'route', route }
}

const BLACKFLOW_NODE_TYPE_LABELS: Record<string, string> = {
  battle_elite: '精英作战',
  battle_normal: '作战',
  battle_savage: '紧急作战',
  battle_boss: 'Boss',
  duel: '决斗',
  door: '通道',
  employ: '招募',
  expedition: '探险',
  incident: '事件',
  shop: '商店',
  scrap_shop: '废品商店',
  rest: '休整',
  sacrifice: '献祭',
  wish: '许愿',
  final: '终点',
  empty: '空节点',
  evacuate: '撤离',
  hide_battle: '隐藏作战',
  hide_invisible: '隐藏作战',
}

const BLACKFLOW_MILESTONE_STATUS_LABELS: Record<string, string> = {
  available: '可达成',
  satisfied: '已达成',
  missed: '已错过',
  impossible: '无法达成',
  inactive: '未激活',
}

const BLACKFLOW_STRATEGY_PROFILE_LABELS: Record<string, string> = {
  baby_animal: '培育襁褓动物',
  investment: '第一层投资后速通',
  burn_with_investment: '投资后速通到第三层',
  burn: '速通到第三层',
  ending1: '第一结局刷等级',
  ending2: '第二结局刷等级',
  ending3: '第三结局刷等级',
}

const BLACKFLOW_STRATEGY_OUTCOME_LABELS: Record<string, string> = {
  burn_completed: '速通完成',
}

const BLACKFLOW_TERMINATION_REASON_LABELS: Record<string, string> = {
  third_floor_reached: '抵达第三层',
}

const BLACKFLOW_NEXT_ACTION_LABELS: Record<string, string> = {
  restart_current_run: '重新开始本局',
  stop_run: '停止运行',
}

const BLACKFLOW_SCRAP_MOVEMENT_PATTERN = /^rogue_6_scrap_M_(?:0[1-9]|1[0-6])$/

const readLabel = (labels: Record<string, string>, value: string | null): string | null =>
  typeof value === 'string' ? labels[value] ?? null : null

export function describeBlackFlowNodeType(
  type: RoguelikeBlackFlowNodeType | null,
): string | null {
  return readLabel(BLACKFLOW_NODE_TYPE_LABELS, type)
}

export function describeBlackFlowMovement(movement: string | null): string | null {
  if (movement === 'walk') return '步行'
  if (typeof movement === 'string' && BLACKFLOW_SCRAP_MOVEMENT_PATTERN.test(movement)) {
    return '加工品移动'
  }
  return null
}

export function describeBlackFlowMilestoneStatus(status: string | null): string | null {
  return readLabel(BLACKFLOW_MILESTONE_STATUS_LABELS, status)
}

export function describeBlackFlowStrategyProfile(profile: string | null): string | null {
  return readLabel(BLACKFLOW_STRATEGY_PROFILE_LABELS, profile)
}

export function describeBlackFlowStrategyOutcome(outcome: string | null): string | null {
  return readLabel(BLACKFLOW_STRATEGY_OUTCOME_LABELS, outcome)
}

export function describeBlackFlowTerminationReason(reason: string | null): string | null {
  return readLabel(BLACKFLOW_TERMINATION_REASON_LABELS, reason)
}

export function describeBlackFlowNextAction(action: string | null): string | null {
  return readLabel(BLACKFLOW_NEXT_ACTION_LABELS, action)
}
