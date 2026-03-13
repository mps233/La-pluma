import { motion, AnimatePresence } from 'framer-motion'
import { useStatusStore } from '../store/statusStore'
import { useEffect, useRef, useState, useCallback } from 'react'

interface OperatorQuote {
  operator: string
  quote: string
}

/**
 * 全局悬浮状态指示器
 * "就绪"状态始终显示在原位置
 * 其他状态在原位置可见时显示在原位置，不可见时悬浮到右上角
 */
export default function FloatingStatusIndicator() {
  const { message } = useStatusStore()
  const [shouldFloat, setShouldFloat] = useState(false)
  const [dailyQuote, setDailyQuote] = useState<OperatorQuote>({ operator: '阿米娅', quote: '就绪' })
  const sentinelRef = useRef<HTMLDivElement>(null)

  // 从 API 获取随机台词
  useEffect(() => {
    const fetchRandomQuote = async () => {
      try {
        const response = await fetch('/api/operator-quotes/random')
        if (response.ok) {
          const data = await response.json()
          setDailyQuote(data)
        }
      } catch (error) {
        // 如果获取失败，使用默认值
        setDailyQuote({ operator: '博士', quote: '准备就绪' })
      }
    }
    fetchRandomQuote()
  }, [])

  // 显示文本：有消息显示消息，否则显示干员台词
  const displayText = message || `${dailyQuote.operator}：${dailyQuote.quote}`
  const isReady = !message

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

  // 颜色映射表
  const colorConfig: Record<string, { dot: string; bg: string; text: string; rgba: string }> = {
    'emerald-400': { dot: 'bg-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-300', rgba: '52, 211, 153' },
    'red-400': { dot: 'bg-red-400', bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-300', rgba: '248, 113, 113' },
    'yellow-400': { dot: 'bg-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20', text: 'text-yellow-700 dark:text-yellow-300', rgba: '250, 204, 21' },
    'blue-400': { dot: 'bg-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300', rgba: '96, 165, 250' },
    'teal-400': { dot: 'bg-teal-400', bg: 'bg-teal-50 dark:bg-teal-900/20', text: 'text-teal-700 dark:text-teal-300', rgba: '45, 212, 191' },
  }

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
        return 'teal-400'
    }
  }

  const detectedType = detectMessageType(message)
  const dotColor = getTypeColor(detectedType)
  const config = colorConfig[dotColor] || colorConfig['teal-400']!

  // 使用 key 强制重新渲染以触发动画
  const indicatorKey = `${displayText}-${dotColor}`

  const indicatorContent = (
    <motion.div
      key={indicatorKey}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.2 }}
      className={`flex items-center space-x-2 ${config.bg} rounded-xl px-3 sm:px-4 py-1.5 sm:py-2 border border-gray-200 dark:border-white/10 shadow-sm`}
    >
      <motion.div
        className={`w-2 h-2 rounded-full flex-shrink-0 ${config.dot}`}
        animate={{
          boxShadow: [
            `0 0 0 0 rgba(${config.rgba}, 0.7)`,
            `0 0 0 4px rgba(${config.rgba}, 0)`,
            `0 0 0 0 rgba(${config.rgba}, 0)`
          ]
        }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
      />
      <div className={`text-xs sm:text-sm font-medium ${config.text} whitespace-nowrap`}>
        {isReady ? (
          <>
            <span className="opacity-70">{dailyQuote.operator}：</span>
            <span>{dailyQuote.quote}</span>
          </>
        ) : (
          displayText
        )}
      </div>
    </motion.div>
  )

  return (
    <>
      {/* 哨兵元素 - 始终存在用于检测位置 */}
      <div ref={sentinelRef} className="inline-block min-w-[1px] min-h-[1px]">
        {/* "就绪"状态始终显示，其他状态只在不需要悬浮时显示 */}
        <AnimatePresence mode="wait">
          {(isReady || !shouldFloat) && indicatorContent}
        </AnimatePresence>
      </div>

      {/* 当有消息且原位置滚出视口时，悬浮显示在右上角 */}
      <AnimatePresence>
        {!isReady && shouldFloat && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: 20 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: -20, x: 20 }}
            className="fixed top-[4.5rem] sm:top-[5rem] right-4 z-40"
          >
            {indicatorContent}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
