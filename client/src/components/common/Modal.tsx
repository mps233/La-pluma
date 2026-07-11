import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, type ReactNode } from 'react'

/**
 * 模态框组件 Props
 */
interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  closeOnOverlay?: boolean
  showClose?: boolean
}

/**
 * 确认对话框组件 Props
 */
export interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'primary' | 'success'
}

/**
 * 模态框组件
 * 统一的弹窗样式
 */
function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnOverlay = true,
  showClose = true,
}: ModalProps) {
  // 阻止背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])
  
  // ESC 键关闭
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])
  
  const sizeStyles: Record<string, string> = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }
  
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 遮罩层 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeOnOverlay ? onClose : undefined}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
          />
          
          {/* 模态框 */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', duration: 0.3 }}
              className={`surface-panel pointer-events-auto w-full ${sizeStyles[size]} overflow-hidden rounded-3xl`}
            >
              {/* 标题栏 */}
              {(title || showClose) && (
                <div className="flex items-center justify-between px-6 py-4 shadow-[inset_0_-1px_0_var(--app-border)]">
                  <h3 className="text-lg font-bold text-primary">
                    {title}
                  </h3>
                  {showClose && (
                    <button
                      onClick={onClose}
                      className="text-tertiary transition-colors hover:text-primary"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
              
              {/* 内容区域 */}
              <div className="px-6 py-4 max-h-[calc(100vh-200px)] overflow-y-auto">
                {children}
              </div>
              
              {/* 底部操作区域 */}
              {footer && (
                <div className="flex items-center justify-end space-x-3 px-6 py-4 shadow-[inset_0_1px_0_var(--app-border)]">
                  {footer}
                </div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}

/**
 * 确认对话框组件
 */
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
  const variantStyles: Record<string, string> = {
    danger: 'bg-rose-600 hover:bg-rose-700',
    primary: 'brand-action',
    success: 'bg-emerald-600 hover:bg-emerald-700',
  }
  
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button
            onClick={onClose}
            className="control-surface rounded-xl px-4 py-2 text-sm transition-all"
          >
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm()
              onClose()
            }}
            className={`px-4 py-2 text-sm text-white rounded-xl transition-all ${variantStyles[variant]}`}
          >
            {confirmText}
          </button>
        </>
      }
    >
      <p className="text-secondary">
        {message}
      </p>
    </Modal>
  )
}
