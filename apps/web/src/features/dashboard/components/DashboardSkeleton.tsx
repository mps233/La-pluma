import { PageShell } from '@/shared/components'
import { Card } from '@/shared/ui/card'
import { Separator } from '@/shared/ui/separator'
import { Skeleton } from '@/shared/ui/skeleton'
import { useDashboardFlowLayout } from '../hooks/useDashboardFlowLayout'
import { DashboardPreviewCard, DashboardPreviewFrame } from './DashboardPreviewShell'

function DashboardSummarySkeleton({ variant }: { variant: 'training' | 'drops' }) {
  return (
    <Card className={`dashboard-summary-card dashboard-summary-skeleton is-${variant} gap-0 p-0!`}>
      <div className="dashboard-summary-header">
        <div className="dashboard-summary-heading">
          <Skeleton className="rounded-sm h-4 w-24" />
        </div>
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>

      {variant === 'training' && (
        <div className="dashboard-summary-body">
          <div className="dashboard-summary-statline">
            <div className="space-y-2">
              <Skeleton className="rounded-sm dashboard-summary-number h-9 w-10" />
              <Skeleton className="rounded-sm dashboard-summary-number-label h-2.5 w-16" />
            </div>
            <div className="dashboard-summary-copy space-y-2">
              <Skeleton className="rounded-sm h-4 w-24" />
              <Skeleton className="rounded-sm h-2.5 w-48 max-w-full" />
            </div>
          </div>
          <div className="dashboard-summary-footer">
            <div className="dashboard-stage-list">
              {[14, 18, 16].map((width, index) => (
                <Skeleton key={index} className="dashboard-stage-skeleton h-6 rounded-lg" style={{ width: `${width / 4}rem` }} />
              ))}
            </div>
          </div>
        </div>
      )}

      {variant === 'drops' && (
        <div className="dashboard-summary-body">
          <div className="dashboard-summary-statline">
            <div className="space-y-2">
              <Skeleton className="rounded-sm dashboard-summary-number h-9 w-10" />
              <Skeleton className="rounded-sm dashboard-summary-number-label h-2.5 w-16" />
            </div>
            <div className="dashboard-summary-copy space-y-2">
              <Skeleton className="rounded-sm h-4 w-28" />
              <Skeleton className="rounded-sm h-2.5 w-52 max-w-full" />
            </div>
          </div>
          <div className="dashboard-summary-footer">
            <div className="dashboard-drop-list">
              <Skeleton className="rounded-sm dashboard-drop-items h-3 w-3/4" />
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
    <PageShell pageKind="dashboard" className="dashboard-page" aria-busy="true" aria-label="概览加载中">
        <div ref={flowGridRef} className="dashboard-flow-layout" style={flowGridStyle}>
          <div ref={flowCardRef} className="min-w-0">
            <Card className="dashboard-flow-card dashboard-flow-skeleton gap-0 p-0!">
              <div className="dashboard-flow-command">
                <div className="min-w-0 space-y-1">
                  <Skeleton className="rounded-sm h-7 w-36 max-w-full" />
                  <Skeleton className="rounded-sm h-4 w-52 max-w-full" />
                </div>
                <div className="dashboard-flow-actions">
                  <Skeleton className="dashboard-flow-primary-action h-8 rounded-lg" />
                </div>
              </div>

              <Separator />

              <div className="dashboard-flow-activity space-y-2">
                <Skeleton className="rounded-sm h-4 w-36 max-w-full" />
                <Skeleton className="rounded-sm h-2 w-52 max-w-full" />
              </div>

              <Separator />

              <div className="dashboard-flow-stages" data-dashboard-flow-stages>
                <Skeleton className="rounded-sm h-3 w-28 max-w-full" />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[20, 24, 28, 20, 16].map((width, index) => (
                    <Skeleton key={index} className="h-6 rounded-lg" style={{ width: `${width / 4}rem` }} />
                  ))}
                </div>
              </div>
            </Card>
          </div>

          <div ref={flowPreviewRef} className="min-w-0">
            <DashboardPreviewCard aria-hidden="true">
              <div className="dashboard-preview-header flex items-center justify-between gap-3.5 border-b border-border px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="rounded-full h-1.5 w-1.5" />
                  <Skeleton className="rounded-sm h-3 w-28" />
                </div>
                <Skeleton className="h-11 w-24 rounded-xl" />
              </div>
              <DashboardPreviewFrame className="bg-black">
                <Skeleton className="absolute inset-[12%] h-auto w-auto rounded-xl opacity-60" />
              </DashboardPreviewFrame>
            </DashboardPreviewCard>
          </div>
        </div>

        <div className="dashboard-device-section" aria-hidden="true">
          <div className="dashboard-device-grid">
            {[1, 2, 3, 4].map((item, index) => (
              <Card
                key={item}
                className="dashboard-device-card-shell dashboard-device-card dashboard-device-skeleton gap-0 space-y-3 p-3.5! max-sm:p-4!"
              >
                <div className="flex items-center gap-2.5">
                  <Skeleton className="h-8 w-8 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="rounded-sm h-3 w-12" />
                    <Skeleton className="rounded-sm h-2.5 w-20" />
                  </div>
                  {index === 3 && <Skeleton className="rounded-sm ml-auto h-4 w-10" />}
                </div>
                {index === 3 ? (
                  <div className="dashboard-temperature-chart dashboard-temperature-skeleton">
                    <Skeleton className="h-9 w-full rounded-lg" />
                    <div className="dashboard-temperature-range mt-1 flex justify-between">
                      <Skeleton className="rounded-sm h-2 w-8" />
                      <Skeleton className="rounded-sm h-2 w-8" />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <Skeleton className="rounded-sm h-2.5 w-10" />
                      <Skeleton className="rounded-sm h-2.5 w-8" />
                    </div>
                    <Skeleton className="h-1.5 w-full rounded-full" />
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>

        <div className="dashboard-summary-grid">
          <DashboardSummarySkeleton variant="training" />
          <DashboardSummarySkeleton variant="drops" />
        </div>

    </PageShell>
  )
}
