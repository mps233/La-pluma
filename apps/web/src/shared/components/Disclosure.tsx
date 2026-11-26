import type { ComponentProps, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from 'cn'

export interface DisclosureProps extends Omit<ComponentProps<'details'>, 'title'> {
  readonly label: ReactNode
  readonly icon?: ReactNode
  readonly meta?: ReactNode
  readonly summaryClassName?: string
  readonly contentClassName?: string
}

export default function Disclosure({
  label,
  icon,
  meta,
  summaryClassName,
  contentClassName,
  className,
  children,
  ...props
}: DisclosureProps) {
  return (
    <details
      className={cn('group rounded-lg border border-border px-3 py-2', className)}
      {...props}
    >
      <summary
        className={cn(
          'flex min-h-11 cursor-pointer list-none items-center justify-between gap-3.5 rounded-md text-sm font-medium text-foreground marker:hidden focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden [&::-webkit-details-marker]:hidden',
          summaryClassName,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {icon !== undefined && (
            <span className="flex shrink-0 items-center" aria-hidden="true">{icon}</span>
          )}
          <span className="min-w-0">{label}</span>
        </span>
        {meta !== undefined && (
          <span className="shrink-0 text-xs font-normal text-muted-foreground">{meta}</span>
        )}
        <ChevronDown
          size={16}
          className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </summary>
      <div className={cn('mt-3 flex flex-col gap-3 border-t border-border pt-3', contentClassName)}>
        {children}
      </div>
    </details>
  )
}
