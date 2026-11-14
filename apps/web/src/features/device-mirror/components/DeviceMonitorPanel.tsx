import type { ReactNode } from 'react'
import { SmoothPanel } from '@/shared/components'
import ScreenMonitor from './ScreenMonitor'

export function DeviceMonitorPanel({ className = '', surfaceClassName = '' }: { className?: string; surfaceClassName?: string }) {
  return (
    <SmoothPanel className={className} surfaceClassName={`automation-monitor-surface ${surfaceClassName}`}>
      <div className="task-monitor-panel is-compact">
        <ScreenMonitor variant="compact" />
      </div>
    </SmoothPanel>
  )
}

export function DeviceMonitorLayout({ children }: { children: ReactNode }) {
  return (
    <div className="task-monitor-layout">
      <div className="task-monitor-main">{children}</div>
      <aside className="task-monitor-column" aria-label="设备画面">
        <DeviceMonitorPanel />
      </aside>
    </div>
  )
}
