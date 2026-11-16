import type { ReactNode } from 'react'
import { cva } from 'class-variance-authority'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from 'cn'
import { useFluidTabIndicator } from '@/shared/hooks/useFluidTabIndicator'
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
  indicatorTestId?: string
  tabClassName?: string
  iconClassName?: string
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

const segmentedTabVariants = cva(
  [
    'app-workspace-segment',
    'h-13 min-h-13 max-lg:h-13.5 max-lg:min-h-13.5',
    'justify-start! max-lg:justify-center!',
    'gap-2.5! max-lg:gap-0.75!',
    'rounded-full! border-0!',
    'px-3! py-2! max-lg:px-[0.3rem]! max-lg:py-1!',
    'transition-colors!',
    'text-muted-foreground!',
    'focus-visible:ring-0! focus-visible:outline-2! -outline-offset-3! focus-visible:outline-primary!',
  ].join(' '),
  {
    variants: {
      selected: {
        true: [
          'is-selected',
          'data-active:bg-transparent! data-active:text-primary-strong! data-active:shadow-none!',
          'data-active:hover:bg-transparent! data-active:hover:text-primary-strong!',
        ].join(' '),
        false: 'hover:bg-transparent! hover:text-foreground!',
      },
    },
    defaultVariants: {
      selected: false,
    },
  },
)

const listBaseClassName = [
  'app-workspace-segment-list',
  'grid w-full h-auto! items-stretch justify-start rounded-none! bg-transparent! p-0! text-inherit!',
].join(' ')

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
  value,
  options,
  className,
  listClassName,
  indicatorClassName,
  indicatorTestId,
  tabClassName,
  iconClassName,
  tabId,
  panelId,
}: SegmentedTabNavProps<T>) {
  const shouldReduceMotion = useReducedMotion()
  const { containerRef, activeRect, setTabRef } = useFluidTabIndicator(value)

  return (
    <div className={cn('app-workspace-segments app-liquid-tab-pill', className)}>
      <TabsList
        ref={containerRef}
        activateOnFocus={false}
        aria-label={ariaLabel}
        className={cn(listBaseClassName, listClassName)}
      >
        {activeRect.width > 0 && (
          <motion.div
            data-testid={indicatorTestId}
            aria-hidden="true"
            className={cn('app-workspace-segment-indicator', indicatorClassName)}
            initial={false}
            animate={{
              x: activeRect.x,
              y: activeRect.y,
              width: activeRect.width,
              height: activeRect.height,
            }}
            transition={shouldReduceMotion
              ? { duration: 0 }
              : { type: 'spring', stiffness: 420, damping: 38, mass: 0.72 }}
          />
        )}
        {options.map((option) => {
          const selected = option.value === value
          const tabPanelId = panelId?.(option.value)
          return (
            <TabsTrigger
              key={option.value}
              value={option.value}
              ref={(element) => {
                setTabRef(option.value)(element)
              }}
              id={tabId?.(option.value)}
              {...(tabPanelId ? { 'aria-controls': tabPanelId } : {})}
              className={cn(segmentedTabVariants({ selected }), tabClassName)}
            >
              {option.icon && (
                <span
                  className={cn('app-workspace-segment-icon', iconClassName)}
                  aria-hidden="true"
                >
                  {option.icon}
                </span>
              )}
              <span className="app-workspace-segment-copy">
                <span>{option.label}</span>
                {option.description && <small>{option.description}</small>}
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
