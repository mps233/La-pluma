import { RefreshCw, ServerOff, WifiOff } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { useDashboardServiceStatus } from '../hooks/useDashboardServiceStatus'

interface DashboardConnectionAlertProps {
  refreshDashboard: () => Promise<void>
}

export default function DashboardConnectionAlert({ refreshDashboard }: DashboardConnectionAlertProps) {
  const { serviceStatus, connectionTitle, connectionDescription } = useDashboardServiceStatus()

  if (serviceStatus !== 'offline' && serviceStatus !== 'unavailable') return null

  return (
    <Card
      className={`dashboard-connection-alert flex min-w-0 flex-row flex-wrap items-center gap-3.5 p-3.5 ${
        serviceStatus === 'offline'
          ? 'bg-warning/10 text-warning ring-warning/25'
          : 'bg-destructive/10 text-destructive ring-destructive/25'
      }`}
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
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          重试连接
        </Button>
      )}
    </Card>
  )
}
