import {
  DEFAULT_RANDOM_OPERATOR_QUOTE,
  loadRandomOperatorQuote,
  type OperatorQuote,
} from '../services/operatorQuotes'
import { useShallow } from 'zustand/react/shallow'
import { useStatusStore } from '../store/statusStore'
import { detectStatusMessageType, getStatusVisualConfig } from '../utils/statusMessage'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

interface FloatingStatusIndicatorProps {
  className?: string
  textClassName?: string
}

/**
 * 全局悬浮状态指示器
 * "就绪"状态始终显示在原位置
 * 其他状态在原位置可见时显示在原位置，滚出页面可视区后悬浮到右上角
 */
export default function FloatingStatusIndicator({ className = '', textClassName = '' }: FloatingStatusIndicatorProps) {
  const { message, messageType, isActive, runStatus, backendStatus, backendMessage } = useStatusStore(useShallow(state => ({
    message: state.message,
    messageType: state.messageType,
    isActive: state.isActive,
    runStatus: state.runStatus,
    backendStatus: state.backendStatus,
    backendMessage: state.backendMessage,
  })))
  const isOnline = useOnlineStatus()
  const [readyQuote, setReadyQuote] = useState<OperatorQuote>(DEFAULT_RANDOM_OPERATOR_QUOTE)
  const [isDockedOutOfView, setIsDockedOutOfView] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let subscribed = true
    void loadRandomOperatorQuote().then(quote => {
      if (subscribed) setReadyQuote(quote)
    })
    return () => {
      subscribed = false
    }
  }, [])

  // The page header belongs to the scrolling workspace. Keep the pill docked
  // while that slot is visible, then hand it to a fixed copy once the slot
  // leaves the scroll host, so notifications stay reachable without moving the
  // pill's default position.
  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    const scrollHost = anchor.closest<HTMLElement>('.la-pluma-scroll-host')
    const navbar = anchor.closest<HTMLElement>('.la-pluma-page')?.querySelector<HTMLElement>('.la-pluma-navbar')
      ?? document.querySelector<HTMLElement>('.la-pluma-navbar')
    let lastFloating: boolean | null = null

    const measure = () => {
      const rect = anchor.getBoundingClientRect()
      // Wait for the docked pill to leave the scroll host completely. The host
      // masks its top edge, so it stays partially visible under the navbar
      // until its bottom clears the host; floating earlier would show two
      // copies of the same pulsing pill.
      const hostTop = scrollHost?.getBoundingClientRect().top
      const visibleTop = hostTop ?? navbar?.getBoundingClientRect().bottom ?? 0
      // React Activity keeps hidden workspaces mounted with a zero-sized box.
      // Never float a notification from a workspace the user cannot see.
      const next = rect.width > 0 && rect.height > 0 && rect.bottom <= visibleTop + 1
      // Compare against a local marker, not the surviving state: an Activity
      // remount must re-apply a stale `true` back to `false`.
      if (next === lastFloating) return
      lastFloating = next
      setIsDockedOutOfView(next)
    }

    measure()
    const scrollTarget: HTMLElement | Window = scrollHost ?? window
    scrollTarget.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure, { passive: true })
    return () => {
      scrollTarget.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
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
      <div
        className={`floating-status-dot h-2 w-2 shrink-0 rounded-full${isReady ? '' : ' is-pulsing'}`}
        style={{
          backgroundColor: config.dotColor,
          '--status-pulse-rgb': config.pulseRgb,
        } as CSSProperties}
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

      <div ref={anchorRef} className="floating-status-anchor inline-block min-h-[1px] min-w-[1px]">
        {indicatorContent}
      </div>

      {/* The docked copy is off-screen here; the live region above already
          announced the message, so the fixed copy stays hidden from AT. */}
      {!isReady && isDockedOutOfView && (
        <div className="floating-status-overlay" aria-hidden="true">
          {indicatorContent}
        </div>
      )}
    </>
  )
}
