import { useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2, UserRound, UserRoundSearch, X } from 'lucide-react'
import {
  getOperatorAvatarUrl,
  operatorCatalogQueryOptions,
  useItemIconCacheVersion,
  type OperatorDetailed,
} from '@/features/game-data'
import { OperatorSelectModal, type OperatorPickerOption } from '@/features/training'
import { Button } from '@/shared/ui/button'
import { Field, FieldDescription, FieldLegend, FieldLabel } from '@/shared/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import {
  OPER_PROGRESS_ROLES,
  resolveOperProgressRole,
  updateOperProgressMastery,
  updateOperProgressTarget,
} from '../model/gameTaskParams'
import { resolveOperProgressOperatorId } from '../model/operProgressOperator'
import type { OperProgressPlan } from '../types'

interface OperProgressPlansEditorProps {
  plans: OperProgressPlan[]
  disabled: boolean
  onChange: (plans: OperProgressPlan[]) => void
}

const eliteOptions = [
  { value: '', label: '不提升精英阶段' },
  { value: '1', label: '精英一' },
  { value: '2', label: '精英二' },
]
const skillOptions = [
  { value: '', label: '不提升技能等级' },
  ...[2, 3, 4, 5, 6, 7].map(level => ({ value: String(level), label: `${level} 级` })),
]
const masteryOptions = [
  { value: '0', label: '不专精' },
  ...[1, 2, 3].map(level => ({ value: String(level), label: `专精 ${level}` })),
]

const roleLabel = (role: string | undefined): string | null => {
  if (!role || role === 'Unknown') return null
  return OPER_PROGRESS_ROLES.find(option => option.value === role)?.label ?? null
}

const EMPTY_OPERATORS: readonly OperatorDetailed[] = []

interface PlanSelectProps {
  id: string
  label: string
  ariaLabel: string
  items: ReadonlyArray<{ value: string; label: string }>
  value: string
  disabled?: boolean
  onValueChange: (value: string) => void
}

function PlanSelect({ id, label, ariaLabel, items, value, disabled, onValueChange }: PlanSelectProps) {
  return (
    <Field className="min-w-0" data-disabled={disabled || undefined}>
      <FieldLabel htmlFor={id} className="text-muted-foreground">{label}</FieldLabel>
      <Select items={items} value={value} onValueChange={(next, details) => { if (details.reason === 'none' || next === null) return; onValueChange(next) }} disabled={disabled}>
        <SelectTrigger id={id} aria-label={ariaLabel} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map(item => (
            <SelectItem key={String(item.value)} value={item.value}>{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

interface PlanOperatorAvatarProps {
  operatorId: string | null
}

function PlanOperatorAvatar({ operatorId }: PlanOperatorAvatarProps) {
  const itemIconVersion = useItemIconCacheVersion()
  const [failedOperatorId, setFailedOperatorId] = useState<string | null>(null)
  const imageSrc = operatorId && operatorId !== failedOperatorId
    ? getOperatorAvatarUrl(operatorId, 'base', itemIconVersion)
    : null

  return (
    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl surface-soft text-tertiary" aria-hidden="true">
      <UserRound size={20} strokeWidth={1.8} />
      {imageSrc && (
        <img
          src={imageSrc}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailedOperatorId(operatorId)}
        />
      )}
    </span>
  )
}

export default function OperProgressPlansEditor({ plans, disabled, onChange }: OperProgressPlansEditorProps) {
  const [pickerPlanIndex, setPickerPlanIndex] = useState<number | null>(null)
  const editorId = useId().replace(/:/g, '')
  const catalogQuery = useQuery({
    ...operatorCatalogQueryOptions(),
    enabled: plans.some(plan => plan.name.trim() !== ''),
  })
  const planOperatorIds = useMemo(
    () => plans.map(plan => resolveOperProgressOperatorId(catalogQuery.data ?? EMPTY_OPERATORS, plan)),
    [catalogQuery.data, plans],
  )

  const updatePlan = (index: number, plan: OperProgressPlan) => {
    onChange(plans.map((current, currentIndex) => currentIndex === index ? plan : current))
  }

  const clearOperator = (index: number) => {
    const plan = plans[index]
    if (!plan) return
    updatePlan(index, { ...plan, role: 'Unknown', name: '' })
  }

  const selectOperator = (operator: OperatorPickerOption) => {
    if (pickerPlanIndex === null) return
    const plan = plans[pickerPlanIndex]
    if (!plan) return
    updatePlan(pickerPlanIndex, {
      ...plan,
      role: resolveOperProgressRole(operator.profession),
      name: operator.name,
    })
  }

  return (
    <div className="@container space-y-3.5">
      <FieldDescription className="text-xs leading-5">在游戏内提升干员，按精英阶段、技能等级、专精的顺序处理。执行会消耗已有资源，可能自动合成材料或用采购凭证购买芯片助剂；专精会占用训练室。每轮执行最多启动一项专精训练，其余专精目标留待后续执行。</FieldDescription>
      {plans.length === 0 && <FieldDescription>添加干员并选择培养目标。</FieldDescription>}
      {plans.map((plan, index) => {
        const professionLabel = plan.name ? roleLabel(plan.role) : null
        return (
          <fieldset key={index} disabled={disabled} className="min-w-0 space-y-3 border-t border-border pt-3">
            <FieldLegend variant="label" className="mb-0 px-1 font-semibold">培养计划 {index + 1}</FieldLegend>
            <div className="flex min-w-0 flex-wrap items-center gap-3.5">
              <PlanOperatorAvatar operatorId={planOperatorIds[index] ?? null} />
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-semibold ${plan.name ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {plan.name || '未选择干员'}
                </p>
                {professionLabel && <p className="text-xs text-muted-foreground">{professionLabel}</p>}
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={() => setPickerPlanIndex(index)}
              >
                <UserRoundSearch size={15} strokeWidth={1.9} aria-hidden="true" />
                {plan.name ? '更换干员' : '选择干员'}
              </Button>
              {plan.name && (
                <Button
                  size="icon"
                  variant="ghost"
                  title={`清除培养计划 ${index + 1} 的干员`}
                  aria-label={`清除培养计划 ${index + 1} 的干员`}
                  disabled={disabled}
                  onClick={() => clearOperator(index)}
                >
                  <X size={16} aria-hidden="true" />
                </Button>
              )}
              <Button size="icon" variant="ghost" title={`删除培养计划 ${index + 1}`} aria-label={`删除培养计划 ${index + 1}`} disabled={disabled} onClick={() => onChange(plans.filter((_, current) => current !== index))}>
                <Trash2 size={16} aria-hidden="true" />
              </Button>
            </div>
            <div className="grid min-w-0 gap-3.5 @sm:grid-cols-2">
              <PlanSelect
                id={`${editorId}-elite-${index}`}
                label="精英目标"
                ariaLabel={`培养计划 ${index + 1} 精英目标`}
                items={eliteOptions}
                value={plan.elite === undefined ? '' : String(plan.elite)}
                disabled={disabled}
                onValueChange={value => updatePlan(index, updateOperProgressTarget(plan, 'elite', String(value)))}
              />
              <PlanSelect
                id={`${editorId}-skill-level-${index}`}
                label="技能等级"
                ariaLabel={`培养计划 ${index + 1} 技能等级`}
                items={skillOptions}
                value={plan.skill_level === undefined ? '' : String(plan.skill_level)}
                disabled={disabled}
                onValueChange={value => updatePlan(index, updateOperProgressTarget(plan, 'skill_level', String(value)))}
              />
            </div>
            <div className="grid min-w-0 gap-3.5 @sm:grid-cols-2 @md:grid-cols-3">
              {[0, 1, 2].map(skill => (
                <PlanSelect
                  key={skill}
                  id={`${editorId}-mastery-${index}-${skill}`}
                  label={`技能 ${skill + 1} 专精`}
                  ariaLabel={`培养计划 ${index + 1} 技能 ${skill + 1} 专精`}
                  items={masteryOptions}
                  value={String(plan.skill_mastery?.[skill] ?? 0)}
                  disabled={disabled}
                  onValueChange={value => updatePlan(index, updateOperProgressMastery(plan, skill, String(value)))}
                />
              ))}
            </div>
          </fieldset>
        )
      })}
      <Button variant="secondary" disabled={disabled} onClick={() => onChange([...plans, { role: 'Unknown', name: '' }])}>
        <Plus size={16} aria-hidden="true" />
        添加培养计划
      </Button>
      <FieldDescription className="text-xs leading-5">只处理明确选择的目标。专精可能先启动前置等级，实际结果以执行详情为准。</FieldDescription>
      <OperatorSelectModal
        isOpen={pickerPlanIndex !== null}
        onClose={() => setPickerPlanIndex(null)}
        onConfirm={selectOperator}
        selectedOperatorId={pickerPlanIndex === null ? null : planOperatorIds[pickerPlanIndex] ?? null}
        selectedOperatorName={pickerPlanIndex === null ? null : plans[pickerPlanIndex]?.name || null}
        defaultSortDirection="asc"
      />
    </div>
  )
}
