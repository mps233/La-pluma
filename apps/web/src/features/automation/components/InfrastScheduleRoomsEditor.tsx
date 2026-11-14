import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { FieldFlagCheckbox, FieldInput, FieldSelect } from './InfrastScheduleFieldControls'
import {
  INFRASTRUCT_MANUFACTURE_PRODUCTS,
  INFRASTRUCT_SCHEDULE_FACILITIES,
  INFRASTRUCT_TRADING_PRODUCTS,
  getInfrastFacilityLabel,
  getInfrastFacilityState,
  getInfrastRoomState,
  readInfrastFacilityRooms,
  type InfrastFacilityKey,
  type InfrastFacilityState,
  type InfrastPlan,
  type InfrastRoom,
  type InfrastRoomState,
} from '../model/infrastSchedule'
import {
  appendInfrastFacilityRoom,
  formatInfrastOperatorText,
  parseInfrastOperatorText,
  removeInfrastFacilityRoom,
  setInfrastFacilityState,
  setInfrastRoomFlag,
  setInfrastRoomOperators,
  setInfrastRoomProduct,
  setInfrastRoomState,
  updateInfrastFacilityRoom,
} from '../model/infrastScheduleEditing'

interface InfrastScheduleRoomsEditorProps {
  plan: InfrastPlan
  disabled: boolean
  onChange: (plan: InfrastPlan) => void
}

const facilityStateOptions = [
  { value: 'default', label: '未配置（默认换班）' },
  { value: 'keep', label: '整个设施保持原样' },
  { value: 'rooms', label: '按房间编辑' },
]

const roomStateOptions = [
  { value: 'shift', label: '更换干员' },
  { value: 'keep', label: '保持干员' },
  { value: 'skip', label: '跳过' },
]

const facilityStateLabels: Record<InfrastFacilityState, string> = {
  default: '默认换班',
  keep: '保持原样',
  rooms: '按房间配置',
}

const roomStateHints: Record<InfrastRoomState, string> = {
  shift: '填写干员后生效；全部留空时 Core 视为保持干员，不会清空房间。',
  keep: '不更换干员，保持当前进驻；产物、排序等房间字段仍按配置处理。',
  skip: '跳过该房间的换人、换产物与排序；无人机和设施级操作照常。',
}

function productOptions(facility: InfrastFacilityKey) {
  if (facility === 'manufacture') return [...INFRASTRUCT_MANUFACTURE_PRODUCTS]
  if (facility === 'trading') return [...INFRASTRUCT_TRADING_PRODUCTS]
  return []
}

interface RoomEditorProps {
  facility: InfrastFacilityKey
  index: number
  room: InfrastRoom
  disabled: boolean
  onChange: (room: InfrastRoom) => void
  onRemove: () => void
}

function RoomEditor({ facility, index, room, disabled, onChange, onRemove }: RoomEditorProps) {
  const state = getInfrastRoomState(room, facility)
  const isTraining = facility === 'training'
  const products = productOptions(facility)
  const currentProduct = typeof room.product === 'string' ? room.product : ''
  const productChoices = currentProduct && !products.some(product => product === currentProduct)
    ? [currentProduct, ...products]
    : products

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">房间 {index + 1}</span>
        <Button
          size="icon"
          variant="ghost"
          title={`删除${getInfrastFacilityLabel(facility)}房间 ${index + 1}`}
          aria-label={`删除${getInfrastFacilityLabel(facility)}房间 ${index + 1}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 size={16} aria-hidden="true" />
        </Button>
      </div>

      <FieldSelect
        id={`${facility}-${index}-state`}
        label="房间处理方式"
        ariaLabel={`${getInfrastFacilityLabel(facility)}房间 ${index + 1}处理方式`}
        items={roomStateOptions}
        value={state}
        disabled={disabled}
        onValueChange={value => onChange(setInfrastRoomState(room, value as InfrastRoomState))}
      />
      <p className="text-xs leading-5 text-muted-foreground">{roomStateHints[state]}</p>

      {state !== 'skip' && isTraining && (
        <>
          <FieldInput
            id={`${facility}-${index}-operators-b`}
            label="训练位干员"
            aria-label={`${getInfrastFacilityLabel(facility)}房间 ${index + 1}训练位干员`}
            value={formatInfrastOperatorText(room.operatorsB)}
            placeholder="银灰"
            hint="按顺序取第一个可进驻的干员；需精二且仍有未专精满级的技能"
            disabled={disabled}
            onChange={event => onChange(setInfrastRoomOperators(room, 'operatorsB', parseInfrastOperatorText(event.target.value)))}
          />
          <FieldInput
            id={`${facility}-${index}-operators-a`}
            label="协助者候选"
            aria-label={`${getInfrastFacilityLabel(facility)}房间 ${index + 1}协助者`}
            value={formatInfrastOperatorText(room.operatorsA)}
            placeholder="杜宾"
            hint="按顺序取第一个可用的协助者；不更换训练位时也可单独配置"
            disabled={disabled}
            onChange={event => onChange(setInfrastRoomOperators(room, 'operatorsA', parseInfrastOperatorText(event.target.value)))}
          />
          <p className="text-xs leading-5 text-muted-foreground">训练室只使用训练位与协助者候选；operators/candidates 等通用字段对训练室无效。</p>
        </>
      )}

      {state !== 'skip' && !isTraining && (
        <>
          <FieldInput
            id={`${facility}-${index}-operators`}
            label="干员"
            aria-label={`${getInfrastFacilityLabel(facility)}房间 ${index + 1}干员`}
            value={formatInfrastOperatorText(room.operators)}
            placeholder="按优先级填写，逗号分隔"
            hint="留空且未启用自动补位时，Core 保持该房间原样"
            disabled={disabled}
            onChange={event => onChange(setInfrastRoomOperators(room, 'operators', parseInfrastOperatorText(event.target.value)))}
          />
          <FieldInput
            id={`${facility}-${index}-candidates`}
            label="备选干员"
            aria-label={`${getInfrastFacilityLabel(facility)}房间 ${index + 1}备选干员`}
            value={formatInfrastOperatorText(room.candidates)}
            placeholder="有谁用谁，选满为止"
            disabled={disabled}
            onChange={event => onChange(setInfrastRoomOperators(room, 'candidates', parseInfrastOperatorText(event.target.value)))}
          />
          <div className="group space-y-1">
            <FieldFlagCheckbox
              label="自动补位"
              checked={room.autofill === true}
              disabled={disabled}
              onCheckedChange={value => onChange(setInfrastRoomFlag(room, 'autofill', value))}
            />
            <FieldFlagCheckbox
              label="按填写顺序排序"
              checked={room.sort === true}
              disabled={disabled}
              onCheckedChange={value => onChange(setInfrastRoomFlag(room, 'sort', value))}
            />
          </div>
          {products.length > 0 && (
            <FieldSelect
              id={`${facility}-${index}-product`}
              label="产物"
              ariaLabel={`${getInfrastFacilityLabel(facility)}房间 ${index + 1}产物`}
              items={[
                { value: '', label: '不指定' },
                ...productChoices.map(product => ({ value: product, label: product })),
              ]}
              value={typeof room.product === 'string' ? room.product : ''}
              disabled={disabled}
              onValueChange={value => onChange(setInfrastRoomProduct(room, value))}
            />
          )}
        </>
      )}

      {room.use_operator_groups === true && (
        <p className="text-xs leading-5 text-muted-foreground">
          该房间引用了干员编组（use_operator_groups），编组定义不在本编辑器中；保存时原样保留，干员名称会按编组名解释。
        </p>
      )}
    </div>
  )
}

export default function InfrastScheduleRoomsEditor({ plan, disabled, onChange }: InfrastScheduleRoomsEditorProps) {
  return (
    <div className="space-y-2">
      {INFRASTRUCT_SCHEDULE_FACILITIES.map(facility => {
        const state = getInfrastFacilityState(plan, facility.key)
        const rooms = readInfrastFacilityRooms(plan, facility.key)
        return (
          <details key={facility.key} className="group rounded-lg border border-border px-3 py-2">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3.5 text-sm font-medium text-foreground marker:hidden [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <ChevronDown size={15} strokeWidth={2} className="transition-transform group-open:rotate-180" aria-hidden="true" />
                {facility.label}
              </span>
              <span className="text-xs text-muted-foreground">
                {facilityStateLabels[state]}{state === 'rooms' ? ` · ${rooms.length} 间` : ''}
              </span>
            </summary>

            <div className="mt-3 space-y-3 border-t border-border pt-3">
              <FieldSelect
                id={`${facility.key}-facility-state`}
                label="设施处理方式"
                ariaLabel={`${facility.label}设施处理方式`}
                items={facilityStateOptions}
                value={state}
                disabled={disabled}
                onValueChange={value => onChange(setInfrastFacilityState(plan, facility.key, value as InfrastFacilityState))}
              />

              {state === 'default' && (
                <p className="text-xs leading-5 text-muted-foreground">未配置该设施，MAA 使用默认算法换班。</p>
              )}
              {state === 'keep' && (
                <p className="text-xs leading-5 text-muted-foreground">
                  整个设施保持原样，不换人也不换产物；会客室线索、训练室继续训练等设施级操作照常执行。
                </p>
              )}
              {state === 'rooms' && (
                <>
                  {rooms.map((room, index) => (
                    <RoomEditor
                      key={index}
                      facility={facility.key}
                      index={index}
                      room={room}
                      disabled={disabled}
                      onChange={next => onChange(updateInfrastFacilityRoom(plan, facility.key, index, next))}
                      onRemove={() => onChange(removeInfrastFacilityRoom(plan, facility.key, index))}
                    />
                  ))}
                  {rooms.length === 0 && (
                    <p className="text-xs leading-5 text-muted-foreground">添加房间后按序号生效；数组短于实际房间数时，剩余房间保持原样。</p>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onChange(appendInfrastFacilityRoom(plan, facility.key))}
                  >
                    <Plus size={15} aria-hidden="true" />
                    添加房间
                  </Button>
                </>
              )}
            </div>
          </details>
        )
      })}
    </div>
  )
}
