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
    lowerMessage.includes('已经存在') ||
    lowerMessage.includes('重复') ||
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
    lowerMessage.includes('已保存') ||
    lowerMessage.includes('已连接') ||
    lowerMessage.includes('已启用') ||
    lowerMessage.includes('已安装') ||
    lowerMessage.includes('已更新') ||
    lowerMessage.includes('已同步') ||
    lowerMessage.includes('已添加') ||
    lowerMessage.includes('已删除') ||
    lowerMessage.includes('已复制') ||
    lowerMessage.includes('已导入') ||
    lowerMessage.includes('已导出') ||
    lowerMessage.includes('已创建') ||
    lowerMessage.includes('已启动') ||
    lowerMessage.includes('已发送') ||
    lowerMessage.includes('已应用') ||
    lowerMessage.includes('已恢复')
  ) {
    return 'success'
  }

  if (
    lowerMessage.includes('警告') ||
    lowerMessage.includes('注意') ||
    lowerMessage.includes('取消') ||
    lowerMessage.includes('终止') ||
    lowerMessage.includes('停止') ||
    lowerMessage.includes('禁用') ||
    lowerMessage.includes('断开')
  ) {
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
