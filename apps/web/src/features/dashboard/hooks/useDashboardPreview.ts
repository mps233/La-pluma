import { useRef } from 'react'
import { useAutomationAvailability } from '@/features/runtime-status'
import {
  derivePreviewStatus,
  usePreviewInfrastructureView,
  usePreviewSession,
  usePreviewSnapshot,
} from '@/features/device-mirror'

export function useDashboardPreview() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const { isAvailable } = useAutomationAvailability()
  const infrastructure = usePreviewInfrastructureView()
  const preview = usePreviewSession({
    videoRef,
  })
  const snapshot = usePreviewSnapshot(isAvailable)
  const status = derivePreviewStatus({
    mode: preview.mode,
    available: isAvailable,
    paused: preview.paused,
    liveStatus: preview.status,
    liveError: preview.error,
    snapshotHasImage: Boolean(snapshot.image),
    snapshotError: snapshot.error,
    infrastructureError: infrastructure.infrastructureError,
  })

  const retry = () => {
    switch (status.retry?.target) {
      case 'snapshot':
        snapshot.retry()
        break
      case 'live':
        preview.connect()
        break
      case 'infrastructure':
        infrastructure.onRefreshInfrastructure()
        break
    }
  }

  return {
    videoRef,
    fallbackSnapshot: snapshot.image,
    isConnecting: preview.isConnecting,
    status,
    retry,
    available: isAvailable,
  }
}
