interface ExecutionSummaryLike {
  successCount?: unknown
  failedCount?: unknown
  skippedCount?: unknown
  durationMs?: unknown
  actions?: unknown
  summaries?: unknown
  errors?: unknown
}

interface ExecutionActionLike {
  action?: unknown
  status?: unknown
  startedCount?: unknown
  collectedCount?: unknown
  expeditedCount?: unknown
  refreshCount?: unknown
  highestLevel?: unknown
  preservedTags?: unknown
  configuredFacilities?: unknown
  rewardCollected?: unknown
  rotationApplied?: unknown
  droneUsed?: unknown
  cluesReceived?: unknown
  cluesSent?: unknown
  clueExchange?: unknown
  trainingContinued?: unknown
  trainingCompleted?: unknown
  trainingProcessing?: unknown
  visitedCount?: unknown
  creditCollected?: unknown
  purchasedCount?: unknown
  noMoney?: unknown
  visitLimited?: unknown
  noFriends?: unknown
  stage?: unknown
  times?: unknown
  dropCount?: unknown
  sanityDepleted?: unknown
}

const toFiniteNumber = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const getLastTaskFromEntries = (entries: unknown) => {
  if (!Array.isArray(entries)) return undefined

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry && typeof entry === 'object' && 'task' in entry && typeof entry.task === 'string') {
      return entry.task
    }
  }
  return undefined
}

export function formatExecutionSummary(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined
  if (!value || typeof value !== 'object') return undefined

  const summary = value as ExecutionSummaryLike
  const successCount = toFiniteNumber(summary.successCount)
  const failedCount = toFiniteNumber(summary.failedCount)
  const skippedCount = toFiniteNumber(summary.skippedCount)
  const durationMs = toFiniteNumber(summary.durationMs)
  const parts: string[] = []

  if (successCount !== null) parts.push(`成功 ${successCount}`)
  if (failedCount !== null && failedCount > 0) parts.push(`失败 ${failedCount}`)
  if (skippedCount !== null && skippedCount > 0) parts.push(`跳过 ${skippedCount}`)
  if (durationMs !== null) parts.push(`${Math.max(1, Math.round(durationMs / 1000))} 秒`)

  return parts.length > 0 ? parts.join(' · ') : undefined
}

export function getExecutionLastTask(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const summary = value as ExecutionSummaryLike

  return getLastTaskFromEntries(summary.actions)
    || getLastTaskFromEntries(summary.summaries)
    || getLastTaskFromEntries(summary.errors)
}

export function formatExecutionActionSummary(actions: unknown): string | undefined {
  if (!Array.isArray(actions) || actions.length === 0) return undefined

  const normalizedActions = actions.filter(
    (action): action is ExecutionActionLike => Boolean(action && typeof action === 'object')
  )
  if (normalizedActions.length === 0) return undefined

  const isAwardResult = normalizedActions.every(action => action.action === 'award')
  const isRecruitResult = normalizedActions.every(action => action.action === 'recruit')
  const isInfrastResult = normalizedActions.every(action => action.action === 'infrast')
  const isMallResult = normalizedActions.every(action => action.action === 'mall')
  const isFightResult = normalizedActions.every(action => action.action === 'fight')
  const successCount = normalizedActions.filter(action => action.status === 'success').length
  const skippedCount = normalizedActions.filter(action => action.status === 'skipped').length
  const failedCount = normalizedActions.filter(action => action.status === 'failed').length
  if (isRecruitResult) {
    const startedCount = normalizedActions.reduce((sum, action) => sum + (toFiniteNumber(action.startedCount) || 0), 0)
    const collectedCount = normalizedActions.reduce((sum, action) => sum + (toFiniteNumber(action.collectedCount) || 0), 0)
    const expeditedCount = normalizedActions.reduce((sum, action) => sum + (toFiniteNumber(action.expeditedCount) || 0), 0)
    const refreshCount = normalizedActions.reduce((sum, action) => sum + (toFiniteNumber(action.refreshCount) || 0), 0)
    const highestLevel = normalizedActions.reduce(
      (highest, action) => Math.max(highest, toFiniteNumber(action.highestLevel) || 0),
      0
    )
    const preservedCount = normalizedActions.filter(
      action => Array.isArray(action.preservedTags) && action.preservedTags.length > 0
    ).length
    const parts = ['公招完成']

    if (startedCount > 0) parts.push(`招募 ${startedCount} 次`)
    if (collectedCount > 0) parts.push(`收取 ${collectedCount} 次`)
    if (expeditedCount > 0) parts.push(`加急 ${expeditedCount} 次`)
    if (refreshCount > 0) parts.push(`刷新 ${refreshCount} 次`)
    if (highestLevel > 0) parts.push(`最高 ${highestLevel} 星`)
    if (preservedCount > 0) parts.push(`保留 ${preservedCount} 个槽位`)
    if (failedCount > 0) parts.push(`失败 ${failedCount} 项`)
    if (parts.length === 1 && skippedCount > 0) parts.push('已跳过')
    return parts.join(' · ')
  }

  if (isInfrastResult) {
    const action = normalizedActions[0]!
    if (skippedCount > 0 && Array.isArray(action.configuredFacilities) && action.configuredFacilities.length === 0) {
      return '基建任务 · 已跳过'
    }
    const parts = [failedCount > 0 ? '基建失败' : '基建完成']

    if (action.rewardCollected === true) parts.push('收取产物')
    if (action.rotationApplied === true) parts.push('完成换班')
    if (action.droneUsed === true) parts.push('使用无人机')
    const cluesReceived = toFiniteNumber(action.cluesReceived) || 0
    const cluesSent = toFiniteNumber(action.cluesSent) || 0
    if (cluesReceived > 0) parts.push(`收线索 ${cluesReceived} 次`)
    if (cluesSent > 0) parts.push(`送线索 ${cluesSent} 次`)
    if (action.clueExchange === true) parts.push('线索交流')
    if (action.trainingContinued === true) parts.push('继续专精')
    else if (action.trainingCompleted === true) parts.push('专精完成')
    else if (action.trainingProcessing === true) parts.push('专精进行中')
    if (parts.length === 1 && Array.isArray(action.configuredFacilities)) {
      parts.push(`${action.configuredFacilities.length} 类设施`)
    }
    if (parts.length === 1 && skippedCount > 0) parts.push('已跳过')
    return parts.join(' · ')
  }

  if (isMallResult) {
    const action = normalizedActions[0]!
    if (skippedCount > 0) return '信用收支 · 已跳过'

    const parts = [failedCount > 0 ? '信用收支失败' : '信用收支完成']
    const visitedCount = toFiniteNumber(action.visitedCount) || 0
    const purchasedCount = toFiniteNumber(action.purchasedCount) || 0
    if (visitedCount > 0) parts.push(`访问 ${visitedCount} 位好友`)
    if (action.creditCollected === true) parts.push('领取信用')
    if (purchasedCount > 0) parts.push(`购买 ${purchasedCount} 件`)
    if (action.noMoney === true) parts.push('信用不足')
    if (action.visitLimited === true) parts.push('访问已达上限')
    if (action.noFriends === true) parts.push('暂无好友')
    return parts.join(' · ')
  }

  if (isFightResult) {
    const completedTimes = normalizedActions.reduce(
      (sum, action) => sum + (toFiniteNumber(action.times) || 0),
      0
    )
    const dropCount = normalizedActions.reduce(
      (sum, action) => sum + (toFiniteNumber(action.dropCount) || 0),
      0
    )
    const stages = [...new Set(normalizedActions
      .map(action => typeof action.stage === 'string' ? action.stage.trim() : '')
      .filter(Boolean))]
    const sanityDepleted = normalizedActions.some(action => action.sanityDepleted === true)
    const title = failedCount > 0
      ? (successCount > 0 ? '作战部分完成' : '作战失败')
      : successCount > 0
        ? '作战完成'
        : '作战任务'
    const parts = [title]

    if (stages.length === 1 && completedTimes > 0) parts.push(`${stages[0]} ${completedTimes} 次`)
    else if (stages.length > 1) {
      parts.push(`${stages.length} 个关卡`)
      if (completedTimes > 0) parts.push(`共 ${completedTimes} 次`)
    }
    if (dropCount > 0) parts.push(`掉落 ${dropCount} 种`)
    if (skippedCount > 0) parts.push(`跳过 ${skippedCount} 个`)
    if (failedCount > 0) parts.push(`失败 ${failedCount} 个`)
    if (sanityDepleted) parts.push('理智耗尽')
    return parts.join(' · ')
  }

  const parts = [isAwardResult ? '奖励检查完成' : '流程执行完成']

  if (successCount > 0) parts.push(`${isAwardResult ? '领取' : '成功'} ${successCount} 项`)
  if (skippedCount > 0) parts.push(`跳过 ${skippedCount} 项`)
  if (failedCount > 0) parts.push(`失败 ${failedCount} 项`)

  return parts.join(' · ')
}
