import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, LoaderCircle, Save, Send } from 'lucide-react'
import type { ApiResponse } from '@/shared/api'
import { Button } from '@/shared/ui/button'
import { Switch } from '@/shared/ui/switch'
import { SmoothPanel } from '@/shared/components'
import { saveNotificationConfig, testNotificationChannel } from '../api'
import {
  cloneNotificationConfig,
  type NotificationConfig,
  type TelegramConfig,
} from '../model/notificationConfig'
import { notificationConfigQueryOptions } from '../model/queries'

const getResponseMessage = (data: Partial<ApiResponse>, fallback: string) =>
  data.message || data.errorInfo?.message || data.error || fallback

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

interface Notice {
  type: 'success' | 'error'
  text: string
}

export default function NotificationSettings() {
  const queryClient = useQueryClient()
  const configQuery = useQuery(notificationConfigQueryOptions())
  const [config, setConfig] = useState<NotificationConfig>(() => cloneNotificationConfig())
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [testNotice, setTestNotice] = useState<Notice | null>(null)
  const [saveNotice, setSaveNotice] = useState<Notice | null>(null)
  const mountedRef = useRef(false)
  const activationRevisionRef = useRef(0)
  const draftRevisionRef = useRef(0)
  const committedRevisionRef = useRef(0)
  const saveRequestIdRef = useRef(0)
  const testAbortRef = useRef<AbortController | null>(null)

  const loading = configQuery.isPending
  const loadError = configQuery.isError
    ? getErrorMessage(configQuery.error, '加载通知配置失败')
    : null

  useEffect(() => {
    const activationRevision = ++activationRevisionRef.current
    mountedRef.current = true
    setTesting(false)

    return () => {
      if (activationRevisionRef.current === activationRevision) activationRevisionRef.current += 1
      mountedRef.current = false
      testAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!configQuery.data) return
    if (draftRevisionRef.current !== committedRevisionRef.current) return
    setConfig(cloneNotificationConfig(configQuery.data))
    setDirty(false)
  }, [configQuery.data])

  const refetchConfig = configQuery.refetch
  const loadConfig = useCallback(async (force = false) => {
    if (force) {
      setSaveNotice(null)
      setTestNotice(null)
    }
    await refetchConfig()
  }, [refetchConfig])

  const updateConfig = (updater: (current: NotificationConfig) => NotificationConfig) => {
    draftRevisionRef.current += 1
    setSaveNotice(null)
    setDirty(true)
    setConfig(updater)
  }

  const updateTelegram = (patch: Partial<TelegramConfig>) => {
    updateConfig(current => ({
      ...current,
      channels: {
        ...current.channels,
        telegram: {
          ...current.channels.telegram,
          ...patch
        }
      }
    }))
  }

  const saveConfig = async () => {
    const configSnapshot = cloneNotificationConfig(config)
    const revisionSnapshot = draftRevisionRef.current
    const requestId = ++saveRequestIdRef.current
    setSaving(true)
    setSaveNotice(null)

    try {
      const data = await saveNotificationConfig(configSnapshot)
      if (saveRequestIdRef.current !== requestId) return

      if (data.success) {
        queryClient.setQueryData(notificationConfigQueryOptions().queryKey, configSnapshot)
        if (revisionSnapshot === draftRevisionRef.current) {
          committedRevisionRef.current = revisionSnapshot
          setDirty(false)
        }
        if (mountedRef.current) setSaveNotice({ type: 'success', text: data.message || '通知配置已保存' })
      } else if (mountedRef.current) {
        setSaveNotice({ type: 'error', text: getResponseMessage(data, '通知配置保存失败') })
      }
    } catch (error) {
      if (saveRequestIdRef.current === requestId && mountedRef.current) {
        setSaveNotice({ type: 'error', text: getErrorMessage(error, '通知配置保存失败') })
      }
    } finally {
      if (saveRequestIdRef.current === requestId && mountedRef.current) setSaving(false)
    }
  }

  const testNotification = async () => {
    const controller = new AbortController()
    const telegramSnapshot = { ...config.channels.telegram }
    testAbortRef.current?.abort()
    testAbortRef.current = controller
    setTesting(true)
    setTestNotice(null)

    try {
      const data = await testNotificationChannel('telegram', telegramSnapshot, controller.signal)
      if (controller.signal.aborted || !mountedRef.current || testAbortRef.current !== controller) return

      setTestNotice(data.success
        ? { type: 'success', text: data.message || '测试通知已发送' }
        : { type: 'error', text: getResponseMessage(data, '测试通知失败') })
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current || testAbortRef.current !== controller) return
      setTestNotice({ type: 'error', text: getErrorMessage(error, '测试通知失败') })
    } finally {
      if (testAbortRef.current === controller) {
        testAbortRef.current = null
        if (mountedRef.current) setTesting(false)
      }
    }
  }

  const telegram = config.channels.telegram
  const canSend = telegram.enabled && Boolean(telegram.botToken && telegram.chatId)
  const canTest = config.enabled && canSend
  const testBlockedReason = !config.enabled
    ? '先启用通知'
    : !telegram.enabled
      ? '先启用 Telegram'
      : !canSend
        ? '填写 Bot Token 与 Chat ID 后可测试'
        : null

  return (
    <SmoothPanel className="automation-side-card">
      <div className="automation-side-card-heading">
        <div className="automation-side-card-heading-text">
          <h3><Bell size={16} strokeWidth={1.8} aria-hidden="true" /><span>通知</span></h3>
          <p>任务流程结束后发送结果</p>
        </div>
        <div className="automation-side-card-heading-actions">
          <Switch
            checked={config.enabled}
            onCheckedChange={(enabled) => updateConfig(current => ({ ...current, enabled }))}
            disabled={loading || saving || Boolean(loadError)}
            aria-label="启用通知"
            className="automation-card-switch"
          />
        </div>
      </div>

      {loading ? (
        <div className="automation-notification-loading" role="status">读取通知配置…</div>
      ) : loadError ? (
        <div className="automation-notification-notice is-error flex flex-wrap items-center justify-between gap-2" role="alert">
          <span>{loadError}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void loadConfig(true)}
            disabled={loading || configQuery.isFetching}
          >
            重新加载
          </Button>
        </div>
      ) : (
        <>
          <div className={`automation-notification-channel${config.enabled ? '' : ' is-parent-disabled'}`}>
            <div className="automation-notification-channel-heading">
              <div>
                <strong>Telegram</strong>
                <small>通过 Bot 发送到指定会话</small>
              </div>
              <Switch
                checked={telegram.enabled}
                onCheckedChange={(enabled) => updateTelegram({ enabled })}
                disabled={!config.enabled || saving}
                aria-label="启用 Telegram"
                className="automation-card-switch"
              />
            </div>

            {telegram.enabled && (
              <div className="automation-notification-details">
                <label className="automation-notification-field">
                  <span>Bot Token</span>
                  <input
                    type="text"
                    value={telegram.botToken}
                    onChange={(event) => updateTelegram({ botToken: event.target.value })}
                    placeholder="Telegram Bot Token"
                    disabled={!config.enabled || saving}
                    autoComplete="off"
                    className="app-native-control"
                  />
                </label>

                <label className="automation-notification-field">
                  <span>Chat ID</span>
                  <input
                    type="text"
                    value={telegram.chatId}
                    onChange={(event) => updateTelegram({ chatId: event.target.value })}
                    placeholder="Telegram Chat ID"
                    disabled={!config.enabled || saving}
                    autoComplete="off"
                    className="app-native-control"
                  />
                </label>
              </div>
            )}

            {config.enabled && !canSend && (
              <p className="automation-notification-hint" role="status">
                {telegram.enabled ? '凭据不完整，不会发送' : '未启用渠道，不会发送'}
              </p>
            )}

            <div className="automation-notification-actions">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void testNotification()}
                disabled={loading || Boolean(loadError) || testing || !canTest}
                aria-busy={testing || undefined}
              >
                {testing
                  ? <><LoaderCircle className="animate-spin" aria-hidden="true" />发送中</>
                  : (
                    <>
                      <Send size={14} aria-hidden="true" />
                      发送测试消息
                    </>
                  )}
              </Button>
              {config.enabled && testBlockedReason && (
                <small className="automation-notification-hint">{testBlockedReason}</small>
              )}
            </div>

            {testNotice && (
              <div
                className={`automation-notification-notice is-${testNotice.type}`}
                role={testNotice.type === 'error' ? 'alert' : 'status'}
              >
                {testNotice.text}
              </div>
            )}
          </div>

          {!config.enabled && (
            <small className="automation-notification-hint">{testBlockedReason}</small>
          )}

          {saveNotice && (
            <div
              className={`automation-notification-notice is-${saveNotice.type}`}
              role={saveNotice.type === 'error' ? 'alert' : 'status'}
            >
              {saveNotice.text}
            </div>
          )}

          <div className="automation-side-card-footer">
            <span className="automation-notification-status">
              {saving ? '保存中…' : dirty ? '有未保存的更改' : '已保存'}
            </span>
            <Button
              size="sm"
              onClick={() => void saveConfig()}
              disabled={!dirty || loading || saving}
              aria-busy={saving || undefined}
            >
              {saving
                ? <><LoaderCircle className="animate-spin" aria-hidden="true" />保存中</>
                : (
                  <>
                    <Save size={14} aria-hidden="true" />
                    保存
                  </>
                )}
            </Button>
          </div>
        </>
      )}
    </SmoothPanel>
  )
}
