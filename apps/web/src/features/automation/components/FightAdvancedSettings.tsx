import { FieldHint } from '@/shared/components'
import { Checkbox } from '@/shared/ui/checkbox'
import { Input } from '@/shared/ui/input'
import AutomationAdvancedSettings from './AutomationAdvancedSettings'
import AutomationSelectField from './AutomationSelectField'
import type { TaskFlowItem, TaskParamKey, TaskParamValue } from '../types'

interface FightAdvancedSettingsProps {
  task: TaskFlowItem
  taskIndex: number
  disabled: boolean
  onUpdateParam: (taskIndex: number, key: TaskParamKey, value: TaskParamValue) => void
}

export default function FightAdvancedSettings({
  task,
  taskIndex,
  disabled,
  onUpdateParam,
}: FightAdvancedSettingsProps) {
  return (
    <AutomationAdvancedSettings>
        <div className="flex items-center gap-2">
          <span className="flex w-24 shrink-0 items-center gap-1">
            <label htmlFor={`${task.id}-fight-client-type`} className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">闪退重启:</label>
            <FieldHint id={`${task.id}-fight-client-type-hint`} label="闪退重启" hint="选择客户端后，游戏闪退时会自动重新启动。" />
          </span>
          <AutomationSelectField
            id={`${task.id}-fight-client-type`}
            className="w-full min-w-0 flex-1"
            items={[
              { value: '', label: '不启用' },
              { value: 'Official', label: '官服' },
              { value: 'Bilibili', label: 'B服' },
              { value: 'YoStarEN', label: '美服' },
              { value: 'YoStarJP', label: '日服' },
              { value: 'YoStarKR', label: '韩服' },
              { value: 'Txwy', label: '繁中服' },
            ]}
            value={task.params.clientType || ''}
            disabled={disabled}
            onValueChange={(value) => onUpdateParam(taskIndex, 'clientType', value)}
          />
        </div>

        <div className="flex items-center gap-1">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <Checkbox
              checked={Boolean(task.params.DrGrandet)}
              onCheckedChange={(checked) => onUpdateParam(taskIndex, 'DrGrandet', checked)}
              disabled={disabled}
            />
            <span>葛朗台碎石模式</span>
          </label>
          <FieldHint id={`${task.id}-dr-grandet-hint`} label="葛朗台碎石模式" hint="使用源石前等待自然恢复 1 点理智，尽量减少碎石浪费。" />
        </div>

        <section className="space-y-2 border-t border-border pt-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <Checkbox
              checked={Boolean(task.params.report_to_penguin)}
              onCheckedChange={(checked) => onUpdateParam(taskIndex, 'report_to_penguin', checked)}
              disabled={disabled}
            />
            汇报掉落至企鹅物流
          </label>
          {task.params.report_to_penguin && (
            <div className="flex items-center gap-2 pl-6">
              <label htmlFor={`${task.id}-penguin-id`} className="w-20 shrink-0 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">用户 ID:</label>
              <Input
                id={`${task.id}-penguin-id`}
                type="text"
                autoComplete="off"
                value={task.params.penguin_id || ''}
                onChange={(e) => onUpdateParam(taskIndex, 'penguin_id', e.target.value)}
                placeholder="留空则匿名汇报"
                disabled={disabled}
                className="min-w-0 flex-1"
              />
            </div>
          )}
        </section>

        <section className="space-y-2 border-t border-border pt-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <Checkbox
              checked={Boolean(task.params.report_to_yituliu)}
              onCheckedChange={(checked) => onUpdateParam(taskIndex, 'report_to_yituliu', checked)}
              disabled={disabled}
            />
            汇报掉落至一图流
          </label>
          {task.params.report_to_yituliu && (
            <div className="flex items-center gap-2 pl-6">
              <label htmlFor={`${task.id}-yituliu-id`} className="w-20 shrink-0 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">用户 ID:</label>
              <Input
                id={`${task.id}-yituliu-id`}
                type="text"
                autoComplete="off"
                value={task.params.yituliu_id || ''}
                onChange={(e) => onUpdateParam(taskIndex, 'yituliu_id', e.target.value)}
                placeholder="留空则匿名汇报"
                disabled={disabled}
                className="min-w-0 flex-1"
              />
            </div>
          )}
        </section>
    </AutomationAdvancedSettings>
  )
}
