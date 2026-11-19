import type { ReactNode } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'

interface AutomationAdvancedSettingsProps {
  children: ReactNode
}

export default function AutomationAdvancedSettings({ children }: AutomationAdvancedSettingsProps) {
  return (
    <details className="group mt-3 rounded-lg border border-border bg-muted px-3 py-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3.5 text-sm font-medium text-gray-700 marker:hidden dark:text-gray-200 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <SlidersHorizontal size={15} strokeWidth={1.9} />
          高级设置
        </span>
        <ChevronDown size={15} strokeWidth={2} className="transition-transform group-open:rotate-180" />
      </summary>

      <div className="mt-3 space-y-3 border-t border-border pt-3">
        {children}
      </div>
    </details>
  )
}
