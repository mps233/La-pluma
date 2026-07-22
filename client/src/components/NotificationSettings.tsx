import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, Save, Send } from 'lucide-react'
import { API_BASE_URL, fetchWithAuth, parseJsonResponse } from '@/services/api'
import { Switch } from './common'

interface TelegramConfig {
  enabled: boolean
  botToken: string
  chatId: string
}

interface NotificationConfig {
  enabled: boolean
  channels: {
    telegram: TelegramConfig
  }
}

const emptyConfig: NotificationConfig = {
  enabled: false,
  channels: {
    telegram: {
      enabled: false,
      botToken: '',
      chatId: ''
    }
  }
}

interface NotificationResponse {
  success: boolean
  data?: NotificationConfig
  message?: string
  error?: string
  errorInfo?: { message?: string }
}

let cachedNotificationConfig: NotificationConfig | null = null
let pendingNotificationConfig: Promise<NotificationConfig> | null = null

const cloneConfig = (config: NotificationConfig = emptyConfig): NotificationConfig => ({
  enabled: Boolean(config.enabled),
  channels: {
    telegram: {
      enabled: Boolean(config.channels?.telegram?.enabled),
      botToken: config.channels?.telegram?.botToken || '',
      chatId: config.channels?.telegram?.chatId || '',
    },
  },
})

const getResponseMessage = (data: NotificationResponse, fallback: string) =>
  data.message || data.errorInfo?.message || data.error || fallback

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

const requestNotificationConfig = (force = false): Promise<NotificationConfig> => {
  if (!force && cachedNotificationConfig) {
    return Promise.resolve(cloneConfig(cachedNotificationConfig))
  }
  if (pendingNotificationConfig) {
    return pendingNotificationConfig.then(cloneConfig)
  }

  const request = (async () => {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/notifications/config`)
    const data = await parseJsonResponse<NotificationResponse>(response)
    if (!data.success) throw new Error(getResponseMessage(data, '加载通知配置失败'))

    const config = cloneConfig(data.data)
    cachedNotificationConfig = config
    return config
  })()

  const sharedRequest = request.finally(() => {
    if (pendingNotificationConfig === sharedRequest) pendingNotificationConfig = null
  })
  pendingNotificationConfig = sharedRequest
  return sharedRequest.then(cloneConfig)
}

const updateNotificationConfigCache = (config: NotificationConfig) => {
  cachedNotificationConfig = cloneConfig(config)
}

export default function NotificationSettings() {
  const [config, setConfig] = useState<NotificationConfig>(() => cloneConfig())
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const mountedRef = useRef(false)
  const activationRevisionRef = useRef(0)
  const draftRevisionRef = useRef(0)
  const committedRevisionRef = useRef(0)
  const saveAbortRef = useRef<AbortController | null>(null)
  const testAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const activationRevision = ++activationRevisionRef.current
    mountedRef.current = true
    setSaving(false)
    setTesting(false)

    return () => {
      if (activationRevisionRef.current === activationRevision) activationRevisionRef.current += 1
      mountedRef.current = false
      saveAbortRef.current?.abort()
      testAbortRef.current?.abort()
    }
  }, [])

  const loadConfig = useCallback(async (force = false) => {
    const activationRevision = activationRevisionRef.current
    setLoading(true)
    setLoadError(null)
    if (force) setNotice(null)

    try {
      const loadedConfig = await requestNotificationConfig(force)
      if (!mountedRef.current || activationRevision !== activationRevisionRef.current) return

      if (draftRevisionRef.current === committedRevisionRef.current) {
        setConfig(loadedConfig)
      }
    } catch (error) {
      if (!mountedRef.current || activationRevision !== activationRevisionRef.current) return
      setLoadError(getErrorMessage(error, '加载通知配置失败'))
    } finally {
      if (mountedRef.current && activationRevision === activationRevisionRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  const updateConfig = (updater: (current: NotificationConfig) => NotificationConfig) => {
    draftRevisionRef.current += 1
    setNotice(null)
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
    const controller = new AbortController()
    const configSnapshot = cloneConfig(config)
    const revisionSnapshot = draftRevisionRef.current
    saveAbortRef.current?.abort()
    saveAbortRef.current = controller
    setSaving(true)
    setNotice(null)

    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/agent/notifications/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configSnapshot),
        signal: controller.signal,
      })
      const data = await parseJsonResponse<NotificationResponse>(response)
      if (controller.signal.aborted || !mountedRef.current || saveAbortRef.current !== controller) return

      if (data.success) {
        updateNotificationConfigCache(configSnapshot)
        committedRevisionRef.current = revisionSnapshot
        setNotice({ type: 'success', text: data.message || '通知配置已保存' })
      } else {
        setNotice({ type: 'error', text: getResponseMessage(data, '通知配置保存失败') })
      }
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current || saveAbortRef.current !== controller) return
      setNotice({ type: 'error', text: getErrorMessage(error, '通知配置保存失败') })
    } finally {
      if (saveAbortRef.current === controller) {
        saveAbortRef.current = null
        if (mountedRef.current) setSaving(false)
      }
    }
  }

  const testNotification = async () => {
    const controller = new AbortController()
    const telegramSnapshot = { ...config.channels.telegram }
    testAbortRef.current?.abort()
    testAbortRef.current = controller
    setTesting(true)
    setNotice(null)

    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/test-notification-channel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'telegram', config: telegramSnapshot }),
        signal: controller.signal,
      })
      const data = await parseJsonResponse<NotificationResponse>(response)
      if (controller.signal.aborted || !mountedRef.current || testAbortRef.current !== controller) return

      setNotice(data.success
        ? { type: 'success', text: data.message || '测试通知已发送' }
        : { type: 'error', text: getResponseMessage(data, '测试通知失败') })
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current || testAbortRef.current !== controller) return
      setNotice({ type: 'error', text: getErrorMessage(error, '测试通知失败') })
    } finally {
      if (testAbortRef.current === controller) {
        testAbortRef.current = null
        if (mountedRef.current) setTesting(false)
      }
    }
  }

  const telegram = config.channels.telegram
  const canTest = telegram.enabled && Boolean(telegram.botToken && telegram.chatId)

  return (
    <section className="automation-notification-panel">
      <div className="automation-notification-heading">
        <div>
          <h4><Bell size={16} strokeWidth={1.8} aria-hidden="true" /><span>通知</span></h4>
          <p>任务完成后发送结果</p>
        </div>
        <Switch
          checked={config.enabled}
          onChange={(enabled) => updateConfig(current => ({ ...current, enabled }))}
          disabled={loading || saving || Boolean(loadError)}
          label="任务通知"
          className="automation-section-switch"
        />
      </div>

      {loadError && (
        <div className="automation-notification-notice is-error flex min-h-11 flex-wrap items-center justify-between gap-2" role="alert">
          <span>{loadError}</span>
          <button type="button" className="min-h-11 rounded-lg px-3 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]" onClick={() => void loadConfig(true)} disabled={loading}>
            重新加载
          </button>
        </div>
      )}

      {notice && !loadError && (
        <div className={`automation-notification-notice is-${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.text}</div>
      )}

      <div className="automation-notification-channel">
        <div className="automation-notification-channel-heading">
          <div>
            <strong>Telegram</strong>
            <small>机器人通知</small>
          </div>
          <Switch
            checked={telegram.enabled}
            onChange={(enabled) => updateTelegram({ enabled })}
            disabled={loading || saving || Boolean(loadError)}
            label="Telegram 通知"
            className="automation-section-switch"
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
                disabled={loading || saving || Boolean(loadError)}
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
                disabled={loading || saving || Boolean(loadError)}
                autoComplete="off"
                className="app-native-control"
              />
            </label>
          </div>
        )}

        <div className="automation-notification-buttons">
          <button type="button" onClick={testNotification} disabled={loading || saving || testing || Boolean(loadError) || !canTest} className="app-native-button">
            <Send size={14} />
            <span>{loading ? '加载中' : testing ? '发送中' : '测试'}</span>
          </button>
          <button type="button" onClick={saveConfig} disabled={loading || saving || testing || Boolean(loadError)} className="app-native-button app-native-button-primary is-primary">
            <Save size={14} />
            <span>{loading ? '加载中' : saving ? '保存中' : '保存'}</span>
          </button>
        </div>
      </div>
    </section>
  )
}
