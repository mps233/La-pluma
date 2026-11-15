import { useCallback, useEffect, useRef, useState } from 'react'
import { dismissNotice, notify, notifyProgress } from '@/shared/notifications'
import type { SettingsFeedback } from '../components/ConfigEditorCard'
import type { ConfigSaveOutcome } from '../model/configDraftOwner'

export interface ConfigDraftPanelOptions<T extends Record<string, unknown>> {
  /** 页面可见名称，用于读取失败、保存成功与保存失败提示。 */
  readonly label: string
  readonly noticeId: string
  readonly savingMessage: string
  readonly loadError: string | null
  readonly loaded: boolean
  readonly saving: boolean
  readonly save: () => Promise<ConfigSaveOutcome<T>>
}

/**
 * 设置页各 section 共用的草稿面板反馈：初始读取失败提示一次、加载完成后清除，
 * 保存前置与结果映射到页内反馈和全局状态提示。
 */
export function useConfigDraftPanel<T extends Record<string, unknown>>({
  label,
  noticeId,
  savingMessage,
  loadError,
  loaded,
  saving,
  save,
}: ConfigDraftPanelOptions<T>) {
  const [feedback, setFeedback] = useState<SettingsFeedback | null>(null)
  const reportedLoadFailureRef = useRef<string | null>(null)

  const blockedSaveMessage = loadError
    ? `${label}读取失败，暂时无法保存`
    : `${label}正在读取，加载完成后才能保存`
  const saveBlockedReason = loaded ? null : blockedSaveMessage

  useEffect(() => {
    if (!loadError) return
    const message = `${label}读取失败: ${loadError}（保存已禁用，请重试读取）`
    if (reportedLoadFailureRef.current === message) return
    reportedLoadFailureRef.current = message
    // 读取失败同步为页内反馈；ref 保证同一失败只提示一次，不是渲染循环。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFeedback({ type: 'error', message })
    notify(message, 'error')
  }, [label, loadError])

  useEffect(() => {
    if (!loaded || !reportedLoadFailureRef.current) return
    const message = reportedLoadFailureRef.current
    reportedLoadFailureRef.current = null
    setFeedback(current => (current?.message === message ? null : current))
  }, [loaded])

  const saveWithFeedback = useCallback(async () => {
    if (!loaded) {
      setFeedback({ type: 'warning', message: blockedSaveMessage })
      notify(blockedSaveMessage, 'warning', { id: noticeId })
      return
    }
    if (saving) return
    setFeedback(null)
    notifyProgress(savingMessage, noticeId)

    let outcome: ConfigSaveOutcome<T>
    try {
      outcome = await save()
    } catch (error) {
      const message = `${label}保存失败: ${error instanceof Error ? error.message : '未知错误'}`
      setFeedback({ type: 'error', message })
      notify(message, 'error', { id: noticeId })
      return
    }
    if (outcome.status === 'ignored') {
      dismissNotice(noticeId)
      return
    }

    if (outcome.status === 'saved') {
      if (outcome.superseded) {
        const message = `此前${label}已保存，当前更改尚未保存`
        setFeedback({ type: 'warning', message })
        notify(message, 'warning', { id: noticeId })
      } else {
        const message = `${label}保存成功`
        setFeedback({ type: 'success', message })
        notify(message, 'success', { id: noticeId })
      }
      return
    }

    const message = `${label}保存失败: ${outcome.message ?? '未知错误'}`
    setFeedback({ type: 'error', message })
    notify(message, 'error', { id: noticeId })
  }, [blockedSaveMessage, label, loaded, noticeId, save, saving, savingMessage])

  return { feedback, setFeedback, saveBlockedReason, save: saveWithFeedback }
}
