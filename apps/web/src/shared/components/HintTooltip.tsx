import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'

interface HintTooltipProps {
  label: string
  hint: string
  id: string
}

interface TooltipPosition {
  top: number
  left: number
  width: number
  placement: 'top' | 'bottom'
}

const MAX_WIDTH = 288
const GAP = 6
const VIEWPORT_MARGIN = 16
const MIN_SPACE_BELOW = 96

export default function HintTooltip({ label, hint, id }: HintTooltipProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<TooltipPosition | null>(null)

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const margin = Math.min(VIEWPORT_MARGIN, viewportWidth / 2)
    const width = Math.min(MAX_WIDTH, Math.max(0, viewportWidth - margin * 2))
    const left = Math.min(
      Math.max(rect.left, margin),
      Math.max(margin, viewportWidth - margin - width),
    )
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - GAP - margin)
    const spaceAbove = Math.max(0, rect.top - GAP - margin)
    const placement = spaceBelow < MIN_SPACE_BELOW && spaceAbove > spaceBelow ? 'top' : 'bottom'

    setPosition({
      top: placement === 'top' ? rect.top - GAP : rect.bottom + GAP,
      left,
      width,
      placement,
    })
  }, [])

  const show = useCallback(() => {
    updatePosition()
    setOpen(true)
  }, [updatePosition])

  const hide = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="-my-1 inline-flex h-7 w-7 flex-none items-center justify-center rounded-full text-tertiary transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`${label}说明`}
        aria-describedby={id}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={show}
      >
        <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
      </button>
      {/* 面板表面会裁切溢出内容；提示层挂到 body 上才不会被圆角容器截断。 */}
      {createPortal(
        <div
          id={id}
          role="tooltip"
          hidden={!open}
          className="pointer-events-none fixed z-2000 max-h-60 overflow-y-auto rounded-xl px-3 py-2 text-xs leading-5 text-muted-foreground surface-panel"
          style={open && position
            ? {
                top: position.top,
                left: position.left,
                width: position.width,
                transform: position.placement === 'top' ? 'translateY(-100%)' : undefined,
              }
            : undefined}
        >
          {hint}
        </div>,
        document.body,
      )}
    </>
  )
}
