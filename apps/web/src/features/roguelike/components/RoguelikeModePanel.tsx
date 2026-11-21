import Icons from '@/shared/components/Icons'
import { SegmentedTabNav, type SegmentedTabOption } from '@/shared/components'
import { ROGUELIKE_TASKS } from '../model/roguelikeTasks'
import type { RoguelikeMode } from '../types'

interface RoguelikeModePanelProps {
  activeMode: RoguelikeMode
  disabled?: boolean
}

const options: readonly SegmentedTabOption<RoguelikeMode>[] = ROGUELIKE_TASKS.map((task) => {
  const IconComponent = Icons[task.icon as keyof typeof Icons]
  return {
    value: task.id,
    label: task.name,
    icon: IconComponent ? <IconComponent /> : undefined,
  }
})

export default function RoguelikeModePanel({ activeMode, disabled }: RoguelikeModePanelProps) {
  return (
    <div className="roguelike-mode-area" data-monitor-area="mode">
      <SegmentedTabNav
        ariaLabel="肉鸽模式"
        value={activeMode}
        options={options}
        disabled={disabled}
        className="roguelike-mode-shell"
        tabClassName="min-h-11"
        tabId={id => `roguelike-mode-tab-${id}`}
        panelId={() => 'roguelike-mode-panel'}
      />
    </div>
  )
}
