import type { ReactNode } from 'react'
import { Card } from '@/shared/ui/card'
import ScreenMonitor from './ScreenMonitor'

export function DeviceMonitorPanel({ className = '' }: { className?: string }) {
  return (
    <Card className={`device-monitor-surface ${className} gap-0 p-0!`} data-region="monitor">
      <div className="task-monitor-panel is-compact">
        <ScreenMonitor variant="compact" />
      </div>
    </Card>
  )
}

interface StandardDeviceMonitorLayoutProps {
  variant?: 'standard'
  children: ReactNode
}

interface WorkbenchDeviceMonitorLayoutProps {
  variant: 'workbench'
  sequence: ReactNode
  editor: ReactNode
  support: ReactNode
}

interface ModeDeviceMonitorLayoutProps {
  variant: 'mode'
  mode: ReactNode
  content: ReactNode
}

export type DeviceMonitorLayoutProps =
  | StandardDeviceMonitorLayoutProps
  | WorkbenchDeviceMonitorLayoutProps
  | ModeDeviceMonitorLayoutProps

export function DeviceMonitorLayout(props: DeviceMonitorLayoutProps) {
  if (props.variant === 'workbench') {
    return (
      <div className="automation-workspace-grid" data-device-monitor-layout="workbench">
        {props.sequence}
        {props.editor}
        <div className="automation-support-column" data-monitor-area="support">
          <div className="device-monitor-column" data-monitor-area="monitor">
            <DeviceMonitorPanel className="device-monitor-panel" />
          </div>
          {props.support}
        </div>
      </div>
    )
  }

  if (props.variant === 'mode') {
    return (
      <div className="roguelike-workspace-grid" data-device-monitor-layout="mode">
        {props.mode}
        {props.content}
        <aside className="device-monitor-column" aria-label="设备画面" data-monitor-area="monitor">
          <DeviceMonitorPanel className="device-monitor-panel" />
        </aside>
      </div>
    )
  }

  return (
    <div className="task-monitor-layout" data-device-monitor-layout="standard">
      <div className="task-monitor-main" data-monitor-area="main">{props.children}</div>
      <aside className="task-monitor-column" aria-label="设备画面" data-monitor-area="monitor">
        <DeviceMonitorPanel />
      </aside>
    </div>
  )
}
