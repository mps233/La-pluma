import { PageShell } from '@/shared/components'
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
    <PageShell pageKind="dashboard" className="dashboard-page">
      <DashboardWorkspace refreshDashboard={refreshDashboard} />
    </PageShell>
  )
}
