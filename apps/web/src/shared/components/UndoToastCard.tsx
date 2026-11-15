import { useEffect, useRef, useState } from 'react'
import { Check, LoaderCircle, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'

export interface UndoToastCardProps {
  message: string
  pending: boolean
  onUndo: () => void
  onDismiss: () => void
  durationMs?: number
}

export function UndoToastCard({
  message,
  pending,
  onUndo,
  onDismiss,
  durationMs = 8000,
}: UndoToastCardProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dismissRef = useRef(onDismiss)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    dismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    if (hovered || focused || pending) return
    const timeout = window.setTimeout(() => dismissRef.current(), durationMs)
    return () => window.clearTimeout(timeout)
  }, [durationMs, focused, hovered, message, pending])

  useEffect(() => {
    const host = rootRef.current?.closest<HTMLElement>('[data-sonner-toast]')
    if (!host) return
    const handlePointerEnter = () => setHovered(true)
    const handlePointerLeave = () => setHovered(false)
    const handleFocusIn = () => setFocused(true)
    const handleFocusOut = (event: FocusEvent) => {
      if (!host.contains(event.relatedTarget as Node | null)) setFocused(false)
    }
    host.addEventListener('mouseenter', handlePointerEnter)
    host.addEventListener('mouseleave', handlePointerLeave)
    host.addEventListener('focusin', handleFocusIn)
    host.addEventListener('focusout', handleFocusOut)
    return () => {
      host.removeEventListener('mouseenter', handlePointerEnter)
      host.removeEventListener('mouseleave', handlePointerLeave)
      host.removeEventListener('focusin', handleFocusIn)
      host.removeEventListener('focusout', handleFocusOut)
    }
  }, [])

  return (
    <div
      ref={rootRef}
      className="mx-auto flex w-max max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10"
    >
      <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <Button
        variant="ghost"
        onClick={onUndo}
        disabled={pending}
        aria-busy={pending || undefined}
        className="min-h-11 shrink-0"
      >
        {pending ? (
          <>
            <LoaderCircle className="animate-spin" aria-hidden="true" />
            恢复中
          </>
        ) : '撤销'}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label="关闭移除提示"
        disabled={pending}
        onClick={onDismiss}
        className="size-11 shrink-0"
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  )
}
