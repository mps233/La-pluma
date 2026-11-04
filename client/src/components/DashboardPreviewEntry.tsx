import { memo } from 'react'
import { Monitor } from 'lucide-react'
import { Button, SmoothPanel } from './common'
import PreviewModeControls, { PreviewAutoStartSetting } from './PreviewModeControls'
import { useDashboardPreview } from '../hooks/useDashboardPreview'

const DashboardPreviewEntry = memo(function DashboardPreviewEntry() {
  const { mode, videoRef, fallbackSnapshot, showLivePreview, isConnecting, statusText, headerStatusText, connectionStatus, connectionError, reconnectPreview } = useDashboardPreview()
  const hasFrame = showLivePreview || Boolean(fallbackSnapshot)

  return (
    <SmoothPanel
      data-dashboard-preview-card
      data-preview-mode={mode}
      data-preview-status={statusText}
      data-preview-connection={connectionStatus}
      data-preview-error={connectionError ?? ''}
      className={`status-border-beam ${isConnecting ? 'is-active' : ''}`}
      aria-busy={isConnecting}
    >
      <div className="dashboard-preview-header flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5 border-b border-[var(--app-border)]">
        <div className="flex min-w-0 items-center gap-2">
          <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${showLivePreview ? 'bg-[var(--app-success)]' : hasFrame ? 'bg-[var(--app-accent)]' : 'bg-[var(--app-text-soft)]'}`} />
          <span className="truncate text-xs font-medium text-secondary">模拟器实时预览</span>
          <span className="shrink-0 text-[11px] text-secondary">{headerStatusText}</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
          {mode === 'live' && !showLivePreview && (
            <Button onClick={reconnectPreview} variant="ghost" size="sm" className="min-h-11 px-2 sm:min-h-8">
              重连
            </Button>
          )}
          <PreviewModeControls />
        </div>
      </div>
      <div
        data-dashboard-preview-frame
        className={`dashboard-preview-frame relative aspect-video w-full overflow-hidden ${hasFrame ? 'bg-black' : 'is-empty'}`}
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
        {!hasFrame && (
          <div className={`absolute inset-0 flex items-center justify-center text-center ${mode === 'off' || mode === 'snapshot' || mode === 'live' ? 'dashboard-preview-empty' : ''}`}>
            <div className="relative">
              <div className="device-preview-empty-icon mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg">
                <Monitor size={17} strokeWidth={2} />
              </div>
              <div className="text-sm font-semibold text-primary">
                {mode === 'off' ? '预览已关闭' : mode === 'snapshot' ? '等待画面快照' : '等待 Live 画面'}
              </div>
              <div className="mt-1 max-w-64 px-3 text-xs text-secondary">
                {mode === 'off'
                  ? '选择“快照”或“实时”开始查看模拟器'
                  : mode === 'snapshot'
                    ? '快照每 10 秒刷新一次'
                    : '实时画面正在连接'}
              </div>
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute left-2 top-2 rounded-lg border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-bg)_55%,transparent)] px-2 py-1 text-[11px] text-primary">
          {statusText}
        </div>
      </div>
      <div className="border-t border-[var(--app-border)] px-4 py-2.5">
        <PreviewAutoStartSetting compact />
      </div>
    </SmoothPanel>
  )
})

export default DashboardPreviewEntry
