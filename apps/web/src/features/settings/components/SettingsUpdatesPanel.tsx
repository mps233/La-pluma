import { Card, CardContent } from '@/shared/ui/card'
import AutoUpdateConfigPanel from './AutoUpdateConfigPanel'
import ComponentUpdatePanel from './ComponentUpdatePanel'

export default function SettingsUpdatesPanel() {
  return (
    <Card>
      <CardContent className="app-stack-card">
        <AutoUpdateConfigPanel />
        <ComponentUpdatePanel />
      </CardContent>
    </Card>
  )
}
