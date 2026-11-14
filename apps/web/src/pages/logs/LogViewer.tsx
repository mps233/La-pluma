import { PageHeader } from '@/shared/components'
import { FloatingStatusIndicator } from '@/features/runtime-status'
import { LogsWorkspace } from '@/features/logs'
import { DeviceMonitorLayout } from '@/features/device-mirror'

export default function LogViewer() {
  return (
    <div className="app-page log-viewer ios-workspace-page ios-borderless-cards">
      <div className="app-stack-section">
        <PageHeader
          title="日志"
          subtitle="实时查看任务执行与历史记录"
          mobileLayout="inline"
          actions={<FloatingStatusIndicator />}
        />

        <DeviceMonitorLayout>
          <LogsWorkspace />
        </DeviceMonitorLayout>
      </div>
    </div>
  )
}
