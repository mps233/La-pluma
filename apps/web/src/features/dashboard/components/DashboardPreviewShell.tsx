import type { ComponentProps } from 'react'
import { cn } from 'cn'
import { Card } from '@/shared/ui/card'

export function DashboardPreviewCard({ className, ...props }: ComponentProps<'div'>) {
  return (
    <Card
      data-dashboard-preview-card
      className={cn('status-border-beam gap-0 p-0!', className)}
      {...props}
    />
  )
}

export function DashboardPreviewFrame({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-dashboard-preview-frame
      className={cn('dashboard-preview-frame relative aspect-video w-full overflow-hidden transition-colors duration-200', className)}
      {...props}
    />
  )
}
