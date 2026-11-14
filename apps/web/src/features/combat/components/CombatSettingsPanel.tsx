import { HintTooltip } from '@/shared/components'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import type {
  CombatTask,
  CopilotRaid,
  CopilotSetExecutionMode,
  FormationMode,
} from '../types'
import type { AdvancedValues } from '../model/combatCommands'
import CombatAdvancedFields from './CombatAdvancedFields'
import CombatSegmentedControl, { type CombatSegmentedOption } from './CombatSegmentedControl'

interface CombatSettingsPanelProps {
  task: CombatTask
  formationMode: FormationMode
  raid: CopilotRaid
  setExecutionMode: CopilotSetExecutionMode
  advanced: AdvancedValues
  onFormationChange: (mode: FormationMode) => void
  onRaidChange: (raid: CopilotRaid) => void
  onSetExecutionModeChange: (mode: CopilotSetExecutionMode) => void
  onAdvancedChange: (key: string, value: string | number | boolean) => void
}

const FORMATION_OPTIONS: readonly CombatSegmentedOption<FormationMode>[] = [
  { value: 'auto', label: '自动决定' },
  { value: 'on', label: '自动编队' },
  { value: 'off', label: '保留当前编队' },
]

const RAID_OPTIONS: Array<{ value: CopilotRaid; label: string }> = [
  { value: 'auto', label: '按作业标注' },
  { value: 'normal', label: '普通模式' },
  { value: 'raid', label: '突袭模式' },
  { value: 'both', label: '普通+突袭' },
]

const SET_EXECUTION_MODE_OPTIONS: readonly CombatSegmentedOption<CopilotSetExecutionMode>[] = [
  { value: 'cli', label: '连续执行' },
  { value: 'manual', label: '手动逐关' },
]

export default function CombatSettingsPanel({
  task,
  formationMode,
  raid,
  setExecutionMode,
  advanced,
  onFormationChange,
  onRaidChange,
  onSetExecutionModeChange,
  onAdvancedChange,
}: CombatSettingsPanelProps) {
  return (
    <div className="combat-workspace-section">
      <h5 className="mb-3 flex items-center space-x-2 text-sm font-semibold text-foreground">
        <svg className="w-4 h-4 brand-text" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span>执行设置</span>
      </h5>

      <div className="mb-3">
        <div className="mb-1.5 flex items-center gap-1">
          <span className="text-xs text-muted-foreground">编队</span>
          <HintTooltip
            id="combat-copilot-formation-hint"
            label="编队"
            hint="“自动决定”会在队列执行时启用自动编队，单作业沿用 Maa CLI 的默认设置。"
          />
        </div>
        <CombatSegmentedControl
          ariaLabel="编队"
          value={formationMode}
          options={FORMATION_OPTIONS}
          onChange={onFormationChange}
          fullWidth
        />
      </div>

      <div className="mb-3">
        <label htmlFor="combat-copilot-raid" className="mb-1.5 block text-xs text-muted-foreground">难度</label>
        <Select
          name="maa-copilot-raid"
          items={RAID_OPTIONS}
          value={raid}
          onValueChange={(next, details) => { if (details.reason !== 'none' && next !== null) onRaidChange(next as CopilotRaid) }}
        >
          <SelectTrigger id="combat-copilot-raid" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RAID_OPTIONS.map(item => (
              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-1">
          <span className="text-xs text-muted-foreground">执行方式</span>
          <HintTooltip
            id="combat-copilot-set-mode-hint"
            label="执行方式"
            hint="连续执行会自动开始下一项。手动逐关需要在每个执行步骤后确认。"
          />
        </div>
        <CombatSegmentedControl
          ariaLabel="执行方式"
          value={setExecutionMode === 'app' ? 'cli' : setExecutionMode}
          options={SET_EXECUTION_MODE_OPTIONS}
          onChange={onSetExecutionModeChange}
          fullWidth
        />
      </div>

      {task.hasAdvanced && (
        <details className="combat-advanced-disclosure mt-4">
          <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-medium text-muted-foreground">
            高级设置
          </summary>
          <CombatAdvancedFields
            taskId={task.id}
            advanced={advanced}
            onChange={onAdvancedChange}
          />
        </details>
      )}
    </div>
  )
}
