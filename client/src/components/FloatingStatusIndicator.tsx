import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { API_BASE_URL, fetchWithAuth, parseJsonResponse } from '../services/api'
import { useStatusStore } from '../store/statusStore'
import { detectStatusMessageType, getStatusVisualConfig } from '../utils/statusMessage'
import { useEffect, useRef, useState, useCallback } from 'react'
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

/**
 * 全局悬浮状态指示器
 * "就绪"状态始终显示在原位置
 * 其他状态在原位置可见时显示在原位置，不可见时悬浮到右上角
 */
export default function FloatingStatusIndicator({ className = '', textClassName = '' }: FloatingStatusIndicatorProps) {
  const { message, messageType, isActive, backendStatus, backendMessage, clearMessage } = useStatusStore()
  const isOnline = useOnlineStatus()
  const shouldReduceMotion = useReducedMotion()
  const [shouldFloat, setShouldFloat] = useState(false)
  const [dailyQuote, setDailyQuote] = useState<OperatorQuote>(() => getFallbackReadyQuote())
  const sentinelRef = useRef<HTMLDivElement>(null)

  // 从 API 获取随机台词
  useEffect(() => {
    const fetchRandomQuote = async () => {
      try {
        const response = await fetchWithAuth(`${API_BASE_URL}/operator-quotes/random`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const data = await parseJsonResponse<OperatorQuote>(response)
        if (!data?.operator || !data?.quote) throw new Error('Invalid quote payload')

        setDailyQuote({
          operator: String(data.operator),
          quote: String(data.quote)
        })
      } catch (error) {
        // 如果获取失败，使用本地兜底台词，避免固定停留在同一句文案。
        setDailyQuote(getFallbackReadyQuote())
      }
    }
    fetchRandomQuote()
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

  // 检测哨兵位置
  const checkPosition = useCallback(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const rect = sentinel.getBoundingClientRect()
    const hasSize = rect.width > 0 && rect.height > 0

    // 如果没有尺寸（页面被隐藏），不更新状态
    if (!hasSize) return

    // 检查是否滚出视口上方
    const isAboveViewport = rect.bottom < 0
    setShouldFloat(isAboveViewport)
  }, [])

  // 监听滚动
  useEffect(() => {
    checkPosition()

    window.addEventListener('scroll', checkPosition, { passive: true })
    window.addEventListener('resize', checkPosition, { passive: true })

    return () => {
      window.removeEventListener('scroll', checkPosition)
      window.removeEventListener('resize', checkPosition)
    }
  }, [checkPosition])

  const detectedType = isBackendChecking
    ? 'info'
    : connectionMessage
      ? (isOnline ? 'error' : 'warning')
      : messageType ?? (message ? detectStatusMessageType(message) : (isActive ? 'info' : 'default'))
  const config = getStatusVisualConfig(detectedType)

  const canDismiss = Boolean(message) && !connectionMessage

  const indicatorContent = (
    <div
      className={`inline-flex max-w-full items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium sm:px-4 sm:py-2 sm:text-sm ${config.className} ${className}`}
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
        className={`min-w-0 flex-1 break-words whitespace-normal leading-5 ${textClassName}`}
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
      {canDismiss && (
        <button
          type="button"
          onClick={() => clearMessage()}
          className="floating-status-dismiss -mr-1 inline-flex shrink-0 items-center justify-center rounded-lg opacity-70 transition-colors hover:bg-black/5 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 dark:hover:bg-white/10"
          title="关闭状态提示"
          aria-label="关闭状态提示"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  )

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {displayText}
      </span>

      {/* 哨兵元素 - 始终存在用于检测位置 */}
      <div ref={sentinelRef} className="inline-block min-w-[1px] min-h-[1px]">
        {/* "就绪"状态始终显示，其他状态只在不需要悬浮时显示 */}
        {(isReady || !shouldFloat) && indicatorContent}
      </div>

      {/* 当有消息且原位置滚出视口时，悬浮显示在右上角 */}
      <AnimatePresence>
        {!isReady && shouldFloat && (
          <motion.div
            initial={shouldReduceMotion ? false : { opacity: 0, y: -20, x: 20 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: -20, x: 20 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
            className="floating-status-overlay fixed z-40 max-w-[calc(100vw-2rem)]"
          >
            {indicatorContent}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
