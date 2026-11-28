import { isActiveRunState, type AgentRun } from '../types/run'

/** How a page recognizes the runs it owns in the global projection. */
export interface RunOwnership {
  /** Operation ids that only this page starts, for example `depot_recognition`. */
  operationIds?: readonly string[]
  /** Server `metadata.taskType` values this page owns. */
  taskTypes?: readonly string[]
  /**
   * Treat a waiting run as idle. Manual copilot sets wait for the user between
   * items, so the page must offer the continue action instead of showing a
   * running task.
   */
  waitingIsIdle?: boolean
}

/**
 * Returns the active run owned by a page, or null. Operation id and task type
 * are alternatives: either match is enough, so pages can list the specific
 * operations they start plus the shared `run_task` task types.
 */
export const selectOwnedRun = (
  run: AgentRun | null | undefined,
  ownership: RunOwnership,
): AgentRun | null => {
  if (!run || !isActiveRunState(run.state)) return null
  if (ownership.waitingIsIdle && run.state === 'waiting') return null

  if (ownership.operationIds?.includes(run.operationId)) return run
  const taskType = run.metadata?.taskType
  if (typeof taskType === 'string' && ownership.taskTypes?.includes(taskType)) return run
  return null
}
