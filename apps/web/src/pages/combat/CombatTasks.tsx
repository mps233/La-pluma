import { PageShell } from '@/shared/components'
import { CombatWorkspace } from '@/features/combat'

export default function CombatTasks() {
  return (
    <PageShell pageKind="combat" layout="workspace" surface="borderless" className="combat-page">
      <CombatWorkspace />
    </PageShell>
  )
}
