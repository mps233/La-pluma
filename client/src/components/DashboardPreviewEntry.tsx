import { memo } from 'react'
import Icons from './Icons'
import { Button } from './common'
import { useDashboardPreview } from '../hooks/useDashboardPreview'

interface DashboardPreviewEntryProps {
  onOpen: () => void
}

const DashboardPreviewEntry = memo(function DashboardPreviewEntry({ onOpen }: DashboardPreviewEntryProps) {
  const { videoRef, fallbackSnapshot, showLivePreview, statusText, headerStatusText } = useDashboardPreview()

  return (
    <div className="rounded-2xl border border-[var(--app-border)] surface-panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--app-border)]">
        <div className="flex items-center gap-2">
          <div className={`h-1.5 w-1.5 rounded-full ${showLivePreview ? 'bg-[var(--app-success)]' : 'bg-[var(--app-accent)]'}`} />
          <span className="text-xs font-medium text-secondary">模拟器实时预览</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-[10px] text-secondary">{headerStatusText}</span>
          <Button onClick={onOpen} variant="ghost" size="sm">打开</Button>
        </div>
      </div>
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`relative h-full w-full bg-black object-contain ${showLivePreview ? 'opacity-100' : 'opacity-0'}`}
        />
        {!showLivePreview && fallbackSnapshot && (
          <img
            src={fallbackSnapshot}
            alt="模拟器截图兜底"
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-contain pointer-events-none"
          />
        )}
        <button
          type="button"
          onClick={onOpen}
          className={`absolute inset-0 flex items-center justify-center text-left ${showLivePreview || fallbackSnapshot ? 'bg-transparent' : 'bg-black'}`}
        >
          {!showLivePreview && !fallbackSnapshot && (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,color-mix(in_srgb,var(--app-accent)_18%,transparent),transparent_45%)] opacity-80" />
          )}
          {!showLivePreview && !fallbackSnapshot && (
            <div className="relative text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--app-border)] surface-soft brand-text">
                <Icons.Monitor />
              </div>
              <div className="text-sm font-semibold text-white">等待 Live 画面</div>
              <div className="mt-1 text-xs text-secondary">点击进入完整控制台</div>
            </div>
          )}
        </button>
        <div className="pointer-events-none absolute left-2 top-2 rounded-lg border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-bg)_55%,transparent)] px-2 py-1 text-[10px] text-primary">
          {statusText}
        </div>
      </div>
    </div>
  )
})

export default DashboardPreviewEntry
