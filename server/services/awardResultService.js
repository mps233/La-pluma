const AWARD_ITEMS = [
  {
    key: 'award',
    label: '日常与周常奖励',
    beginTask: 'AwardBegin',
    claimedTasks: ['ReceiveAward']
  },
  {
    key: 'mail',
    label: '邮件奖励',
    beginTask: 'MailBegin',
    claimedTasks: ['ReceiveMail']
  },
  {
    key: 'recruit',
    label: '限定寻访奖励',
    beginTask: 'RecruitingActivitiesBegin',
    claimedTasks: ['RecruitingActivitiesConfirm', 'RecruitingActivitiesRecruit']
  },
  {
    key: 'orundum',
    label: '合成玉活动奖励',
    beginTask: 'OrundumActivitiesBegin',
    claimedTasks: ['OrundumActivitiesChoose', 'OrundumActivitiesConfirm']
  },
  {
    key: 'mining',
    label: '采矿活动奖励',
    beginTask: 'MiningActivitiesBegin',
    claimedTasks: ['MiningActivities', 'MiningActivitiesConfirm']
  },
  {
    key: 'specialaccess',
    label: '特别登录奖励',
    beginTask: 'SpecialAccessActivitiesBegin',
    claimedTasks: ['SpecialAccessActivitiesConfirm']
  },
  {
    key: 'signinevent',
    label: '限时签到奖励',
    beginTask: 'SignInEvent',
    claimedTasks: ['SignInEventAllClaimed']
  }
];

function hasTaskEvent(logSegment, taskName) {
  const escapedTaskName = taskName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`"(?:task|what)":"${escapedTaskName}"`).test(logSegment);
}

function getTaskSegment(logOutput, item, nextItem) {
  const startMarker = `"first":["${item.beginTask}"]`;
  let start = logOutput.indexOf(startMarker);
  let startLength = startMarker.length;
  if (start === -1) {
    // Newer interface tasks (for example SignInEvent) do not always appear as
    // the `first` task of the Award chain. Fall back to the task name itself.
    start = logOutput.indexOf(item.beginTask);
    startLength = item.beginTask.length;
  }
  if (start === -1) return null;

  if (!nextItem) return logOutput.slice(start);
  const nextMarker = `"first":["${nextItem.beginTask}"]`;
  let end = logOutput.indexOf(nextMarker, start + startLength);
  if (end === -1) end = logOutput.indexOf(nextItem.beginTask, start + startLength);
  return end === -1 ? logOutput.slice(start) : logOutput.slice(start, end);
}

export function getEnabledAwardItems(params = {}) {
  return AWARD_ITEMS.filter(item => params[item.key] === true);
}

export function parseAwardExecutionActions(taskName, params = {}, logOutput = '') {
  const enabledItems = getEnabledAwardItems(params);
  if (enabledItems.length === 0) {
    return [{
      task: taskName,
      action: 'award',
      status: 'skipped',
      message: '未启用任何领取项目，已跳过'
    }];
  }

  const actions = [];
  let parsedItemCount = 0;

  enabledItems.forEach(item => {
    const itemIndex = AWARD_ITEMS.findIndex(candidate => candidate.key === item.key);
    const segment = getTaskSegment(logOutput, item, AWARD_ITEMS[itemIndex + 1]);
    if (!segment) {
      if (item.key === 'signinevent') {
        actions.push({
          task: taskName,
          action: 'award',
          status: 'skipped',
          message: '未检测到可领取的限时签到活动，已跳过'
        });
      }
      return;
    }
    parsedItemCount++;

    if (item.key === 'signinevent') {
      const allClaimed = hasTaskEvent(segment, 'SignInEventAllClaimed');
      const processed = hasTaskEvent(segment, 'SignInEvent');
      actions.push({
        task: taskName,
        action: 'award',
        status: allClaimed || processed ? 'success' : 'skipped',
        message: allClaimed
          ? '限时签到奖励已领取'
          : processed
            ? '已处理限时签到活动'
            : '未检测到可领取的限时签到奖励，已跳过'
      });
      return;
    }

    const claimed = item.claimedTasks.some(claimedTask => hasTaskEvent(segment, claimedTask));
    actions.push({
      task: taskName,
      action: 'award',
      status: claimed ? 'success' : 'skipped',
      message: claimed
        ? `${item.label}已领取`
        : `${item.label}无可领取内容或当前未开放，已跳过`
    });
  });

  if (parsedItemCount === 0 && actions.length === 0) {
    return [{
      task: taskName,
      action: 'award',
      status: 'success',
      message: `领取奖励流程已完成，共检查 ${enabledItems.length} 项`
    }];
  }

  return actions;
}
