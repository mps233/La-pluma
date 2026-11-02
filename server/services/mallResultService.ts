import { isRecord } from '../utils/errors.ts';
import { parseMaaCallbackEvents } from './maaCallbackService.ts';

interface MallExecutionParams {
  visit_friends?: unknown;
  shopping?: unknown;
  credit_fight?: unknown;
}

interface MallCallbackEvent {
  callback?: string;
  what?: string;
  details?: Record<string, unknown>;
}

interface MallExecutionActionBase {
  task: string;
  action: 'mall';
  visitedCount: number;
  creditCollected: boolean;
  purchasedCount: number;
  noMoney: boolean;
  visitLimited: boolean;
  noFriends: boolean;
}

interface MallExecutionAction extends MallExecutionActionBase {
  status: 'success' | 'failed' | 'skipped';
  message: string;
}

function isMallDisabled(params: unknown): boolean {
  const record: MallExecutionParams = isRecord(params) ? params : {};
  return record.visit_friends === false
    && record.shopping === false
    && record.credit_fight === false;
}

export function parseMallExecutionAction(
  taskName: string,
  params: unknown = {},
  logOutput: unknown = ''
): MallExecutionAction {
  if (isMallDisabled(params)) {
    return {
      task: taskName,
      action: 'mall',
      status: 'skipped',
      visitedCount: 0,
      creditCollected: false,
      purchasedCount: 0,
      noMoney: false,
      visitLimited: false,
      noFriends: false,
      message: '未启用好友访问、信用购物或信用作战，已跳过'
    };
  }

  const events = parseMaaCallbackEvents(logOutput, 'Mall') as MallCallbackEvent[];
  if (events.length === 0) {
    return {
      task: taskName,
      action: 'mall',
      status: 'success',
      visitedCount: 0,
      creditCollected: false,
      purchasedCount: 0,
      noMoney: false,
      visitLimited: false,
      noFriends: false,
      message: '信用收支流程已完成'
    };
  }

  const startEvents = events.filter(event => event.callback === 'SubTaskStart');
  const taskNames = startEvents
    .map(event => event.details?.task)
    .filter((task): task is string => typeof task === 'string' && task.length > 0);
  const eventTaskNames = events.flatMap(event => [
    event.details?.task,
    ...(Array.isArray(event.details?.to_be_recognized) ? event.details.to_be_recognized : [])
  ]).filter(Boolean);
  const visitedNext = taskNames.filter(task => task === 'VisitNext').length;
  const visitedOcr = taskNames.filter(task => task === 'VisitNextOcr').length;
  // A single friend visit may emit both VisitNext and VisitNextOcr; do not sum
  // them or the report doubles the number of visited friends.
  const visitedCount = Math.max(visitedNext, visitedOcr);
  const creditCollected = eventTaskNames.includes('CollectCredit');
  const boughtEvents = startEvents.filter(event => (
    event.details?.task === 'CreditShop-Bought'
      && (event.details.exec_times === undefined || Number(event.details.exec_times) === 1)
  )).length;
  const buyItEvents = startEvents.filter(event => (
    event.details?.task === 'CreditShop-BuyIt' && event.details?.action === 'ClickSelf'
  )).length;
  const purchasedCount = buyItEvents > 0 ? buyItEvents : boughtEvents;
  const noMoney = eventTaskNames.includes('CreditShop-NoMoney');
  const visitLimited = eventTaskNames.includes('VisitLimited');
  const noFriends = eventTaskNames.includes('NoFriends');
  const failed = events.some(event => event.callback === 'TaskChainError');
  const entered = eventTaskNames.some(task => [
    'MallBegin',
    'FriendsList',
    'StartToVisit',
    'Mall',
    'CreditStoreOcr',
    'CollectCredit',
    'CreditShop-BuyIt',
    'CreditShop-Bought'
  ].includes(String(task)));
  const baseAction: MallExecutionActionBase = {
    task: taskName,
    action: 'mall',
    visitedCount,
    creditCollected,
    purchasedCount,
    noMoney,
    visitLimited,
    noFriends
  };

  if (failed) {
    return {
      ...baseAction,
      status: 'failed',
      message: entered ? '信用收支处理过程中失败' : '未能进入或识别好友或信用商店界面'
    };
  }

  const details: string[] = [];
  if (visitedCount > 0) details.push(`访问 ${visitedCount} 位好友`);
  if (creditCollected) details.push('已领取信用');
  if (purchasedCount > 0) details.push(`购买 ${purchasedCount} 件商品`);
  if (noMoney) details.push('信用不足');
  if (visitLimited) details.push('好友访问已达上限');
  if (noFriends) details.push('暂无可访问好友');

  return {
    ...baseAction,
    status: 'success',
    message: details.length > 0
      ? `信用收支完成：${details.join('；')}`
      : '信用收支流程已完成'
  };
}
