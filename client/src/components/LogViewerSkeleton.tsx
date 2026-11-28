import { Card } from './common/Card'
import { CardHeaderSkeleton, GlassModeSkeleton, Skeleton } from './common/Skeleton'

export function LogsSkeleton() {
  return (
    <>
      <GlassModeSkeleton count={2} className="log-mode-shell" />
      <Card smoothCorners className="log-card log-toolbar-card !p-0">
        <div className="app-card-content log-toolbar">
          <div className="log-toolbar-controls">
            {[1, 2].map(item => (
              <div key={item} className="log-toggle-control flex min-h-11 min-w-0 items-center justify-between gap-4">
                <Skeleton variant="text" className="h-3 w-14" />
                <Skeleton variant="rect" className="h-5 w-8 rounded-full" />
              </div>
            ))}
            <Skeleton variant="rect" className="col-span-2 h-11 w-full rounded-xl sm:col-auto sm:w-36" />
            <Skeleton variant="rect" className="col-span-2 h-11 w-full rounded-xl sm:col-auto sm:min-w-56 sm:flex-1" />
          </div>
          <div className="log-toolbar-actions">
            <Skeleton variant="rect" className="h-10 w-20 rounded-xl" />
            <Skeleton variant="rect" className="h-10 w-20 rounded-xl" />
          </div>
        </div>
      </Card>
      <Card smoothCorners className="log-card !p-0">
        <CardHeaderSkeleton actionWidth="w-14" />
        <div className="app-card-content log-console-content">
          <div className="log-console">
            {Array.from({ length: 10 }, (_, index) => (
              <div key={index} className="log-row">
                <div className="log-row-meta">
                  <Skeleton variant="text" className="h-3 w-full" />
                  <Skeleton variant="rect" className="h-5 w-full rounded" />
                </div>
                <Skeleton variant="text" className="mt-1 h-3" style={{ width: `${58 + (index % 4) * 9}%` }} />
              </div>
            ))}
          </div>
        </div>
      </Card>
      <Card smoothCorners className="log-card log-history-card !p-0">
        <CardHeaderSkeleton actionWidth="w-28" />
        <div className="app-card-content log-history-content">
          <div className="log-history-list">
            {[1, 2, 3].map(item => (
              <div key={item} className="log-history-row">
                <Skeleton variant="rect" className="log-history-icon h-8 w-8 rounded-xl" />
                <span className="log-history-copy">
                  <Skeleton variant="text" className="h-3 w-36 max-w-full" />
                  <Skeleton variant="text" className="h-2.5 w-52 max-w-full" />
                </span>
                <Skeleton variant="rect" className="h-4 w-4 rounded" />
              </div>
            ))}
          </div>
        </div>
      </Card>
    </>
  )
}

