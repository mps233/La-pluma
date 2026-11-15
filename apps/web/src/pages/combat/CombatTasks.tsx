import { CombatWorkspace } from '@/features/combat'

export default function CombatTasks() {
  return (
    <div className="app-page combat-page ios-workspace-page" data-workbench-tasks data-page="combat">
      <div className="app-stack-section">
        <CombatWorkspace />
      </div>
    </div>
  )
}
