import { memo } from 'react'
import { Monitor } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { SmoothPanel } from '@/shared/components'
import { useDashboardPreview } from '../hooks/useDashboardPreview'
import { PreviewModeSegmented } from '@/features/device-mirror'

const DashboardPreviewEntry = memo(function DashboardPreviewEntry() {
  const { videoRef, fallbackSnapshot, showLivePreview, isConnecting, connectionState, statusText, error, retry, available = true } = useDashboardPreview()

  return (
    <SmoothPanel
      data-dashboard-preview-card
      className={`status-border-beam ${isConnecting ? 'is-active' : ''}`}
      aria-busy={isConnecting}
    >
      <div className="dashboard-preview-header flex items-center justify-between gap-3.5 px-4 py-2 border-b border-border">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`preview-status-light is-${connectionState}`}
            data-preview-status={connectionState}
            role="img"
            aria-label={statusText}
            title={statusText}
          />
          <span className="truncate text-xs font-medium text-muted-foreground">画面预览</span>
        </div>
        <PreviewModeSegmented unavailable={!available} />
      </div>
      <div
        data-dashboard-preview-frame
        className={`dashboard-preview-frame relative aspect-video w-full overflow-hidden ${showLivePreview || fallbackSnapshot ? 'bg-black' : 'is-empty'}`}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          aria-hidden="true"
          className={`relative h-full w-full bg-black object-contain ${showLivePreview ? 'opacity-100' : 'opacity-0'}`}
        />
        {!showLivePreview && fallbackSnapshot && (
          <img
            src={fallbackSnapshot}
            alt="模拟器画面快照"
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-contain pointer-events-none"
          />
        )}
        {!showLivePreview && !fallbackSnapshot && (
          <div
            className="dashboard-preview-empty absolute inset-0 flex items-center justify-center px-4 text-center"
            role="status"
            aria-live="polite"
          >
            <div>
              <div className="device-preview-empty-icon mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg">
                <Monitor size={17} strokeWidth={2} />
              </div>
              <div className="text-sm font-semibold text-foreground">{statusText}</div>
            </div>
          </div>
        )}
        {error && (
          <Button onClick={retry} variant="secondary" size="sm" className="absolute bottom-2 right-2">
            重试实时预览
          </Button>
        )}
      </div>
    </SmoothPanel>
  )
})

export default DashboardPreviewEntry
