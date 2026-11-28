import { Card } from './common/Card'
import { GlassModeSkeleton, Skeleton } from './common/Skeleton'

export function StatisticsSkeleton() {
  return (
    <>
      <GlassModeSkeleton count={3} className="data-statistics-view-switcher data-statistics-mode-shell" />
      <div className="min-w-0 app-stack-section">
        <Card smoothCorners className="data-statistics-task-card !p-0">
          <div className="data-statistics-task-content">
            <div className="data-statistics-task-header mb-4 flex items-start gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton variant="rect" className="h-8 w-8 rounded-xl" />
                  <Skeleton variant="text" className="h-4 w-24" />
                  <Skeleton variant="rect" className="h-6 w-16 rounded-full" />
                </div>
                <Skeleton variant="text" className="h-3 w-44 max-w-full" />
              </div>
              <div className="data-statistics-task-actions flex shrink-0 items-center gap-2">
                <Skeleton variant="rect" className="h-10 w-32 rounded-xl" />
                <Skeleton variant="rect" className="h-10 w-28 rounded-xl" />
              </div>
            </div>
            <div className="data-statistics-result-grid grid grid-cols-3 gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="rounded-2xl border border-transparent p-3 surface-soft">
                  <Skeleton variant="rect" className="aspect-square h-auto w-full rounded-xl" />
                  <Skeleton variant="text" className="mx-auto mt-3 h-3 w-16 max-w-full" />
                  <Skeleton variant="rect" className="mx-auto mt-2 h-5 w-12 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </>
  )
}

