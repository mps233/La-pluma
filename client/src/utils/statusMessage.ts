export type StatusMessageType = 'success' | 'error' | 'warning' | 'info' | 'default'

export interface StatusVisualConfig {
  className: string
  dotColor: string
  pulseRgb: string
}

const STATUS_VISUAL_CONFIG: Record<StatusMessageType, StatusVisualConfig> = {
  success: {
    className: 'status-success',
    dotColor: 'var(--app-success)',
    pulseRgb: '5, 150, 105',
  },
  error: {
    className: 'status-danger',
    dotColor: 'var(--app-danger)',
    pulseRgb: '225, 29, 72',
  },
  warning: {
    className: 'status-warning',
    dotColor: 'var(--app-warning)',
    pulseRgb: '217, 119, 6',
  },
  info: {
    className: 'status-info',
    dotColor: 'var(--app-info)',
    pulseRgb: '37, 99, 235',
  },
  default: {
    className: 'surface-soft text-secondary',
    dotColor: 'var(--app-text-soft)',
    pulseRgb: '148, 163, 184',
  },
}

export function detectStatusMessageType(message: string): StatusMessageType {
  if (!message) return 'default'

  const lowerMessage = message.toLowerCase()

  if (
    lowerMessage.includes('失败') ||
    lowerMessage.includes('错误') ||
    lowerMessage.includes('不存在') ||
    lowerMessage.includes('无效') ||
    lowerMessage.includes('未找到') ||
    lowerMessage.includes('请输入')
  ) {
    return 'error'
  }

  if (
    lowerMessage.includes('成功') ||
    lowerMessage.includes('完成') ||
    lowerMessage.includes('已')
  ) {
    return 'success'
  }

  if (lowerMessage.includes('警告') || lowerMessage.includes('注意')) {
    return 'warning'
  }

  if (
    lowerMessage.includes('正在') ||
    lowerMessage.includes('获取') ||
    lowerMessage.includes('搜索')
  ) {
    return 'info'
  }

  return 'default'
}

export function getStatusVisualConfig(type: StatusMessageType): StatusVisualConfig {
  return STATUS_VISUAL_CONFIG[type] ?? STATUS_VISUAL_CONFIG.default
}
