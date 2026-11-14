import { useCallback, useEffect, useRef } from 'react'
import { maaApi } from '@/services/api'
import { useMaaUpdateStore, type MaaUpdateKind, type MaaUpdateOperation } from '@/store/maaUpdateStore'
import type { ApiResponse } from '@/types/api'

const SUCCESS_HOLD_MS = 5_000
const ERROR_HOLD_MS = 9_000

/**
 * Run one MAA update and report it on the island. The request is the caller's, so the config page
 * keeps its existing feedback and refresh behavior; this only mirrors the outcome into the shared
 * operation state. A failed request is not turned into success.
 */
export async function startMaaUpdate(
  kind: MaaUpdateKind,
  request: () => Promise<ApiResponse>,
  detail: string,
): Promise<ApiResponse> {
  const store = useMaaUpdateStore.getState()
  const token = store.begin(kind, detail)
  try {
    const result = await request()
    store.finish(
      token,
      result.success ? 'success' : 'error',
      result.success ? (result.message || '更新完成') : maaApi.getErrorMessage(result),
    )
    return result
  } catch (error) {
    store.finish(token, 'error', error instanceof Error ? error.message : '网络错误')
    throw error
  }
}

/**
 * The update the island shows, with a short hold after it ends so the outcome is visible without
 * leaving the pill there all day. The state lives outside the config page, so switching workspaces
 * does not lose a long update.
 */
export function useMaaUpdateIsland(): { operation: MaaUpdateOperation | null } {
  const operation = useMaaUpdateStore(state => state.operation)
  const clear = useMaaUpdateStore(state => state.clear)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  useEffect(() => {
    clearTimer()
    if (!operation || operation.state === 'running') return undefined
    const delay = operation.state === 'error' ? ERROR_HOLD_MS : SUCCESS_HOLD_MS
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      clear(operation.token)
    }, delay)
    return clearTimer
  }, [clear, clearTimer, operation])

  useEffect(() => clearTimer, [clearTimer])

  return { operation }
}
