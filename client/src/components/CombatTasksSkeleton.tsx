import { Card } from './common/Card'
import { ModeControlSkeleton, MonitorSkeleton, Skeleton } from './common/Skeleton'

export function CombatSkeleton() {
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

