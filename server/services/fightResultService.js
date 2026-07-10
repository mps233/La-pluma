function getErrorText(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return [error.message, error.stdout, error.stderr].filter(Boolean).join('\n');
}

export function isFightSanityDepleted(output, stage = '') {
  const text = String(output || '');
  if (!text) return false;

  const lowerOutput = text.toLowerCase();
  const lowerStage = String(stage || '').toLowerCase();
  const sanityPatterns = [
    'sanity is not enough',
    '理智不足',
    '理智已耗尽',
    'not enough sanity',
    'insufficient sanity',
    'no sanity',
    'sanity depleted'
  ];

  if (sanityPatterns.some(pattern => lowerOutput.includes(pattern))) return true;
  if (/fight\s+(?:[a-z0-9-]+\s+)?0\s+times?/i.test(text)) return true;

  if (text.includes('Summary') && text.includes('[Fight]') && text.includes('Completed')) {
    const hasFightRecord = /Fight\s+[A-Z0-9-]+\s+[1-9]\d*\s+times?/i.test(text);
    const isAnnihilation = lowerStage.includes('annihilation') || lowerStage.includes('剿灭');
    if (!hasFightRecord && !isAnnihilation) return true;
  }

  return false;
}

export function createFightExecutionAction(taskName, requestedStage, options = {}) {
  const summary = options.summary || null;
  const stage = String(summary?.stage || requestedStage || '').trim();
  const times = Math.max(0, Number(summary?.times) || 0);
  const dropCount = Array.isArray(summary?.dropItems) ? summary.dropItems.length : 0;
  const output = String(options.output || '');
  const errorText = getErrorText(options.error);
  const combinedOutput = [output, errorText].filter(Boolean).join('\n');
  const sanityDepleted = isFightSanityDepleted(combinedOutput, stage);
  const baseAction = {
    task: taskName,
    action: 'fight',
    stage,
    times,
    dropCount,
    drops: summary?.drops || '',
    medicine: Math.max(0, Number(summary?.medicine) || 0),
    stone: Math.max(0, Number(summary?.stone) || 0),
    duration: summary?.duration || '',
    sanityDepleted
  };

  if (options.skipReason) {
    return {
      ...baseAction,
      status: 'skipped',
      message: `${stage || '当前关卡'}已跳过：${options.skipReason}`
    };
  }

  if (errorText) {
    if (sanityDepleted) {
      return {
        ...baseAction,
        status: 'skipped',
        message: `${stage || '当前关卡'}未继续作战：理智已耗尽`
      };
    }

    if (/stage not open|关卡未开放/i.test(errorText)) {
      return {
        ...baseAction,
        status: 'skipped',
        message: `${stage || '当前关卡'}已跳过：关卡未开放或不存在`
      };
    }

    if (/annihilation|剿灭/i.test(stage)) {
      return {
        ...baseAction,
        status: 'skipped',
        message: `${stage || '剿灭关卡'}已跳过：奖励可能已领完或未找到入口`
      };
    }

    return {
      ...baseAction,
      status: 'failed',
      message: `${stage || '当前关卡'}作战失败：${errorText.split('\n')[0]}`
    };
  }

  if (times === 0 && sanityDepleted) {
    return {
      ...baseAction,
      status: 'skipped',
      message: `${stage || '当前关卡'}未开始作战：理智已耗尽`
    };
  }

  if (times === 0 && /annihilation|剿灭/i.test(stage)) {
    return {
      ...baseAction,
      status: 'skipped',
      message: `${stage || '剿灭关卡'}未执行作战，奖励可能已领完`
    };
  }

  const details = [];
  if (times > 0) details.push(`${stage || '当前关卡'} × ${times}`);
  else if (stage) details.push(stage);
  if (dropCount > 0) details.push(`获得 ${dropCount} 种掉落`);
  if (sanityDepleted) details.push('理智已耗尽');

  return {
    ...baseAction,
    status: 'success',
    message: details.length > 0 ? `作战完成：${details.join('；')}` : '理智作战已完成'
  };
}
