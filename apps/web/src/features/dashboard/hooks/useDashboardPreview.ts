import { useRef } from 'react'
import { useAutomationAvailability } from '@/features/runtime-status'
import { usePreviewSession, usePreviewSnapshot } from '@/features/device-mirror'

export type PreviewConnectionState = 'off' | 'connecting' | 'snapshot' | 'live' | 'idle' | 'error'

export function useDashboardPreview() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const { isAvailable } = useAutomationAvailability()
  const preview = usePreviewSession({
    videoRef,
  })
  const snapshot = usePreviewSnapshot(isAvailable)
  const showLivePreview = preview.mode === 'live' && !preview.paused && preview.status === 'connected'
  const error = preview.mode === 'live' ? preview.error : snapshot.error
  const statusText = preview.mode === 'off' ? '预览已关闭'
    : preview.paused ? '后台已暂停'
    : preview.mode === 'snapshot' ? error || (snapshot.image ? '画面快照 · 10s' : '正在获取快照')
    : error || (showLivePreview ? '实时画面' : preview.isConnecting ? '正在连接' : '实时预览待连接')
  const connectionState: PreviewConnectionState = error ? 'error'
    : preview.mode === 'off' ? 'off'
    : showLivePreview ? 'live'
    : preview.isConnecting ? 'connecting'
    : preview.mode === 'snapshot' ? (snapshot.image ? 'snapshot' : 'connecting')
    : 'idle'

  return {
    videoRef,
    fallbackSnapshot: snapshot.image,
    showLivePreview,
    isConnecting: preview.isConnecting,
    connectionState,
    statusText,
    headerStatusText: showLivePreview ? `${preview.stats?.width || 0}×${preview.stats?.height || 0}` : statusText,
    retry: preview.mode === 'snapshot' ? snapshot.retry : preview.connect,
    error,
    available: isAvailable,
  }
}
