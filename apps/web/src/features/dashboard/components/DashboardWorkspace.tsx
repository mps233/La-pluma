import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { statisticsTabRoute } from '@/features/statistics'
import { appTabRoute } from '@/shared/navigation'
import { useDashboardDeviceStats } from '../hooks/useDashboardDeviceStats'
import DashboardConnectionNotice from './DashboardConnectionNotice'
import DashboardDeviceSection from './DashboardDeviceSection'
import DashboardFlowSection from './DashboardFlowSection'
import DashboardSummarySection from './DashboardSummarySection'

interface DashboardWorkspaceProps {
  refreshDashboard: () => Promise<void>
}

function DashboardDeviceSampleProjection() {
  useDashboardDeviceStats()
  return null
}

export default function DashboardWorkspace({ refreshDashboard }: DashboardWorkspaceProps) {
  const navigate = useNavigate()

  const openAutomation = useCallback(() => navigate(appTabRoute('automation')), [navigate])
  const openTraining = useCallback(() => navigate(appTabRoute('training')), [navigate])
  const openStatistics = useCallback(() => navigate(statisticsTabRoute('drops')), [navigate])

  return (
    <>
      <DashboardDeviceSampleProjection />
      <DashboardConnectionNotice refreshDashboard={refreshDashboard} />
      <DashboardFlowSection refreshDashboard={refreshDashboard} onOpenAutomation={openAutomation} />
      <DashboardDeviceSection />
      <DashboardSummarySection onOpenTraining={openTraining} onOpenStatistics={openStatistics} />
    </>
  )
}
