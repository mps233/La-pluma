import { PageShell } from '@/shared/components'
import { AutomationWorkspace } from '@/features/automation'

export default function AutomationTasks() {
  return (
    <PageShell pageKind="automation" layout="workspace" surface="borderless">
      <AutomationWorkspace />
    </PageShell>
  )
}
