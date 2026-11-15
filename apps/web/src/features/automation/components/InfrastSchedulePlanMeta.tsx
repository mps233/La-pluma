import { Button } from '@/shared/ui/button'
import { FieldInput, FieldSelect } from './InfrastScheduleFieldControls'
import {
  addInfrastPlan,
  normalizeInfrastPlanIndex,
  removeInfrastPlan,
  updateInfrastDocumentMeta,
  updateInfrastPlanMeta,
} from '../model/infrastScheduleEditing'
import {
  getInfrastPlanLabel,
  type InfrastPlan,
  type InfrastScheduleDocument,
} from '../model/infrastSchedule'
import InfrastScheduleRoomsEditor from './InfrastScheduleRoomsEditor'

interface InfrastSchedulePlanMetaProps {
  editorId: string
  document: InfrastScheduleDocument
  plan: InfrastPlan
  planIndex: number
  saving: boolean
  onDocumentChange: (document: InfrastScheduleDocument) => void
  onPlanIndexChange: (index: number) => void
  onPlanChange: (updater: (plan: InfrastPlan) => InfrastPlan) => void
}

export default function InfrastSchedulePlanMeta({
  editorId,
  document,
  plan,
  planIndex,
  saving,
  onDocumentChange,
  onPlanIndexChange,
  onPlanChange,
}: InfrastSchedulePlanMetaProps) {
  const addPlan = () => {
    const added = addInfrastPlan(document)
    onDocumentChange(added.document)
    onPlanIndexChange(added.index)
  }

  const removePlan = () => {
    const removed = removeInfrastPlan(document, planIndex)
    onDocumentChange(removed.document)
    onPlanIndexChange(removed.index)
  }

  return (
    <>
      <section className="space-y-3 border-t border-border pt-4">
        <div className="grid min-w-0 gap-3.5 @sm:grid-cols-2">
          <FieldInput
            id={`${editorId}-document-title`}
            label="排班表标题"
            value={typeof document.title === 'string' ? document.title : ''}
            placeholder="可选"
            disabled={saving}
            onChange={event => onDocumentChange(updateInfrastDocumentMeta(document, { title: event.target.value }))}
          />
          <FieldInput
            id={`${editorId}-document-description`}
            label="排班表说明"
            value={typeof document.description === 'string' ? document.description : ''}
            placeholder="可选"
            disabled={saving}
            onChange={event => onDocumentChange(updateInfrastDocumentMeta(document, { description: event.target.value }))}
          />
        </div>
      </section>

      <section className="space-y-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-end gap-2">
          <FieldSelect
            id={`${editorId}-plan-index`}
            label="方案"
            className="min-w-0 flex-1"
            value={String(planIndex)}
            items={document.plans.map((current, index) => ({ value: String(index), label: getInfrastPlanLabel(current, index) }))}
            disabled={saving}
            onValueChange={value => onPlanIndexChange(normalizeInfrastPlanIndex(value, document.plans.length))}
          />
          <Button variant="secondary" disabled={saving} onClick={addPlan}>
            添加方案
          </Button>
          <Button variant="secondary" disabled={saving || document.plans.length <= 1} onClick={removePlan}>
            删除方案
          </Button>
        </div>
        <div className="grid min-w-0 gap-3.5 @sm:grid-cols-2">
          <FieldInput
            id={`${editorId}-plan-name`}
            label="方案名称"
            value={typeof plan.name === 'string' ? plan.name : ''}
            placeholder="例如：早班"
            disabled={saving}
            onChange={event => onPlanChange(current => updateInfrastPlanMeta(current, { name: event.target.value }))}
          />
          <FieldInput
            id={`${editorId}-plan-description`}
            label="方案说明"
            value={typeof plan.description === 'string' ? plan.description : ''}
            placeholder="可选"
            disabled={saving}
            onChange={event => onPlanChange(current => updateInfrastPlanMeta(current, { description: event.target.value }))}
          />
        </div>
      </section>

      <section className="space-y-2 border-t border-border pt-4">
        <h4 className="text-sm font-semibold text-foreground">房间</h4>
        <InfrastScheduleRoomsEditor
          plan={plan}
          disabled={saving}
          onChange={next => onPlanChange(() => next)}
        />
        <p className="text-xs leading-5 text-muted-foreground">
          无人机、菲亚梅塔、干员编组、时间段与其他扩展字段不在本编辑器内，保存时原样保留。
        </p>
      </section>
    </>
  )
}
