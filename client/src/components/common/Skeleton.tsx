import type { CSSProperties } from 'react'

import SmoothPanel from './SmoothPanel'

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
export function PanelHeadingSkeleton({ className, showIcon = true }: { className: string; showIcon?: boolean }) {
  return (
    <div className={className}>
      <div className="min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          {showIcon && <Skeleton variant="rect" className="h-4 w-4 shrink-0 rounded" />}
          <Skeleton variant="text" className="h-4 w-24" />
        </div>
        <Skeleton variant="text" className="h-2.5 w-36 max-w-full" />
      </div>
      <Skeleton variant="rect" className="h-7 w-12 shrink-0 rounded-full" />
    </div>
  )
}

export function CardHeaderSkeleton({ actionWidth = 'w-20' }: { actionWidth?: string | null }) {
  return (
    <div className="app-card-header" aria-hidden="true">
      <Skeleton variant="text" className="h-4 w-28" />
      {actionWidth && <Skeleton variant="rect" className={`h-9 ${actionWidth} rounded-xl`} />}
    </div>
  )
}

export function MonitorSkeleton({ variant }: { variant: 'automation' | 'combat' | 'roguelike' }) {
  return (
    <SmoothPanel
      className={`${variant}-monitor-panel automation-monitor-skeleton`}
      surfaceClassName={`automation-monitor-surface ${variant}-monitor-surface automation-monitor-skeleton-surface`}
      aria-hidden="true"
    >
      <div className="automation-monitor-skeleton-header">
        <Skeleton variant="circle" className="h-1.5 w-1.5 shrink-0" />
        <Skeleton variant="text" className="h-4 w-24" />
        <Skeleton variant="text" className="ml-auto h-3 w-12" />
      </div>
      <div className="automation-monitor-skeleton-frame aspect-video">
        <Skeleton variant="rect" className="h-full w-full rounded-[inherit]" />
      </div>
      <div className="automation-monitor-skeleton-toolbar">
        {[1, 2, 3, 4, 5].map(item => <Skeleton key={item} variant="circle" className="h-11 w-11" />)}
      </div>
    </SmoothPanel>
  )
}


export function GlassModeSkeleton({ count, className = '' }: { count: number; className?: string }) {
  return (
    <div className={`${className} glass-mode-skeleton`.trim()} aria-hidden="true">
      <div className="glass-mode-skeleton-track">
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className={`glass-mode-skeleton-item${index === 0 ? ' is-selected' : ''}`}>
            <Skeleton variant="circle" className="h-4 w-4" />
            <Skeleton variant="text" className="h-3 w-16 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ModeControlSkeleton({ variant }: { variant: 'combat' | 'roguelike' }) {
  return (
    <GlassModeSkeleton
      count={variant === 'roguelike' ? 2 : 3}
      className={`${variant}-mode-shell`}
    />
  )
}

