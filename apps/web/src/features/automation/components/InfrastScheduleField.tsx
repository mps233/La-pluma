import { useState } from 'react'
import { FileJson } from 'lucide-react'
import { NumberField } from '@/shared/components'
import { Button } from '@/shared/ui/button'
import { FieldDescription, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
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
        <FieldLabel htmlFor={filenameId} className="text-muted-foreground">排班文件</FieldLabel>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Input
            id={filenameId}
            type="text"
            autoComplete="off"
            value={filename}
            placeholder="schedules/base.json"
            onChange={event => onChange('filename', event.target.value)}
            disabled={disabled}
            className="min-w-0 flex-1"
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
        <FieldLabel htmlFor={planId} className="text-muted-foreground">方案序号</FieldLabel>
        <NumberField
          id={planId}
          label="方案序号"
          value={planIndex === '' ? '' : normalizeInfrastPlanIndex(planIndex)}
          onValueChange={value => onChange('plan_index', normalizeInfrastPlanIndex(value))}
          min={0}
          disabled={disabled}
          autoComplete="off"
          className="min-w-0"
          controlsClassName="hidden workbench:flex"
        />
      </div>

      <FieldDescription className="text-xs leading-5">
        排班文件位于 MAA 配置目录的 infrast 文件夹，相对路径与 maa-cli 解析 filename 的规则一致。
        路径留空或文件不存在时，可在编辑器中新建并保存；方案序号从 0 开始，超出方案数会导致执行失败。
      </FieldDescription>

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
