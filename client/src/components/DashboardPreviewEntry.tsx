import { memo } from 'react'
import { Play, Radio, RotateCw, Smartphone } from 'lucide-react'
import { Button, SmoothPanel } from './common'
import PreviewModeControls, { PreviewAutoStartToggle } from './PreviewModeControls'
import { useDashboardPreview } from '../hooks/useDashboardPreview'
import { usePreviewStore } from '../stores'

const DashboardPreviewEntry = memo(function DashboardPreviewEntry() {
  const {
    mode,
    videoRef,
    fallbackSnapshot,
    showLivePreview,
    isConnecting,
    statusText,
    headerStatusText,
    connectionStatus,
    connectionError,
    reconnectPreview,
  } = useDashboardPreview()
  const setMode = usePreviewStore(state => state.setMode)
  const hasFrame = showLivePreview || Boolean(fallbackSnapshot)
  const showReconnect = mode === 'live' && !showLivePreview

  const statusDotClass = showLivePreview
    ? 'bg-[var(--app-success)]'
    : hasFrame
      ? 'bg-[var(--app-accent)]'
      : 'bg-[var(--app-text-soft)]'

  const emptyState = (() => {
    if (mode === 'off') {
      return {
        title: '预览已关闭',
        description: '选择“快照”或“实时”开始查看模拟器。',
        action: (
          <Button
            size="sm"
            variant="primary"
            className="scrcpy-empty-action min-w-32 px-4"
            icon={<Play className="h-3.5 w-3.5" strokeWidth={1.8} />}
            onClick={() => setMode('live')}
          >
            启动预览
          </Button>
        ),
      }
    }
    if (mode === 'snapshot') {
      return {
        title: '等待画面快照',
        description: '快照每 10\u00A0秒刷新一次，也可以切换到实时画面。',
        action: (
          <Button
            size="sm"
            variant="secondary"
            className="scrcpy-empty-action min-w-32 px-4"
            icon={<Radio className="h-3.5 w-3.5" strokeWidth={1.8} />}
            onClick={() => setMode('live')}
          >
            改用实时
          </Button>
        ),
      }
    }
    if (connectionError) {
      return {
        title: '预览连接失败',
        description: connectionError,
        action: (
          <Button
            size="sm"
            variant="primary"
            className="scrcpy-empty-action min-w-32 px-4"
            icon={<RotateCw className="h-3.5 w-3.5" strokeWidth={1.8} />}
            onClick={reconnectPreview}
          >
            重试预览
          </Button>
        ),
      }
    }
    if (isConnecting) {
      return {
        title: '正在连接实时画面',
        description: '首次连接会自动启动预览服务。',
        action: undefined,
      }
    }
    return {
      title: '等待实时画面',
      description: '若设备息屏，请先唤醒设备。',
      action: (
        <Button
          size="sm"
          variant="secondary"
          className="scrcpy-empty-action min-w-32 px-4"
          icon={<RotateCw className="h-3.5 w-3.5" strokeWidth={1.8} />}
          onClick={reconnectPreview}
        >
          重试预览
        </Button>
      ),
    }
  })()

  return (
    <SmoothPanel
      data-dashboard-preview-card
      data-preview-mode={mode}
      data-preview-status={statusText}
      data-preview-connection={connectionStatus}
      data-preview-error={connectionError ?? ''}
      className="dashboard-preview-card"
      surfaceClassName="automation-monitor-surface dashboard-preview-surface"
      aria-busy={isConnecting}
    >
      <div className="task-monitor-panel is-compact">
        <div className="scrcpy-device-layout is-compact">
          <div className="space-y-3 min-w-0">
            <div className="scrcpy-view-header is-compact flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="dashboard-preview-eyebrow">Preview</div>
                <div className="scrcpy-view-title-row flex min-w-0 items-center gap-2">
                  <span className={`scrcpy-view-status-dot h-2 w-2 rounded-full ${statusDotClass}`} />
                  <span className="scrcpy-view-title">模拟器画面</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span
                  className="dashboard-preview-status-chip"
                  role="status"
                  aria-live="polite"
                  title={statusText}
                >
                  {headerStatusText}
                </span>
                {showReconnect && (
                  <button
                    type="button"
                    onClick={reconnectPreview}
                    title="重连预览"
                    aria-label="重连预览"
                    className="dashboard-preview-reconnect"
                  >
                    <RotateCw className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </button>
                )}
                <PreviewAutoStartToggle />
              </div>
            </div>

            <div
              data-dashboard-preview-frame
              className={`scrcpy-video-frame status-border-beam relative flex aspect-video w-full items-center justify-center overflow-hidden shadow-sm ${
                isConnecting ? 'is-active ' : ''
              }${hasFrame ? 'is-connected bg-black' : 'is-empty ring-1 ring-inset ring-[var(--app-border)]'}`}
              aria-busy={isConnecting}
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
                <div
                  className="scrcpy-empty-state absolute inset-0 flex items-center justify-center px-6 text-center"
                  role={mode === 'live' && connectionError ? 'alert' : 'status'}
                  aria-live="polite"
                >
                  <div className="scrcpy-empty-content w-full max-w-sm">
                    <div className="device-preview-empty-icon mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg">
                      <Smartphone className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />
                    </div>
                    <div className="scrcpy-empty-title mb-1 text-sm font-semibold text-primary">{emptyState.title}</div>
                    <div className="scrcpy-empty-description mx-auto max-w-md text-xs leading-5 text-secondary">
                      {emptyState.description}
                    </div>
                    {emptyState.action && (
                      <div className="scrcpy-empty-actions mt-4 flex justify-center gap-2">
                        {emptyState.action}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="dashboard-preview-settings">
              <div className="dashboard-preview-setting-row">
                <span className="dashboard-preview-setting-label">预览模式</span>
                <PreviewModeControls />
              </div>
            </div>
          </div>
        </div>
      </div>
    </SmoothPanel>
  )
})

export default DashboardPreviewEntry
