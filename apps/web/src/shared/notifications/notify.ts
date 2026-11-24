import { toast } from 'sonner'
import { detectNoticeType, type NoticeType } from './noticeType'

export const EXECUTION_NOTICE_ID = 'execution'
export const STATISTICS_NOTICE_ID = 'statistics'
export const SETTINGS_UPDATE_NOTICE_ID = 'settings-update'
export const SETTINGS_UPDATE_CHANNEL_NOTICE_ID = 'settings-update-channel'
export const SETTINGS_AUTO_UPDATE_NOTICE_ID = 'settings-auto-update'
export const SETTINGS_CONFIG_CONNECTION_NOTICE_ID = 'settings-config:connection'
export const SETTINGS_CONFIG_INSTANCE_NOTICE_ID = 'settings-config:instance'
export const SETTINGS_CONFIG_RESOURCE_SOURCE_NOTICE_ID = 'settings-config:resource-source'
export const COMBAT_PREVIEW_NOTICE_ID = 'combat-preview'
export const COMBAT_QUEUE_PREVIEW_NOTICE_ID = 'combat-queue-preview'
export const COMBAT_PARADOX_SEARCH_NOTICE_ID = 'combat-paradox-search'
export const DASHBOARD_CONNECTION_NOTICE_ID = 'dashboard-connection'
export const LOGS_NOTICE_ID = 'logs'
export const LOGS_COVERAGE_NOTICE_ID = 'logs-coverage'
export const LOGS_HIDDEN_MATCHES_NOTICE_ID = 'logs-hidden-matches'
export const LOGS_REFRESH_NOTICE_ID = 'logs-refresh'

export interface NoticeOptions {
  id?: string
  duration?: number
  description?: string
  action?: { label: string; onClick: () => void }
}

export type Notify = (message: string, type?: NoticeType, options?: NoticeOptions) => string

const NOTICE_DURATION_MS: Record<NoticeType, number> = {
  success: 2500,
  error: Infinity,
  warning: 4000,
  info: 4000,
  default: 4000,
}

export function notify(message: string, type?: NoticeType, options: NoticeOptions = {}): string {
  if (!message) return ''

  const resolvedType = type ?? detectNoticeType(message)
  const duration = options.duration ?? NOTICE_DURATION_MS[resolvedType]
  const toastOptions = {
    duration,
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.action === undefined ? {} : { action: options.action }),
  }
  const id = resolvedType === 'default'
    ? toast(message, toastOptions)
    : toast[resolvedType](message, toastOptions)
  return String(id)
}

export function notifyProgress(message: string, id: string): string {
  if (!message) return ''
  return String(toast.loading(message, { id, duration: Infinity }))
}

export function dismissNotice(id?: string): void {
  toast.dismiss(id)
}
