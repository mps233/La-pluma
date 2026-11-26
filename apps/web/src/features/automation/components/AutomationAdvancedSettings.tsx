import type { ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Disclosure } from '@/shared/components'

interface AutomationAdvancedSettingsProps {
  children: ReactNode
}

export default function AutomationAdvancedSettings({ children }: AutomationAdvancedSettingsProps) {
  return (
    <Disclosure
      label="高级设置"
      icon={<SlidersHorizontal size={15} strokeWidth={1.9} aria-hidden="true" />}
      className="mt-3 bg-muted"
    >
      {children}
    </Disclosure>
  )
}
