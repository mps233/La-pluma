import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { AlertCircle, X } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import Button, { IconButton } from './Button'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  closeOnOverlay?: boolean
  showClose?: boolean
  dismissible?: boolean
  role?: 'dialog' | 'alertdialog'
  ariaLabel?: string
}

export interface ConfirmDialogProps {
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

const modalStack: string[] = []
const modalLayers = new Map<string, HTMLElement>()
const backgroundState = new Map<HTMLElement, { inert: boolean; ariaHidden: string | null }>()
let scrollLockCount = 0
let previousBodyOverflow = ''

function updateModalStack() {
  const topId = modalStack[modalStack.length - 1]
  modalLayers.forEach((layer, id) => {
    const isTop = id === topId
    layer.inert = !isTop
    if (isTop) layer.removeAttribute('aria-hidden')
    else layer.setAttribute('aria-hidden', 'true')
  })
}

function registerModal(id: string, layer: HTMLElement) {
  modalStack.push(id)
  modalLayers.set(id, layer)
  updateModalStack()
}

function unregisterModal(id: string) {
  const index = modalStack.lastIndexOf(id)
  if (index >= 0) modalStack.splice(index, 1)
  modalLayers.delete(id)
  updateModalStack()
}

function lockBackground() {
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    Array.from(document.body.children).forEach(child => {
      if (!(child instanceof HTMLElement) || child.dataset.appModalLayer === 'true') return
      backgroundState.set(child, {
        inert: child.inert,
        ariaHidden: child.getAttribute('aria-hidden'),
      })
      child.inert = true
      child.setAttribute('aria-hidden', 'true')
    })
  }
  scrollLockCount += 1
}

function unlockBackground() {
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount > 0) return

  document.body.style.overflow = previousBodyOverflow
  backgroundState.forEach((state, element) => {
    element.inert = state.inert
    if (state.ariaHidden === null) element.removeAttribute('aria-hidden')
    else element.setAttribute('aria-hidden', state.ariaHidden)
  })
  backgroundState.clear()
}

function isTopModal(id: string) {
  return modalStack[modalStack.length - 1] === id
}

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
  closeOnOverlay = true,
  showClose = true,
  dismissible = true,
  role = 'dialog',
  ariaLabel,
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

  return (
    <div
      ref={layerRef}
      data-app-modal-layer="true"
      className="app-modal-layer pointer-events-none fixed inset-0 z-[80]"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
        onClick={closeOnOverlay && dismissible ? onClose : undefined}
        className="app-modal-backdrop pointer-events-auto absolute inset-0"
        aria-hidden="true"
      />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 sm:p-6">
        <motion.div
          ref={dialogRef}
          role={role}
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-label={title ? undefined : (ariaLabel || '对话框')}
          aria-describedby={descriptionId}
          tabIndex={-1}
          onKeyDown={handleDialogKeyDown}
          initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 8 }}
          transition={shouldReduceMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}
          className={`surface-panel pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-xl ${sizeStyles[size]}`}
        >
          {(title || showClose) && (
            <div className="flex min-h-14 items-center justify-between gap-4 px-5 py-3 shadow-[inset_0_-1px_0_var(--app-border)] sm:px-6">
              {title
                ? <h2 id={titleId} className="min-w-0 text-base font-semibold text-primary sm:text-lg">{title}</h2>
                : <span />}
              {showClose && (
                <IconButton
                  icon={<X className="h-4 w-4" aria-hidden="true" />}
                  size="sm"
                  variant="ghost"
                  onClick={onClose}
                  disabled={!dismissible}
                  title="关闭对话框"
                  aria-label="关闭对话框"
                />
              )}
            </div>
          )}

          <div id={descriptionId} className="min-h-0 overflow-y-auto px-5 py-4 sm:px-6">
            {children}
          </div>

          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-3 px-5 py-4 shadow-[inset_0_1px_0_var(--app-border)] sm:px-6">
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
            variant={variant}
            onClick={() => void handleConfirm()}
            loading={isPending}
            loadingText="处理中..."
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {message && <div className="text-sm leading-6 text-secondary">{message}</div>}
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
