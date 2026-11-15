import { PageHeader } from '@/shared/components'
import { FloatingStatusIndicator } from '@/features/runtime-status'
import { AutomationWorkspace } from '@/features/automation'

export default function AutomationTasks() {
  return (
    <div className="app-page ios-workspace-page" data-automation-tasks data-page="automation">
      <div className="app-stack-section">
        <PageHeader
          title="日常任务"
          subtitle="安排日常流程，一键执行或定时运行"
          mobileLayout="inline"
          actions={<FloatingStatusIndicator />}
        />

        <AutomationWorkspace />
      </div>
    </div>
  )
}
