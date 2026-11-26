import type { ReactNode } from 'react'
import { cn } from 'cn'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'

export interface SegmentedTabOption<T extends string> {
  value: T
  label: string
  description?: string
  icon?: ReactNode
}

export interface SegmentedTabsProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  children: ReactNode
}

export interface SegmentedTabNavProps<T extends string> {
  ariaLabel: string
  value: T
  options: readonly SegmentedTabOption<T>[]
  className?: string
  listClassName?: string
  indicatorClassName?: string
  tabClassName?: string
  iconClassName?: string
  disabled?: boolean
  tabId?: (value: T) => string
  panelId?: (value: T) => string | undefined
}

export interface SegmentedTabPanelProps<T extends string> {
  value: T
  id?: string
  keepMounted?: boolean
  className?: string
  children: ReactNode
}

const listBaseClassName = 'app-workspace-segment-list grid! w-full! h-auto!'

export function SegmentedTabs<T extends string>({
  value,
  onValueChange,
  children,
}: SegmentedTabsProps<T>) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string') onValueChange(next as T)
      }}
      className="contents"
    >
      {children}
    </Tabs>
  )
}

export function SegmentedTabNav<T extends string>({
  ariaLabel,
  value: _value,
  options,
  className,
  listClassName,
  indicatorClassName: _indicatorClassName,
  tabClassName,
  iconClassName,
  disabled,
  tabId,
  panelId,
}: SegmentedTabNavProps<T>) {
  return (
    <div className={className}>
      <TabsList
        activateOnFocus={false}
        aria-label={ariaLabel}
        className={cn(listBaseClassName, listClassName)}
      >
        {options.map((option) => {
          const tabPanelId = panelId?.(option.value)
          return (
            <TabsTrigger
              key={option.value}
              value={option.value}
              disabled={disabled}
              id={tabId?.(option.value)}
              {...(tabPanelId ? { 'aria-controls': tabPanelId } : {})}
              className={tabClassName}
            >
              {option.icon && (
                <span className={cn('app-workspace-segment-icon', iconClassName)} aria-hidden="true">
                  {option.icon}
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate">{option.label}</span>
                {option.description && (
                  <small className="block truncate text-muted-foreground max-lg:hidden">
                    {option.description}
                  </small>
                )}
              </span>
            </TabsTrigger>
          )
        })}
      </TabsList>
    </div>
  )
}

export function SegmentedTabPanel<T extends string>({
  value,
  id,
  keepMounted = false,
  className,
  children,
}: SegmentedTabPanelProps<T>) {
  return (
    <TabsContent
      value={value}
      {...(id !== undefined ? { id } : {})}
      keepMounted={keepMounted}
      className={cn('min-w-0 flex-none', className)}
      style={{ fontSize: 'inherit', lineHeight: 'inherit' }}
    >
      {children}
    </TabsContent>
  )
}
