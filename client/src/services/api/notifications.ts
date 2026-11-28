import type { ApiResponse } from '@/types/api'
import { parseJsonResponse } from '@/utils/apiResponse'
import { API_BASE_URL, fetchWithAuth } from './client'

export interface TelegramConfig {
  enabled: boolean
  botToken: string
  chatId: string
}

export interface NotificationConfig {
  enabled: boolean
  channels: {
    telegram: TelegramConfig
  }
}

const emptyNotificationConfig: NotificationConfig = {
  enabled: false,
  channels: {
    telegram: {
      enabled: false,
      botToken: '',
      chatId: '',
    },
  },
}

export const cloneNotificationConfig = (config: NotificationConfig = emptyNotificationConfig): NotificationConfig => ({
  enabled: Boolean(config?.enabled),
  channels: {
    telegram: {
      enabled: Boolean(config?.channels?.telegram?.enabled),
      botToken: config?.channels?.telegram?.botToken || '',
      chatId: config?.channels?.telegram?.chatId || '',
    },
  },
})

let cachedNotificationConfig: NotificationConfig | null = null
let pendingNotificationConfig: Promise<ApiResponse<NotificationConfig>> | null = null

/**
 * Notification configuration reads are shared across mounts and reloads: a
 * cached copy answers immediately, and concurrent first reads share one
 * request. Callers receive a clone so a draft cannot mutate the cache.
 */
export const notificationsApi = {
  async getConfig(force = false): Promise<ApiResponse<NotificationConfig>> {
    if (!force && cachedNotificationConfig) {
      return { success: true, data: cloneNotificationConfig(cachedNotificationConfig) }
    }
    if (pendingNotificationConfig) {
      return pendingNotificationConfig
    }

    const request = (async (): Promise<ApiResponse<NotificationConfig>> => {
      const response = await fetchWithAuth(`${API_BASE_URL}/agent/notifications/config`)
      const result = await parseJsonResponse<ApiResponse<NotificationConfig>>(response)
      if (result.success) cachedNotificationConfig = cloneNotificationConfig(result.data)
      return {
        ...result,
        data: result.data ? cloneNotificationConfig(result.data) : undefined,
      }
    })()

    const sharedRequest = request.finally(() => {
      if (pendingNotificationConfig === sharedRequest) pendingNotificationConfig = null
    })
    pendingNotificationConfig = sharedRequest
    return sharedRequest
  },

  async saveConfig(config: NotificationConfig, signal?: AbortSignal): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/notifications/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cloneNotificationConfig(config)),
      signal,
    })
    const result = await parseJsonResponse<ApiResponse>(response)
    if (result.success) cachedNotificationConfig = cloneNotificationConfig(config)
    return result
  },

  async testChannel(
    channel: string,
    config: TelegramConfig,
    signal?: AbortSignal,
  ): Promise<ApiResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/agent/actions/test-notification-channel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, config }),
      signal,
    })
    return parseJsonResponse<ApiResponse>(response)
  },
}
