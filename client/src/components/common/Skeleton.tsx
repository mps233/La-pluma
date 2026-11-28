import type { CSSProperties } from 'react'

/**
 * 骨架屏组件 Props
 */
export interface SkeletonProps {
  className?: string
  variant?: 'text' | 'title' | 'circle' | 'rect'
  style?: CSSProperties
}

/**
 * 骨架屏组件
 */
export function Skeleton({ className = '', variant = 'text', style }: SkeletonProps) {
  const variantStyles: Record<string, string> = {
    text: 'h-4 rounded',
    title: 'h-6 rounded',
    circle: 'rounded-full',
    rect: 'rounded-xl',
  }

  return (
    <div
      className={`app-skeleton surface-soft relative overflow-hidden ${variantStyles[variant]} ${className}`}
      style={style}
    >
      <div
        className="app-skeleton-shimmer absolute inset-y-0 left-0 w-[55%]"
        aria-hidden="true"
      />
    </div>
  )
}

export function PageHeaderSkeleton({ dashboard = false }: { dashboard?: boolean }) {
  return (
    <div className="app-page-header is-mobile-inline" aria-hidden="true">
      <div className="app-page-heading">
        <div className="min-w-0 space-y-2">
          <Skeleton variant="title" className="h-8 w-28 max-w-[42vw]" />
          <Skeleton variant="text" className="app-page-subtitle h-4 w-64 max-w-[58vw]" />
        </div>
      </div>
      <div className="app-page-actions">
        {dashboard ? (
          <div className="dashboard-page-actions flex w-full items-center sm:w-auto">
            <div className="dashboard-status-slot min-w-0 flex-1 sm:flex-none">
              <Skeleton variant="rect" className="h-8 w-full rounded-full sm:h-9 sm:w-28" />
            </div>
          </div>
        ) : (
          <Skeleton variant="rect" className="h-8 w-full rounded-full sm:h-9 sm:w-28" />
        )}
      </div>
    </div>
  )
}
