import { motion } from 'framer-motion'

/**
 * 状态指示器组件 Props
 */
export interface StatusIndicatorProps {
  isActive?: boolean
  activeText?: string
  inactiveText?: string
  activeColor?: string
  inactiveColor?: string
  message?: string
  /** 消息类型，用于显示不同颜色（可选，不传则自动检测） */
  type?: 'success' | 'error' | 'warning' | 'info' | 'default'
}

/**
 * 状态指示器组件
 * 统一的状态显示样式，包含动画圆点和状态文本
 */
export default function StatusIndicator({
  isActive = false,
  activeText = '运行中',
  inactiveText = '就绪',
  activeColor = 'fuchsia-400',
  inactiveColor = 'emerald-400',
  message,
  type,
}: StatusIndicatorProps) {
  const displayText = message || (isActive ? activeText : inactiveText)

  // 颜色映射表（包含 Tailwind 类名和 rgba 值）
  const colorConfig: Record<string, { className: string; rgba: string }> = {
    'fuchsia-400': { className: 'bg-fuchsia-400', rgba: '232, 121, 249' },
    'emerald-400': { className: 'bg-emerald-400', rgba: '52, 211, 153' },
    'orange-400': { className: 'bg-orange-400', rgba: '251, 146, 60' },
    'cyan-400': { className: 'bg-cyan-400', rgba: '34, 211, 238' },
    'purple-400': { className: 'bg-purple-400', rgba: '192, 132, 252' },
    'blue-400': { className: 'bg-blue-400', rgba: '96, 165, 250' },
    'red-400': { className: 'bg-red-400', rgba: '248, 113, 113' },
    'yellow-400': { className: 'bg-yellow-400', rgba: '250, 204, 21' },
    'teal-400': { className: 'bg-teal-400', rgba: '45, 212, 191' },
  }

  // 自动检测消息类型
  const detectMessageType = (msg: string): 'success' | 'error' | 'warning' | 'info' | 'default' => {
    if (!msg) return 'default'
    const lowerMsg = msg.toLowerCase()
    if (lowerMsg.includes('失败') || lowerMsg.includes('错误') || lowerMsg.includes('不存在') || lowerMsg.includes('无效') || lowerMsg.includes('未找到') || lowerMsg.includes('请输入')) {
      return 'error'
    }
    if (lowerMsg.includes('成功') || lowerMsg.includes('完成') || lowerMsg.includes('已')) {
      return 'success'
    }
    if (lowerMsg.includes('警告') || lowerMsg.includes('注意')) {
      return 'warning'
    }
    if (lowerMsg.includes('正在') || lowerMsg.includes('获取') || lowerMsg.includes('搜索')) {
      return 'info'
    }
    return 'default'
  }

  // 根据消息类型决定颜色
  const getTypeColor = (msgType: string) => {
    switch (msgType) {
      case 'success':
        return 'emerald-400'
      case 'error':
        return 'red-400'
      case 'warning':
        return 'yellow-400'
      case 'info':
        return 'blue-400'
      default:
        return isActive ? activeColor : inactiveColor
    }
  }

  const detectedType = type || detectMessageType(message || '')
  const dotColor = getTypeColor(detectedType)

  // 获取配置，如果不存在则使用默认的 fuchsia-400
  const config = colorConfig[dotColor] || { className: 'bg-fuchsia-400', rgba: '232, 121, 249' }

  return (
    <div className="flex items-center space-x-2 bg-gray-50 dark:bg-gray-800/40 rounded-xl px-3 sm:px-4 py-1.5 sm:py-2 border border-gray-200 dark:border-white/10 shadow-sm text-xs">
      <motion.div
        className={`w-2 h-2 rounded-full flex-shrink-0 ${config.className}`}
        animate={{
          boxShadow: [
            `0 0 0 0 rgba(${config.rgba}, 0.7)`,
            `0 0 0 4px rgba(${config.rgba}, 0)`,
            `0 0 0 0 rgba(${config.rgba}, 0)`
          ]
        }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
      />
      <div className="text-xs sm:text-sm font-bold text-gray-700 dark:text-gray-300 whitespace-nowrap">
        {displayText}
      </div>
    </div>
  )
}
