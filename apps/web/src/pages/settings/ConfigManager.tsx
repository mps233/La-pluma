import { SettingsWorkspace } from '@/features/settings'

export default function ConfigManager() {
  return (
    <div className="app-page ios-workspace-page ios-borderless-cards" data-page="config">
      <div className="app-stack-section">
        <SettingsWorkspace />
      </div>
    </div>
  )
}
