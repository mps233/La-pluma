import { LoaderCircle } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'

interface LoadingProps {
  size?: 'sm' | 'md' | 'lg'
  text?: string
}

const spinnerSizes = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-7',
} as const

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
      <LoaderCircle className={`animate-spin text-primary-strong ${spinnerSizes[size]}`} aria-hidden="true" />

      {text && (
        <p className="text-sm text-muted-foreground">
          {text}
        </p>
      )}
      {!text && <span className="sr-only">加载中</span>}
    </div>
  )
}

function PanelHeadingSkeleton({ className, showIcon = true }: { className: string; showIcon?: boolean }) {
  return (
    <div className={className}>
      <div className="min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          {showIcon && <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />}
          <Skeleton className="rounded-sm h-4 w-24" />
        </div>
        <Skeleton className="rounded-sm h-2.5 w-36 max-w-full" />
      </div>
      <Skeleton className="h-7 w-12 shrink-0 rounded-full" />
    </div>
  )
}

function CardHeaderSkeleton({ actionWidth = 'w-20' }: { actionWidth?: string | null }) {
  return (
    <CardHeader className="flex flex-row items-center justify-between gap-3.5 border-b py-3.5" aria-hidden="true">
      <Skeleton className="rounded-sm h-4 w-28" />
      {actionWidth && <Skeleton className={`h-9 ${actionWidth} rounded-xl`} />}
    </CardHeader>
  )
}

function MonitorSkeleton() {
  return (
    <Card
      className="device-monitor-panel device-monitor-skeleton device-monitor-surface device-monitor-skeleton-surface gap-0 p-0!"
      aria-hidden="true"
    >
      <div className="device-monitor-skeleton-header">
        <Skeleton className="rounded-full h-1.5 w-1.5 shrink-0" />
        <Skeleton className="rounded-sm h-4 w-24" />
        <Skeleton className="rounded-sm ml-auto h-3 w-12" />
      </div>
      <div className="device-monitor-skeleton-frame aspect-video">
        <Skeleton className="h-full w-full rounded-[inherit]" />
      </div>
      <div className="device-monitor-skeleton-toolbar">
        {[1, 2, 3, 4, 5].map(item => <Skeleton key={item} className="rounded-full h-11 w-11" />)}
      </div>
    </Card>
  )
}

function AutomationSequenceSkeleton() {
  return (
    <Card
      className="automation-sequence-panel automation-sequence-skeleton automation-sequence-surface gap-0 p-0!"
      aria-hidden="true"
    >
      <PanelHeadingSkeleton className="automation-flow-header" />
      <div className="automation-sequence-list">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="automation-sequence-item pointer-events-none">
            <Skeleton className="h-4 w-3 justify-self-center rounded-sm" />
            <div className="flex min-w-0 items-center gap-2 px-1">
              <Skeleton className="rounded-full h-6 w-6 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="rounded-sm h-3" style={{ width: `${48 + (index % 3) * 10}%` }} />
                <Skeleton className="rounded-sm h-2.5" style={{ width: `${66 + (index % 2) * 12}%` }} />
              </div>
            </div>
            <Skeleton className="h-5 w-9 justify-self-center rounded-full" />
            <Skeleton className="rounded-full h-8 w-8 justify-self-center" />
          </div>
        ))}
      </div>
      <div className="automation-sequence-footer">
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
    </Card>
  )
}

function AutomationEditorSkeleton() {
  return (
    <Card className="automation-editor-panel automation-editor-skeleton gap-0 p-0!" aria-hidden="true">
      <PanelHeadingSkeleton className="automation-editor-heading" />
      <div className="automation-editor-content">
        <div className="automation-task-editor space-y-3.5">
          <div className="automation-flow-card-header flex-wrap">
            <div className="automation-flow-card-identity min-w-0">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="rounded-sm h-3 w-28" />
                <Skeleton className="rounded-sm h-2.5 w-20" />
              </div>
            </div>
            <div className="automation-flow-card-controls">
              <Skeleton className="h-7 w-12 rounded-full" />
              <Skeleton className="rounded-full h-11 w-11" />
            </div>
          </div>
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="space-y-2">
              <Skeleton className="rounded-sm h-2.5 w-20" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

function AutomationScheduleSkeleton() {
  return (
    <Card className="automation-side-card automation-schedule-skeleton gap-0 p-0!" aria-hidden="true">
      <PanelHeadingSkeleton className="automation-side-card-heading" />
      <div className="automation-schedule-body">
        {[0, 1].map(item => (
          <div key={item} className="automation-schedule-time-row">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="ml-auto h-7 w-12 rounded-full" />
            <Skeleton className="rounded-full h-11 w-11" />
          </div>
        ))}
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
      <div className="automation-schedule-timezone">
        <Skeleton className="rounded-sm h-2.5 w-48 max-w-full" />
      </div>
    </Card>
  )
}

function AutomationNotificationSkeleton() {
  return (
    <Card className="automation-side-card gap-0 p-0!" aria-hidden="true">
      <PanelHeadingSkeleton className="automation-side-card-heading" />
      <div className="automation-notification-channel">
        <div className="automation-notification-channel-heading">
          <div className="space-y-2">
            <Skeleton className="rounded-sm h-3.5 w-24" />
            <Skeleton className="rounded-sm h-2.5 w-36" />
          </div>
          <Skeleton className="h-7 w-12 rounded-full" />
        </div>
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-9 w-full rounded-md" />
      </div>
      <div className="automation-side-card-footer">
        <Skeleton className="rounded-sm h-2.5 w-20" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>
    </Card>
  )
}

function AutomationSkeleton() {
  return (
    <div className="automation-workspace-grid" aria-hidden="true">
      <div className="automation-sequence-column"><AutomationSequenceSkeleton /></div>
      <div className="automation-editor-column"><AutomationEditorSkeleton /></div>
      <div className="automation-support-column">
        <div className="device-monitor-column"><MonitorSkeleton /></div>
        <AutomationScheduleSkeleton />
        <AutomationNotificationSkeleton />
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
              <Skeleton className="rounded-full h-5 w-5" />
            </span>
            <span className="app-workspace-segment-copy min-w-0">
              <Skeleton className="rounded-sm h-3 w-16 max-w-full" />
              <Skeleton className="rounded-sm h-2 w-24 max-w-full" />
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
          <Card className="combat-task-card combat-task-skeleton gap-0 p-0!">
            <div className="combat-task-heading flex flex-col gap-3.5 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 items-center gap-3.5">
                <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
                <div className="min-w-0 space-y-2">
                  <Skeleton className="rounded-sm h-4 w-32 max-w-full" />
                  <Skeleton className="rounded-sm h-2.5 w-64 max-w-full" />
                </div>
              </div>
              <Skeleton className="combat-task-run-button h-11 w-28 shrink-0 rounded-xl" />
            </div>
            <div className="combat-copilot-layout">
              <div className="space-y-3 xl:sticky xl:top-4">
                <div className="combat-workspace-section space-y-3">
                  <Skeleton className="rounded-sm h-3.5 w-24" />
                  {[1, 2, 3, 4].map(item => <Skeleton key={item} className="h-11 rounded-xl" />)}
                </div>
              </div>
              <div className="space-y-3">
                <div className="combat-workspace-section space-y-3">
                  <Skeleton className="rounded-sm h-3.5 w-20" />
                  <Skeleton className="h-11 rounded-xl" />
                </div>
                <div className="combat-workspace-section combat-job-list-section space-y-3">
                  <Skeleton className="rounded-sm h-3.5 w-24" />
                  {[1, 2, 3].map(item => <Skeleton key={item} className="h-14 rounded-xl" />)}
                </div>
              </div>
              <div className="space-y-3">
                <div className="combat-workspace-section space-y-3">
                  <Skeleton className="rounded-sm h-3.5 w-20" />
                  <Skeleton className="h-11 rounded-xl" />
                </div>
                <div className="combat-workspace-section space-y-3">
                  <Skeleton className="rounded-sm h-3.5 w-28" />
                  <Skeleton className="rounded-sm h-3 w-full" />
                  <Skeleton className="rounded-sm h-3 w-4/5" />
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
      <div className="task-monitor-column"><MonitorSkeleton /></div>
    </div>
  )
}

function RoguelikeSkeleton() {
  return (
    <div className="roguelike-workspace-grid workbench-skeleton" aria-hidden="true">
      <div className="roguelike-mode-area"><ModeControlSkeleton variant="roguelike" /></div>
      <div className="roguelike-main-column">
        <Card className="roguelike-panel roguelike-theme-panel gap-0 p-0!">
          <PanelHeadingSkeleton className="roguelike-panel-heading" showIcon={false} />
          <div className="roguelike-panel-body">
            <div className="roguelike-theme-grid">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="roguelike-theme-option">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="rounded-sm h-3 w-20 max-w-full" />
                    <Skeleton className="rounded-sm h-2 w-14 max-w-full" />
                  </div>
                </div>
              ))}
            </div>
            <div className="roguelike-custom-theme mt-4 space-y-2">
              <Skeleton className="rounded-sm h-2.5 w-24" />
              <Skeleton className="h-10 rounded-xl" />
            </div>
          </div>
        </Card>
      </div>
      <Card className="roguelike-panel roguelike-settings-panel gap-0 p-0!">
        <PanelHeadingSkeleton className="roguelike-panel-heading" showIcon={false} />
        <div className="roguelike-panel-body roguelike-settings-body">
          <div className="roguelike-field-grid">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="rounded-sm h-2.5 w-20" />
                <Skeleton className="h-10 rounded-xl" />
              </div>
            ))}
          </div>
          <div className="roguelike-toggle-list">
            {[1, 2].map(item => (
              <div key={item} className="roguelike-toggle-row">
                <div className="space-y-1.5">
                  <Skeleton className="rounded-sm h-3 w-24" />
                  <Skeleton className="rounded-sm h-2 w-32" />
                </div>
                <Skeleton className="h-7 w-12 rounded-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="roguelike-panel-footer">
          <Skeleton className="roguelike-run-button h-11 rounded-xl" />
        </div>
      </Card>
      <aside className="device-monitor-column" data-monitor-area="monitor"><MonitorSkeleton /></aside>
    </div>
  )
}

function TrainingSkeleton() {
  return (
    <div className="grid grid-cols-1 items-start gap-4.5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,27rem)]" aria-hidden="true">
      <section className="order-1 min-w-0 space-y-3.5 training-operator-column">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="rounded-sm h-5 w-24" />
            <Skeleton className="rounded-sm h-3 w-36" />
          </div>
          <Skeleton className="h-7 w-44 rounded-full" />
        </div>
        <div className="space-y-3.5">
          <div className="app-workspace-segments app-liquid-tab-pill training-status-shell">
            <div className="app-workspace-segment-list grid-cols-3">
              <div className="app-workspace-segment-indicator training-status-skeleton-highlight" />
              {[1, 2, 3].map(item => (
                <div key={item} className="app-workspace-segment training-status-segment">
                  <span className="app-workspace-segment-icon training-status-count">
                    <Skeleton className="rounded-sm h-3 w-4" />
                  </span>
                  <span className="app-workspace-segment-copy space-y-1.5">
                    <Skeleton className="rounded-sm h-3 w-14 max-w-full" />
                    <Skeleton className="rounded-sm h-2 w-16 max-w-full" />
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
            <Skeleton className="col-span-2 h-11 min-w-0 rounded-xl sm:col-span-1" />
            <Skeleton className="h-11 w-full rounded-xl" />
            <Skeleton className="h-11 w-24 rounded-xl" />
          </div>
          <div className="min-h-65">
            <div className="training-operator-grid grid grid-cols-3 gap-3.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-5 xl:grid-cols-4">
              {Array.from({ length: 12 }, (_, index) => (
                <div key={index} className="training-operator-skeleton relative overflow-hidden rounded-xl p-2.5 surface-soft">
                  <Skeleton className="mb-2.5 aspect-square h-auto w-full rounded-xl" />
                  <div className="space-y-2">
                    <Skeleton className="rounded-sm mx-auto h-3 w-16 max-w-full" />
                    <Skeleton className="mx-auto h-5 w-12 rounded-full" />
                    <Skeleton className="h-9 w-full rounded-xl" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <aside className="order-2 min-w-0 space-y-3.5 xl:sticky xl:top-4 training-support-column">
        <Card className="training-settings-panel gap-0 p-0!">
          <div className="px-4 py-3">
            <div className="flex min-h-11 items-center">
              <Skeleton className="rounded-sm h-4 w-24" />
            </div>
            <div className="mt-2 divide-y divide-border">
              {[1, 2].map(item => (
                <div
                  key={item}
                  className="training-settings-skeleton-row flex min-h-14 items-center justify-between gap-3.5 py-2.5"
                >
                  <div className="space-y-1.5">
                    <Skeleton className="rounded-sm h-3.5 w-20" />
                    <Skeleton className="rounded-sm h-2.5 w-36 max-w-full" />
                  </div>
                  <Skeleton className="h-7 w-12 shrink-0 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </Card>
        <Card className="training-queue-card gap-0 p-0!">
          <CardHeaderSkeleton actionWidth="w-16" />
          <div className="divide-y divide-border px-4">
            {[1, 2, 3].map(item => (
              <div key={item} className="flex min-h-16 items-center gap-3.5 py-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="rounded-sm h-3 w-24" />
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
                <Skeleton className="rounded-sm h-3 w-8" />
              </div>
            ))}
          </div>
        </Card>
        <Card className="training-plan-empty gap-0 p-0!">
          <div className="px-6 py-8 text-center">
            <Skeleton className="mx-auto h-12 w-12 rounded-xl" />
            <Skeleton className="rounded-sm mx-auto mt-4 h-5 w-36" />
            <Skeleton className="rounded-sm mx-auto mt-3 h-3 w-64 max-w-full" />
            <Skeleton className="rounded-sm mx-auto mt-2 h-3 w-48 max-w-full" />
          </div>
        </Card>
      </aside>
    </div>
  )
}

function LogsSkeleton() {
  return (
    <>
      <Card className="log-card log-toolbar-card gap-0 p-0!">
        <CardContent className="log-toolbar">
          <div className="log-toolbar-controls">
            {[1, 2].map(item => (
              <div key={item} className="log-toggle-control flex min-h-11 min-w-0 items-center justify-between gap-3.5">
                <Skeleton className="rounded-sm h-3 w-14" />
                <Skeleton className="h-5 w-8 rounded-full" />
              </div>
            ))}
            <Skeleton className="col-span-2 h-11 w-full rounded-xl sm:col-auto sm:w-36" />
            <Skeleton className="col-span-2 h-11 w-full rounded-xl sm:col-auto sm:min-w-56 sm:flex-1" />
          </div>
          <div className="log-toolbar-actions">
            <Skeleton className="h-10 w-20 rounded-xl" />
            <Skeleton className="h-10 w-20 rounded-xl" />
          </div>
        </CardContent>
      </Card>
      <Card className="log-card gap-0 p-0!">
        <CardHeaderSkeleton actionWidth="w-14" />
        <CardContent className="log-console-content">
          <div className="log-console">
            {Array.from({ length: 10 }, (_, index) => (
              <div key={index} className="log-row">
                <div className="log-row-meta">
                  <Skeleton className="rounded-sm h-3 w-full" />
                  <Skeleton className="h-5 w-full rounded-sm" />
                </div>
                <Skeleton className="rounded-sm mt-1 h-3" style={{ width: `${58 + (index % 4) * 9}%` }} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card className="log-card log-history-card gap-0 p-0!">
        <CardHeaderSkeleton actionWidth="w-28" />
        <CardContent className="log-history-content px-0">
          <div className="log-history-list">
            {[1, 2, 3].map(item => (
              <div key={item} className="log-history-row">
                <Skeleton className="log-history-icon h-8 w-8 rounded-xl" />
                <span className="log-history-copy">
                  <Skeleton className="rounded-sm h-3 w-36 max-w-full" />
                  <Skeleton className="rounded-sm h-2.5 w-52 max-w-full" />
                </span>
                <Skeleton className="h-4 w-4 rounded-sm" />
              </div>
            ))}
          </div>
        </CardContent>
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
                <Skeleton className="rounded-full h-5 w-5" />
              </span>
              <span className="app-workspace-segment-copy gap-1">
                <Skeleton className="rounded-sm h-3 w-16 max-w-full" />
                <Skeleton className="rounded-sm h-2.5 w-24 max-w-full" />
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0 app-stack-section">
        <Card className="data-statistics-task-card gap-0 p-0!">
          <div className="data-statistics-task-content">
            <div className="data-statistics-task-header mb-4 flex items-start gap-3.5">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-8 w-8 rounded-xl" />
                  <Skeleton className="rounded-sm h-4 w-24" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
                <Skeleton className="rounded-sm h-3 w-44 max-w-full" />
              </div>
              <div className="data-statistics-task-actions flex shrink-0 items-center gap-2">
                <Skeleton className="h-10 w-32 rounded-xl" />
                <Skeleton className="h-10 w-28 rounded-xl" />
              </div>
            </div>
            <div className="data-statistics-result-grid grid grid-cols-3 gap-3.5 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="rounded-xl border border-transparent p-3 surface-soft">
                  <Skeleton className="aspect-square h-auto w-full rounded-xl" />
                  <Skeleton className="rounded-sm mx-auto mt-3 h-3 w-16 max-w-full" />
                  <Skeleton className="mx-auto mt-2 h-5 w-12 rounded-full" />
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
      <div className="config-workspace-grid grid min-w-0 gap-4.5 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)] xl:items-start">
        <div className="config-workspace-primary app-stack-section min-w-0">
      <div className="app-workspace-segments app-liquid-tab-pill w-full" data-config-sections aria-hidden="true">
        <div className="app-workspace-segment-list grid-cols-3">
          {[1, 2, 3].map(item => (
            <div key={item} className="app-workspace-segment min-h-11">
              <span className="app-workspace-segment-icon">
                <Skeleton className="rounded-full h-5 w-5" />
              </span>
              <span className="app-workspace-segment-copy gap-1">
                <Skeleton className="rounded-sm h-3 w-12 max-w-full" />
                <Skeleton className="rounded-sm h-2.5 w-24 max-w-full" />
              </span>
            </div>
          ))}
        </div>
      </div>
      <Card className="config-editor-card gap-0 p-0!">
        <CardHeaderSkeleton actionWidth="w-36" />
        <CardContent className="app-stack-card py-4">
          <div className="grid gap-3.5 md:grid-cols-2">
            {[1, 2].map(item => (
              <div key={item} className="space-y-2">
                <Skeleton className="rounded-sm h-3 w-24" />
                <Skeleton className="h-11 w-full rounded-xl" />
                <Skeleton className="rounded-sm h-2.5 w-48 max-w-full" />
              </div>
            ))}
          </div>
          <div className="flex min-h-20 flex-wrap items-center justify-between gap-3.5 rounded-xl p-4 surface-soft">
            <div className="flex min-w-0 items-center gap-3.5">
              <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="rounded-sm h-3 w-24" />
                <Skeleton className="rounded-sm h-2.5 w-40 max-w-full" />
              </div>
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-28 rounded-xl" />
              <Skeleton className="h-9 w-24 rounded-xl" />
            </div>
          </div>
          <div className="grid gap-3.5 md:grid-cols-2">
            <div className="space-y-2">
              <Skeleton className="rounded-sm h-3 w-24" />
              <Skeleton className="h-11 w-full rounded-xl" />
              <Skeleton className="rounded-sm h-2.5 w-48 max-w-full" />
            </div>
            <div className="config-reconnect-row flex min-h-14 items-center justify-between gap-3.5 py-1">
              <div className="space-y-2">
                <Skeleton className="rounded-sm h-3 w-20" />
                <Skeleton className="rounded-sm h-2.5 w-36 max-w-full" />
              </div>
              <Skeleton className="h-7 w-12 rounded-full" />
            </div>
          </div>
        </CardContent>
      </Card>
      <Card className="config-directory-card gap-0 p-0!">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-3.5">
            <div className="flex min-w-0 flex-1 items-center gap-3.5">
              <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="rounded-sm h-4 w-24" />
                <Skeleton className="rounded-sm h-3 w-80 max-w-full" />
              </div>
            </div>
            <Skeleton className="h-10 w-24 rounded-xl" />
          </div>
        </CardContent>
      </Card>
        </div>
        <div className="config-workspace-secondary app-stack-section min-w-0">
      <Card className="config-update-card gap-0 p-0!">
        <CardHeaderSkeleton actionWidth={null} />
        <CardContent className="app-stack-card py-4">
          <section className="rounded-xl p-4 surface-soft">
            <div className="flex items-center justify-between gap-3.5">
              <div className="flex min-w-0 items-center gap-3.5">
                <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
                <div className="space-y-2">
                  <Skeleton className="rounded-sm h-4 w-24" />
                  <Skeleton className="rounded-sm h-2.5 w-48 max-w-full" />
                </div>
              </div>
              <Skeleton className="h-7 w-12 rounded-full" />
            </div>
          </section>
          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-1">
            {[1, 2].map(item => (
              <div key={item} className="space-y-3 rounded-xl p-4 surface-soft">
                <Skeleton className="rounded-sm h-4 w-28" />
                <Skeleton className="rounded-sm h-2.5 w-52 max-w-full" />
                <Skeleton className="h-11 w-full rounded-xl" />
              </div>
            ))}
          </div>
        </CardContent>
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
  // dashboard 骨架由域内 DashboardSkeleton 提供，shared 不反向依赖 feature
  const isWorkspace = ['automation', 'combat', 'roguelike', 'training', 'logs', 'statistics', 'config']
    .includes(variant)
  const isBorderless = ['automation', 'combat', 'roguelike', 'logs', 'statistics', 'config']
    .includes(variant)
  const pageClassNames = [
    'app-page',
    variant === 'combat' ? 'combat-page' : '',
    variant === 'roguelike' ? 'roguelike-page' : '',
    variant === 'logs' ? 'log-viewer' : '',
    variant === 'statistics' ? 'data-statistics-page' : '',
    variant === 'config' ? 'app-stack-section' : '',
  ].filter(Boolean).join(' ')

  const pageContent = (
    <>
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
      data-page-kind={isWorkspace ? variant : undefined}
      data-page-layout={isWorkspace ? 'workspace' : undefined}
      data-page-surface={isBorderless ? 'borderless' : undefined}
      aria-busy="true"
      aria-label="页面内容加载中"
    >
      {variant === 'config' ? pageContent : <div className="app-stack-section">{pageContent}</div>}
    </div>
  )
}
