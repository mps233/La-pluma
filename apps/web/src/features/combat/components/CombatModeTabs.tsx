import { SegmentedTabNav, type SegmentedTabOption } from '@/shared/components'
import type { CombatMode } from '../types'
import { COMBAT_MODE_OPTIONS } from './CombatTaskCatalog'

interface CombatModeTabsProps {
  activeMode: CombatMode
}

const options: readonly SegmentedTabOption<CombatMode>[] = COMBAT_MODE_OPTIONS.map(({
  id,
  title,
}) => ({
  value: id,
  label: title,
}))

export default function CombatModeTabs({ activeMode }: CombatModeTabsProps) {
  return (
    <SegmentedTabNav
      ariaLabel="作业类型"
      value={activeMode}
      options={options}
      className="combat-mode-shell"
      tabClassName="min-h-11"
      tabId={id => `combat-mode-tab-${id}`}
      panelId={id => (id === activeMode ? `combat-mode-panel-${id}` : undefined)}
    />
  )
}
