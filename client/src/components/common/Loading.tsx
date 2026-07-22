import type { CSSProperties } from 'react'
import { useDashboardFlowLayout } from '../../hooks/useDashboardFlowLayout'
import { Card } from './Card'
import SmoothPanel from './SmoothPanel'
import ActivityIndicator from './ActivityIndicator'

/**
 * 加载动画组件 Props
 */
export interface LoadingProps {
  size?: 'sm' | 'md' | 'lg'
  text?: string
}

/**
 * 骨架屏组件 Props
 */
interface SkeletonProps {
  className?: string
  variant?: 'text' | 'title' | 'circle' | 'rect'
  style?: CSSProperties
}

/**
 * 加载动画组件
 */
export default function Loading({
  size = 'md',
  text,
}: LoadingProps) {
  return (
    <div
      className="app-loading flex flex-col items-center justify-center space-y-3"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <ActivityIndicator size={size} className="app-preloader" />
      
      {text && (
        <p className="text-sm text-secondary">
          {text}
        </p>
      )}
      {!text && <span className="sr-only">加载中</span>}
    </div>
  )
}

/**
 * 骨架屏组件
 */
function Skeleton({ className = '', variant = 'text', style }: SkeletonProps) {
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

function PageHeaderSkeleton() {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4" aria-hidden="true">
      <div className="flex min-w-0 items-center gap-3">
        <Skeleton variant="rect" className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 space-y-2">
          <Skeleton variant="title" className="h-6 w-28" />
          <Skeleton variant="text" className="h-3 w-56 max-w-[58vw]" />
        </div>
      </div>
      <Skeleton variant="rect" className="h-9 w-24 shrink-0 rounded-xl" />
    </div>
  )
}

function PanelSkeleton({
  className = '',
  rows = 4,
}: {
  className?: string
  rows?: number
}) {
  return (
    <div className={`surface-panel min-w-0 overflow-hidden rounded-xl ${className}`} aria-hidden="true">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--app-border)] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Skeleton variant="rect" className="h-8 w-8 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton variant="text" className="h-4 w-24" />
            <Skeleton variant="text" className="h-2.5 w-32" />
          </div>
        </div>
        <Skeleton variant="rect" className="h-8 w-16 rounded-lg" />
      </div>
      <div className="space-y-3 p-4">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="surface-soft flex min-h-14 items-center gap-3 rounded-lg px-3 py-2.5">
            <Skeleton variant="rect" className="h-8 w-8 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton variant="text" className="h-3" style={{ width: `${48 + (index % 3) * 12}%` }} />
              <Skeleton variant="text" className="h-2.5" style={{ width: `${68 + (index % 2) * 14}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function WorkbenchSkeleton({ variant }: { variant: 'combat' | 'roguelike' }) {
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
      <div className="surface-panel min-w-0 overflow-hidden rounded-xl" aria-hidden="true">
        <div className="flex gap-2 border-b border-[var(--app-border)] p-3">
          {[1, 2, 3].slice(0, variant === 'roguelike' ? 2 : 3).map(item => (
            <Skeleton key={item} variant="rect" className="h-9 flex-1 rounded-lg" />
          ))}
        </div>
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton variant="rect" className="h-10 rounded-lg" />
            <Skeleton variant="rect" className="h-10 rounded-lg" />
          </div>
          <Skeleton variant="rect" className="h-28 rounded-lg" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton variant="rect" className="h-20 rounded-lg" />
            <Skeleton variant="rect" className="h-20 rounded-lg" />
          </div>
          <Skeleton variant="rect" className="h-10 w-32 rounded-lg" />
        </div>
      </div>
      <div className="surface-panel min-w-0 overflow-hidden rounded-xl" aria-hidden="true">
        <div className="flex items-center justify-between border-b border-[var(--app-border)] px-4 py-3">
          <Skeleton variant="text" className="h-4 w-28" />
          <Skeleton variant="rect" className="h-8 w-20 rounded-lg" />
        </div>
        <div className="p-3">
          <Skeleton variant="rect" className="aspect-video w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
}

/**
 * Lazy route skeletons keep each workspace close to its final proportions.
 */
export function PageSkeleton({ variant }: { variant: string }) {
  if (variant === 'dashboard') return <DashboardSkeleton />

  return (
    <div
      className={`app-page${variant === 'automation' ? ' ios-workspace-page' : ''}`}
      data-automation-tasks={variant === 'automation' ? true : undefined}
      aria-busy="true"
      aria-label="页面内容加载中"
    >
      <div className="app-stack-section">
        <PageHeaderSkeleton />

        {variant === 'automation' && (
          <div className="automation-workspace-grid">
            <div className="automation-sequence-column">
              <PanelSkeleton className="automation-sequence-panel" rows={5} />
            </div>
            <div className="automation-editor-column">
              <PanelSkeleton className="automation-editor-panel" rows={4} />
            </div>
            <div className="automation-support-column">
              <div className="automation-monitor-column">
                <SmoothPanel
                  className="automation-monitor-panel automation-monitor-skeleton"
                  surfaceClassName="automation-monitor-skeleton-surface"
                  aria-hidden="true"
                >
                  <div className="automation-monitor-skeleton-header">
                    <Skeleton variant="circle" className="h-1.5 w-1.5" />
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
              </div>
              <div className="automation-schedule-column">
                <PanelSkeleton className="automation-schedule-panel" rows={3} />
              </div>
            </div>
          </div>
        )}

        {(variant === 'combat' || variant === 'roguelike') && <WorkbenchSkeleton variant={variant} />}

        {variant === 'training' && (
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
            <div className="min-w-0 space-y-4">
              <div className="grid grid-cols-3 gap-2" aria-hidden="true">
                {[1, 2, 3].map(item => <Skeleton key={item} variant="rect" className="h-16 rounded-xl" />)}
              </div>
              <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
                {[1, 2, 3, 4].map(item => <Skeleton key={item} variant="rect" className="h-28 rounded-xl" />)}
              </div>
            </div>
            <PanelSkeleton rows={4} />
          </div>
        )}

        {variant === 'logs' && (
          <div className="surface-panel min-w-0 overflow-hidden rounded-xl" aria-hidden="true">
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--app-border)] p-3">
              <Skeleton variant="rect" className="h-9 w-32 rounded-lg" />
              <Skeleton variant="rect" className="h-9 w-24 rounded-lg" />
              <Skeleton variant="rect" className="ml-auto h-9 w-20 rounded-lg" />
            </div>
            <div className="space-y-3 p-4 sm:p-5">
              {Array.from({ length: 12 }, (_, index) => (
                <div key={index} className="flex min-w-0 items-center gap-3">
                  <Skeleton variant="text" className="h-3 w-16 shrink-0" />
                  <Skeleton variant="text" className="h-3 min-w-0" style={{ width: `${52 + (index % 4) * 10}%` }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {(variant === 'statistics' || variant === 'config') && (
          <div className="space-y-4">
            <div className="flex gap-2" aria-hidden="true">
              {[1, 2, 3].map(item => <Skeleton key={item} variant="rect" className="h-9 w-24 rounded-lg" />)}
            </div>
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <PanelSkeleton rows={4} />
              <PanelSkeleton rows={4} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DashboardSummarySkeleton({ variant }: { variant: 'status' | 'stages' | 'metric' }) {
  return (
    <Card smoothCorners className={`dashboard-summary-card dashboard-summary-skeleton is-${variant} !p-0`}>
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
    </Card>
  )
}

/**
 * Dashboard skeleton mirrors the live dashboard's structural layout classes.
 */
export function DashboardSkeleton() {
  const { flowGridRef, flowCardRef, flowPreviewRef, flowGridStyle } = useDashboardFlowLayout()

  return (
    <div className="app-page dashboard-page" aria-busy="true" aria-label="控制台加载中">
      <div className="app-stack-section">
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
              <Card smoothCorners className="dashboard-flow-card dashboard-flow-skeleton !p-0">
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
              </Card>
            </div>
          </div>

          <div ref={flowPreviewRef} className="min-w-0">
            <SmoothPanel data-dashboard-preview-card aria-hidden="true">
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
            </SmoothPanel>
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
              <SmoothPanel
                key={item}
                cornerSize="compact"
                className="dashboard-device-card-shell"
                surfaceClassName="dashboard-device-card dashboard-device-skeleton space-y-3"
              >
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
              </SmoothPanel>
            ))}
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <DashboardSummarySkeleton variant="status" />
          <DashboardSummarySkeleton variant="stages" />
          <DashboardSummarySkeleton variant="metric" />
          <DashboardSummarySkeleton variant="metric" />
        </div>

      </div>
    </div>
  )
}
