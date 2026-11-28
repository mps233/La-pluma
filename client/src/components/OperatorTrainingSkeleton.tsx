import { Card } from './common/Card'
import { CardHeaderSkeleton, GlassModeSkeleton, Skeleton } from './common/Skeleton'
import SmoothPanel from './common/SmoothPanel'

export function TrainingSkeleton() {
  return (
    <div className="grid grid-cols-1 items-start gap-[var(--app-space-section)] xl:grid-cols-[minmax(0,1fr)_minmax(22rem,27rem)]" aria-hidden="true">
      <section className="order-1 min-w-0 space-y-4 training-operator-column">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Skeleton variant="title" className="h-5 w-24" />
            <Skeleton variant="text" className="h-3 w-36" />
          </div>
          <Skeleton variant="rect" className="h-7 w-44 rounded-full" />
        </div>
        <div className="space-y-4">
          <GlassModeSkeleton count={3} className="training-status-shell" />
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
            <Skeleton variant="rect" className="col-span-2 h-11 min-w-0 rounded-xl sm:col-span-1" />
            <Skeleton variant="rect" className="h-11 w-full rounded-xl" />
            <Skeleton variant="rect" className="h-11 w-24 rounded-xl" />
          </div>
          <div className="min-h-[260px]">
            <div className="training-operator-grid grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-5 xl:grid-cols-4 2xl:grid-cols-6">
              {Array.from({ length: 12 }, (_, index) => (
                <div key={index} className="training-operator-skeleton relative overflow-hidden rounded-xl p-2.5 surface-soft">
                  <Skeleton variant="rect" className="mb-2.5 aspect-square h-auto w-full rounded-xl" />
                  <div className="space-y-2">
                    <Skeleton variant="text" className="mx-auto h-3 w-16 max-w-full" />
                    <Skeleton variant="rect" className="mx-auto h-5 w-12 rounded-full" />
                    <Skeleton variant="rect" className="h-9 w-full rounded-xl" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <aside className="order-2 min-w-0 space-y-4 xl:sticky xl:top-4 training-support-column">
        <SmoothPanel cornerSize="compact" className="training-settings-panel">
          <div className="px-4 py-3">
            <div className="flex min-h-11 items-center">
              <Skeleton variant="text" className="h-4 w-24" />
            </div>
            <div className="mt-2 divide-y divide-[var(--app-border)]">
              {[1, 2].map(item => (
                <div
                  key={item}
                  className="training-settings-skeleton-row flex min-h-14 items-center justify-between gap-4 py-2.5"
                >
                  <div className="space-y-1.5">
                    <Skeleton variant="text" className="h-3.5 w-20" />
                    <Skeleton variant="text" className="h-2.5 w-36 max-w-full" />
                  </div>
                  <Skeleton variant="rect" className="h-7 w-12 shrink-0 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </SmoothPanel>
        <Card smoothCorners className="training-queue-card !p-0">
          <CardHeaderSkeleton actionWidth="w-16" />
          <div className="divide-y divide-[var(--app-border)] px-4">
            {[1, 2, 3].map(item => (
              <div key={item} className="flex min-h-16 items-center gap-4 py-3">
                <Skeleton variant="rect" className="h-8 w-8 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton variant="text" className="h-3 w-24" />
                  <Skeleton variant="rect" className="h-1.5 w-full rounded-full" />
                </div>
                <Skeleton variant="text" className="h-3 w-8" />
              </div>
            ))}
          </div>
        </Card>
        <SmoothPanel className="training-plan-empty" surfaceClassName="px-6 py-8 text-center">
          <Skeleton variant="rect" className="mx-auto h-12 w-12 rounded-2xl" />
          <Skeleton variant="title" className="mx-auto mt-4 h-5 w-36" />
          <Skeleton variant="text" className="mx-auto mt-3 h-3 w-64 max-w-full" />
          <Skeleton variant="text" className="mx-auto mt-2 h-3 w-48 max-w-full" />
        </SmoothPanel>
      </aside>
    </div>
  )
}

