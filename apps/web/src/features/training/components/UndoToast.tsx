import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, LoaderCircle, X } from 'lucide-react'
import { Button } from '@/shared/ui/button'

export interface UndoToastProps {
  name: string
  pending: boolean
  onUndo: () => void
  onDismiss: () => void
}

export default function UndoToast({ name, pending, onUndo, onDismiss }: UndoToastProps) {
  const [paused, setPaused] = useState(false)
  const dismissRef = useRef(onDismiss)
  useEffect(() => { dismissRef.current = onDismiss }, [onDismiss])
  useEffect(() => {
    if (paused || pending) return
    const timeout = setTimeout(() => dismissRef.current(), 8000)
    return () => clearTimeout(timeout)
  }, [name, paused, pending])
  return createPortal(<div className="training-undo-toast" role="status" aria-live="polite" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false) }}>
    <Check size={18} aria-hidden="true" /><span className="min-w-0 flex-1">已移除 {name}</span>
    <Button variant="ghost" onClick={onUndo} disabled={pending} aria-busy={pending || undefined}>{pending ? <><LoaderCircle className="animate-spin" aria-hidden="true" />恢复中</> : '撤销'}</Button>
    <Button size="icon" variant="ghost" aria-label="关闭移除提示" disabled={pending} onClick={onDismiss}><X size={17} aria-hidden="true" /></Button>
  </div>, document.body)
}
