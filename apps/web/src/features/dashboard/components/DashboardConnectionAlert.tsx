import { ServerOff, WifiOff } from 'lucide-react'
import { Button, SmoothPanel } from '@/shared/components'
import Icons from '@/shared/components/Icons'
import { useDashboardServiceStatus } from '../hooks/useDashboardServiceStatus'

interface DashboardConnectionAlertProps {
  refreshDashboard: () => Promise<void>
}

export default function DashboardConnectionAlert({ refreshDashboard }: DashboardConnectionAlertProps) {
  const { serviceStatus, connectionTitle, connectionDescription } = useDashboardServiceStatus()

  if (serviceStatus !== 'offline' && serviceStatus !== 'unavailable') return null

  return (
    <SmoothPanel
      cornerSize="compact"
      className="dashboard-connection-alert"
      surfaceClassName={`app-info-card flex min-w-0 flex-wrap items-center gap-3.5 ${serviceStatus === 'offline' ? 'status-warning' : 'status-danger'}`}
      role="alert"
    >
      {serviceStatus === 'offline'
        ? <WifiOff className="h-5 w-5 shrink-0" aria-hidden="true" />
        : <ServerOff className="h-5 w-5 shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{connectionTitle}</div>
        <div className="mt-0.5 text-xs opacity-80">{connectionDescription}</div>
      </div>
      {serviceStatus === 'unavailable' && (
        <Button
          onClick={() => refreshDashboard()}
          variant="secondary"
          size="sm"
          icon={<Icons.RefreshCw />}
        >
          重试连接
        </Button>
      )}
    </SmoothPanel>
  )
}
