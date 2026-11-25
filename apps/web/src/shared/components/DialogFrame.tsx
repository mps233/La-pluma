import type { ComponentProps, ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'

const DIALOG_FRAME_SIZES = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  '4xl': 'sm:max-w-4xl',
} as const

export type DialogFrameSize = keyof typeof DIALOG_FRAME_SIZES

export interface DialogFrameProps {
  open: boolean
  onOpenChange?: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  toolbar?: ReactNode
  children: ReactNode
  footer?: ReactNode
  layers?: ReactNode
  size?: DialogFrameSize
  closeDisabled?: boolean
  closeClassName?: string
  disablePointerDismissal?: boolean
  id?: string
  className?: string
}

export function DialogFrame({
  open,
  onOpenChange,
  title,
  description,
  toolbar,
  children,
  footer,
  layers,
  size = 'md',
  closeDisabled = false,
  closeClassName,
  disablePointerDismissal = false,
  id,
  className,
}: DialogFrameProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (nextOpen) {
          onOpenChange?.(true)
          return
        }
        if (closeDisabled) {
          details.cancel()
          return
        }
        onOpenChange?.(false)
      }}
      disablePointerDismissal={disablePointerDismissal}
    >
      <DialogContent
        id={id}
        showCloseButton={false}
        aria-modal="true"
        className={cn(
          'flex max-h-(--layout-dialog-max-height) flex-col gap-0 overflow-hidden p-0',
          DIALOG_FRAME_SIZES[size],
          className,
        )}
      >
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 space-y-1">
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </div>
          <DialogClose
            render={<Button size="icon" variant="ghost" aria-label="关闭对话框" className={closeClassName} disabled={closeDisabled} />}
          >
            <X className="size-4" aria-hidden="true" />
          </DialogClose>
        </DialogHeader>
        {toolbar && (
          <div data-slot="dialog-toolbar" className="shrink-0 border-b border-border px-4 py-3">
            {toolbar}
          </div>
        )}
        {children}
        {footer}
      </DialogContent>
      {layers}
    </Dialog>
  )
}

export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-body"
      className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-3', className)}
      {...props}
    />
  )
}

export interface DialogFrameFooterProps extends ComponentProps<'div'> {
  align?: 'between' | 'end'
}

export function DialogFrameFooter({ align = 'end', className, ...props }: DialogFrameFooterProps) {
  return (
    <DialogFooter
      className={cn(
        'mx-0 mb-0 flex-row flex-wrap items-center gap-3 px-4 py-3',
        align === 'between' ? 'justify-between sm:justify-between' : 'justify-end sm:justify-end',
        className,
      )}
      {...props}
    />
  )
}
