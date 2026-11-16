import { PageShell } from '@/shared/components'
import { LogsWorkspace } from '@/features/logs'
import { DeviceMonitorLayout } from '@/features/device-mirror'

export default function LogViewer() {
  return (
    <PageShell pageKind="logs" layout="workspace" surface="borderless" className="log-viewer">
      <DeviceMonitorLayout variant="standard">
        <LogsWorkspace />
      </DeviceMonitorLayout>
    </PageShell>
  )
}
