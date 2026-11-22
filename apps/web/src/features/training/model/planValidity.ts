// `queueRevision` 覆盖服务端队列成员与精英目标（含命令与外部变化）；
// `settingsRevision` 在设置值每次变化时递增。版本不同或队列刷新失败时，
// 页面不得生成新计划，也不得应用旧计划。

export interface TrainingPlanBasisContext {
  readonly gameDate?: string | null
  readonly clientType?: string | null
}

export interface TrainingPlanBasis {
  readonly queueRevision: string | null
  readonly settingsRevision: number
  readonly gameDate: string | null
  readonly clientType: string | null
}

export interface TrainingPlanCurrentBasis extends TrainingPlanBasisContext {
  readonly queueRevision: string | null
  readonly settingsRevision: number
}

const readContextValue = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

export const captureTrainingPlanBasis = (
  queueRevision: string | null | undefined,
  settingsRevision: number,
  context: TrainingPlanBasisContext | null = null,
): TrainingPlanBasis => ({
  queueRevision: queueRevision ?? null,
  settingsRevision,
  gameDate: readContextValue(context?.gameDate),
  clientType: readContextValue(context?.clientType),
})

const isContextCurrent = (
  basisValue: string | null,
  currentValue: string | null | undefined,
): boolean => {
  const frozen = readContextValue(basisValue)
  const current = readContextValue(currentValue)
  return frozen === null || current === null || frozen === current
}

export const isTrainingPlanBasisCurrent = (
  basis: TrainingPlanBasis,
  current: TrainingPlanCurrentBasis,
): boolean => (
  basis.queueRevision === current.queueRevision
  && basis.settingsRevision === current.settingsRevision
  && isContextCurrent(basis.gameDate, current.gameDate)
  && isContextCurrent(basis.clientType, current.clientType)
)

export interface GenerateTrainingPlanAvailability {
  readonly hasQueue: boolean
  readonly busy: boolean
  readonly refreshFailed: boolean
}

/** 刷新失败（本地仍有旧快照）时不能生成依赖旧队列的计划。 */
export const canGenerateTrainingPlan = ({
  hasQueue,
  busy,
  refreshFailed,
}: GenerateTrainingPlanAvailability): boolean => hasQueue && !busy && !refreshFailed

export interface ApplyTrainingPlanAvailability {
  readonly hasPlan: boolean
  readonly busy: boolean
  readonly refreshFailed: boolean
  readonly basisCurrent: boolean
}

/** 版本前提变化或刷新失败时旧计划不可应用。 */
export const canApplyTrainingPlan = ({
  hasPlan,
  busy,
  refreshFailed,
  basisCurrent,
}: ApplyTrainingPlanAvailability): boolean => (
  hasPlan && !busy && !refreshFailed && basisCurrent
)
