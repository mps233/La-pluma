import { motion } from 'framer-motion'
import {
  detectStatusMessageType,
  getStatusVisualConfig,
  type StatusMessageType,
} from '../../utils/statusMessage'

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
  type?: StatusMessageType
}

/**
 * 状态指示器组件
 * 统一的状态显示样式，包含动画圆点和状态文本
 */
export default function StatusIndicator({
  isActive = false,
  activeText = '运行中',
  inactiveText = '就绪',
  activeColor: _activeColor = 'fuchsia-400',
  inactiveColor: _inactiveColor = 'emerald-400',
  message,
  type,
}: StatusIndicatorProps) {
  void _activeColor
  void _inactiveColor

  const displayText = message || (isActive ? activeText : inactiveText)
  const detectedType = type || (message ? detectStatusMessageType(message) : (isActive ? 'info' : 'default'))
  const config = getStatusVisualConfig(detectedType)

  return (
    <div className={`flex items-center space-x-2 rounded-xl px-3 py-1.5 text-xs sm:px-4 sm:py-2 ${config.className}`}>
      <motion.div
        className="h-2 w-2 flex-shrink-0 rounded-full"
        style={{ backgroundColor: config.dotColor }}
        animate={{
          boxShadow: [
            `0 0 0 0 rgba(${config.pulseRgb}, 0.7)`,
            `0 0 0 4px rgba(${config.pulseRgb}, 0)`,
            `0 0 0 0 rgba(${config.pulseRgb}, 0)`
          ]
        }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
      />
      <div className="whitespace-nowrap text-xs font-bold sm:text-sm">
        {displayText}
      </div>
    </div>
  )
}
