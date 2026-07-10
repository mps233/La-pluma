function parseCallbackEvents(logOutput) {
  const marker = 'Assistant::append_callback | ';
  const events = [];

  for (const line of String(logOutput || '').split('\n')) {
    if (!line.includes('"taskchain":"Mall"')) continue;
    const markerIndex = line.indexOf(marker);
    if (markerIndex === -1) continue;

    const callback = line.slice(markerIndex + marker.length);
    const jsonIndex = callback.indexOf('{');
    if (jsonIndex === -1) continue;

    try {
      events.push({
        callback: callback.slice(0, jsonIndex).trim(),
        ...JSON.parse(callback.slice(jsonIndex))
      });
    } catch {
      // Ignore an incomplete first line from an incremental log segment.
    }
  }

  return events;
}

function isMallDisabled(params) {
  return params.visit_friends === false
    && params.shopping === false
    && params.credit_fight === false;
}

export function parseMallExecutionAction(taskName, params = {}, logOutput = '') {
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

  const events = parseCallbackEvents(logOutput);
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
  const taskNames = startEvents.map(event => event.details?.task).filter(Boolean);
  const visitedCount = taskNames.filter(task => task === 'VisitNext' || task === 'VisitNextOcr').length;
  const creditCollected = taskNames.includes('CollectCredit');
  const purchasedCount = startEvents.filter(event => (
    event.details?.task === 'CreditShop-Bought'
      && (event.details.exec_times === undefined || Number(event.details.exec_times) === 1)
  )).length;
  const noMoney = taskNames.includes('CreditShop-NoMoney');
  const visitLimited = taskNames.includes('VisitLimited');
  const noFriends = taskNames.includes('NoFriends');
  const failed = events.some(event => event.callback === 'TaskChainError');
  const entered = taskNames.some(task => [
    'FriendsList',
    'StartToVisit',
    'Mall',
    'CreditStoreOcr',
    'CollectCredit',
    'CreditShop-BuyIt',
    'CreditShop-Bought'
  ].includes(task));
  const baseAction = {
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

  const details = [];
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
