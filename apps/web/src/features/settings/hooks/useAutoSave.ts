import { useCallback, useEffect, useRef } from 'react'

export const SETTINGS_AUTO_SAVE_DELAY_MS = 600

export interface AutoSaveState {
  readonly loaded: boolean
  readonly dirty: boolean
  readonly saving: boolean
  readonly revision: number
}

export interface UseAutoSaveOptions<TState extends AutoSaveState> {
  readonly state: TState
  readonly getState: () => TState
  readonly save: () => Promise<unknown>
  /** 设备忙时同时阻止排程与显式冲刷。 */
  readonly locked?: boolean
  /** 只暂停防抖排程；显式冲刷（失焦、卸载）仍然生效。 */
  readonly paused?: boolean
  /** 上一次自动保存失败后阻止自动重试，直到下一次编辑。 */
  readonly saveBlocked?: boolean
  readonly delayMs?: number
  readonly canSave?: (state: TState) => boolean
  readonly onBlocked?: (state: TState) => void
}

/**
 * 设置页草稿的自动保存调度器：只观察 owner 状态并触发 `save`，不复制草稿、
 * 不维护第二份 revision。`revision === 0` 排除读取回退等非用户编辑产生的 dirty。
 */
export function useAutoSave<TState extends AutoSaveState>({
  state,
  getState,
  save,
  locked = false,
  paused = false,
  saveBlocked = false,
  delayMs = SETTINGS_AUTO_SAVE_DELAY_MS,
  canSave,
  onBlocked,
}: UseAutoSaveOptions<TState>) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRef = useRef(save)
  const getStateRef = useRef(getState)
  const canSaveRef = useRef(canSave)
  const onBlockedRef = useRef(onBlocked)
  const lockedRef = useRef(locked)
  const blockedRevisionRef = useRef<number | null>(null)

  useEffect(() => {
    saveRef.current = save
    getStateRef.current = getState
    canSaveRef.current = canSave
    onBlockedRef.current = onBlocked
    lockedRef.current = locked
  })

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const notifyBlocked = useCallback((current: TState) => {
    if (blockedRevisionRef.current === current.revision) return
    blockedRevisionRef.current = current.revision
    onBlockedRef.current?.(current)
  }, [])

  const performSave = useCallback(() => {
    clearTimer()
    const current = getStateRef.current()
    if (!current.loaded || !current.dirty || current.saving || lockedRef.current) return
    if (current.revision === 0) return
    if (canSaveRef.current && !canSaveRef.current(current)) {
      notifyBlocked(current)
      return
    }
    void saveRef.current()
  }, [clearTimer, notifyBlocked])

  useEffect(() => {
    clearTimer()
    if (paused || locked || saveBlocked) return
    if (!state.loaded || !state.dirty || state.saving || state.revision === 0) return
    const current = getStateRef.current()
    if (canSaveRef.current && !canSaveRef.current(current)) {
      notifyBlocked(current)
      return
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      performSave()
    }, delayMs)
    return clearTimer
  }, [
    clearTimer,
    delayMs,
    locked,
    notifyBlocked,
    paused,
    performSave,
    saveBlocked,
    state.dirty,
    state.loaded,
    state.revision,
    state.saving,
  ])

  useEffect(() => {
    const handlePageHide = () => performSave()
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      performSave()
    }
  }, [performSave])

  return { flush: performSave }
}
