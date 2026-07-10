import type { CSSProperties } from 'react'
import { useDashboardFlowLayout } from '../../hooks/useDashboardFlowLayout'

/**
 * 加载动画组件 Props
 */
export interface LoadingProps {
  size?: 'sm' | 'md' | 'lg'
  color?: 'violet' | 'emerald' | 'cyan' | 'orange' | 'fuchsia'
  text?: string
}

/**
 * 全屏加载组件 Props
 */
export interface FullScreenLoadingProps {
  text?: string
}

/**
 * 骨架屏组件 Props
 */
export interface SkeletonProps {
  className?: string
  variant?: 'text' | 'title' | 'circle' | 'rect'
  style?: CSSProperties
}

/**
 * 加载动画组件
 */
export default function Loading({
  size = 'md',
  color = 'violet',
  text,
}: LoadingProps) {
  const sizeStyles: Record<string, string> = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  }
  
  const colorStyles: Record<string, string> = {
    violet: 'brand-text',
    emerald: 'brand-text',
    cyan: 'brand-text',
    orange: 'brand-text',
    fuchsia: 'brand-text',
  }
  
  return (
    <div className="flex flex-col items-center justify-center space-y-3">
      <svg
        className={`${sizeStyles[size]} ${colorStyles[color]} animate-spin`}
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        ></circle>
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
      
      {text && (
        <p className="text-sm text-secondary">
          {text}
        </p>
      )}
    </div>
  )
}

/**
 * 全屏加载组件
 */
export function FullScreenLoading({ text = '加载中...' }: FullScreenLoadingProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm dark:bg-black/80">
      <Loading size="lg" text={text} />
    </div>
  )
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
      className={`surface-soft relative overflow-hidden ${variantStyles[variant]} ${className}`}
      style={style}
    >
      {/* Shimmer effect */}
      <div
        className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent"
      />
    </div>
  )
}

/**
 * 卡片骨架屏
 */
export function CardSkeleton() {
  return (
    <div className="app-card app-stack-card surface-panel">
      <Skeleton variant="title" className="w-1/3" />
      <Skeleton variant="text" className="w-full" />
      <Skeleton variant="text" className="w-2/3" />
      <Skeleton variant="rect" className="w-full h-32" />
    </div>
  )
}

function DashboardSummarySkeleton({ variant }: { variant: 'status' | 'stages' | 'metric' }) {
  return (
    <div className={`app-card surface-panel dashboard-summary-card dashboard-summary-skeleton is-${variant} !p-0`} aria-hidden="true">
      <div className="dashboard-summary-header">
        <div className="dashboard-summary-heading">
          <Skeleton variant="rect" className="h-8 w-8 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton variant="text" className="h-4 w-24" />
            <Skeleton variant="text" className="h-2.5 w-36" />
          </div>
        </div>
        <Skeleton variant="rect" className="h-7 w-12 rounded-lg" />
      </div>

      {variant === 'status' && (
        <div className="dashboard-status-grid">
          {[1, 2].map(item => (
            <div key={item} className="dashboard-status-block space-y-2.5">
              <Skeleton variant="text" className="h-2.5 w-16" />
              <Skeleton variant="title" className="h-5 w-24" />
              <Skeleton variant="text" className="h-2.5 w-32 max-w-full" />
            </div>
          ))}
        </div>
      )}

      {variant === 'stages' && (
        <div className="dashboard-stage-groups">
          {[1, 2].map(group => (
            <div key={group} className="dashboard-stage-group">
              <div className="dashboard-stage-group-heading">
                <Skeleton variant="text" className="h-2.5 w-14" />
                <Skeleton variant="text" className="h-2.5 w-4" />
              </div>
                <div className="dashboard-stage-list">
                  {[20, 24, 28, 22].map((width, index) => (
                  <Skeleton key={index} variant="rect" className="h-6 rounded-lg" style={{ width: `${width / 4}rem` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {variant === 'metric' && (
        <div className="dashboard-summary-body">
          <div className="dashboard-summary-statline">
            <Skeleton variant="title" className="h-10 w-10" />
            <div className="space-y-2">
              <Skeleton variant="text" className="h-4 w-24" />
              <Skeleton variant="text" className="h-2.5 w-48 max-w-full" />
            </div>
          </div>
          <div className="dashboard-summary-footer">
            <Skeleton variant="text" className="h-3 w-28" />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Dashboard skeleton mirrors the live dashboard's structural layout classes.
 */
export function DashboardSkeleton() {
  const { flowGridRef, flowCardRef, flowPreviewRef, flowGridStyle } = useDashboardFlowLayout()

  return (
    <div className="app-page" aria-busy="true" aria-label="控制台加载中">
      <div className="mx-auto max-w-7xl app-stack-section">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton variant="rect" className="h-11 w-11 shrink-0 rounded-xl" />
            <div className="space-y-2">
              <Skeleton variant="title" className="h-6 w-24" />
              <Skeleton variant="text" className="h-3 w-48 max-w-[55vw]" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Skeleton variant="rect" className="hidden h-9 w-40 rounded-xl sm:block" />
            <Skeleton variant="rect" className="h-9 w-10 rounded-xl sm:w-24" />
          </div>
        </div>

        <div ref={flowGridRef} className="dashboard-flow-layout" style={flowGridStyle}>
          <div ref={flowCardRef} className="min-w-0">
            <div className="dashboard-flow-glow-shell">
              <div className="app-card surface-panel dashboard-flow-card dashboard-flow-skeleton !p-0" aria-hidden="true">
                <div className="dashboard-flow-header">
                  <div className="flex items-center gap-3">
                    <Skeleton variant="rect" className="h-8 w-8 rounded-lg" />
                    <div className="space-y-1.5">
                      <Skeleton variant="text" className="h-2.5 w-24" />
                      <Skeleton variant="title" className="h-4 w-20" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Skeleton variant="rect" className="ml-auto h-5 w-12 rounded-full" />
                    <Skeleton variant="text" className="h-2 w-14" />
                  </div>
                </div>

                <div className="dashboard-flow-command">
                  <div className="flex min-w-0 items-center gap-3.5">
                    <Skeleton variant="rect" className="h-11 w-11 shrink-0 rounded-xl" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton variant="text" className="h-2.5 w-16" />
                      <Skeleton variant="title" className="h-6 w-36 max-w-full" />
                      <Skeleton variant="text" className="h-2.5 w-52 max-w-full" />
                    </div>
                  </div>
                  <Skeleton variant="rect" className="dashboard-flow-primary-action h-9 rounded-xl" />
                </div>

                <div className="dashboard-flow-metrics">
                  {[1, 2, 3].map(item => (
                    <div key={item} className="dashboard-flow-metric space-y-2">
                      <Skeleton variant="text" className="h-2.5 w-16 max-w-full" />
                      <Skeleton variant="text" className="h-4 w-20 max-w-full" />
                      <Skeleton variant="text" className="h-2 w-24 max-w-full" />
                    </div>
                  ))}
                </div>

                <div className="dashboard-flow-stages">
                  <div className="flex items-center justify-between gap-4">
                    <Skeleton variant="text" className="h-3 w-24" />
                    <Skeleton variant="text" className="h-2.5 w-16" />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[20, 24, 28, 20, 16].map((width, index) => (
                      <Skeleton key={index} variant="rect" className="h-6 rounded-lg" style={{ width: `${width / 4}rem` }} />
                    ))}
                  </div>
                </div>

                <div className="dashboard-flow-shortcuts">
                  {[1, 2, 3].map(item => (
                    <div key={item} className="dashboard-flow-shortcut pointer-events-none">
                      <Skeleton variant="rect" className="h-7 w-7 rounded-lg" />
                      <Skeleton variant="text" className="h-3 w-10" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div ref={flowPreviewRef} className="min-w-0">
            <div data-dashboard-preview-card className="overflow-hidden rounded-2xl surface-panel" aria-hidden="true">
              <div className="dashboard-preview-header flex items-center justify-between gap-3 border-b border-[var(--app-border)] px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Skeleton variant="circle" className="h-1.5 w-1.5" />
                  <Skeleton variant="text" className="h-3 w-28" />
                </div>
                <Skeleton variant="text" className="h-3 w-16" />
              </div>
              <div data-dashboard-preview-frame className="relative aspect-video overflow-hidden bg-black">
                <Skeleton variant="rect" className="absolute inset-[12%] h-auto w-auto rounded-xl opacity-60" />
              </div>
            </div>
          </div>
        </div>

        <div className="dashboard-device-section" aria-hidden="true">
          <div className="flex items-center gap-2">
            <div className="h-0.5 flex-1 rounded-full bg-[var(--app-border)]" />
            <Skeleton variant="text" className="h-3 w-16" />
            <div className="h-0.5 flex-1 rounded-full bg-[var(--app-border)]" />
          </div>
          <div className="dashboard-device-grid">
            {[1, 2, 3, 4].map(item => (
              <div key={item} className="dashboard-device-card dashboard-device-skeleton surface-panel space-y-3">
                <div className="flex items-center gap-2.5">
                  <Skeleton variant="rect" className="h-8 w-8 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton variant="text" className="h-3 w-12" />
                    <Skeleton variant="text" className="h-2.5 w-20" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <Skeleton variant="text" className="h-2.5 w-10" />
                    <Skeleton variant="text" className="h-2.5 w-8" />
                  </div>
                  <Skeleton variant="rect" className="h-1.5 w-full rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <DashboardSummarySkeleton variant="status" />
          <DashboardSummarySkeleton variant="stages" />
          <DashboardSummarySkeleton variant="metric" />
          <DashboardSummarySkeleton variant="metric" />
        </div>

        <div className="app-card surface-panel" aria-hidden="true">
          <div className="flex items-center gap-3 border-b border-[var(--app-border)] pb-4">
            <Skeleton variant="rect" className="h-8 w-8 rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton variant="title" className="h-4 w-24" />
              <Skeleton variant="text" className="h-2.5 w-40" />
            </div>
          </div>
          <div className="grid gap-4 pt-4 sm:grid-cols-3">
            <Skeleton variant="rect" className="h-16 rounded-xl" />
            <Skeleton variant="rect" className="h-16 rounded-xl" />
            <Skeleton variant="rect" className="h-16 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  )
}
