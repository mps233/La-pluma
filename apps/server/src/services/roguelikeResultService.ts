import {
  getCallbackDetails,
  parseMaaCallbackEvents
} from './maaCallbackService.ts';
import type { MaaCallbackEvent } from './maaCallbackService.ts';
import {
  readRoguelikeEvent,
  readRoguelikeInvestment,
  readRoguelikeSettlement
} from './roguelikeCallbackReaders.ts';
import type {
  RoguelikeEventSummary,
  RoguelikeInvestmentSummary,
  RoguelikeSettlementSummary
} from './roguelikeCallbackReaders.ts';
import type { RoguelikeProgressSnapshot } from './roguelikeProgressService.ts';

export type {
  RoguelikeEventSummary,
  RoguelikeInvestmentSummary,
  RoguelikeSettlementSummary
} from './roguelikeCallbackReaders.ts';

export type RoguelikeCommand = 'roguelike' | 'reclamation';

export type RoguelikeRunStatus = 'success' | 'failed' | 'stopped' | 'incomplete';

export interface RoguelikeCopperExchangeSummary {
  toDiscard: string;
  toPickup: string;
}

export interface RoguelikeStrategySummary {
  profile: string | null;
  outcome: string | null;
  succeeded: boolean | null;
}

/**
 * 单次肉鸽/生息演算执行的结果投影：字段只来自本次执行日志中的结构化回调，
 * 缺失字段保持 null/空数组，不用 UI 文案或假数据补齐；progress 是执行结束时
 * 由同一段日志归并出的最终进度快照。
 */
export interface RoguelikeResultSummary {
  command: RoguelikeCommand;
  theme: string;
  status: RoguelikeRunStatus;
  observed: boolean;
  message: string;
  settlement: RoguelikeSettlementSummary | null;
  investment: RoguelikeInvestmentSummary | null;
  events: RoguelikeEventSummary[];
  coppers: RoguelikeCopperExchangeSummary[];
  milestones: string[];
  warnings: string[];
  strategy: RoguelikeStrategySummary | null;
  combats: number;
  progress: RoguelikeProgressSnapshot | null;
  taskChain: {
    started: boolean;
    completed: boolean;
    failed: boolean;
    stopped: boolean;
  };
}

export interface RoguelikeResultCapture {
  command: string;
  args?: readonly string[];
}

const ROGUELIKE_TASKCHAIN = 'Roguelike';
const RECLAMATION_TASKCHAIN = 'Reclamation';

const TASKCHAIN_BY_COMMAND: Record<RoguelikeCommand, string> = {
  roguelike: ROGUELIKE_TASKCHAIN,
  reclamation: RECLAMATION_TASKCHAIN
};

const COMMAND_LABELS: Record<RoguelikeCommand, string> = {
  roguelike: '集成战略',
  reclamation: '生息演算'
};

const WARNING_MESSAGES: Record<string, string> = {
  EncounterOcrError: '事件识别失败，可能错过事件选项',
  StageInfoError: '关卡信息识别失败',
  RoguelikeCoppersRecognitionError: '通宝识别失败',
  BlackFlowScrapTradeAborted: '黑流交易已中止',
  RoguelikeInvestmentReachLimit: '已达本次投资上限',
  RoguelikeInvestmentReachFull: '投资存款已满'
};

const MILESTONE_MESSAGES: Record<string, string> = {
  DeepExplorationCompleted: '深入调查已完成',
  MonthlySquadCompleted: '月度小队已完成'
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function isRoguelikeCommand(command: unknown): command is RoguelikeCommand {
  return command === 'roguelike' || command === 'reclamation';
}

export function getRoguelikeTaskchain(command: RoguelikeCommand): string {
  return TASKCHAIN_BY_COMMAND[command];
}

export function readRoguelikeTheme(args: readonly string[] = []): string {
  const theme = args[0];
  return typeof theme === 'string' ? theme.trim() : '';
}

function readStrategy(event: MaaCallbackEvent): RoguelikeStrategySummary {
  const details = getCallbackDetails(event) ?? {};
  return {
    profile: readText(details.profile),
    outcome: readText(details.outcome),
    succeeded: typeof details.succeeded === 'boolean' ? details.succeeded : null
  };
}

function readTaskChainError(event: MaaCallbackEvent): string | null {
  const details = getCallbackDetails(event);
  return details ? readText(details.error) : null;
}

function formatSettlementMessage(settlement: RoguelikeSettlementSummary): string {
  const parts: string[] = [];
  if (settlement.floor !== null) parts.push(`第 ${settlement.floor} 层`);
  if (settlement.step !== null) parts.push(`${settlement.step} 步`);
  if (settlement.combat !== null) parts.push(`作战 ${settlement.combat}`);
  if (settlement.recruit !== null) parts.push(`招募 ${settlement.recruit}`);
  if (settlement.collection !== null) parts.push(`收藏品 ${settlement.collection}`);
  if (settlement.boss !== null) parts.push(`Boss ${settlement.boss}`);
  if (settlement.emergency !== null) parts.push(`紧急 ${settlement.emergency}`);
  if (settlement.score !== null) parts.push(`得分 ${settlement.score}`);
  if (settlement.gamePass === false) parts.push('未通关');
  return parts.length > 0 ? `肉鸽结算：${parts.join(' · ')}` : '肉鸽结算完成';
}

function formatStatusMessage(
  command: RoguelikeCommand,
  status: RoguelikeRunStatus,
  settlement: RoguelikeSettlementSummary | null,
  taskChainError: string | null,
  progressObserved: boolean
): string {
  const label = COMMAND_LABELS[command];
  if (status === 'failed') {
    return taskChainError ? `${label}执行失败：${taskChainError}` : `${label}执行失败`;
  }
  if (status === 'stopped') return `${label}任务已停止`;
  if (status === 'incomplete') {
    if (settlement) return `${formatSettlementMessage(settlement)} · 未观察到任务链终态`;
    return progressObserved
      ? '已观察到执行进度，但未读取到任务链终态'
      : '未读取到任务回调，无法确认执行结果';
  }
  if (settlement) return formatSettlementMessage(settlement);
  return `${label}执行完成`;
}

/**
 * 从一次执行的增量 MaaCore 日志构建结果摘要。
 *
 * 只读取目标 taskchain 的结构化回调；任务链终态以最后一条 TaskChain 消息为准，
 * 没有观察到任务链终态时状态为 `incomplete`，不能把“没有错误”当成成功。
 */
export function buildRoguelikeResultSummary(
  logOutput: string | null | undefined,
  capture: RoguelikeResultCapture,
  progress: RoguelikeProgressSnapshot | null = null
): RoguelikeResultSummary {
  const command: RoguelikeCommand = capture.command === 'reclamation' ? 'reclamation' : 'roguelike';
  const taskchain = TASKCHAIN_BY_COMMAND[command];
  const events = parseMaaCallbackEvents(logOutput, taskchain);

  let settlement: RoguelikeSettlementSummary | null = null;
  let investment: RoguelikeInvestmentSummary | null = null;
  let strategy: RoguelikeStrategySummary | null = null;
  let taskChainError: string | null = null;
  let combats = 0;
  let observed = false;
  let lastTaskChainEvent: 'start' | 'completed' | 'failed' | 'stopped' | null = null;
  const roguelikeEvents: RoguelikeEventSummary[] = [];
  const coppers: RoguelikeCopperExchangeSummary[] = [];
  const milestones: string[] = [];
  const warnings: string[] = [];

  for (const event of events) {
    if (event.callback === 'TaskChainStart') {
      lastTaskChainEvent = 'start';
      observed = true;
      continue;
    }
    if (event.callback === 'TaskChainCompleted') {
      lastTaskChainEvent = 'completed';
      observed = true;
      continue;
    }
    if (event.callback === 'TaskChainError') {
      lastTaskChainEvent = 'failed';
      taskChainError = readTaskChainError(event) ?? taskChainError;
      observed = true;
      continue;
    }
    if (event.callback === 'TaskChainStopped') {
      lastTaskChainEvent = 'stopped';
      observed = true;
      continue;
    }
    if (event.callback !== 'SubTaskExtraInfo') continue;

    const what = typeof event.what === 'string' ? event.what : '';
    if (what === 'RoguelikeSettlement') {
      settlement = readRoguelikeSettlement(event) ?? settlement;
      observed = true;
      continue;
    }
    if (what === 'RoguelikeInvestment') {
      investment = readRoguelikeInvestment(event, investment);
      observed = true;
      continue;
    }
    if (what === 'RoguelikeInvestmentReachLimit' && investment) {
      investment = { ...investment, reachedLimit: true };
      warnings.push(WARNING_MESSAGES[what]!);
      continue;
    }
    if (what === 'RoguelikeInvestmentReachFull' && investment) {
      investment = { ...investment, reachedFull: true };
      warnings.push(WARNING_MESSAGES[what]!);
      continue;
    }
    if (what === 'RoguelikeEvent') {
      const parsed = readRoguelikeEvent(event);
      if (parsed) {
        const existing = roguelikeEvents.find(item => item.name === parsed.name);
        if (existing) {
          if (existing.option === null && parsed.option !== null) existing.option = parsed.option;
        } else {
          roguelikeEvents.push({ name: parsed.name, option: parsed.option });
        }
        observed = true;
      }
      continue;
    }
    if (what === 'RoguelikeEventSelected') {
      const parsed = readRoguelikeEvent(event);
      if (!parsed) continue;
      const existing = roguelikeEvents.find(item => item.name === parsed.name);
      if (existing) {
        if (parsed.option !== null) existing.option = parsed.option;
      } else roguelikeEvents.push({ name: parsed.name, option: parsed.option });
      observed = true;
      continue;
    }
    if (what === 'RoguelikeCombatEnd') {
      combats += 1;
      observed = true;
      continue;
    }
    if (what === 'RoguelikeCoppersExchangeInfo') {
      const details = getCallbackDetails(event) ?? {};
      const toDiscard = readText(details.to_discard);
      const toPickup = readText(details.to_pickup);
      if (toDiscard && toPickup) {
        coppers.push({ toDiscard, toPickup });
        observed = true;
      }
      continue;
    }
    if (what === 'BlackFlowStrategyStarted') {
      strategy = readStrategy(event);
      observed = true;
      continue;
    }
    if (what === 'BlackFlowStrategyResult') {
      strategy = readStrategy(event);
      observed = true;
      continue;
    }
    const milestone = MILESTONE_MESSAGES[what];
    if (milestone) {
      milestones.push(milestone);
      observed = true;
      continue;
    }
    const warning = WARNING_MESSAGES[what];
    if (warning && !warnings.includes(warning)) warnings.push(warning);
  }

  observed = observed || Boolean(progress?.observed);

  let status: RoguelikeRunStatus = 'incomplete';
  if (lastTaskChainEvent === 'completed') status = 'success';
  else if (lastTaskChainEvent === 'failed') status = 'failed';
  else if (lastTaskChainEvent === 'stopped') status = 'stopped';

  const taskChain = {
    started: events.some(event => event.callback === 'TaskChainStart'),
    completed: events.some(event => event.callback === 'TaskChainCompleted'),
    failed: events.some(event => event.callback === 'TaskChainError'),
    stopped: events.some(event => event.callback === 'TaskChainStopped')
  };

  if (!observed) {
    status = 'incomplete';
  }

  return {
    command,
    theme: readRoguelikeTheme(capture.args),
    status,
    observed,
    message: formatStatusMessage(
      command,
      status,
      settlement,
      taskChainError,
      progress?.observed === true
    ),
    settlement,
    investment,
    events: roguelikeEvents,
    coppers,
    milestones,
    warnings,
    strategy,
    combats,
    progress,
    taskChain
  };
}

function attachSummary(value: unknown, summary: RoguelikeResultSummary | null): unknown {
  if (!summary?.observed) return value;
  if (isRecord(value)) return { ...value, summary };
  return { summary };
}

/** 把摘要挂到命令结果；未观察到任何回调时不写入空摘要。 */
export function attachRoguelikeResultSummary(
  result: unknown,
  summary: RoguelikeResultSummary | null
): unknown {
  return attachSummary(result, summary);
}

/** 把摘要挂到执行错误详情；错误对象保持原样，仅补 details.summary。 */
export function attachRoguelikeErrorSummary(
  error: unknown,
  summary: RoguelikeResultSummary | null
): unknown {
  if (!summary?.observed) return error;
  if (!isRecord(error)) return error;

  const details = isRecord(error.details) ? error.details : {};
  return Object.assign(error, { details: { ...details, summary } });
}
