import { useRunStore } from '@/state'

import { selectOwnedRun, type RunOwnership } from '../utils/runOwnership'

/**
 * True while the global run projection shows an active run this page owns.
 * Pages combine it with their own submit-in-flight flag so a task started in
 * another tab or before a refresh still renders as running.
 */
export function useOwnedRunActive(ownership: RunOwnership): boolean {
  const run = useRunStore(state => state.run)
  return selectOwnedRun(run, ownership) !== null
}
