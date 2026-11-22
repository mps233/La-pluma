import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { trainingKeys } from '../model/queryKeys'
import {
  trainingQueueCommandOwner,
  type TrainingQueueCommand,
  type TrainingQueueCommandContext,
  type TrainingQueueCommandOutcome,
  type TrainingQueueCommandOwner,
  type TrainingQueueCommandState,
  type TrainingQueuePendingCommand,
} from '../model/queueCommands'
import type { TrainingQueueSnapshot } from '../types'

export interface TrainingQueuePendingGroups {
  readonly pendingAdds: ReadonlySet<string>
  readonly pendingRemoves: ReadonlySet<string>
  readonly pendingUndoOperatorIds: ReadonlySet<string>
}

export function selectTrainingQueuePendingGroups(
  pending: readonly TrainingQueuePendingCommand[],
): TrainingQueuePendingGroups {
  const pendingAdds = new Set<string>()
  const pendingRemoves = new Set<string>()
  const pendingUndoOperatorIds = new Set<string>()
  for (const entry of pending) {
    switch (entry.type) {
      case 'add': pendingAdds.add(entry.operatorId); break
      case 'remove': pendingRemoves.add(entry.operatorId); break
      case 'undo': pendingUndoOperatorIds.add(entry.operatorId); break
      case 'reorder': break
    }
  }
  return { pendingAdds, pendingRemoves, pendingUndoOperatorIds }
}

export function useTrainingQueueCommandState(
  owner: TrainingQueueCommandOwner = trainingQueueCommandOwner,
): TrainingQueueCommandState {
  return useSyncExternalStore(owner.subscribe, owner.getState, owner.getState)
}

export interface TrainingQueueCommands extends TrainingQueuePendingGroups {
  readonly pending: TrainingQueueCommandState['pending']
  readonly pendingOperatorIds: ReadonlySet<string>
  readonly queueMutationPending: boolean
  readonly run: (command: TrainingQueueCommand) => Promise<TrainingQueueCommandOutcome>
}

export function useTrainingQueueCommands(
  owner: TrainingQueueCommandOwner = trainingQueueCommandOwner,
): TrainingQueueCommands {
  const queryClient = useQueryClient()
  const state = useTrainingQueueCommandState(owner)

  const context = useMemo<TrainingQueueCommandContext>(() => ({
    getSnapshot: () => queryClient.getQueryData<TrainingQueueSnapshot>(
      trainingKeys.resource('queue'),
    ),
    commitSnapshot: snapshot => {
      queryClient.setQueryData(trainingKeys.resource('queue'), snapshot)
    },
    cancelReads: () => queryClient.cancelQueries({
      queryKey: trainingKeys.resource('queue'),
      exact: true,
    }),
  }), [queryClient])

  const pendingOperatorIds = useMemo(
    () => new Set(state.pending.map(entry => entry.operatorId)),
    [state.pending],
  )

  const pendingGroups = useMemo(
    () => selectTrainingQueuePendingGroups(state.pending),
    [state.pending],
  )

  const run = useCallback(
    (command: TrainingQueueCommand) => owner.run(command, context),
    [context, owner],
  )

  return {
    pending: state.pending,
    pendingOperatorIds,
    ...pendingGroups,
    queueMutationPending: state.pending.length > 0,
    run,
  }
}
