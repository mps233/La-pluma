import { useEffect, useState } from 'react'
import { Badge } from '@/shared/ui/badge'
import { Card } from '@/shared/ui/card'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/shared/ui/item'
import { Progress, ProgressLabel } from '@/shared/ui/progress'
import { EmptyState, InlineAlert, Loading } from '@/shared/components'
import type { AgentRun } from '@/features/task-execution'
import {
  calculateRoguelikeSuccessRate,
  describeBlackFlowFreshness,
  describeBlackFlowMilestoneStatus,
  describeBlackFlowMovement,
  describeBlackFlowNextAction,
  describeBlackFlowNodeType,
  describeBlackFlowStrategyOutcome,
  describeBlackFlowStrategyProfile,
  describeBlackFlowTerminationReason,
  describeRoguelikeRoundOutcome,
  formatRoguelikeElapsed,
  formatRoguelikeRelativeTime,
  selectBlackFlowAction,
  selectRoguelikeProgressView,
  type BlackFlowFreshness,
  type RoguelikeBlackFlowActionPoints,
  type RoguelikeBlackFlowMilestone,
  type RoguelikeBlackFlowNode,
  type RoguelikeBlackFlowProgress,
  type RoguelikeBlackFlowStrategy,
  type RoguelikeCommand,
  type RoguelikeProgressInvestment,
  type RoguelikeProgressRound,
  type RoguelikeProgressSnapshot,
  type RoguelikeProgressView,
} from '../model/runProgress'
import type { RoguelikeRunSummary } from '../model/runSummary'

interface RoguelikeProgressPanelProps {
  mode: RoguelikeCommand
  run: AgentRun | null
  lastRun: AgentRun | null
  hasSnapshot: boolean
  resolvingIdentity: boolean
  taskName?: string | null
}

type ProgressBadgeTone = 'success' | 'warning' | 'danger' | 'running' | 'neutral'

const BADGE_SURFACE: Record<ProgressBadgeTone, string> = {
  success: 'status-success',
  warning: 'status-warning',
  danger: 'status-danger',
  running: 'brand-chip',
  neutral: 'surface-soft text-muted-foreground',
}

const PANEL_TITLES: Record<RoguelikeCommand, string> = {
  roguelike: '集成战略进度',
  reclamation: '生息演算进度',
}

const IDLE_TITLES: Record<RoguelikeCommand, string> = {
  roguelike: '还没有开始探索',
  reclamation: '还没有开始演算',
}

const ACTION_LABELS: Record<string, string> = {
  StartExplore: '开始新一局',
  RoguelikeCombatEnd: '战斗结束',
  RoguelikeInvestment: '投资',
  GamePass: '通关结算',
  MissionFailedFlag2: '本局结束',
  TaskChainStart: '任务启动',
  TaskChainCompleted: '任务完成',
  TaskChainError: '任务失败',
  TaskChainStopped: '任务停止',
}

const SETTLEMENT_MODES: ReadonlySet<number> = new Set([0, 30001, 30003])

function parseTimestamp(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatDuration(ms: number | null): string | null {
  return formatRoguelikeElapsed(typeof ms === 'number' ? ms : null)
}

function readProgressMessage(run: AgentRun | null): string | null {
  const message = run?.progress?.message
  return typeof message === 'string' && message.trim() ? message.trim() : null
}

function cleanErrorMessage(run: AgentRun | null): string | null {
  const message = run?.error?.message
  if (typeof message !== 'string') return null
  const cleaned = message.replace(/\s+/g, ' ').trim()
  return cleaned || null
}

function describeBadge(
  view: RoguelikeProgressView,
  status: RoguelikeProgressView['status'],
): { label: string; tone: ProgressBadgeTone } | null {
  if (status === 'loading') return null
  if (status === 'idle') return { label: '未开始', tone: 'neutral' }
  if (status === 'active') {
    switch (view.run?.state) {
      case 'accepted':
      case 'waiting':
        return { label: '启动中', tone: 'running' }
      case 'stopping':
        return { label: '正在停止', tone: 'warning' }
      default:
        return { label: '运行中', tone: 'running' }
    }
  }
  switch (view.run?.state) {
    case 'failed':
      return { label: '失败', tone: 'danger' }
    case 'stopped':
      return { label: '已停止', tone: 'warning' }
    case 'interrupted':
      return { label: '已中断', tone: 'warning' }
    default:
      return { label: '已完成', tone: 'success' }
  }
}

function describeActiveStatus(
  mode: RoguelikeCommand,
  progress: RoguelikeProgressSnapshot | null,
  state: AgentRun['state'] | null,
): string {
  if (state === 'stopping') return '正在停止'
  if (state === 'accepted' || state === 'waiting') return '正在启动'
  if (mode === 'reclamation') return '本次演算进行中'
  if (!progress) return '正在启动'
  if (progress.currentRound !== null) return `第 ${progress.currentRound} 局 · 探索中`
  if (progress.roundsEnded > 0) return `已结束 ${progress.roundsEnded} 局 · 等待下一局`
  return '正在启动'
}

function describeTerminalStatus(view: RoguelikeProgressView): string {
  const state = view.run?.state
  if (view.command === 'reclamation') {
    if (state === 'succeeded') {
      const duration = formatDuration(view.run?.durationMs ?? null)
      return duration ? `上次演算已完成 · 耗时 ${duration}` : '上次演算已完成'
    }
    if (state === 'failed') return '执行失败'
    if (state === 'stopped') return '任务已停止'
    return '任务已中断'
  }
  if (state === 'succeeded') {
    const rounds = view.progress ? ` · 共 ${view.progress.roundsEnded} 局` : ''
    return `${view.fromLastRun ? '最近一次执行已结束' : '本次探索已结束'}${rounds}`
  }
  if (state === 'failed') return view.fromLastRun ? '最近一次执行失败' : '执行失败'
  if (state === 'stopped') return view.fromLastRun ? '最近一次执行已停止' : '任务已停止'
  return view.fromLastRun ? '最近一次执行已中断' : '任务已中断'
}

function describeCurrentAction(progress: RoguelikeProgressSnapshot): string {
  const action = progress.currentAction
  if (action === 'StageInfo' || action === 'RoguelikeEvent' || action === 'RoguelikeEventSelected') {
    const name = progress.lastEventName?.trim()
    const prefix = action === 'StageInfo' ? '作战' : '事件'
    return name ? `${prefix}：${name}` : prefix
  }
  if (!action) return '任务执行中'
  return ACTION_LABELS[action] ?? '任务执行中'
}

function formatBlackFlowNode(node: RoguelikeBlackFlowNode): string {
  const name = node.name?.trim() ?? ''
  const type = describeBlackFlowNodeType(node.type)
  if (name && type) return `${name}（${type}）`
  return name || type || ''
}

function describeBlackFlowFloor(
  floor: number,
  at: string | null,
  freshness: BlackFlowFreshness,
  now: number,
  terminal: boolean,
): string {
  const label = `第 ${floor} 层`
  if (terminal) return `最后记录${label}`
  if (freshness === 'current') return label
  if (freshness === 'recent') return `最近已知${label}`
  if (freshness === 'stale') return `可能已过期${label}`
  const atMs = parseTimestamp(at)
  return atMs !== null && now >= atMs ? `最近已知${label}` : label
}

function describeBlackFlowNodeStatus(
  node: RoguelikeBlackFlowNode,
  freshness: BlackFlowFreshness,
): string | null {
  if (freshness === 'unknown') return null
  const identity = formatBlackFlowNode(node)
  if (freshness === 'terminal') {
    return identity ? `最后记录节点 ${identity}` : '最后记录节点未知'
  }
  if (freshness === 'stale') {
    return identity ? `可能已过期节点 ${identity}` : '可能已过期节点未知'
  }
  if (freshness === 'recent') {
    return identity ? `最近已知节点 ${identity}` : '最近已知节点未知'
  }
  return identity ? `当前节点 ${identity}` : '当前节点未知'
}

function describeBlackFlowActionPointsStatus(
  actionPoints: RoguelikeBlackFlowActionPoints,
  freshness: BlackFlowFreshness,
): string | null {
  if (freshness === 'unknown') return null
  const value = actionPoints.before
  if (value === null) return null
  if (freshness === 'terminal') return `最后记录行动力 ${value}`
  if (freshness === 'stale') return `可能已过期行动力 ${value}`
  if (freshness === 'recent') return `最近决策时行动力 ${value}`
  return `行动力 ${value}`
}

function describeBlackFlowStatus(
  blackflow: RoguelikeBlackFlowProgress,
  now: number,
  terminal: boolean,
): string | null {
  const parts: string[] = []

  if (blackflow.floor !== null) {
    parts.push(describeBlackFlowFloor(
      blackflow.floor,
      blackflow.floorAt,
      describeBlackFlowFreshness(blackflow.floorAt, now, terminal),
      now,
      terminal,
    ))
  }

  if (blackflow.currentNode) {
    const node = describeBlackFlowNodeStatus(
      blackflow.currentNode,
      describeBlackFlowFreshness(blackflow.currentNodeAt, now, terminal),
    )
    if (node !== null) parts.push(node)
  }

  if (blackflow.actionPoints) {
    const actionPoints = describeBlackFlowActionPointsStatus(
      blackflow.actionPoints,
      describeBlackFlowFreshness(blackflow.actionPoints.at, now, terminal),
    )
    if (actionPoints !== null) parts.push(actionPoints)
  }

  return parts.length > 0 ? parts.join(' · ') : null
}

function describeBlackFlowAction(blackflow: RoguelikeBlackFlowProgress): string | null {
  const action = selectBlackFlowAction(blackflow)
  if (!action) return null
  if (action.kind === 'route') {
    const route = action.route
    const destination = route.target ?? route.landing
    const parts: string[] = []
    if (destination) {
      const name = destination.name?.trim()
        || describeBlackFlowNodeType(destination.type)
        || '未知节点'
      const movement = describeBlackFlowMovement(route.movement)
      parts.push(`移动：前往 ${name}${movement ? `（${movement}）` : ''}`)
    }
    if (route.actionPointsBefore !== null && route.actionPointsAfter !== null) {
      parts.push(`行动力 ${route.actionPointsBefore}→${route.actionPointsAfter}`)
    }
    if (route.arrived) parts.push('已到达')
    return parts.length > 0 ? parts.join(' · ') : null
  }
  const resolution = action.resolution
  const label = resolution.eventName?.trim()
    || describeBlackFlowNodeType(resolution.node?.type ?? null)
    || '事件节点'
  const parts = [`最近完成：${label}`]
  if (resolution.progress === 'active') parts.push('进行中')
  if (resolution.progress === 'removed') parts.push('已移除')
  return parts.join(' · ')
}

function describeBlackFlowMilestone(milestone: RoguelikeBlackFlowMilestone): string | null {
  const status = describeBlackFlowMilestoneStatus(milestone.status)
  const parts: string[] = []
  if (milestone.floor !== null) parts.push(`第 ${milestone.floor} 层目标`)
  if (status) parts.push(status)
  if (parts.length === 0) return null
  if (milestone.progress !== null && milestone.progress > 0) {
    parts.push(`进度 ${milestone.progress}`)
  }
  return parts.join(' · ')
}

function describeBlackFlowStrategy(strategy: RoguelikeBlackFlowStrategy | null): {
  profile: string | null
  result: string | null
} {
  if (!strategy) return { profile: null, result: null }
  const profile = describeBlackFlowStrategyProfile(strategy.profile)
  const outcome = describeBlackFlowStrategyOutcome(strategy.outcome)
  const reason = describeBlackFlowTerminationReason(strategy.terminationReason)
  const nextAction = describeBlackFlowNextAction(strategy.nextAction)
  const resultParts = [
    outcome,
    reason ? `原因：${reason}` : null,
    nextAction ? `建议：${nextAction}` : null,
  ].filter((part): part is string => part !== null)
  if (resultParts.length === 0 && strategy.succeeded === true) {
    resultParts.push('策略目标已达成')
  }
  return {
    profile: profile ? `黑流策略：${profile}` : null,
    result: resultParts.length > 0 ? `策略结果：${resultParts.join(' · ')}` : null,
  }
}

function describeBlackFlowUpdatedAt(
  updatedAt: string | null,
  now: number,
  terminal: boolean,
): string | null {
  const relative = formatRoguelikeRelativeTime(parseTimestamp(updatedAt), now)
  if (!relative) return null
  return terminal ? `最后记录于 ${relative}` : `黑流更新于 ${relative}`
}

function BlackFlowProgress({
  blackflow,
  now,
  terminal,
}: {
  blackflow: RoguelikeBlackFlowProgress
  now: number
  terminal: boolean
}) {
  const status = describeBlackFlowStatus(blackflow, now, terminal)
  const action = describeBlackFlowAction(blackflow)
  const milestones = blackflow.milestones
    .map(milestone => ({ id: milestone.id, text: describeBlackFlowMilestone(milestone) }))
    .filter((milestone): milestone is { id: string; text: string } => milestone.text !== null)
    .slice(0, 3)
  const strategy = describeBlackFlowStrategy(blackflow.strategy)
  const updatedAt = describeBlackFlowUpdatedAt(blackflow.updatedAt, now, terminal)
  const hasMapData = blackflow.floor !== null
    || blackflow.currentNode !== null
    || (blackflow.actionPoints?.before ?? null) !== null
    || (blackflow.actionPoints?.after ?? null) !== null
    || blackflow.lastRoute !== null
    || blackflow.lastNodeResolution !== null
  const showEmptyState = status === null && action === null && milestones.length === 0

  return (
    <section className="roguelike-progress-blackflow">
      <h3>黑流进度</h3>
      {status ? (
        <p className="roguelike-progress-action">{status}</p>
      ) : (
        showEmptyState && (
          <p className="roguelike-progress-note">
            {terminal
              ? '未记录到黑流进度'
              : hasMapData
                ? '节点未知（最近记录已过期）'
                : '等待黑流地图数据…'}
          </p>
        )
      )}
      {action && <p className="roguelike-progress-action">{action}</p>}
      {milestones.length > 0 && (
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {milestones.map(milestone => <li key={milestone.id}>{milestone.text}</li>)}
        </ul>
      )}
      {strategy.profile && <p className="roguelike-progress-note">{strategy.profile}</p>}
      {strategy.result && <p className="roguelike-progress-note">{strategy.result}</p>}
      {updatedAt && (
        <p className="text-[11px] leading-normal text-muted-foreground">{updatedAt}</p>
      )}
    </section>
  )
}

function ActiveTiming({
  mode,
  startedAtMs,
  roundStartedAtMs,
  lastEventAtMs,
  now,
}: {
  mode: RoguelikeCommand
  startedAtMs: number | null
  roundStartedAtMs: number | null
  lastEventAtMs: number | null
  now: number
}) {
  const taskElapsed = startedAtMs === null ? null : formatRoguelikeElapsed(now - startedAtMs)
  const roundElapsed = roundStartedAtMs === null ? null : formatRoguelikeElapsed(now - roundStartedAtMs)
  const lastEvent = formatRoguelikeRelativeTime(lastEventAtMs, now)
  const parts = mode === 'reclamation'
    ? [
        taskElapsed ? `本次时长 ${taskElapsed}` : null,
        lastEvent ? `最近活动 ${lastEvent}` : null,
      ]
    : [
        taskElapsed ? `本次任务 ${taskElapsed}` : null,
        roundElapsed ? `本局 ${roundElapsed}` : null,
        lastEvent ? `最近事件 ${lastEvent}` : null,
      ]
  const visible = parts.filter((part): part is string => part !== null)
  if (visible.length === 0) return null
  return <p className="roguelike-progress-timing">{visible.join(' · ')}</p>
}

function InvestmentStats({ investment }: { investment: RoguelikeProgressInvestment }) {
  return (
    <div className="roguelike-progress-stats" role="group" aria-label="投资统计">
      <Badge variant="secondary">投资轮次 {investment.rounds}</Badge>
      <Badge variant="secondary">投资次数 {investment.count}</Badge>
      {investment.total !== null && <Badge variant="secondary">投资总额 {investment.total}</Badge>}
      {investment.deposit !== null && <Badge variant="secondary">投资存款 {investment.deposit}</Badge>}
    </div>
  )
}

function ProgressStats({ progress }: { progress: RoguelikeProgressSnapshot }) {
  const rate = calculateRoguelikeSuccessRate(progress.roundsPassed, progress.roundsEnded)
  const settlementMode = progress.mode !== null && SETTLEMENT_MODES.has(progress.mode)
  const passObserved = progress.settlementSupported === true || progress.roundsPassed > 0
  const showPassed = settlementMode || passObserved
  const showRate = showPassed
    && rate !== null
    && !(progress.settlementSupported === false && progress.roundsPassed === 0)
  const showSettled = progress.roundsSettled > 0
    || progress.settlementSupported === true
    || (settlementMode && progress.settlementSupported !== false)
  const settlementUnsupported = progress.settlementSupported === false && !settlementMode
  const showInvestment = progress.investment !== null

  return (
    <>
      <div className="roguelike-progress-stats">
        {!settlementMode && <Badge variant="secondary">已开始 {progress.roundsStarted} 局</Badge>}
        <Badge variant="secondary">已结束 {progress.roundsEnded} 局</Badge>
        {showPassed && <Badge variant="secondary">通关 {progress.roundsPassed} 局</Badge>}
        {showRate && <Badge variant="secondary">成功率 {rate}%</Badge>}
        {showSettled && <Badge variant="secondary">已结算 {progress.roundsSettled} 局</Badge>}
        {settlementUnsupported && <span>该模式不提供结算数据</span>}
      </div>
      {showInvestment && progress.investment && <InvestmentStats investment={progress.investment} />}
      {progress.targetRounds !== null && progress.targetRounds > 0 && (
        <Progress
          className="w-full"
          value={Math.min(100, Math.round((progress.roundsEnded / progress.targetRounds) * 100))}
        >
          <ProgressLabel className="text-xs font-normal text-muted-foreground">
            目标 {progress.targetRounds} 局 · 还剩 {Math.max(0, progress.targetRounds - progress.roundsEnded)} 局
          </ProgressLabel>
        </Progress>
      )}
    </>
  )
}

function RecentRounds({ rounds }: { rounds: RoguelikeProgressRound[] }) {
  if (rounds.length === 0) return null
  return (
    <ItemGroup className="gap-1">
      {rounds.slice(0, 5).map((round, index) => (
        <Item
          key={`${round.index ?? 'unknown'}-${index}`}
          render={<div role="listitem" />}
          size="xs"
          variant="muted"
          className="py-1 text-xs"
        >
          <ItemContent className="flex-row flex-wrap items-center gap-x-2.5 gap-y-1">
            <ItemTitle className="text-xs">
              {round.index === null ? '未知局' : `第 ${round.index} 局`}
            </ItemTitle>
            <ItemDescription className="text-xs">
              {describeRoguelikeRoundOutcome(round.outcome)}
            </ItemDescription>
            {round.floor !== null && <span>第 {round.floor} 层</span>}
            {round.score !== null && <span>{round.score} 分</span>}
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  )
}

function LastRoundResult({ progress }: { progress: RoguelikeProgressSnapshot }) {
  const round = progress.recentRounds[0]
  if (!round) return null
  const parts = [describeRoguelikeRoundOutcome(round.outcome)]
  if (round.floor !== null) parts.push(`第 ${round.floor} 层`)
  if (round.score !== null) parts.push(`${round.score} 分`)
  return <p className="roguelike-progress-result">本局结果：{parts.join(' · ')}</p>
}

function SettlementFallback({ summary }: { summary: RoguelikeRunSummary }) {
  const settlement = summary.settlement
  if (!settlement) return null
  const parts: string[] = []
  if (settlement.gamePass !== null) parts.push(`通关 ${settlement.gamePass ? '是' : '否'}`)
  if (settlement.floor !== null) parts.push(`层数 ${settlement.floor}`)
  if (settlement.score !== null) parts.push(`得分 ${settlement.score}`)
  if (parts.length === 0) return null
  return (
    <div className="roguelike-progress-stats">
      {parts.map(part => <Badge key={part} variant="secondary">{part}</Badge>)}
    </div>
  )
}

export default function RoguelikeProgressPanel({
  mode,
  run,
  lastRun,
  hasSnapshot,
  resolvingIdentity,
  taskName,
}: RoguelikeProgressPanelProps) {
  const view = selectRoguelikeProgressView({ mode, run, lastRun, hasSnapshot, taskName })
  const status = run === null && resolvingIdentity ? 'loading' : view.status
  const [now, setNow] = useState(() => Date.now())
  const progress = view.progress
  const blackflow = progress?.blackflow ?? null
  const startedAtMs = parseTimestamp(view.run?.startedAt)
  const roundStartedAtMs = parseTimestamp(progress?.roundStartedAt)
  const lastEventAtMs = parseTimestamp(progress?.lastEventAt)
  const isLive = status === 'active'
    && (startedAtMs !== null || roundStartedAtMs !== null || lastEventAtMs !== null)

  useEffect(() => {
    if (!isLive) return undefined
    const tick = () => setNow(Date.now())
    const alignTimer = window.setTimeout(tick, 0)
    const timer = window.setInterval(tick, 1_000)
    return () => {
      window.clearTimeout(alignTimer)
      window.clearInterval(timer)
    }
  }, [isLive])

  const badge = describeBadge(view, status)
  const owner = view.taskName?.trim() ?? ''
  const activeMessage = status === 'active' && progress === null
    ? readProgressMessage(view.run)
    : null
  const errorText = status === 'terminal' ? cleanErrorMessage(view.run) : null

  return (
    <Card
      className="roguelike-panel roguelike-progress-panel gap-0 p-0!"
      role="region"
      aria-label="执行进度"
    >
      <div className="roguelike-panel-heading">
        <h2>{PANEL_TITLES[mode]}</h2>
        {badge && (
          <div className="flex shrink-0 items-center">
            <Badge variant="ghost" className={`${BADGE_SURFACE[badge.tone]} pointer-events-none`}>
              {badge.label}
            </Badge>
          </div>
        )}
      </div>

      <div className="roguelike-panel-body roguelike-progress-body">
        {owner && status !== 'idle' && status !== 'loading' && (
          <p className="roguelike-progress-owner">任务：{owner}</p>
        )}

        {status === 'loading' && (
          <Loading size="sm" text="正在确认执行状态…" />
        )}

        {status === 'idle' && (
          <EmptyState
            compact
            className="roguelike-progress-empty"
            title={IDLE_TITLES[mode]}
          />
        )}

        {status === 'active' && (
          <>
            <p className="roguelike-progress-status" role="status">
              {describeActiveStatus(mode, progress, view.run?.state ?? null)}
            </p>
            {activeMessage && <p className="roguelike-progress-note">{activeMessage}</p>}
            <ActiveTiming
              mode={mode}
              startedAtMs={startedAtMs}
              roundStartedAtMs={roundStartedAtMs}
              lastEventAtMs={lastEventAtMs}
              now={now}
            />
            {mode === 'roguelike' && progress && (
              <>
                {blackflow && (
                  <BlackFlowProgress blackflow={blackflow} now={now} terminal={false} />
                )}
                <ProgressStats progress={progress} />
                {!(blackflow && selectBlackFlowAction(blackflow)) && (
                  <p className="roguelike-progress-action">{describeCurrentAction(progress)}</p>
                )}
                <RecentRounds rounds={progress.recentRounds} />
                {progress.degraded && (
                  <InlineAlert tone="warning">进度数据可能不完整</InlineAlert>
                )}
              </>
            )}
          </>
        )}

        {status === 'terminal' && (
          <>
            <p className="roguelike-progress-status">{describeTerminalStatus(view)}</p>
            {mode === 'roguelike' ? (
              progress ? (
                <>
                  {blackflow && <BlackFlowProgress blackflow={blackflow} now={now} terminal />}
                  <LastRoundResult progress={progress} />
                  <ProgressStats progress={progress} />
                  <RecentRounds rounds={progress.recentRounds} />
                  {progress.degraded && (
                    <InlineAlert tone="warning">进度数据可能不完整</InlineAlert>
                  )}
                </>
              ) : view.summary ? (
                <>
                  {view.summary.message && (
                    <p className="roguelike-progress-message">{view.summary.message}</p>
                  )}
                  <SettlementFallback summary={view.summary} />
                </>
              ) : (
                <p className="roguelike-progress-note">本次执行没有可用的结构化结果</p>
              )
            ) : (
              view.summary?.message ? (
                <p className="roguelike-progress-message">{view.summary.message}</p>
              ) : (
                <p className="roguelike-progress-note">本次执行没有可用的结构化结果</p>
              )
            )}
            {errorText && (
              <InlineAlert tone="error" title="执行错误">{errorText}</InlineAlert>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
