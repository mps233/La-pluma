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

function PageHeaderSkeleton({ dashboard = false }: { dashboard?: boolean }) {
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

function PanelHeadingSkeleton({ className, showIcon = true }: { className: string; showIcon?: boolean }) {
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

function CardHeaderSkeleton({ actionWidth = 'w-20' }: { actionWidth?: string | null }) {
  return (
    <div className="app-card-header" aria-hidden="true">
      <Skeleton variant="text" className="h-4 w-28" />
      {actionWidth && <Skeleton variant="rect" className={`h-9 ${actionWidth} rounded-xl`} />}
    </div>
  )
}

function MonitorSkeleton({ variant }: { variant: 'automation' | 'combat' | 'roguelike' }) {
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

function AutomationSequenceSkeleton() {
  return (
    <SmoothPanel
      className="automation-sequence-panel automation-sequence-skeleton"
      surfaceClassName="automation-sequence-surface"
      aria-hidden="true"
    >
      <PanelHeadingSkeleton className="automation-flow-header" />
      <div className="automation-sequence-list">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="automation-sequence-item pointer-events-none">
            <Skeleton variant="rect" className="h-4 w-3 justify-self-center rounded" />
            <div className="flex min-w-0 items-center gap-2 px-1">
              <Skeleton variant="circle" className="h-6 w-6 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton variant="text" className="h-3" style={{ width: `${48 + (index % 3) * 10}%` }} />
                <Skeleton variant="text" className="h-2.5" style={{ width: `${66 + (index % 2) * 12}%` }} />
              </div>
            </div>
            <Skeleton variant="rect" className="h-5 w-9 justify-self-center rounded-full" />
            <Skeleton variant="circle" className="h-8 w-8 justify-self-center" />
          </div>
        ))}
      </div>
      <div className="automation-sequence-footer">
        <Skeleton variant="rect" className="h-11 w-full rounded-xl" />
        <Skeleton variant="rect" className="h-11 w-full rounded-xl" />
      </div>
    </SmoothPanel>
  )
}

function AutomationEditorSkeleton() {
  return (
    <SmoothPanel className="automation-editor-panel automation-editor-skeleton" aria-hidden="true">
      <PanelHeadingSkeleton className="automation-editor-heading" />
      <div className="automation-editor-content">
        <div className="automation-task-editor space-y-4">
          <div className="automation-flow-card-header flex-wrap">
            <div className="automation-flow-card-identity min-w-0">
              <Skeleton variant="circle" className="h-7 w-7 shrink-0" />
              <Skeleton variant="rect" className="h-8 w-8 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton variant="text" className="h-3 w-28" />
                <Skeleton variant="text" className="h-2.5 w-20" />
              </div>
            </div>
            <div className="automation-flow-card-controls">
              <Skeleton variant="rect" className="h-7 w-12 rounded-full" />
              <Skeleton variant="circle" className="h-11 w-11" />
            </div>
          </div>
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="space-y-2">
              <Skeleton variant="text" className="h-2.5 w-20" />
              <Skeleton variant="rect" className="h-11 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </SmoothPanel>
  )
}

function AutomationScheduleSkeleton() {
  return (
    <SmoothPanel className="automation-schedule-panel automation-schedule-skeleton" aria-hidden="true">
      <PanelHeadingSkeleton className="automation-schedule-heading" />
      <div className="automation-schedule-empty">
        <Skeleton variant="text" className="h-4 w-28" />
        <Skeleton variant="text" className="h-2.5 w-44 max-w-full" />
      </div>
      <div className="automation-notification-panel">
        <div className="automation-notification-heading">
          <div className="space-y-2">
            <Skeleton variant="text" className="h-3.5 w-20" />
            <Skeleton variant="text" className="h-2.5 w-32" />
          </div>
          <Skeleton variant="rect" className="h-7 w-12 rounded-full" />
        </div>
        <div className="automation-notification-channel">
          <div className="automation-notification-channel-heading">
            <div className="space-y-2">
              <Skeleton variant="text" className="h-3.5 w-24" />
              <Skeleton variant="text" className="h-2.5 w-36" />
            </div>
            <Skeleton variant="rect" className="h-7 w-12 rounded-full" />
          </div>
        </div>
      </div>
    </SmoothPanel>
  )
}

function AutomationSkeleton() {
  return (
    <div className="automation-workspace-grid" aria-hidden="true">
      <div className="automation-sequence-column"><AutomationSequenceSkeleton /></div>
      <div className="automation-editor-column"><AutomationEditorSkeleton /></div>
      <div className="automation-support-column">
        <div className="automation-monitor-column"><MonitorSkeleton variant="automation" /></div>
        <div className="automation-schedule-column"><AutomationScheduleSkeleton /></div>
      </div>
    </div>
  )
}

function ModeControlSkeleton({ variant }: { variant: 'combat' | 'roguelike' }) {
  const modeCount = variant === 'roguelike' ? 2 : 3
  return (
    <div className={`app-workspace-segments app-liquid-tab-pill ${variant}-mode-shell`} aria-hidden="true">
      <div className={`app-workspace-segment-list${variant === 'roguelike' ? ' roguelike-mode-tabs' : ''}`}>
        <div className={`app-workspace-segment-indicator ${variant}-mode-skeleton-highlight`} />
        {Array.from({ length: modeCount }, (_, index) => (
          <div key={index} className={`app-workspace-segment ${variant}-mode-button min-h-11`}>
            <span className={`app-workspace-segment-icon ${variant}-mode-icon`}>
              <Skeleton variant="circle" className="h-5 w-5" />
            </span>
            <span className="app-workspace-segment-copy min-w-0">
              <Skeleton variant="text" className="h-3 w-16 max-w-full" />
              <Skeleton variant="text" className="h-2 w-24 max-w-full" />
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CombatSkeleton() {
  return (
    <div className="task-monitor-layout workbench-skeleton" aria-hidden="true">
      <div className="task-monitor-main">
        <ModeControlSkeleton variant="combat" />
        <div className="app-stack-section">
          <Card smoothCorners className="combat-task-card combat-task-skeleton !p-0">
            <div className="combat-task-heading flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <Skeleton variant="rect" className="h-10 w-10 shrink-0 rounded-xl" />
                <div className="min-w-0 space-y-2">
                  <Skeleton variant="text" className="h-4 w-32 max-w-full" />
                  <Skeleton variant="text" className="h-2.5 w-64 max-w-full" />
                </div>
              </div>
              <Skeleton variant="rect" className="combat-task-run-button h-11 w-28 shrink-0 rounded-xl" />
            </div>
            <div className="combat-copilot-layout">
              <div className="space-y-3 xl:sticky xl:top-24">
                <div className="combat-workspace-section space-y-3">
                  <Skeleton variant="text" className="h-3.5 w-24" />
                  {[1, 2, 3, 4].map(item => <Skeleton key={item} variant="rect" className="h-11 rounded-xl" />)}
                </div>
              </div>
              <div className="space-y-3">
                <div className="combat-workspace-section space-y-3">
                  <Skeleton variant="text" className="h-3.5 w-20" />
                  <Skeleton variant="rect" className="h-11 rounded-xl" />
                </div>
                <div className="combat-workspace-section combat-job-list-section space-y-3">
                  <Skeleton variant="text" className="h-3.5 w-24" />
                  {[1, 2, 3].map(item => <Skeleton key={item} variant="rect" className="h-14 rounded-xl" />)}
                </div>
              </div>
              <div className="space-y-3">
                <div className="combat-workspace-section space-y-3">
                  <Skeleton variant="text" className="h-3.5 w-20" />
                  <Skeleton variant="rect" className="h-11 rounded-xl" />
                </div>
                <div className="combat-workspace-section space-y-3">
                  <Skeleton variant="text" className="h-3.5 w-28" />
                  <Skeleton variant="text" className="h-3 w-full" />
                  <Skeleton variant="text" className="h-3 w-4/5" />
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
      <div className="task-monitor-column"><MonitorSkeleton variant="combat" /></div>
    </div>
  )
}

function RoguelikeSkeleton() {
  return (
    <div className="roguelike-workspace-grid workbench-skeleton" aria-hidden="true">
      <div className="roguelike-mode-area"><ModeControlSkeleton variant="roguelike" /></div>
      <SmoothPanel className="roguelike-panel roguelike-theme-panel">
        <PanelHeadingSkeleton className="roguelike-panel-heading" showIcon={false} />
        <div className="roguelike-panel-body">
          <div className="roguelike-theme-grid">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="roguelike-theme-option">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton variant="text" className="h-3 w-20 max-w-full" />
                  <Skeleton variant="text" className="h-2 w-14 max-w-full" />
                </div>
              </div>
            ))}
          </div>
          <div className="roguelike-custom-theme mt-4 space-y-2">
            <Skeleton variant="text" className="h-2.5 w-24" />
            <Skeleton variant="rect" className="h-10 rounded-xl" />
          </div>
        </div>
      </SmoothPanel>
      <SmoothPanel className="roguelike-panel roguelike-settings-panel">
        <PanelHeadingSkeleton className="roguelike-panel-heading" showIcon={false} />
        <div className="roguelike-panel-body roguelike-settings-body">
          <div className="roguelike-field-grid">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton variant="text" className="h-2.5 w-20" />
                <Skeleton variant="rect" className="h-10 rounded-xl" />
              </div>
            ))}
          </div>
          <div className="roguelike-toggle-list">
            {[1, 2].map(item => (
              <div key={item} className="roguelike-toggle-row">
                <div className="space-y-1.5">
                  <Skeleton variant="text" className="h-3 w-24" />
                  <Skeleton variant="text" className="h-2 w-32" />
                </div>
                <Skeleton variant="rect" className="h-7 w-12 rounded-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="roguelike-panel-footer">
          <Skeleton variant="rect" className="roguelike-run-button h-11 rounded-xl" />
        </div>
      </SmoothPanel>
      <aside className="roguelike-monitor-column"><MonitorSkeleton variant="roguelike" /></aside>
    </div>
  )
}

function TrainingSkeleton() {
  return (
    <div className="grid grid-cols-1 items-start gap-[var(--app-space-section)] xl:grid-cols-[minmax(0,1fr)_minmax(22rem,27rem)]" aria-hidden="true">
      <section className="order-1 min-w-0 space-y-4 training-operator-column">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Skeleton variant="title" className="h-5 w-24" />
            <Skeleton variant="text" className="h-3 w-36" />
          </div>
          <Skeleton variant="rect" className="h-7 w-44 rounded-full" />
        </div>
        <div className="space-y-4">
          <div className="app-workspace-segments app-liquid-tab-pill training-status-shell">
            <div className="app-workspace-segment-list grid-cols-3">
              <div className="app-workspace-segment-indicator training-status-skeleton-highlight" />
              {[1, 2, 3].map(item => (
                <div key={item} className="app-workspace-segment training-status-segment">
                  <span className="app-workspace-segment-icon training-status-count">
                    <Skeleton variant="text" className="h-3 w-4" />
                  </span>
                  <span className="app-workspace-segment-copy space-y-1.5">
                    <Skeleton variant="text" className="h-3 w-14 max-w-full" />
                    <Skeleton variant="text" className="h-2 w-16 max-w-full" />
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
            <Skeleton variant="rect" className="col-span-2 h-11 min-w-0 rounded-xl sm:col-span-1" />
            <Skeleton variant="rect" className="h-11 w-full rounded-xl" />
            <Skeleton variant="rect" className="h-11 w-24 rounded-xl" />
          </div>
          <div className="min-h-[260px]">
            <div className="training-operator-grid grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-5 xl:grid-cols-4 2xl:grid-cols-6">
              {Array.from({ length: 12 }, (_, index) => (
                <div key={index} className="training-operator-skeleton relative overflow-hidden rounded-xl p-2.5 surface-soft">
                  <Skeleton variant="rect" className="mb-2.5 aspect-square h-auto w-full rounded-xl" />
                  <div className="space-y-2">
                    <Skeleton variant="text" className="mx-auto h-3 w-16 max-w-full" />
                    <Skeleton variant="rect" className="mx-auto h-5 w-12 rounded-full" />
                    <Skeleton variant="rect" className="h-9 w-full rounded-xl" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <aside className="order-2 min-w-0 space-y-4 xl:sticky xl:top-4 training-support-column">
        <SmoothPanel cornerSize="compact" className="training-settings-panel">
          <div className="px-4 py-3">
            <div className="flex min-h-11 items-center">
              <Skeleton variant="text" className="h-4 w-24" />
            </div>
            <div className="mt-2 divide-y divide-[var(--app-border)]">
              {[1, 2].map(item => (
                <div
                  key={item}
                  className="training-settings-skeleton-row flex min-h-14 items-center justify-between gap-4 py-2.5"
                >
                  <div className="space-y-1.5">
                    <Skeleton variant="text" className="h-3.5 w-20" />
                    <Skeleton variant="text" className="h-2.5 w-36 max-w-full" />
                  </div>
                  <Skeleton variant="rect" className="h-7 w-12 shrink-0 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </SmoothPanel>
        <Card smoothCorners className="training-queue-card !p-0">
          <CardHeaderSkeleton actionWidth="w-16" />
          <div className="divide-y divide-[var(--app-border)] px-4">
            {[1, 2, 3].map(item => (
              <div key={item} className="flex min-h-16 items-center gap-3 py-3">
                <Skeleton variant="rect" className="h-8 w-8 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton variant="text" className="h-3 w-24" />
                  <Skeleton variant="rect" className="h-1.5 w-full rounded-full" />
                </div>
                <Skeleton variant="text" className="h-3 w-8" />
              </div>
            ))}
          </div>
        </Card>
        <SmoothPanel className="training-plan-empty" surfaceClassName="px-6 py-8 text-center">
          <Skeleton variant="rect" className="mx-auto h-12 w-12 rounded-2xl" />
          <Skeleton variant="title" className="mx-auto mt-4 h-5 w-36" />
          <Skeleton variant="text" className="mx-auto mt-3 h-3 w-64 max-w-full" />
          <Skeleton variant="text" className="mx-auto mt-2 h-3 w-48 max-w-full" />
        </SmoothPanel>
      </aside>
    </div>
  )
}

function LogsSkeleton() {
  return (
    <>
      <div className="app-workspace-segments app-liquid-tab-pill log-mode-shell" aria-hidden="true">
        <div className="app-workspace-segment-list log-mode-tabs">
          <div className="app-workspace-segment-indicator log-mode-skeleton-highlight" />
          {[1, 2].map(item => (
            <div key={item} className="app-workspace-segment log-mode-button min-h-11">
              <span className="app-workspace-segment-icon log-mode-icon">
                <Skeleton variant="circle" className="h-5 w-5" />
              </span>
              <span className="app-workspace-segment-copy gap-1">
                <Skeleton variant="text" className="h-3 w-12 max-w-full" />
                <Skeleton variant="text" className="h-2.5 w-20 max-w-full" />
              </span>
            </div>
          ))}
        </div>
      </div>
      <Card smoothCorners className="log-card log-toolbar-card !p-0">
        <div className="app-card-content log-toolbar">
          <div className="log-toolbar-controls">
            {[1, 2].map(item => (
              <div key={item} className="flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-xl px-3 surface-soft">
                <Skeleton variant="text" className="h-3 w-14" />
                <Skeleton variant="rect" className="h-5 w-8 rounded-full" />
              </div>
            ))}
            <Skeleton variant="rect" className="col-span-2 h-11 w-full rounded-xl sm:col-auto sm:w-36" />
            <Skeleton variant="rect" className="col-span-2 h-11 w-full rounded-xl sm:col-auto sm:min-w-56 sm:flex-1" />
          </div>
          <div className="log-toolbar-actions">
            <Skeleton variant="rect" className="h-10 w-20 rounded-xl" />
            <Skeleton variant="rect" className="h-10 w-20 rounded-xl" />
          </div>
        </div>
      </Card>
      <Card smoothCorners className="log-card !p-0">
        <CardHeaderSkeleton actionWidth="w-14" />
        <div className="app-card-content log-console-content">
          <div className="log-console">
            {Array.from({ length: 10 }, (_, index) => (
              <div key={index} className="log-row">
                <div className="log-row-meta">
                  <Skeleton variant="text" className="h-3 w-full" />
                  <Skeleton variant="rect" className="h-5 w-full rounded" />
                </div>
                <Skeleton variant="text" className="mt-1 h-3" style={{ width: `${58 + (index % 4) * 9}%` }} />
              </div>
            ))}
          </div>
        </div>
      </Card>
      <Card smoothCorners className="log-card log-history-card !p-0">
        <CardHeaderSkeleton actionWidth="w-28" />
        <div className="app-card-content log-history-content">
          <div className="log-history-list">
            {[1, 2, 3].map(item => (
              <div key={item} className="log-history-row">
                <Skeleton variant="rect" className="log-history-icon h-8 w-8 rounded-xl" />
                <span className="log-history-copy">
                  <Skeleton variant="text" className="h-3 w-36 max-w-full" />
                  <Skeleton variant="text" className="h-2.5 w-52 max-w-full" />
                </span>
                <Skeleton variant="rect" className="h-4 w-4 rounded" />
              </div>
            ))}
          </div>
        </div>
      </Card>
    </>
  )
}

function StatisticsSkeleton() {
  return (
    <>
      <div className="app-workspace-segments app-liquid-tab-pill data-statistics-view-switcher data-statistics-mode-shell" aria-hidden="true">
        <div className="app-workspace-segment-list data-statistics-mode-tabs">
          <div className="app-workspace-segment-indicator data-statistics-mode-skeleton-highlight" />
          {[1, 2, 3].map(item => (
            <div key={item} className="app-workspace-segment data-statistics-mode-button min-h-11">
              <span className="app-workspace-segment-icon data-statistics-mode-icon">
                <Skeleton variant="circle" className="h-5 w-5" />
              </span>
              <span className="app-workspace-segment-copy gap-1">
                <Skeleton variant="text" className="h-3 w-16 max-w-full" />
                <Skeleton variant="text" className="h-2.5 w-24 max-w-full" />
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0 app-stack-section">
        <Card smoothCorners className="data-statistics-task-card !p-0">
          <div className="data-statistics-task-content">
            <div className="data-statistics-task-header mb-4 flex items-start gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton variant="rect" className="h-8 w-8 rounded-xl" />
                  <Skeleton variant="text" className="h-4 w-24" />
                  <Skeleton variant="rect" className="h-6 w-16 rounded-full" />
                </div>
                <Skeleton variant="text" className="h-3 w-44 max-w-full" />
              </div>
              <div className="data-statistics-task-actions flex shrink-0 items-center gap-2">
                <Skeleton variant="rect" className="h-10 w-32 rounded-xl" />
                <Skeleton variant="rect" className="h-10 w-28 rounded-xl" />
              </div>
            </div>
            <div className="data-statistics-result-grid grid grid-cols-3 gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="rounded-2xl border border-transparent p-3 surface-soft">
                  <Skeleton variant="rect" className="aspect-square h-auto w-full rounded-xl" />
                  <Skeleton variant="text" className="mx-auto mt-3 h-3 w-16 max-w-full" />
                  <Skeleton variant="rect" className="mx-auto mt-2 h-5 w-12 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </>
  )
}

function ConfigSkeleton() {
  return (
    <>
      <div className="app-workspace-segments app-liquid-tab-pill w-full" data-config-sections aria-hidden="true">
        <div className="app-workspace-segment-list grid-cols-3">
          {[1, 2, 3].map(item => (
            <div key={item} className="app-workspace-segment min-h-11">
              <span className="app-workspace-segment-icon">
                <Skeleton variant="circle" className="h-5 w-5" />
              </span>
              <span className="app-workspace-segment-copy gap-1">
                <Skeleton variant="text" className="h-3 w-12 max-w-full" />
                <Skeleton variant="text" className="h-2.5 w-24 max-w-full" />
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="config-workspace-grid grid min-w-0 gap-[var(--app-space-section)] xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)] xl:items-start">
        <div className="config-workspace-primary app-stack-section min-w-0">
      <Card smoothCorners className="config-editor-card !p-0">
        <CardHeaderSkeleton actionWidth="w-36" />
        <div className="app-card-content app-stack-card">
          <div className="grid gap-[var(--app-space-card)] md:grid-cols-2">
            {[1, 2].map(item => (
              <div key={item} className="space-y-2">
                <Skeleton variant="text" className="h-3 w-24" />
                <Skeleton variant="rect" className="h-11 w-full rounded-xl" />
                <Skeleton variant="text" className="h-2.5 w-48 max-w-full" />
              </div>
            ))}
          </div>
          <div className="flex min-h-20 flex-wrap items-center justify-between gap-3 rounded-xl p-4 surface-soft">
            <div className="flex min-w-0 items-center gap-3">
              <Skeleton variant="rect" className="h-9 w-9 shrink-0 rounded-xl" />
              <div className="space-y-2">
                <Skeleton variant="text" className="h-3 w-24" />
                <Skeleton variant="text" className="h-2.5 w-40 max-w-full" />
              </div>
            </div>
            <div className="flex gap-2">
              <Skeleton variant="rect" className="h-9 w-28 rounded-xl" />
              <Skeleton variant="rect" className="h-9 w-24 rounded-xl" />
            </div>
          </div>
          <div className="grid gap-[var(--app-space-card)] md:grid-cols-2">
            <div className="space-y-2">
              <Skeleton variant="text" className="h-3 w-24" />
              <Skeleton variant="rect" className="h-11 w-full rounded-xl" />
              <Skeleton variant="text" className="h-2.5 w-48 max-w-full" />
            </div>
            <div className="flex min-h-20 items-center justify-between gap-3 rounded-xl px-4 py-3 surface-soft">
              <div className="space-y-2">
                <Skeleton variant="text" className="h-3 w-20" />
                <Skeleton variant="text" className="h-2.5 w-36 max-w-full" />
              </div>
              <Skeleton variant="rect" className="h-7 w-12 rounded-full" />
            </div>
          </div>
        </div>
      </Card>
      <Card smoothCorners className="config-directory-card !p-0">
        <div className="app-card-content">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Skeleton variant="rect" className="h-10 w-10 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton variant="title" className="h-4 w-24" />
                <Skeleton variant="text" className="h-3 w-80 max-w-full" />
              </div>
            </div>
            <Skeleton variant="rect" className="h-10 w-24 rounded-xl" />
          </div>
        </div>
      </Card>
        </div>
        <div className="config-workspace-secondary app-stack-section min-w-0">
      <Card smoothCorners className="config-update-card !p-0">
        <CardHeaderSkeleton actionWidth={null} />
        <div className="app-card-content app-stack-card">
          <section className="rounded-xl p-4 surface-soft">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <Skeleton variant="rect" className="h-9 w-9 shrink-0 rounded-xl" />
                <div className="space-y-2">
                  <Skeleton variant="text" className="h-4 w-24" />
                  <Skeleton variant="text" className="h-2.5 w-48 max-w-full" />
                </div>
              </div>
              <Skeleton variant="rect" className="h-7 w-12 rounded-full" />
            </div>
          </section>
          <div className="grid gap-[var(--app-space-card)] md:grid-cols-2 xl:grid-cols-1">
            {[1, 2].map(item => (
              <div key={item} className="space-y-3 rounded-xl p-4 surface-soft">
                <Skeleton variant="text" className="h-4 w-28" />
                <Skeleton variant="text" className="h-2.5 w-52 max-w-full" />
                <Skeleton variant="rect" className="h-11 w-full rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      </Card>
        </div>
      </div>
    </>
  )
}

/**
 * Lazy route skeletons keep each workspace close to its final proportions.
 */
export function PageSkeleton({ variant }: { variant: string }) {
  if (variant === 'dashboard') return <DashboardSkeleton />

  const pageClassNames = [
    'app-page',
    'ios-workspace-page',
    variant === 'combat' ? 'combat-page' : '',
    variant === 'roguelike' ? 'roguelike-page' : '',
    variant === 'logs' ? 'log-viewer' : '',
    variant === 'statistics' ? 'data-statistics-page' : '',
    variant === 'config' ? 'app-stack-section' : '',
  ].filter(Boolean).join(' ')

  const pageContent = (
    <>
      <PageHeaderSkeleton />
      {variant === 'automation' && <AutomationSkeleton />}
      {variant === 'combat' && <CombatSkeleton />}
      {variant === 'roguelike' && <RoguelikeSkeleton />}
      {variant === 'training' && <TrainingSkeleton />}
      {variant === 'logs' && <LogsSkeleton />}
      {variant === 'statistics' && <StatisticsSkeleton />}
      {variant === 'config' && <ConfigSkeleton />}
    </>
  )

  return (
    <div
      className={pageClassNames}
      data-automation-tasks={variant === 'automation' ? true : undefined}
      data-workbench-tasks={variant === 'combat' || variant === 'roguelike' ? true : undefined}
      data-page={variant === 'training' || variant === 'config' ? variant : undefined}
      aria-busy="true"
      aria-label="页面内容加载中"
    >
      {variant === 'config' ? pageContent : <div className="app-stack-section">{pageContent}</div>}
    </div>
  )
}

function DashboardSummarySkeleton({ variant }: { variant: 'status' | 'stages' | 'training' | 'drops' }) {
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
        {variant === 'stages' && <Skeleton variant="rect" className="h-7 w-14 rounded-lg" />}
        {(variant === 'training' || variant === 'drops') && (
          <Skeleton variant="rect" className="h-8 w-8 rounded-lg" />
        )}
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

      {variant === 'training' && (
        <div className="dashboard-summary-body">
          <div className="dashboard-summary-statline">
            <div className="space-y-2">
              <Skeleton variant="title" className="dashboard-summary-number h-9 w-10" />
              <Skeleton variant="text" className="dashboard-summary-number-label h-2.5 w-16" />
            </div>
            <div className="dashboard-summary-copy space-y-2">
              <Skeleton variant="text" className="h-4 w-24" />
              <Skeleton variant="text" className="h-2.5 w-48 max-w-full" />
            </div>
          </div>
          <div className="dashboard-summary-footer">
            <div className="dashboard-stage-list">
              {[14, 18, 16].map((width, index) => (
                <Skeleton key={index} variant="rect" className="h-6 rounded-lg" style={{ width: `${width / 4}rem` }} />
              ))}
            </div>
          </div>
        </div>
      )}

      {variant === 'drops' && (
        <div className="dashboard-summary-body">
          <div className="dashboard-summary-statline">
            <div className="space-y-2">
              <Skeleton variant="title" className="dashboard-summary-number h-9 w-10" />
              <Skeleton variant="text" className="dashboard-summary-number-label h-2.5 w-16" />
            </div>
            <div className="dashboard-summary-copy space-y-2">
              <Skeleton variant="text" className="h-4 w-28" />
              <Skeleton variant="text" className="h-2.5 w-52 max-w-full" />
            </div>
          </div>
          <div className="dashboard-summary-footer">
            <div className="dashboard-drop-list">
              {[1, 2].map(item => (
                <div key={item} className="dashboard-drop-row">
                  <Skeleton variant="rect" className="dashboard-drop-stage h-6 w-12 rounded-lg" />
                  <Skeleton variant="text" className="dashboard-drop-items h-3 w-32 max-w-full" />
                </div>
              ))}
            </div>
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
    <div className="app-page dashboard-page" data-page="dashboard" aria-busy="true" aria-label="控制台加载中">
      <div className="app-stack-section">
        <PageHeaderSkeleton dashboard />

        <div ref={flowGridRef} className="dashboard-flow-layout" style={flowGridStyle}>
          <div ref={flowCardRef} className="min-w-0">
            <div className="dashboard-flow-glow-shell status-border-beam">
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
                  <div className="dashboard-flow-actions">
                    <Skeleton variant="rect" className="dashboard-flow-activity-action h-11 rounded-xl" />
                    <Skeleton variant="rect" className="dashboard-flow-primary-action h-11 rounded-xl" />
                  </div>
                </div>

                <div className="dashboard-flow-metrics">
                  {[1, 2, 3].map(item => (
                    <div key={item} className="dashboard-flow-metric space-y-2">
                      <div className="flex items-center gap-2">
                        <Skeleton variant="circle" className="h-3.5 w-3.5 shrink-0" />
                        <Skeleton variant="text" className="h-2.5 w-16 max-w-full" />
                      </div>
                      <Skeleton variant="text" className="h-4 w-20 max-w-full" />
                      <Skeleton variant="text" className="h-2 w-24 max-w-full" />
                    </div>
                  ))}
                </div>

                <div className="dashboard-flow-stages">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <span className="dashboard-flow-rail-dot" />
                      <Skeleton variant="text" className="h-3 w-24" />
                    </div>
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
                      <Skeleton variant="rect" className="h-3.5 w-3.5 rounded" />
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>

          <div ref={flowPreviewRef} className="min-w-0">
            <SmoothPanel data-dashboard-preview-card className="status-border-beam" aria-hidden="true">
              <div className="dashboard-preview-header flex items-center justify-between gap-3 border-b border-[var(--app-border)] px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Skeleton variant="circle" className="h-1.5 w-1.5" />
                  <Skeleton variant="text" className="h-3 w-28" />
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton variant="text" className="hidden h-2.5 w-14 sm:block" />
                  <Skeleton variant="rect" className="h-11 w-14 rounded-xl sm:h-9" />
                </div>
              </div>
              <div data-dashboard-preview-frame className="dashboard-preview-frame relative aspect-video w-full overflow-hidden bg-black">
                <Skeleton variant="rect" className="absolute inset-[12%] h-auto w-auto rounded-xl opacity-60" />
                <Skeleton variant="rect" className="absolute left-2 top-2 h-6 w-16 rounded-lg" />
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
            {[1, 2, 3, 4].map((item, index) => (
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
                  {index === 3 && <Skeleton variant="text" className="ml-auto h-4 w-10" />}
                </div>
                {index === 3 ? (
                  <div className="dashboard-temperature-chart dashboard-temperature-skeleton">
                    <Skeleton variant="rect" className="h-9 w-full rounded-lg" />
                    <div className="dashboard-temperature-range mt-1 flex justify-between">
                      <Skeleton variant="text" className="h-2 w-8" />
                      <Skeleton variant="text" className="h-2 w-8" />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <Skeleton variant="text" className="h-2.5 w-10" />
                      <Skeleton variant="text" className="h-2.5 w-8" />
                    </div>
                    <Skeleton variant="rect" className="h-1.5 w-full rounded-full" />
                  </div>
                )}
              </SmoothPanel>
            ))}
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <DashboardSummarySkeleton variant="status" />
          <DashboardSummarySkeleton variant="stages" />
          <DashboardSummarySkeleton variant="training" />
          <DashboardSummarySkeleton variant="drops" />
        </div>

      </div>
    </div>
  )
}
