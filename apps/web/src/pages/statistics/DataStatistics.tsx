import { StatisticsWorkspace } from '@/features/statistics'
import { DeviceMonitorLayout } from '@/features/device-mirror'

export default function DataStatistics() {
  return (
    <div className="app-page ios-workspace-page ios-borderless-cards data-statistics-page" data-page="statistics">
      <div className="app-stack-section">
        <DeviceMonitorLayout>
          <StatisticsWorkspace />
        </DeviceMonitorLayout>
      </div>
    </div>
  )
}
