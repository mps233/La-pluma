import Icons from '@/shared/components/Icons'
import { SegmentedTabNav, type SegmentedTabOption } from '@/shared/components'
import { ROGUELIKE_TASKS } from '../model/roguelikeTasks'
import type { RoguelikeMode } from '../types'

interface RoguelikeModePanelProps {
  activeMode: RoguelikeMode
}

const options: readonly SegmentedTabOption<RoguelikeMode>[] = ROGUELIKE_TASKS.map((task) => {
  const IconComponent = Icons[task.icon as keyof typeof Icons]
  return {
    value: task.id,
    label: task.name,
    description: task.description,
    icon: IconComponent ? <IconComponent /> : undefined,
  }
})

export default function RoguelikeModePanel({ activeMode }: RoguelikeModePanelProps) {
  return (
    <div className="roguelike-mode-area" data-monitor-area="mode">
      <SegmentedTabNav
        ariaLabel="肉鸽模式"
        value={activeMode}
        options={options}
        className="roguelike-mode-shell"
        listClassName="roguelike-mode-tabs"
        indicatorClassName="roguelike-mode-highlight"
        indicatorTestId="roguelike-mode-highlight"
        tabClassName="roguelike-mode-button min-h-11"
        iconClassName="roguelike-mode-icon"
        tabId={id => `roguelike-mode-tab-${id}`}
        panelId={() => 'roguelike-mode-panel'}
      />
    </div>
  )
}
