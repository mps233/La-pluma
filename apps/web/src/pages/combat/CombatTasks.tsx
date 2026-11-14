import { PageHeader } from '@/shared/components'
import { FloatingStatusIndicator } from '@/features/runtime-status'
import { CombatWorkspace } from '@/features/combat'

export default function CombatTasks() {
  return (
    <div className="app-page combat-page ios-workspace-page" data-workbench-tasks>
      <div className="app-stack-section">
        <PageHeader
          title="自动战斗"
          subtitle="支持单作业、作业集、保全派驻、悖论模拟与链接识别"
          mobileLayout="inline"
          actions={<FloatingStatusIndicator />}
        />

        <CombatWorkspace />
      </div>
    </div>
  )
}
