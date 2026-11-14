import { Card, CardContent, CardHeader } from '@/shared/components'
import AutoUpdateConfigPanel from './AutoUpdateConfigPanel'
import ComponentUpdatePanel from './ComponentUpdatePanel'

export default function SettingsUpdatesPanel() {
  return (
    <Card smoothCorners className="config-update-card p-0!">
      <CardHeader title="组件更新" />
      <CardContent className="app-stack-card">
        <AutoUpdateConfigPanel />
        <ComponentUpdatePanel />
      </CardContent>
    </Card>
  )
}
