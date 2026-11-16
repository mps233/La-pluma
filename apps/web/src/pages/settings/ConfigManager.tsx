import { PageShell } from '@/shared/components'
import { SettingsWorkspace } from '@/features/settings'

export default function ConfigManager() {
  return (
    <PageShell pageKind="config" layout="workspace" surface="borderless">
      <SettingsWorkspace />
    </PageShell>
  )
}
