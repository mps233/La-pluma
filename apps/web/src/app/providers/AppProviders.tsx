import { MotionConfig } from 'framer-motion'
import type { ReactNode } from 'react'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { QueryProvider } from './QueryProvider'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          {children}
        </TooltipProvider>
      </MotionConfig>
    </QueryProvider>
  )
}
