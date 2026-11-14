import { Card, SmoothPanel } from '@/shared/components'
import { PageHeaderSkeleton, Skeleton } from '@/shared/components/Loading'
import { useDashboardFlowLayout } from '../hooks/useDashboardFlowLayout'

function DashboardSummarySkeleton({ variant }: { variant: 'training' | 'drops' }) {
  return (
    <Card smoothCorners className={`dashboard-summary-card dashboard-summary-skeleton is-${variant} p-0!`}>
      <div className="dashboard-summary-header">
        <div className="dashboard-summary-heading">
          <Skeleton variant="rect" className="h-8 w-8 rounded-lg" />
          <Skeleton variant="title" className="h-4 w-24" />
        </div>
        <Skeleton variant="rect" className="h-8 w-8 rounded-lg" />
      </div>

      {variant === 'training' && (
        <div className="dashboard-summary-body">
          <div className="dashboard-summary-statline">
            <div className="space-y-2">
              <Skeleton variant="title" className="dashboard-summary-number h-9 w-10" />
              <Skeleton variant="text" className="dashboard-summary-number-label h-2.5 w-16" />
            </div>
            <div className="dashboard-summary-copy space-y-2">
              <Skeleton variant="text" className="h-4 w-24" />
              <Skeleton variant="text" className="h-2.5 w-48 max-w-full" />
            </div>
          </div>
          <div className="dashboard-summary-footer">
            <div className="dashboard-stage-list">
              {[14, 18, 16].map((width, index) => (
                <Skeleton key={index} variant="rect" className="h-6 rounded-lg" style={{ width: `${width / 4}rem` }} />
              ))}
            </div>
          </div>
        </div>
      )}

      {variant === 'drops' && (
        <div className="dashboard-summary-body">
          <div className="dashboard-summary-statline">
            <div className="space-y-2">
              <Skeleton variant="title" className="dashboard-summary-number h-9 w-10" />
              <Skeleton variant="text" className="dashboard-summary-number-label h-2.5 w-16" />
            </div>
            <div className="dashboard-summary-copy space-y-2">
              <Skeleton variant="text" className="h-4 w-28" />
              <Skeleton variant="text" className="h-2.5 w-52 max-w-full" />
            </div>
          </div>
          <div className="dashboard-summary-footer">
            <div className="dashboard-drop-list">
              {[1, 2].map(item => (
                <div key={item} className="dashboard-drop-row">
                  <Skeleton variant="rect" className="dashboard-drop-stage h-6 w-12 rounded-lg" />
                  <Skeleton variant="text" className="dashboard-drop-items h-3 w-32 max-w-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

/**
 * Dashboard skeleton mirrors the live dashboard's structural layout classes.
 */
export function DashboardSkeleton() {
  const { flowGridRef, flowCardRef, flowPreviewRef, flowGridStyle } = useDashboardFlowLayout()

  return (
    <div className="app-page dashboard-page" data-page="dashboard" aria-busy="true" aria-label="概览加载中">
      <div className="app-stack-section">
        <PageHeaderSkeleton dashboard />

        <div ref={flowGridRef} className="dashboard-flow-layout" style={flowGridStyle}>
          <div ref={flowCardRef} className="min-w-0">
            <div className="dashboard-flow-glow-shell status-border-beam">
              <Card smoothCorners className="dashboard-flow-card dashboard-flow-skeleton p-0!">
                <div className="dashboard-flow-header">
                  <div className="flex items-center gap-3.5">
                    <Skeleton variant="rect" className="h-8 w-8 rounded-lg" />
                    <Skeleton variant="title" className="h-4 w-20" />
                  </div>
                </div>

                <div className="dashboard-flow-command">
                  <div className="min-w-0 space-y-2">
                    <Skeleton variant="text" className="h-2.5 w-16" />
                    <Skeleton variant="title" className="h-6 w-36 max-w-full" />
                    <Skeleton variant="text" className="h-2.5 w-52 max-w-full" />
                  </div>
                  <div className="dashboard-flow-actions">
                    <Skeleton variant="rect" className="dashboard-flow-primary-action h-11 rounded-xl" />
                  </div>
                </div>

                <div className="dashboard-flow-activity space-y-2">
                  <div className="flex items-center gap-2">
                    <Skeleton variant="circle" className="h-3.5 w-3.5 shrink-0" />
                    <Skeleton variant="text" className="h-2.5 w-16 max-w-full" />
                  </div>
                  <Skeleton variant="text" className="h-4 w-36 max-w-full" />
                  <Skeleton variant="text" className="h-2 w-52 max-w-full" />
                </div>

                <div className="dashboard-flow-stages" data-dashboard-flow-stages>
                  <div className="flex items-center justify-between gap-3.5">
                    <div className="flex items-center gap-2">
                      <span className="dashboard-flow-rail-dot" />
                      <Skeleton variant="text" className="h-3 w-24" />
                    </div>
                    <Skeleton variant="text" className="h-2.5 w-16" />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {[20, 24, 28, 20, 16].map((width, index) => (
                      <Skeleton key={index} variant="rect" className="h-6 rounded-lg" style={{ width: `${width / 4}rem` }} />
                    ))}
                  </div>
                </div>

              </Card>
            </div>
          </div>

          <div ref={flowPreviewRef} className="min-w-0">
            <SmoothPanel data-dashboard-preview-card className="status-border-beam" aria-hidden="true">
              <div className="dashboard-preview-header flex items-center justify-between gap-3.5 border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Skeleton variant="circle" className="h-1.5 w-1.5" />
                  <Skeleton variant="text" className="h-3 w-28" />
                </div>
                <Skeleton variant="rect" className="h-11 w-24 rounded-xl" />
              </div>
              <div data-dashboard-preview-frame className="dashboard-preview-frame relative aspect-video w-full overflow-hidden bg-black">
                <Skeleton variant="rect" className="absolute inset-[12%] h-auto w-auto rounded-xl opacity-60" />
              </div>
            </SmoothPanel>
          </div>
        </div>

        <div className="dashboard-device-section" aria-hidden="true">
          <div className="flex items-center gap-2">
            <div className="h-0.5 flex-1 rounded-full bg-border" />
            <Skeleton variant="text" className="h-3 w-16" />
            <div className="h-0.5 flex-1 rounded-full bg-border" />
          </div>
          <div className="dashboard-device-grid">
            {[1, 2, 3, 4].map((item, index) => (
              <SmoothPanel
                key={item}
                cornerSize="compact"
                className="dashboard-device-card-shell"
                surfaceClassName="dashboard-device-card dashboard-device-skeleton space-y-3"
              >
                <div className="flex items-center gap-2.5">
                  <Skeleton variant="rect" className="h-8 w-8 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton variant="text" className="h-3 w-12" />
                    <Skeleton variant="text" className="h-2.5 w-20" />
                  </div>
                  {index === 3 && <Skeleton variant="text" className="ml-auto h-4 w-10" />}
                </div>
                {index === 3 ? (
                  <div className="dashboard-temperature-chart dashboard-temperature-skeleton">
                    <Skeleton variant="rect" className="h-9 w-full rounded-lg" />
                    <div className="dashboard-temperature-range mt-1 flex justify-between">
                      <Skeleton variant="text" className="h-2 w-8" />
                      <Skeleton variant="text" className="h-2 w-8" />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <Skeleton variant="text" className="h-2.5 w-10" />
                      <Skeleton variant="text" className="h-2.5 w-8" />
                    </div>
                    <Skeleton variant="rect" className="h-1.5 w-full rounded-full" />
                  </div>
                )}
              </SmoothPanel>
            ))}
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <DashboardSummarySkeleton variant="training" />
          <DashboardSummarySkeleton variant="drops" />
        </div>

      </div>
    </div>
  )
}
