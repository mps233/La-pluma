import { MonitorSkeleton, PanelHeadingSkeleton, Skeleton } from './common/Skeleton'
import SmoothPanel from './common/SmoothPanel'

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

export function AutomationSkeleton() {
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

