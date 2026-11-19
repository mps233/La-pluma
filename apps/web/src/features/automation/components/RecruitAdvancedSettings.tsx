import { FieldHint } from '@/shared/components'
import { Input } from '@/shared/ui/input'
import AutomationAdvancedSettings from './AutomationAdvancedSettings'
import AutomationSelectField from './AutomationSelectField'
import {
  RECRUITMENT_TIME_MAX,
  RECRUITMENT_TIME_MIN,
  RECRUITMENT_TIME_STEP,
  normalizeRecruitmentTime,
} from '../model/taskParamRules'
import type { TaskFlowItem, TaskParamKey, TaskParamValue } from '../types'

interface RecruitAdvancedSettingsProps {
  task: TaskFlowItem
  taskIndex: number
  disabled: boolean
  onUpdateParam: (taskIndex: number, key: TaskParamKey, value: TaskParamValue) => void
}

export default function RecruitAdvancedSettings({
  task,
  taskIndex,
  disabled,
  onUpdateParam,
}: RecruitAdvancedSettingsProps) {
  return (
    <AutomationAdvancedSettings>
        <div className="flex items-center gap-2">
          <span className="flex w-32 shrink-0 items-center gap-1">
            <label htmlFor={`${task.id}-extra-tags-mode`} className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">多选 Tag 策略:</label>
            <FieldHint
              id={`${task.id}-extra-tags-mode-hint`}
              label="多选 Tag 策略"
              hint="默认行为只选能组成有效组合的 Tag；“选 3 个 Tags”会尽量凑满 3 个；“尽量多选高星 Tag 组合”优先保留高星组合，可能包含冲突标签。"
            />
          </span>
          <AutomationSelectField
            id={`${task.id}-extra-tags-mode`}
            className="w-full min-w-0 flex-1"
            items={[
              { value: '0', label: '默认行为' },
              { value: '1', label: '选 3 个 Tags' },
              { value: '2', label: '尽量多选高星 Tag 组合' },
            ]}
            value={String(task.params.extra_tags_mode ?? 0)}
            disabled={disabled}
            onValueChange={(value) => onUpdateParam(taskIndex, 'extra_tags_mode', Number(value))}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="flex w-32 shrink-0 items-center gap-1">
            <label htmlFor={`${task.id}-first-tags`} className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">三星首选:</label>
            <FieldHint
              id={`${task.id}-first-tags-hint`}
              label="三星首选"
              hint="仅在三星组合中优先选择，多个标签用逗号分隔。"
            />
          </span>
          <Input
            id={`${task.id}-first-tags`}
            type="text"
            autoComplete="off"
            value={Array.isArray(task.params.first_tags) ? task.params.first_tags.join(',') : (task.params.first_tags || '')}
            onChange={(e) => onUpdateParam(taskIndex, 'first_tags', e.target.value)}
            placeholder="近卫干员,治疗"
            disabled={disabled}
            className="min-w-0 flex-1"
          />
        </div>

        <fieldset>
          <legend className="mb-2 block text-sm text-gray-600 dark:text-gray-400">
            <span className="inline-flex items-center gap-1">
              招募时长:
              <FieldHint
                id={`${task.id}-recruitment-time-hint`}
                label="招募时长"
                hint="可设置 60 至 540 分钟，按 10 分钟调整；五星和六星固定为 540 分钟。"
              />
            </span>
          </legend>
          <div className="automation-recruitment-time-list">
            {[3, 4].map(star => {
              const key = String(star)
              const recruitmentTimeId = `${task.id}-recruitment-time-${star}`
              const recruitmentTime = task.params.recruitment_time || { '3': 540, '4': 540 }
              return (
                <label key={star} htmlFor={recruitmentTimeId} className="automation-recruitment-time-row">
                  <span className="shrink-0 text-sm font-medium text-gray-700 dark:text-gray-200">{star} 星</span>
                  <Input
                    id={recruitmentTimeId}
                    type="number"
                    autoComplete="off"
                    value={recruitmentTime[key] ?? 540}
                    onChange={(e) => onUpdateParam(taskIndex, 'recruitment_time', { ...recruitmentTime, [key]: e.target.value })}
                    onBlur={(e) => onUpdateParam(taskIndex, 'recruitment_time', {
                      ...recruitmentTime,
                      [key]: normalizeRecruitmentTime(e.target.value),
                    })}
                    min={RECRUITMENT_TIME_MIN}
                    max={RECRUITMENT_TIME_MAX}
                    step={RECRUITMENT_TIME_STEP}
                    disabled={disabled}
                    className="min-w-0 flex-1 border-0 bg-transparent text-right dark:bg-transparent focus-visible:ring-0"
                  />
                  <span className="shrink-0 text-xs text-gray-400">分钟</span>
                </label>
              )
            })}
          </div>
        </fieldset>
    </AutomationAdvancedSettings>
  )
}
