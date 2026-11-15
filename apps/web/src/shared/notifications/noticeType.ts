export type NoticeType = 'success' | 'error' | 'warning' | 'info' | 'default'

export function detectNoticeType(message: string): NoticeType {
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
