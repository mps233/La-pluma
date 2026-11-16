import { SegmentedTabs, SegmentedTabPanel } from '@/shared/components'
import { useConfigSection } from '../hooks/useConfigSection'
import { useDeviceConnectionActivityCleanup } from '../hooks/useSettingsDeviceConnection'
import ConfigDirectoryPanel from './ConfigDirectoryPanel'
import ConfigSectionNav from './ConfigSectionNav'
import ConnectionConfigPanel from './ConnectionConfigPanel'
import InstanceOptionsPanel from './InstanceOptionsPanel'
import ResourceSourcePanel from './ResourceSourcePanel'
import SettingsUpdatesPanel from './SettingsUpdatesPanel'

export default function SettingsWorkspace() {
  const { section, selectSection } = useConfigSection()
  // 三个配置面板始终挂载，只渲染当前 section；切换 section 不清空草稿与反馈。
  useDeviceConnectionActivityCleanup()

  return (
    <div className="config-workspace-grid grid min-w-0 gap-4.5 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)] xl:items-start">
      <SegmentedTabs value={section} onValueChange={selectSection}>
        <div className="config-workspace-primary app-stack-section min-w-0">
          <ConfigSectionNav section={section} />
          <SegmentedTabPanel value="connection" id="config-section-panel-connection" keepMounted>
            <ConnectionConfigPanel isActive={section === 'connection'} />
          </SegmentedTabPanel>
          <SegmentedTabPanel value="resource" id="config-section-panel-resource" keepMounted>
            <ResourceSourcePanel isActive={section === 'resource'} />
          </SegmentedTabPanel>
          <SegmentedTabPanel value="instance" id="config-section-panel-instance" keepMounted>
            <InstanceOptionsPanel isActive={section === 'instance'} />
          </SegmentedTabPanel>
          <ConfigDirectoryPanel />
        </div>
      </SegmentedTabs>

      <div className="config-workspace-secondary app-stack-section min-w-0">
        <SettingsUpdatesPanel />
      </div>
    </div>
  )
}
