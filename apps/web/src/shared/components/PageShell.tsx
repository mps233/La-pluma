import type { ComponentPropsWithoutRef } from 'react'
import type { AppTab } from '@/shared/navigation'

export type PageKind = AppTab | 'gallery'

interface PageShellProps extends ComponentPropsWithoutRef<'div'> {
  pageKind: PageKind
  layout?: 'workspace'
  surface?: 'borderless'
}

export default function PageShell({
  pageKind,
  layout,
  surface,
  className,
  children,
  ...props
}: PageShellProps) {
  return (
    <div
      {...props}
      className={['app-page', className].filter(Boolean).join(' ')}
      data-region="page"
      data-page-kind={pageKind}
      data-page-layout={layout}
      data-page-surface={surface}
    >
      <div className="app-stack-section">{children}</div>
    </div>
  )
}
