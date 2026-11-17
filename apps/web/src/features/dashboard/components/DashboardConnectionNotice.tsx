import { useEffect, useRef } from 'react'
import { DASHBOARD_CONNECTION_NOTICE_ID, dismissNotice, notify } from '@/shared/notifications'
import { useDashboardServiceStatus } from '../hooks/useDashboardServiceStatus'

interface DashboardConnectionNoticeProps {
  refreshDashboard: () => Promise<void>
}

export default function DashboardConnectionNotice({ refreshDashboard }: DashboardConnectionNoticeProps) {
  const { serviceStatus, connectionTitle, connectionDescription } = useDashboardServiceStatus()
  const activeNoticeRef = useRef<string | null>(null)

  useEffect(() => () => {
    activeNoticeRef.current = null
    dismissNotice(DASHBOARD_CONNECTION_NOTICE_ID)
  }, [])

  useEffect(() => {
    if (serviceStatus === 'checking') return

    if (serviceStatus !== 'offline' && serviceStatus !== 'unavailable') {
      activeNoticeRef.current = null
      dismissNotice(DASHBOARD_CONNECTION_NOTICE_ID)
      return
    }

    const noticeSignature = `${serviceStatus}\n${connectionTitle}\n${connectionDescription}`
    if (activeNoticeRef.current === noticeSignature) return
    activeNoticeRef.current = noticeSignature

    notify(connectionTitle, serviceStatus === 'offline' ? 'warning' : 'error', {
      id: DASHBOARD_CONNECTION_NOTICE_ID,
      duration: Infinity,
      description: connectionDescription,
      ...(serviceStatus === 'unavailable'
        ? {
            action: {
              label: '重试连接',
              onClick: () => {
                void refreshDashboard()
              },
            },
          }
        : {}),
    })
  }, [connectionDescription, connectionTitle, refreshDashboard, serviceStatus])

  return null
}
