function parseCallbackEvents(logOutput) {
  const marker = 'Assistant::append_callback | ';
  const events = [];

  for (const line of String(logOutput || '').split('\n')) {
    if (!line.includes('"taskchain":"Recruit"')) continue;
    const markerIndex = line.indexOf(marker);
    if (markerIndex === -1) continue;

    const callback = line.slice(markerIndex + marker.length);
    const jsonIndex = callback.indexOf('{');
    if (jsonIndex === -1) continue;

    try {
      const event = JSON.parse(callback.slice(jsonIndex));
      events.push({
        callback: callback.slice(0, jsonIndex).trim(),
        ...event
      });
    } catch {
      // Ignore incomplete lines when the log checkpoint starts mid-event.
    }
  }

  return events;
}

function normalizePreserveTags(value) {
  if (Array.isArray(value)) return value.map(String).map(tag => tag.trim()).filter(Boolean);
  return String(value || '').split(',').map(tag => tag.trim()).filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(value => typeof value === 'string' && value.trim()))];
}

export function parseRecruitExecutionAction(taskName, params = {}, logOutput = '') {
  const events = parseCallbackEvents(logOutput);
  if (events.length === 0) {
    return {
      task: taskName,
      action: 'recruit',
      status: 'success',
      message: '自动公招流程已完成'
    };
  }

  const taskNames = events
    .filter(event => event.callback === 'SubTaskStart')
    .map(event => event.details?.task)
    .filter(Boolean);
  const detectedEvents = events.filter(event => event.what === 'RecruitTagsDetected');
  const resultEvents = events.filter(event => event.what === 'RecruitResult');
  const preservedEvents = events.filter(event => event.what === 'RecruitPreservedTag');
  const refreshCount = events.filter(event => event.what === 'RecruitTagsRefreshed').length;
  const startedCount = taskNames.filter(task => task === 'RecruitConfirm').length;
  const collectedCount = taskNames.filter(task => task === 'RecruitFinish').length;
  const expeditedCount = taskNames.filter(task => task === 'RecruitNowConfirm').length;
  const noPermit = taskNames.includes('RecruitNoPermit');
  const noRefresh = taskNames.includes('RecruitNoRefresh');
  const failed = events.some(event => event.callback === 'TaskChainError');
  const completed = events.some(event => event.callback === 'TaskChainCompleted');
  const detectedTags = uniqueStrings(
    detectedEvents.flatMap(event => Array.isArray(event.details?.tags) ? event.details.tags : [])
  );
  const finalTags = uniqueStrings(
    Array.isArray(detectedEvents.at(-1)?.details?.tags) ? detectedEvents.at(-1).details.tags : []
  );
  const highestLevel = resultEvents.reduce(
    (highest, event) => Math.max(highest, Number(event.details?.level) || 0),
    0
  );
  const configuredPreserveTags = normalizePreserveTags(params.preserve_tags);
  const preservedDetectedTags = uniqueStrings(
    preservedEvents.flatMap(event => Array.isArray(event.details?.tags) ? event.details.tags : [])
  );
  const preservedTags = configuredPreserveTags.filter(tag => preservedDetectedTags.includes(tag));
  const effectivePreservedTags = preservedTags.length > 0 ? preservedTags : preservedDetectedTags;

  const baseAction = {
    task: taskName,
    action: 'recruit',
    startedCount,
    collectedCount,
    expeditedCount,
    refreshCount,
    highestLevel,
    detectedTags,
    finalTags,
    preservedTags: effectivePreservedTags,
    noRefresh
  };

  if (failed) {
    return {
      ...baseAction,
      status: 'failed',
      message: detectedEvents.length > 0
        ? '自动公招在标签处理过程中失败'
        : '自动公招未能进入或识别公招界面'
    };
  }

  if (startedCount > 0 || collectedCount > 0 || expeditedCount > 0) {
    const operations = [];
    if (startedCount > 0) operations.push(`开始 ${startedCount} 次招募`);
    if (collectedCount > 0) operations.push(`收取 ${collectedCount} 次结果`);
    if (expeditedCount > 0) operations.push(`加急 ${expeditedCount} 次`);
    if (refreshCount > 0) operations.push(`刷新 ${refreshCount} 次`);
    if (highestLevel > 0) operations.push(`最高 ${highestLevel} 星组合`);
    if (finalTags.length > 0) operations.push(`最终标签：${finalTags.join('、')}`);

    return {
      ...baseAction,
      status: 'success',
      message: `公招处理完成：${operations.join('；')}`
    };
  }

  if (preservedEvents.length > 0) {
    return {
      ...baseAction,
      status: 'skipped',
      message: `发现保留标签 ${effectivePreservedTags.join('、') || '高价值标签'}，已保留该槽位`
    };
  }

  if (noPermit) {
    return {
      ...baseAction,
      status: 'skipped',
      message: '招聘许可不足，未开始新的公招'
    };
  }

  if (detectedEvents.length > 0) {
    return {
      ...baseAction,
      status: 'skipped',
      message: noRefresh
        ? '标签已识别，但没有可用刷新次数或未匹配自动确认条件'
        : '标签已识别，但未匹配自动确认条件，已保留槽位'
    };
  }

  return {
    ...baseAction,
    status: completed ? 'skipped' : 'success',
    message: completed ? '没有可处理的公招槽位，已跳过' : '自动公招流程已完成'
  };
}
