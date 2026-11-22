import { useCallback, useSyncExternalStore } from 'react'
import {
  trainingSettingsOwner,
  type TrainingSettingsOwner,
  type TrainingSettingsOwnerState,
  type TrainingSettingsPatch,
  type TrainingSettingsWriteOutcome,
} from '../model/settingsCommands'
import type { TrainingSettings } from '../types'

export interface TrainingSettingsController extends TrainingSettingsOwnerState {
  readonly update: (patch: TrainingSettingsPatch) => Promise<TrainingSettingsWriteOutcome>
  readonly hydrate: (settings?: TrainingSettings | null) => boolean
  readonly adopt: (settings?: TrainingSettings | null) => boolean
  readonly readState: () => TrainingSettingsOwnerState
}

export function useTrainingSettings(
  owner: TrainingSettingsOwner = trainingSettingsOwner,
): TrainingSettingsController {
  const state = useSyncExternalStore(owner.subscribe, owner.getState, owner.getState)

  const update = useCallback(
    (patch: TrainingSettingsPatch) => owner.update(patch),
    [owner],
  )
  const hydrate = useCallback(
    (settings?: TrainingSettings | null) => owner.hydrate(settings),
    [owner],
  )
  const adopt = useCallback(
    (settings?: TrainingSettings | null) => owner.adopt(settings),
    [owner],
  )
  const readState = useCallback(() => owner.getState(), [owner])

  return {
    settings: state.settings,
    persisted: state.persisted,
    revision: state.revision,
    syncState: state.syncState,
    error: state.error,
    update,
    hydrate,
    adopt,
    readState,
  }
}
