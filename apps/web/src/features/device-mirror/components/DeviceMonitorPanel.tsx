import type { ReactNode } from 'react'
import { Card } from '@/shared/ui/card'
import ScreenMonitor from './ScreenMonitor'

export function DeviceMonitorPanel({ className = '' }: { className?: string }) {
  return (
    <Card className={`automation-monitor-surface ${className} gap-0 p-0!`} data-region="monitor">
      <div className="task-monitor-panel is-compact">
        <ScreenMonitor variant="compact" />
      </div>
    </Card>
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
