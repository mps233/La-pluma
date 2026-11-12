import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

type TooltipSide = 'top' | 'bottom'

interface TooltipProps {
  content: ReactNode
  children: ReactElement
  side?: TooltipSide
  delay?: number
  warmWindow?: number
  longPress?: number
  disabled?: boolean
  className?: string
  triggerClassName?: string
  triggerAs?: 'span' | 'div'
}

const VIEWPORT_GAP = 8
const TRIGGER_GAP = 8
const DEFAULT_DELAY = 400
const DEFAULT_WARM_WINDOW = 400
const DEFAULT_LONG_PRESS = 450
const TOUCH_CANCEL_DISTANCE = 10

let lastClosedAt = 0

/**
 * Lightweight visual tooltip for icon-dense toolbars.
 * The trigger keeps its own aria-label; this component must not be the only
 * source of an accessible name.
 */
export default function Tooltip({
  content,
  children,
  side = 'top',
  delay = DEFAULT_DELAY,
  warmWindow = DEFAULT_WARM_WINDOW,
  longPress = DEFAULT_LONG_PRESS,
  disabled = false,
  className = '',
  triggerClassName = '',
  triggerAs = 'span',
}: TooltipProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const hoverTimerRef = useRef<number | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const pressCleanupRef = useRef<(() => void) | null>(null)
  const suppressClickRef = useRef(false)
  const lastPointerTypeRef = useRef<string | null>(null)
  const hasContent = content !== null && content !== undefined && content !== ''

  const setTriggerRef = useCallback((node: HTMLElement | null) => {
    triggerRef.current = node
  }, [])

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current === null) return
    window.clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = null
  }, [])

  const endPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    pressCleanupRef.current?.()
    pressCleanupRef.current = null
  }, [])

  const close = useCallback(() => {
    clearHoverTimer()
    endPress()
    setOpen(false)
    setPosition(null)
    lastClosedAt = Date.now()
  }, [clearHoverTimer, endPress])

  const show = useCallback(() => {
    if (disabled || !hasContent) return
    clearHoverTimer()
    setOpen(true)
  }, [clearHoverTimer, disabled, hasContent])

  const handlePointerEnter = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch' || disabled || !hasContent || open) return
    clearHoverTimer()
    if (Date.now() - lastClosedAt < warmWindow) {
      show()
      return
    }
    hoverTimerRef.current = window.setTimeout(show, delay)
  }

  const handlePointerLeave = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') return
    clearHoverTimer()
    if (open) close()
  }

  const handleFocus = () => {
    if (lastPointerTypeRef.current === 'touch') return
    show()
  }

  const handleBlur = () => {
    if (open) close()
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    lastPointerTypeRef.current = event.pointerType
    if (event.pointerType !== 'touch' || disabled || !hasContent) return
    endPress()
    const startX = event.clientX
    const startY = event.clientY
    longPressTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = true
      setOpen(true)
      endPress()
    }, longPress)
    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return
      if (Math.abs(moveEvent.clientX - startX) > TOUCH_CANCEL_DISTANCE
        || Math.abs(moveEvent.clientY - startY) > TOUCH_CANCEL_DISTANCE) {
        endPress()
      }
    }
    const handleEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== event.pointerId) return
      endPress()
    }
    pressCleanupRef.current = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleEnd)
      window.removeEventListener('pointercancel', handleEnd)
    }
    window.addEventListener('pointermove', handleMove, { passive: true })
    window.addEventListener('pointerup', handleEnd)
    window.addEventListener('pointercancel', handleEnd)
  }

  const handleClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (triggerRef.current?.contains(event.target as Node)) return
      close()
    }
    const handleViewportChange = () => close()
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('scroll', handleViewportChange, true)
    window.addEventListener('resize', handleViewportChange)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('scroll', handleViewportChange, true)
      window.removeEventListener('resize', handleViewportChange)
    }
  }, [open, close])

  useEffect(() => () => {
    clearHoverTimer()
    endPress()
  }, [clearHoverTimer, endPress])

  useLayoutEffect(() => {
    if (!open) return undefined
    const updatePosition = () => {
      const trigger = triggerRef.current
      const tooltip = tooltipRef.current
      if (!trigger || !tooltip) return
      const triggerRect = trigger.getBoundingClientRect()
      const tooltipRect = tooltip.getBoundingClientRect()
      let top = side === 'bottom'
        ? triggerRect.bottom + TRIGGER_GAP
        : triggerRect.top - tooltipRect.height - TRIGGER_GAP
      if (top < VIEWPORT_GAP) top = triggerRect.bottom + TRIGGER_GAP
      if (top + tooltipRect.height > window.innerHeight - VIEWPORT_GAP) {
        top = Math.max(VIEWPORT_GAP, triggerRect.top - tooltipRect.height - TRIGGER_GAP)
      }
      const centeredLeft = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2
      const left = Math.min(
        Math.max(VIEWPORT_GAP, centeredLeft),
        Math.max(VIEWPORT_GAP, window.innerWidth - tooltipRect.width - VIEWPORT_GAP),
      )
      setPosition({ top, left })
    }
    updatePosition()
  }, [open, side, content])

  const portal = open && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          className={`app-tooltip${position ? ' is-visible' : ''}${className ? ` ${className}` : ''}`}
          style={{
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
            visibility: position ? 'visible' : 'hidden',
          }}
        >
          {content}
        </div>,
        document.body,
      )
    : null

  const Trigger = triggerAs
  const trigger = (
    <Trigger
      ref={setTriggerRef}
      className={`inline-flex${triggerClassName ? ` ${triggerClassName}` : ''}`}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onClickCapture={handleClickCapture}
    >
      {children}
    </Trigger>
  )

  return (
    <>
      {trigger}
      {portal}
    </>
  )
}
