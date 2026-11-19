import { Checkbox } from '@/shared/ui/checkbox'
import AutomationAdvancedSettings from './AutomationAdvancedSettings'
import type { TaskFlowItem, TaskParamKey, TaskParamValue } from '../types'

interface InfrastAdvancedSettingsProps {
  task: TaskFlowItem
  taskIndex: number
  disabled: boolean
  onUpdateParam: (taskIndex: number, key: TaskParamKey, value: TaskParamValue) => void
}

export default function InfrastAdvancedSettings({
  task,
  taskIndex,
  disabled,
  onUpdateParam,
}: InfrastAdvancedSettingsProps) {
  return (
    <AutomationAdvancedSettings>
        {Array.isArray(task.params.facility) && task.params.facility.includes('Dorm') && (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">宿舍</h4>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <Checkbox
                checked={Boolean(task.params.dorm_notstationed_enabled)}
                onCheckedChange={(checked) => onUpdateParam(taskIndex, 'dorm_notstationed_enabled', checked)}
                disabled={disabled}
              />
              使用“未进驻”筛选
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <Checkbox
                checked={Boolean(task.params.dorm_trust_enabled)}
                onCheckedChange={(checked) => onUpdateParam(taskIndex, 'dorm_trust_enabled', checked)}
                disabled={disabled}
              />
              空位补入未满信赖干员
            </label>
          </section>
        )}

        {Array.isArray(task.params.facility) && task.params.facility.includes('Reception') && (
          <section className="space-y-2 border-t border-border pt-3">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">会客室</h4>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <Checkbox
                checked={Boolean(task.params.reception_message_board)}
                onCheckedChange={(checked) => onUpdateParam(taskIndex, 'reception_message_board', checked)}
                disabled={disabled}
              />
              领取信息板信用
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <Checkbox
                checked={Boolean(task.params.reception_clue_exchange)}
                onCheckedChange={(checked) => onUpdateParam(taskIndex, 'reception_clue_exchange', checked)}
                disabled={disabled}
              />
              发起线索交流
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <Checkbox
                checked={Boolean(task.params.reception_send_clue)}
                onCheckedChange={(checked) => onUpdateParam(taskIndex, 'reception_send_clue', checked)}
                disabled={disabled}
              />
              自动赠送线索
            </label>
          </section>
        )}

        {Array.isArray(task.params.facility) && task.params.facility.includes('Training') && (
          <section className="space-y-2 border-t border-border pt-3">
            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">训练室</h4>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <Checkbox
                checked={Boolean(task.params.continue_training)}
                onCheckedChange={(checked) => onUpdateParam(taskIndex, 'continue_training', checked)}
                disabled={disabled}
              />
              完成后继续专精
            </label>
          </section>
        )}
    </AutomationAdvancedSettings>
  )
}
