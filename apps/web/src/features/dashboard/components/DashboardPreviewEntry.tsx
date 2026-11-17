import { memo } from 'react'
import { Smartphone } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { useDashboardPreview } from '../hooks/useDashboardPreview'
import { useRetainedSnapshot } from '../hooks/useRetainedSnapshot'
import { PreviewModeSegmented } from '@/features/device-mirror'

const DashboardPreviewEntry = memo(function DashboardPreviewEntry() {
  const { videoRef, fallbackSnapshot, showLivePreview, isConnecting, connectionState, statusText, error, retry, available = true } = useDashboardPreview()
  const retainedSnapshot = useRetainedSnapshot(fallbackSnapshot, Boolean(fallbackSnapshot) && !error)
  const hasFrame = showLivePreview || (Boolean(fallbackSnapshot) && !error)

  return (
    <Card
      data-dashboard-preview-card
      className={`status-border-beam gap-0 p-0! ${isConnecting ? 'is-active' : ''}`}
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
        className={`dashboard-preview-frame relative aspect-video w-full overflow-hidden transition-colors duration-200 ${hasFrame ? 'bg-black' : 'is-empty'}`}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          aria-hidden="true"
          className={`relative h-full w-full bg-black object-contain transition-opacity duration-200 ${showLivePreview ? 'opacity-100' : 'opacity-0'}`}
        />
        {retainedSnapshot.snapshot && (
          <img
            src={retainedSnapshot.snapshot}
            alt="模拟器画面快照"
            draggable={false}
            aria-hidden={!retainedSnapshot.visible}
            className={`dashboard-preview-snapshot-image absolute inset-0 h-full w-full select-none object-contain pointer-events-none transition-opacity duration-200 ${retainedSnapshot.visible ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
        <div
          className={`dashboard-preview-empty absolute inset-0 flex items-center justify-center px-4 text-center transition-opacity duration-200 ${hasFrame ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
          role="status"
          aria-live="polite"
          aria-hidden={hasFrame}
        >
          <div>
            <div className="device-preview-empty-icon mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg">
              <Smartphone className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />
            </div>
            <div className="text-sm font-semibold text-foreground">{statusText}</div>
            <div className="mt-3 flex h-7 items-center justify-center">
              {error && (
                <Button onClick={retry} variant="secondary" size="sm">
                  重试
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
})

export default DashboardPreviewEntry
