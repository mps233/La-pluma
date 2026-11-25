import { useCallback, useEffect, useRef } from 'react'
import { dismissNotice, notify } from '@/shared/notifications'
import type { ConfigEditorFeedback } from '../components/ConfigEditorCard'
import type { ConfigSaveOutcome, ConfigSyncState } from '../model/configDraftOwner'

export interface ConfigDraftPanelOptions<T extends Record<string, unknown>> {
  /** 页面可见名称，用于读取失败与保存失败提示。 */
  readonly label: string
  readonly noticeId: string
  readonly loadError: string | null
  readonly syncState: ConfigSyncState
  readonly error: string | null
  readonly save: () => Promise<ConfigSaveOutcome<T>>
}

/**
 * 设置页各 section 共用的自动保存反馈：读取失败保留页内警示与全局提示，
 * 保存失败同时保留页内错误与带重试入口的全局提示；成功保持静默。
 */
export function useConfigDraftPanel<T extends Record<string, unknown>>({
  label,
  noticeId,
  loadError,
  syncState,
  error,
  save,
}: ConfigDraftPanelOptions<T>) {
  const retryRef = useRef<() => void>(() => {})
  const reportedLoadFailureRef = useRef<string | null>(null)

  useEffect(() => {
    if (!loadError) {
      reportedLoadFailureRef.current = null
      return
    }
    const message = `${label}读取失败: ${loadError}`
    if (reportedLoadFailureRef.current === message) return
    reportedLoadFailureRef.current = message
    notify(message, 'error')
  }, [label, loadError])

  const saveWithFeedback = useCallback(async () => {
    let outcome: ConfigSaveOutcome<T>
    try {
      outcome = await save()
    } catch (saveError) {
      const message = `${label}保存失败: ${saveError instanceof Error ? saveError.message : '未知错误'}`
      notify(message, 'error', {
        id: noticeId,
        action: { label: '重试保存', onClick: () => { void retryRef.current() } },
      })
      return null
    }

    if (outcome.status === 'failed') {
      const message = `${label}保存失败: ${outcome.message ?? '未知错误'}`
      notify(message, 'error', {
        id: noticeId,
        action: { label: '重试保存', onClick: () => { void retryRef.current() } },
      })
    } else if (outcome.status === 'saved') {
      dismissNotice(noticeId)
    }
    return outcome
  }, [label, noticeId, save])

  useEffect(() => {
    retryRef.current = saveWithFeedback
  }, [saveWithFeedback])

  const loadMessage = loadError ? `${label}读取失败: ${loadError}` : null
  const feedback: ConfigEditorFeedback | null = loadMessage
    ? { type: 'error', message: loadMessage, retry: 'load' }
    : syncState === 'failed' && error
      ? { type: 'error', message: `${label}保存失败: ${error}`, retry: 'save' }
      : null

  return { feedback, save: saveWithFeedback }
}
