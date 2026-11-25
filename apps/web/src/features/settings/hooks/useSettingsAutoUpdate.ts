import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  dismissNotice,
  SETTINGS_AUTO_UPDATE_NOTICE_ID,
  type Notify,
} from '@/shared/notifications'
import {
  INVALID_UPDATE_TIME_MESSAGE,
  settingsAutoUpdateOwner,
  type AutoUpdateConfigOwner,
  type AutoUpdateConfigState,
  type AutoUpdateSaveOutcome,
} from '../model/autoUpdateConfig'
import { isValidUpdateTime } from '../model/configNormalization'
import type { AutoUpdateConfig } from '../types'
import { useAutoSave, type AutoSaveState } from './useAutoSave'

interface AutoUpdateAutoSaveState extends AutoSaveState {
  readonly draft: AutoUpdateConfig
}

export interface UseSettingsAutoUpdateResult extends AutoUpdateConfigState {
  readonly loaded: boolean
  readonly update: (patch: Partial<AutoUpdateConfig>) => void
  /** 失焦、重试与切换 section 时冲刷当前草稿。 */
  readonly flush: () => void
  readonly retrySave: () => void
}

export function useSettingsAutoUpdate(
  notifyNotice: Notify,
  owner: AutoUpdateConfigOwner = settingsAutoUpdateOwner,
): UseSettingsAutoUpdateResult {
  const state = useSyncExternalStore(owner.subscribe, owner.getState, owner.getState)
  // 每次真正挂载读取一次；Activity 隐藏保留该标记，恢复时不会重读。
  const initializedRef = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const loadedRef = useRef(false)
  const [editRevision, setEditRevision] = useState(0)
  const editRevisionRef = useRef(0)
  const retryRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    void owner.load().then(outcome => {
      if (!outcome.feedback) return
      notifyNotice(outcome.feedback.message, outcome.feedback.type)
    }).finally(() => {
      loadedRef.current = true
      setLoaded(true)
    })
  }, [notifyNotice, owner])

  const update = useCallback((patch: Partial<AutoUpdateConfig>) => {
    const previous = owner.getState().draft
    owner.update(patch)
    if (owner.getState().draft === previous) return
    editRevisionRef.current += 1
    setEditRevision(editRevisionRef.current)
  }, [owner])

  const saveWithFeedback = useCallback(async (): Promise<AutoUpdateSaveOutcome> => {
    const outcome = await owner.save()
    if (outcome.status === 'failed') {
      notifyNotice(outcome.feedback?.message ?? '自动更新设置保存失败', 'error', {
        id: SETTINGS_AUTO_UPDATE_NOTICE_ID,
        action: { label: '重试保存', onClick: () => { void retryRef.current() } },
      })
    } else if (outcome.status === 'invalid') {
      notifyNotice(outcome.feedback?.message ?? INVALID_UPDATE_TIME_MESSAGE, 'error', {
        id: SETTINGS_AUTO_UPDATE_NOTICE_ID,
      })
    } else if (outcome.status === 'saved' || outcome.status === 'superseded') {
      dismissNotice(SETTINGS_AUTO_UPDATE_NOTICE_ID)
    }
    return outcome
  }, [notifyNotice, owner])

  const getAutoSaveState = useCallback((): AutoUpdateAutoSaveState => {
    const current = owner.getState()
    return {
      loaded: loadedRef.current,
      dirty: current.dirty,
      saving: current.saving,
      revision: editRevisionRef.current,
      draft: current.draft,
    }
  }, [owner])

  const { flush } = useAutoSave<AutoUpdateAutoSaveState>({
    state: {
      loaded,
      dirty: state.dirty,
      saving: state.saving,
      revision: editRevision,
      draft: state.draft,
    },
    getState: getAutoSaveState,
    save: saveWithFeedback,
    canSave: current => !current.draft.enabled || isValidUpdateTime(current.draft.time),
    onBlocked: () => {
      notifyNotice(INVALID_UPDATE_TIME_MESSAGE, 'error', { id: SETTINGS_AUTO_UPDATE_NOTICE_ID })
    },
    saveBlocked: state.feedback?.type === 'error',
  })

  const retrySave = useCallback(() => {
    void saveWithFeedback()
  }, [saveWithFeedback])
  useEffect(() => {
    retryRef.current = retrySave
  }, [retrySave])

  return {
    ...state,
    loaded,
    update,
    flush,
    retrySave,
  }
}
