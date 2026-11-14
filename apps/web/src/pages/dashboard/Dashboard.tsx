import { PageHeader } from '@/shared/components'
import { FloatingStatusIndicator } from '@/features/runtime-status'
import { DashboardSkeleton } from '@/features/dashboard'
import { DashboardWorkspace } from '@/features/dashboard'
import { useDashboardSnapshotRefresh } from '@/features/dashboard'
import { useDashboardStore } from '@/features/dashboard'

export default function Dashboard() {
  const hasLoaded = useDashboardStore(state => state.hasLoaded)
  const { refreshDashboard } = useDashboardSnapshotRefresh()

  if (!hasLoaded) {
    return <DashboardSkeleton />
  }

  return (
    <div className="app-page dashboard-page" data-page="dashboard">
      <div className="app-stack-section">
        <PageHeader
          title="概览"
          subtitle="当前活动、自动化进度、养成与掉落总览"
          mobileLayout="inline"
          actions={
            <div className="dashboard-page-actions flex w-full items-center sm:w-auto">
              <div className="dashboard-status-slot min-w-0 flex-1 sm:flex-none">
                <FloatingStatusIndicator className="dashboard-status-indicator w-full sm:w-auto" textClassName="truncate whitespace-nowrap" />
              </div>
            </div>
          }
        />

        <DashboardWorkspace refreshDashboard={refreshDashboard} />
      </div>
    </div>
  )
}
