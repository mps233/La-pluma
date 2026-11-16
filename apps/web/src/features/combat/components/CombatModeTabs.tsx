import { SegmentedTabNav, type SegmentedTabOption } from '@/shared/components'
import type { CombatMode } from '../types'
import { COMBAT_MODE_OPTIONS } from './CombatTaskCatalog'

interface CombatModeTabsProps {
  activeMode: CombatMode
}

const options: readonly SegmentedTabOption<CombatMode>[] = COMBAT_MODE_OPTIONS.map(({
  id,
  title,
  desc,
  icon,
}) => ({
  value: id,
  label: title,
  description: desc,
  icon,
}))

export default function CombatModeTabs({ activeMode }: CombatModeTabsProps) {
  return (
    <SegmentedTabNav
      ariaLabel="作业类型"
      value={activeMode}
      options={options}
      className="combat-mode-shell"
      indicatorClassName="combat-mode-highlight"
      indicatorTestId="combat-mode-highlight"
      tabClassName="combat-mode-button min-h-11"
      iconClassName="combat-mode-icon"
      tabId={id => `combat-mode-tab-${id}`}
      panelId={id => (id === activeMode ? `combat-mode-panel-${id}` : undefined)}
    />
  )
}
