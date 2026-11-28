import { Card } from './common/Card'
import { CardHeaderSkeleton, GlassModeSkeleton, Skeleton } from './common/Skeleton'

export function ConfigSkeleton() {
  return (
    <>
      <div data-config-sections>
        <GlassModeSkeleton count={3} />
      </div>
      <div className="config-workspace-grid grid min-w-0 gap-[var(--app-space-section)] xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)] xl:items-start">
        <div className="config-workspace-primary app-stack-section min-w-0">
      <Card smoothCorners className="config-editor-card !p-0">
        <CardHeaderSkeleton actionWidth="w-36" />
        <div className="app-card-content app-stack-card">
          <div className="grid gap-[var(--app-space-card)] md:grid-cols-2">
            {[1, 2].map(item => (
              <div key={item} className="space-y-2">
                <Skeleton variant="text" className="h-3 w-24" />
                <Skeleton variant="rect" className="h-11 w-full rounded-xl" />
                <Skeleton variant="text" className="h-2.5 w-48 max-w-full" />
              </div>
            ))}
          </div>
          <div className="flex min-h-20 flex-wrap items-center justify-between gap-4 rounded-xl p-4 surface-soft">
            <div className="flex min-w-0 items-center gap-4">
              <Skeleton variant="rect" className="h-9 w-9 shrink-0 rounded-xl" />
              <div className="space-y-2">
                <Skeleton variant="text" className="h-3 w-24" />
                <Skeleton variant="text" className="h-2.5 w-40 max-w-full" />
              </div>
            </div>
            <div className="flex gap-2">
              <Skeleton variant="rect" className="h-9 w-28 rounded-xl" />
              <Skeleton variant="rect" className="h-9 w-24 rounded-xl" />
            </div>
          </div>
          <div className="grid gap-[var(--app-space-card)] md:grid-cols-2">
            <div className="space-y-2">
              <Skeleton variant="text" className="h-3 w-24" />
              <Skeleton variant="rect" className="h-11 w-full rounded-xl" />
              <Skeleton variant="text" className="h-2.5 w-48 max-w-full" />
            </div>
            <div className="config-reconnect-row flex min-h-[3.5rem] items-center justify-between gap-4 py-1">
              <div className="space-y-2">
                <Skeleton variant="text" className="h-3 w-20" />
                <Skeleton variant="text" className="h-2.5 w-36 max-w-full" />
              </div>
              <Skeleton variant="rect" className="h-7 w-12 rounded-full" />
            </div>
          </div>
        </div>
      </Card>
      <Card smoothCorners className="config-directory-card !p-0">
        <div className="app-card-content">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <Skeleton variant="rect" className="h-10 w-10 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton variant="title" className="h-4 w-24" />
                <Skeleton variant="text" className="h-3 w-80 max-w-full" />
              </div>
            </div>
            <Skeleton variant="rect" className="h-10 w-24 rounded-xl" />
          </div>
        </div>
      </Card>
        </div>
        <div className="config-workspace-secondary app-stack-section min-w-0">
      <Card smoothCorners className="config-update-card !p-0">
        <CardHeaderSkeleton actionWidth={null} />
        <div className="app-card-content app-stack-card">
          <section className="rounded-xl p-4 surface-soft">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                <Skeleton variant="rect" className="h-9 w-9 shrink-0 rounded-xl" />
                <div className="space-y-2">
                  <Skeleton variant="text" className="h-4 w-24" />
                  <Skeleton variant="text" className="h-2.5 w-48 max-w-full" />
                </div>
              </div>
              <Skeleton variant="rect" className="h-7 w-12 rounded-full" />
            </div>
          </section>
          <div className="grid gap-[var(--app-space-card)] md:grid-cols-2 xl:grid-cols-1">
            {[1, 2].map(item => (
              <div key={item} className="space-y-3 rounded-xl p-4 surface-soft">
                <Skeleton variant="text" className="h-4 w-28" />
                <Skeleton variant="text" className="h-2.5 w-52 max-w-full" />
                <Skeleton variant="rect" className="h-11 w-full rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      </Card>
        </div>
      </div>
    </>
  )
}

/**
 * Lazy route skeletons keep each workspace close to its final proportions.
 */
