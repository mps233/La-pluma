import { useState } from 'react'
import { FileJson } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { normalizeInfrastPlanIndex } from '../model/infrastScheduleEditing'
import InfrastScheduleEditor from './InfrastScheduleEditor'

interface InfrastScheduleFieldProps {
  fieldId: string
  filename: string
  planIndex: number | string
  disabled: boolean
  onChange: (key: 'filename' | 'plan_index', value: string | number) => void
}

export default function InfrastScheduleField({
  fieldId,
  filename,
  planIndex,
  disabled,
  onChange,
}: InfrastScheduleFieldProps) {
  const [isOpen, setIsOpen] = useState(false)
  const filenameId = `${fieldId}-filename`
  const planId = `${fieldId}-plan-index`

  return (
    <div className="space-y-3">
      <div className="automation-field-row">
        <label htmlFor={filenameId} className="automation-field-label">排班文件</label>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            id={filenameId}
            type="text"
            autoComplete="off"
            value={filename}
            placeholder="schedules/base.json"
            onChange={event => onChange('filename', event.target.value)}
            disabled={disabled}
            className="automation-text-control min-w-0 flex-1"
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => setIsOpen(true)}
          >
            <FileJson size={15} aria-hidden="true" />
            编辑排班
          </Button>
        </div>
      </div>

      <div className="automation-field-row">
        <label htmlFor={planId} className="automation-field-label">方案序号</label>
        <div className="number-input-wrapper flex-1">
          <input
            id={planId}
            type="number"
            min={0}
            value={planIndex === '' ? '' : normalizeInfrastPlanIndex(planIndex)}
            onChange={event => onChange('plan_index', normalizeInfrastPlanIndex(event.target.value))}
            disabled={disabled}
            className="automation-number-control"
          />
        </div>
      </div>

      <p className="text-xs leading-5 text-muted-foreground">
        排班文件位于 MAA 配置目录的 infrast 文件夹，相对路径与 maa-cli 解析 filename 的规则一致。
        路径留空或文件不存在时，可在编辑器中新建并保存；方案序号从 0 开始，超出方案数会导致执行失败。
      </p>

      {isOpen && (
        <InfrastScheduleEditor
          filename={filename}
          initialPlanIndex={normalizeInfrastPlanIndex(planIndex)}
          onClose={() => setIsOpen(false)}
          onSaved={target => {
            onChange('filename', target.filename)
            onChange('plan_index', target.planIndex)
            setIsOpen(false)
          }}
        />
      )}
    </div>
  )
}
