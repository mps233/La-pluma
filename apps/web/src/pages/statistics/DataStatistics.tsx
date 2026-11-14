import { PageHeader } from '@/shared/components'
import { FloatingStatusIndicator } from '@/features/runtime-status'
import { StatisticsWorkspace } from '@/features/statistics'
import { DeviceMonitorLayout } from '@/features/device-mirror'

export default function DataStatistics() {
  return (
    <div className="app-page ios-workspace-page ios-borderless-cards data-statistics-page">
      <div className="app-stack-section">
        <PageHeader
          title="数据"
          subtitle="识别并查看仓库、干员与掉落数据"
          mobileLayout="inline"
          actions={(
            <div className="data-statistics-status min-w-0 max-w-full">
              <FloatingStatusIndicator
                className="max-w-full"
                textClassName="truncate whitespace-nowrap"
              />
            </div>
          )}
        />

        <DeviceMonitorLayout>
          <StatisticsWorkspace />
        </DeviceMonitorLayout>
      </div>
    </div>
  )
}
