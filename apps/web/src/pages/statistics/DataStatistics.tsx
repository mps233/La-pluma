import { PageShell } from '@/shared/components'
import { StatisticsWorkspace } from '@/features/statistics'
import { DeviceMonitorLayout } from '@/features/device-mirror'

export default function DataStatistics() {
  return (
    <PageShell pageKind="statistics" layout="workspace" surface="borderless" className="data-statistics-page">
      <DeviceMonitorLayout>
        <StatisticsWorkspace />
      </DeviceMonitorLayout>
    </PageShell>
  )
}
