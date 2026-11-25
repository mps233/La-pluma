import { useRef } from 'react'
import { useSettingsSectionNavigation } from '../hooks/useSettingsSectionNavigation'
import { useDeviceConnectionActivityCleanup } from '../hooks/useSettingsDeviceConnection'
import AppearanceCard from './AppearanceCard'
import ConfigDirectoryPanel from './ConfigDirectoryPanel'
import ConnectionConfigPanel from './ConnectionConfigPanel'
import InstanceOptionsPanel from './InstanceOptionsPanel'
import ResourceSourcePanel from './ResourceSourcePanel'
import SettingsSection from './SettingsSection'
import SettingsSectionNav from './SettingsSectionNav'
import SettingsUpdatesPanel from './SettingsUpdatesPanel'

export default function SettingsWorkspace() {
  const contentRef = useRef<HTMLDivElement>(null)
  const { activeSection, selectSection } = useSettingsSectionNavigation(contentRef)
  useDeviceConnectionActivityCleanup()

  return (
    <div className="mx-auto grid w-full max-w-6xl min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_13rem] xl:items-start xl:gap-10">
      <div ref={contentRef} className="flex min-w-0 flex-col gap-10">
        <SettingsSection id="connection">
          <ConnectionConfigPanel />
        </SettingsSection>
        <SettingsSection id="resource">
          <ResourceSourcePanel />
        </SettingsSection>
        <SettingsSection id="instance">
          <InstanceOptionsPanel />
        </SettingsSection>
        <SettingsSection id="config-directory">
          <ConfigDirectoryPanel />
        </SettingsSection>
        <SettingsSection id="appearance">
          <AppearanceCard />
        </SettingsSection>
        <SettingsSection id="updates">
          <SettingsUpdatesPanel />
        </SettingsSection>
      </div>
      <SettingsSectionNav activeSection={activeSection} onSelect={selectSection} />
    </div>
  )
}
