import type { AgentRun, CurrentRunSnapshot } from '@/types/run'

function firstText(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function firstNumber(...values: Array<number | null | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

/**
 * A scheduled flow keeps its task and step in `schedule` (or the legacy `task` snapshot), not in
 * the Run's own progress, so `/runs/current` can report a running Run with an empty progress
 * object. Merge the live executor fields into the Run before the store and island read it.
 *
 * The schedule's `currentStep` is zero-based (the first running task reports 0 and the message
 * reads "1/7"); the Run's own progress is one-based, so only the schedule value is shifted.
 */
export function applyScheduleProgress(
  run: AgentRun | null,
  snapshot: CurrentRunSnapshot | undefined,
): AgentRun | null {
  if (!run || !snapshot) return run

  const progress = run.progress ?? {}
  const schedule = snapshot.schedule
  const legacy = snapshot.task
  const currentTask = firstText(
    progress.currentTask,
    schedule?.currentTask,
    legacy?.currentTask,
    legacy?.taskName,
    snapshot.taskName,
  )
  const currentStage = firstText(progress.currentStage, schedule?.currentStage, legacy?.currentStage)
  const scheduleStep = firstNumber(schedule?.currentStep, legacy?.currentStep)
  const currentStep = progress.currentStep
    ?? (scheduleStep === undefined ? undefined : scheduleStep + 1)
  const totalSteps = firstNumber(progress.totalSteps, schedule?.totalSteps, legacy?.totalSteps)
  const message = firstText(progress.message, schedule?.message)

  if (
    currentTask === progress.currentTask
    && currentStage === progress.currentStage
    && currentStep === progress.currentStep
    && totalSteps === progress.totalSteps
    && message === progress.message
  ) {
    return run
  }

  return {
    ...run,
    progress: {
      ...progress,
      ...(currentTask === undefined ? {} : { currentTask }),
      ...(currentStage === undefined ? {} : { currentStage }),
      ...(currentStep === undefined ? {} : { currentStep }),
      ...(totalSteps === undefined ? {} : { totalSteps }),
      ...(message === undefined ? {} : { message }),
    },
  }
}
