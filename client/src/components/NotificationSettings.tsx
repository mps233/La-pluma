import { useEffect, useState } from 'react'
import { Bell, Save, Send } from 'lucide-react'
import { API_BASE_URL, fetchWithAuth } from '@/services/api'

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

export default function NotificationSettings() {
  const [config, setConfig] = useState<NotificationConfig>(emptyConfig)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const getResponseMessage = (data: any, fallback: string) =>
    data?.message || data?.errorInfo?.message || data?.error || fallback

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetchWithAuth(`${API_BASE_URL}/agent/notifications/config`)
        const data = await response.json()

        if (data.success) {
          setConfig(data.data || data)
        } else {
          setNotice({ type: 'error', text: getResponseMessage(data, '加载通知配置失败') })
        }
      } catch (error) {
        setNotice({ type: 'error', text: (error as Error).message || '加载通知配置失败' })
      }
    }

    loadConfig()
  }, [])

  const updateTelegram = (patch: Partial<TelegramConfig>) => {
    setConfig(current => ({
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
    setSaving(true)
    setNotice(null)

    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/agent/notifications/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })
      const data = await response.json()

      setNotice(data.success
        ? { type: 'success', text: data.message || '通知配置已保存' }
        : { type: 'error', text: getResponseMessage(data, '通知配置保存失败') })
    } catch (error) {
      setNotice({ type: 'error', text: (error as Error).message || '通知配置保存失败' })
    } finally {
      setSaving(false)
    }
  }

  const testNotification = async () => {
    setTesting(true)
    setNotice(null)

    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/test-notification-channel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'telegram' })
      })
      const data = await response.json()

      setNotice(data.success
        ? { type: 'success', text: data.message || '测试通知已发送' }
        : { type: 'error', text: getResponseMessage(data, '测试通知失败') })
    } catch (error) {
      setNotice({ type: 'error', text: (error as Error).message || '测试通知失败' })
    } finally {
      setTesting(false)
    }
  }

  const telegram = config.channels.telegram
  const canTest = telegram.enabled && Boolean(telegram.botToken && telegram.chatId)

  return (
    <section className="automation-notification-panel">
      <div className="automation-notification-heading">
        <div>
          <h4><Bell size={15} /><span>通知</span></h4>
          <p>任务完成后发送结果</p>
        </div>
        <label>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => setConfig(current => ({ ...current, enabled: event.target.checked }))}
            className="custom-checkbox cursor-pointer"
          />
          <span>{config.enabled ? '已启用' : '未启用'}</span>
        </label>
      </div>

      {notice && (
        <div className={`automation-notification-notice is-${notice.type}`}>{notice.text}</div>
      )}

      <div className="automation-notification-channel">
        <div className="automation-notification-channel-heading">
          <div>
            <strong>Telegram</strong>
            <small>机器人通知</small>
          </div>
          <label>
            <input
              type="checkbox"
              checked={telegram.enabled}
              onChange={(event) => updateTelegram({ enabled: event.target.checked })}
              className="custom-checkbox cursor-pointer"
            />
            <span>{telegram.enabled ? '已启用' : '未启用'}</span>
          </label>
        </div>

        <label className="automation-notification-field">
          <span>Bot Token</span>
          <input
            type="text"
            value={telegram.botToken}
            onChange={(event) => updateTelegram({ botToken: event.target.value })}
            placeholder="Telegram Bot Token"
            disabled={!telegram.enabled}
            autoComplete="off"
          />
        </label>

        <label className="automation-notification-field">
          <span>Chat ID</span>
          <input
            type="text"
            value={telegram.chatId}
            onChange={(event) => updateTelegram({ chatId: event.target.value })}
            placeholder="Telegram Chat ID"
            disabled={!telegram.enabled}
            autoComplete="off"
          />
        </label>

        <div className="automation-notification-buttons">
          <button type="button" onClick={testNotification} disabled={testing || !canTest}>
            <Send size={14} />
            <span>{testing ? '发送中' : '测试'}</span>
          </button>
          <button type="button" onClick={saveConfig} disabled={saving} className="is-primary">
            <Save size={14} />
            <span>{saving ? '保存中' : '保存'}</span>
          </button>
        </div>
      </div>
    </section>
  )
}
