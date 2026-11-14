import { PageHeader } from '@/shared/components'
import { FloatingStatusIndicator } from '@/features/runtime-status'
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
    <>
      <PageHeader
        title="配置"
        subtitle="连接设备、管理运行选项与组件更新"
        mobileLayout="inline"
        actions={(
          <FloatingStatusIndicator
            className="w-full overflow-hidden sm:w-auto"
            textClassName="truncate whitespace-nowrap"
          />
        )}
      />

      <div className="config-workspace-grid grid min-w-0 gap-4.5 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)] xl:items-start">
        <div className="config-workspace-primary app-stack-section min-w-0">
          <ConfigSectionNav section={section} onSelect={selectSection} />
          <ConnectionConfigPanel isActive={section === 'connection'} />
          <ResourceSourcePanel isActive={section === 'resource'} />
          <InstanceOptionsPanel isActive={section === 'instance'} />
          <ConfigDirectoryPanel />
        </div>

        <div className="config-workspace-secondary app-stack-section min-w-0">
          <SettingsUpdatesPanel />
        </div>
      </div>
    </>
  )
}
