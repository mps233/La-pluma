import { PageHeaderSkeleton, Skeleton } from './Skeleton'
import { DashboardSkeleton } from '../DashboardSkeleton'
import { Card } from './Card'
import SmoothPanel from './SmoothPanel'
import ActivityIndicator from './ActivityIndicator'

/**
 * 加载动画组件 Props
 */
interface LoadingProps {
  size?: 'sm' | 'md' | 'lg'
  text?: string
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

function GlassModeSkeleton({ count, className = '' }: { count: number; className?: string }) {
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

function ModeControlSkeleton({ variant }: { variant: 'combat' | 'roguelike' }) {
  return (
    <GlassModeSkeleton
      count={variant === 'roguelike' ? 2 : 3}
      className={`${variant}-mode-shell`}
    />
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
              <div className="flex min-w-0 items-center gap-4">
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
          <GlassModeSkeleton count={3} className="training-status-shell" />
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
            <Skeleton variant="rect" className="col-span-2 h-11 min-w-0 rounded-xl sm:col-span-1" />
            <Skeleton variant="rect" className="h-11 w-full rounded-xl" />
            <Skeleton variant="rect" className="h-11 w-24 rounded-xl" />
          </div>
          <div className="min-h-[260px]">
            <div className="training-operator-grid grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-5 xl:grid-cols-4 2xl:grid-cols-6">
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
              <div key={item} className="flex min-h-16 items-center gap-4 py-3">
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
      <GlassModeSkeleton count={2} className="log-mode-shell" />
      <Card smoothCorners className="log-card log-toolbar-card !p-0">
        <div className="app-card-content log-toolbar">
          <div className="log-toolbar-controls">
            {[1, 2].map(item => (
              <div key={item} className="log-toggle-control flex min-h-11 min-w-0 items-center justify-between gap-4">
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
      <GlassModeSkeleton count={3} className="data-statistics-view-switcher data-statistics-mode-shell" />
      <div className="min-w-0 app-stack-section">
        <Card smoothCorners className="data-statistics-task-card !p-0">
          <div className="data-statistics-task-content">
            <div className="data-statistics-task-header mb-4 flex items-start gap-4">
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
            <div className="data-statistics-result-grid grid grid-cols-3 gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
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
      <div data-config-sections>
        <GlassModeSkeleton count={3} />
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
          <div className="flex min-h-20 flex-wrap items-center justify-between gap-4 rounded-xl p-4 surface-soft">
            <div className="flex min-w-0 items-center gap-4">
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
            <div className="config-reconnect-row flex min-h-[3.5rem] items-center justify-between gap-4 py-1">
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
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-4">
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
              <div className="flex min-w-0 items-center gap-4">
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
    ['training', 'logs', 'statistics', 'config'].includes(variant) ? 'ios-borderless-cards' : '',
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

