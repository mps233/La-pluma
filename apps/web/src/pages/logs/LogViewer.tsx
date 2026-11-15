import { LogsWorkspace } from '@/features/logs'
import { DeviceMonitorLayout } from '@/features/device-mirror'

export default function LogViewer() {
  return (
    <div className="app-page log-viewer ios-workspace-page ios-borderless-cards" data-page="logs">
      <div className="app-stack-section">
        <DeviceMonitorLayout>
          <LogsWorkspace />
        </DeviceMonitorLayout>
      </div>
    </div>
  )
}
