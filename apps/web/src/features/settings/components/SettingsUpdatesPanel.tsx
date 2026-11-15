import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import AutoUpdateConfigPanel from './AutoUpdateConfigPanel'
import ComponentUpdatePanel from './ComponentUpdatePanel'

export default function SettingsUpdatesPanel() {
  return (
    <Card className="config-update-card gap-0 p-0!">
      <CardHeader className="border-b py-3.5">
        <CardTitle role="heading" aria-level={3}>组件更新</CardTitle>
      </CardHeader>
      <CardContent className="app-stack-card py-4">
        <AutoUpdateConfigPanel />
        <ComponentUpdatePanel />
      </CardContent>
    </Card>
  )
}
