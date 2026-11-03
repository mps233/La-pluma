import { motion, useReducedMotion } from 'framer-motion'
import {
  DEFAULT_RANDOM_OPERATOR_QUOTE,
  loadRandomOperatorQuote,
  type OperatorQuote,
} from '../services/operatorQuotes'
import { useStatusStore } from '../store/statusStore'
import { detectStatusMessageType, getStatusVisualConfig } from '../utils/statusMessage'
import { useEffect, useState } from 'react'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

interface FloatingStatusIndicatorProps {
  className?: string
  textClassName?: string
}

/**
 * 全局悬浮状态指示器
 * "就绪"状态始终显示在原位置
 * 其他状态在原位置可见时显示在原位置，不可见时悬浮到右上角
 */
export default function FloatingStatusIndicator({ className = '', textClassName = '' }: FloatingStatusIndicatorProps) {
  const { message, messageType, isActive, runStatus, backendStatus, backendMessage } = useStatusStore()
  const isOnline = useOnlineStatus()
  const shouldReduceMotion = useReducedMotion()
  const [readyQuote, setReadyQuote] = useState<OperatorQuote>(DEFAULT_RANDOM_OPERATOR_QUOTE)

  useEffect(() => {
    let subscribed = true
    void loadRandomOperatorQuote().then(quote => {
      if (subscribed) setReadyQuote(quote)
    })
    return () => {
      subscribed = false
    }
  }, [])

  // 显示文本：有消息显示消息，运行中显示运行态，否则显示干员台词
  const isBackendChecking = isOnline && (backendStatus === 'unknown' || backendStatus === 'checking')
  const connectionMessage = !isOnline
    ? '网络连接已断开，页面控制暂不可用'
    : isBackendChecking
      ? '正在检查后端服务'
      : backendStatus === 'unavailable'
        ? (backendMessage || '无法连接后端服务，请确认服务已启动')
        : ''
  const hasRunStatus = runStatus.phase !== 'idle'
  const runStatusType = runStatus.phase === 'running'
    ? 'info'
    : runStatus.phase === 'stopping' || runStatus.phase === 'unknown'
      ? 'warning'
      : 'default'
  const displayText = connectionMessage || message || (hasRunStatus
    ? (runStatus.label || '任务执行中')
    : isActive
      ? '任务执行中'
      : `${readyQuote.operator}：${readyQuote.quote}`)
  const isReady = !connectionMessage && !message && !hasRunStatus && !isActive

  const detectedType = isBackendChecking
    ? 'info'
    : connectionMessage
      ? (isOnline ? 'error' : 'warning')
      : messageType ?? (message ? detectStatusMessageType(message) : (hasRunStatus ? runStatusType : (isActive ? 'info' : 'default')))
  const config = getStatusVisualConfig(detectedType)

  const indicatorContent = (
    <div
      className={`floating-status-indicator inline-flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium sm:max-w-sm sm:px-4 sm:py-2 sm:text-sm ${config.className} ${className}`}
    >
      <motion.div
        className="h-2 w-2 flex-shrink-0 rounded-full"
        style={{ backgroundColor: config.dotColor }}
        animate={shouldReduceMotion ? { boxShadow: 'none' } : {
          boxShadow: [
            `0 0 0 0 rgba(${config.pulseRgb}, 0.7)`,
            `0 0 0 4px rgba(${config.pulseRgb}, 0)`,
            `0 0 0 0 rgba(${config.pulseRgb}, 0)`
          ]
        }}
        transition={shouldReduceMotion ? { duration: 0 } : { duration: 2, repeat: Infinity, ease: "easeOut" }}
      />
      <div
        className={`floating-status-text min-w-0 flex-1 truncate leading-5 ${textClassName}`}
        title={displayText}
      >
        {isReady ? (
          <>
            <span>{readyQuote.operator}：</span>
            <span>{readyQuote.quote}</span>
          </>
        ) : (
          displayText
        )}
      </div>
    </div>
  )

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {displayText}
      </span>

      <div className="floating-status-anchor inline-block min-h-[1px] min-w-[1px]">
        {indicatorContent}
      </div>
    </>
  )
}
