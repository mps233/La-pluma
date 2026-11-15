import { AutomationWorkspace } from '@/features/automation'

export default function AutomationTasks() {
  return (
    <div className="app-page ios-workspace-page" data-automation-tasks data-page="automation">
      <div className="app-stack-section">
        <AutomationWorkspace />
      </div>
    </div>
  )
}
