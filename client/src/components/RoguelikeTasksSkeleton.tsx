import { ModeControlSkeleton, MonitorSkeleton, PanelHeadingSkeleton, Skeleton } from './common/Skeleton'
import SmoothPanel from './common/SmoothPanel'

export function RoguelikeSkeleton() {
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

