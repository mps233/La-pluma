import { motion, useReducedMotion } from 'framer-motion'
import { API_BASE_URL, fetchWithAuth, parseJsonResponse } from '../services/api'
import { useStatusStore } from '../store/statusStore'
import { detectStatusMessageType, getStatusVisualConfig } from '../utils/statusMessage'
import { useEffect, useState } from 'react'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

interface OperatorQuote {
  operator: string
  quote: string
}

interface FloatingStatusIndicatorProps {
  className?: string
  textClassName?: string
}

const defaultReadyQuote: OperatorQuote = { operator: '博士', quote: '准备就绪' }

const fallbackReadyQuotes: OperatorQuote[] = [
  defaultReadyQuote,
  { operator: '阿米娅', quote: '今天也请多指教' },
  { operator: '凯尔希', quote: '作战记录已归档' },
  { operator: '陈', quote: '任务简报已经确认' },
  { operator: '能天使', quote: '补给检查完成' },
  { operator: '艾雅法拉', quote: '数据采集稳定' },
  { operator: '塞雷娅', quote: '防护流程正常' },
  { operator: '澄闪', quote: '信号稳定，可以开始' }
]

const getFallbackReadyQuote = () =>
  fallbackReadyQuotes[Math.floor(Math.random() * fallbackReadyQuotes.length)] ?? defaultReadyQuote

const sessionFallbackQuote = getFallbackReadyQuote()
let cachedReadyQuote: OperatorQuote | null = null
let readyQuoteRequest: Promise<OperatorQuote> | null = null

const loadReadyQuote = () => {
  if (cachedReadyQuote) return Promise.resolve(cachedReadyQuote)
  if (readyQuoteRequest) return readyQuoteRequest

  readyQuoteRequest = fetchWithAuth(`${API_BASE_URL}/operator-quotes/random`)
    .then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await parseJsonResponse<OperatorQuote>(response)
      if (!data?.operator || !data?.quote) throw new Error('Invalid quote payload')
      return { operator: String(data.operator), quote: String(data.quote) }
    })
    .catch(() => sessionFallbackQuote)
    .then(quote => {
      cachedReadyQuote = quote
      return quote
    })
    .finally(() => {
      readyQuoteRequest = null
    })

  return readyQuoteRequest
}

/**
 * 全局悬浮状态指示器
 * "就绪"状态始终显示在原位置
 * 其他状态在原位置可见时显示在原位置，不可见时悬浮到右上角
 */
export default function FloatingStatusIndicator({ className = '', textClassName = '' }: FloatingStatusIndicatorProps) {
  const { message, messageType, isActive, backendStatus, backendMessage } = useStatusStore()
  const isOnline = useOnlineStatus()
  const shouldReduceMotion = useReducedMotion()
  const [dailyQuote, setDailyQuote] = useState<OperatorQuote>(() => cachedReadyQuote ?? sessionFallbackQuote)

  useEffect(() => {
    let subscribed = true
    void loadReadyQuote().then(quote => {
      if (subscribed) setDailyQuote(quote)
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
  const displayText = connectionMessage || message || (isActive ? '任务执行中' : `${dailyQuote.operator}：${dailyQuote.quote}`)
  const isReady = !connectionMessage && !message && !isActive

  const detectedType = isBackendChecking
    ? 'info'
    : connectionMessage
      ? (isOnline ? 'error' : 'warning')
      : messageType ?? (message ? detectStatusMessageType(message) : (isActive ? 'info' : 'default'))
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
            <span className="opacity-70">{dailyQuote.operator}：</span>
            <span>{dailyQuote.quote}</span>
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
