import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AlertCircle, LoaderCircle, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type UIEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/shared/ui/button'
import {
  isTopModal,
  lockBackground,
  registerModal,
  unregisterModal,
  unlockBackground,
} from './modalLayer'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  placement?: 'center' | 'sheet'
  closeOnOverlay?: boolean
  showClose?: boolean
  dismissible?: boolean
  role?: 'dialog' | 'alertdialog'
  ariaLabel?: string
  dialogId?: string
  /** 观察弹窗正文滚动（内容超出时由正文层滚动），用于滚动加载等场景。 */
  onBodyScroll?: (event: UIEvent<HTMLDivElement>) => void
}

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void | boolean | Promise<void | boolean>
  title?: string
  message?: ReactNode
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'primary' | 'success'
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(element => element.getAttribute('aria-hidden') !== 'true')
}

interface ModalLayerProps extends Omit<ModalProps, 'isOpen'> {
  modalId: string
  titleId: string
  descriptionId: string
}

function ModalLayer({
  modalId,
  titleId,
  descriptionId,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  placement = 'center',
  closeOnOverlay = true,
  showClose = true,
  dismissible = true,
  role = 'dialog',
  ariaLabel,
  dialogId,
  onBodyScroll,
}: ModalLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const dismissibleRef = useRef(dismissible)
  const shouldReduceMotion = useReducedMotion()

  useEffect(() => {
    onCloseRef.current = onClose
    dismissibleRef.current = dismissible
  }, [dismissible, onClose])

  useEffect(() => {
    const layer = layerRef.current
    const dialog = dialogRef.current
    if (!layer || !dialog) return

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    registerModal(modalId, layer)

    const initialFocus = dialog.querySelector<HTMLElement>('[data-autofocus]')
      ?? getFocusableElements(dialog)[0]
      ?? dialog
    initialFocus.focus({ preventScroll: true })
    lockBackground()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal(modalId)) return

      if (event.key === 'Escape' && dismissibleRef.current) {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab') return
      const focusable = getFocusableElements(dialog)
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      unregisterModal(modalId)
      unlockBackground()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [modalId])

  const sizeStyles: Record<NonNullable<ModalProps['size']>, string> = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }

  const handleDialogKeyDown = (event: ReactKeyboardEvent) => {
    event.stopPropagation()
  }

  const isSheet = placement === 'sheet'
  const containerClassName = isSheet
    ? 'pointer-events-none absolute inset-0 flex items-end justify-center'
    : 'pointer-events-none absolute inset-0 flex items-center justify-center p-4 sm:p-6'
  const panelClassName = isSheet
    ? 'surface-panel pointer-events-auto flex max-h-[85dvh] w-full max-w-none flex-col overflow-hidden rounded-t-[1.25rem]'
    : `surface-panel pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-xl ${sizeStyles[size]}`
  const motionProps = shouldReduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : isSheet
      ? {
          initial: { opacity: 0, y: 48 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: 32 },
        }
      : {
          initial: { opacity: 0, scale: 0.97, y: 12, backdropFilter: 'blur(0px) saturate(100%)' },
          animate: { opacity: 1, scale: 1, y: 0, backdropFilter: 'blur(24px) saturate(165%)' },
          exit: { opacity: 0, scale: 0.98, y: 8, backdropFilter: 'blur(0px) saturate(100%)' },
        }
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : isSheet
      ? { duration: 0.22, ease: 'easeOut' as const }
      : { type: 'spring' as const, stiffness: 380, damping: 34, mass: 0.82 }

  return (
    <div
      ref={layerRef}
      data-app-modal-layer="true"
      className="app-modal-layer pointer-events-none fixed inset-0 z-80"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.22, ease: 'easeOut' }}
        onClick={closeOnOverlay && dismissible ? onClose : undefined}
        className="app-modal-backdrop pointer-events-auto absolute inset-0"
        aria-hidden="true"
      />

      <div className={containerClassName}>
        <motion.div
          ref={dialogRef}
          id={dialogId}
          data-modal-placement={placement}
          role={role}
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-label={title ? undefined : (ariaLabel || '对话框')}
          aria-describedby={descriptionId}
          tabIndex={-1}
          onKeyDown={handleDialogKeyDown}
          {...motionProps}
          transition={transition}
          className={panelClassName}
          style={isSheet ? { paddingBottom: 'env(safe-area-inset-bottom)' } : undefined}
        >
          {(title || showClose) && (
            <div className="flex min-h-14 items-center justify-between gap-3.5 px-5 py-3 shadow-[inset_0_-1px_0_var(--border)] sm:px-6">
              {title
                ? <h2 id={titleId} className="min-w-0 text-base font-semibold text-foreground sm:text-lg">{title}</h2>
                : <span />}
              {showClose && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onClose}
                  disabled={!dismissible}
                  title="关闭对话框"
                  aria-label="关闭对话框"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          )}

          <div
            id={descriptionId}
            className="min-h-0 overflow-y-auto px-5 py-4 sm:px-6"
            onScroll={onBodyScroll}
          >
            {children}
          </div>

          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-3.5 px-5 py-4 shadow-[inset_0_1px_0_var(--border)] sm:px-6">
              {footer}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}

export function Modal({ isOpen, ...props }: ModalProps) {
  const generatedId = useId().replace(/:/g, '')
  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <ModalLayer
          key={generatedId}
          modalId={`modal-${generatedId}`}
          titleId={`modal-title-${generatedId}`}
          descriptionId={`modal-description-${generatedId}`}
          {...props}
        />
      )}
    </AnimatePresence>,
    document.body,
  )
}

function getConfirmErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '操作失败，请重试'
}

const confirmVariants = {
  danger: 'destructive',
  primary: 'default',
  success: 'default',
} as const

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title = '确认操作',
  message,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'danger',
}: ConfirmDialogProps) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) setError('')
    else setIsPending(false)
  }, [isOpen])

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
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      role="alertdialog"
      size="sm"
      dismissible={!isPending}
      closeOnOverlay={!isPending}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={handleClose}
            disabled={isPending}
            data-autofocus
          >
            {cancelText}
          </Button>
          <Button
            variant={confirmVariants[variant]}
            onClick={() => void handleConfirm()}
            disabled={isPending}
            aria-busy={isPending || undefined}
          >
            {isPending
              ? <><LoaderCircle className="animate-spin" aria-hidden="true" />处理中...</>
              : confirmText}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {message && <div className="text-sm leading-6 text-muted-foreground">{message}</div>}
        {error && (
          <div role="alert" className="status-danger flex items-start gap-2 rounded-lg px-3 py-2 text-sm leading-5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}
