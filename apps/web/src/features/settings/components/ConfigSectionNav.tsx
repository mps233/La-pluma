import { SegmentedTabNav, type SegmentedTabOption } from '@/shared/components'
import {
  CONFIG_SECTION_IDS,
  type ConfigSectionId,
} from '../model/configSection'
import { CONFIG_SECTION_VIEWS } from './configSectionViews'

export interface ConfigSectionNavProps {
  section: ConfigSectionId
}

const options: readonly SegmentedTabOption<ConfigSectionId>[] = CONFIG_SECTION_IDS.map((id) => {
  const view = CONFIG_SECTION_VIEWS[id]
  return {
    value: id,
    label: view.name,
    description: view.description,
    icon: view.icon,
  }
})

export default function ConfigSectionNav({ section }: ConfigSectionNavProps) {
  return (
    <SegmentedTabNav
      ariaLabel="配置类型"
      value={section}
      options={options}
      className="w-full"
      listClassName="grid-cols-3"
      indicatorTestId="config-section-highlight"
      tabClassName="min-h-11"
      tabId={id => `config-section-tab-${id}`}
      panelId={id => `config-section-panel-${id}`}
    />
  )
}
