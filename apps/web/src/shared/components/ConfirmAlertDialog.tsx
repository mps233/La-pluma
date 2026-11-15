import { AlertCircle, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/shared/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'

export interface ConfirmAlertDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void | boolean | Promise<void | boolean>
  title?: string
  message?: ReactNode
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'primary' | 'success'
}

function getConfirmErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '操作失败，请重试'
}

const confirmVariants = {
  danger: 'destructive',
  primary: 'default',
  success: 'default',
} as const

export function ConfirmAlertDialog({
  isOpen,
  onClose,
  onConfirm,
  title = '确认操作',
  message,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'danger',
}: ConfirmAlertDialogProps) {
  const contentId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) setError('')
    else setIsPending(false)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    let closing = false
    const handleOutsideClick = (event: MouseEvent) => {
      if (isPending || closing || !(event.target instanceof Element)) return
      if (event.target.closest('[data-slot="alert-dialog-content"]')?.id === contentId) return
      closing = true
      onClose()
    }

    document.addEventListener('click', handleOutsideClick, true)
    return () => document.removeEventListener('click', handleOutsideClick, true)
  }, [contentId, isOpen, isPending, onClose])

  const handleClose = () => {
    if (!isPending) onClose()
  }

  const handleConfirm = async () => {
    if (isPending) return
    setError('')
    setIsPending(true)
    try {
      const result = await onConfirm()
      if (result !== false) onClose()
    } catch (confirmError) {
      setError(getConfirmErrorMessage(confirmError))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open, details) => {
        if (open) return
        if (isPending) {
          details.cancel()
          return
        }
        onClose()
      }}
    >
      <AlertDialogContent
        id={contentId}
        aria-modal="true"
        initialFocus={() => cancelRef.current ?? true}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {message && <AlertDialogDescription>{message}</AlertDialogDescription>}
        </AlertDialogHeader>
        {error && (
          <div role="alert" className="status-danger flex items-start gap-2 rounded-lg px-3 py-2 text-sm leading-5">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        <AlertDialogFooter>
          <Button ref={cancelRef} variant="secondary" disabled={isPending} onClick={handleClose}>
            {cancelText}
          </Button>
          <AlertDialogAction
            variant={confirmVariants[variant]}
            onClick={() => void handleConfirm()}
            disabled={isPending}
            aria-busy={isPending || undefined}
          >
            {isPending
              ? <><LoaderCircle className="animate-spin" aria-hidden="true" />处理中...</>
              : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
