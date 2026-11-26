import { useMemo, useState, type UIEvent } from 'react'
import { getOperatorAvatarUrl, useItemIconCacheVersion } from '@/features/game-data'
import { DialogBody, DialogFrame, EmptyState, InlineAlert, Loading, SearchField } from '@/shared/components'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Field, FieldLabel } from '@/shared/ui/field'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/shared/ui/item'
import {
  filterOperatorOptions,
  normalizeOperatorSelection,
  orderOperatorFilterOptions,
  type OperatorFilterOption,
  type OperatorFilterSection,
  type OperatorSelection,
} from '../model/operatorFilter'

export interface CombatCopilotOperatorFilterDialogProps {
  isOpen: boolean
  selection: OperatorSelection
  enabled: boolean
  remember: boolean
  operators: readonly OperatorFilterOption[]
  operatorsLoading: boolean
  operatorsError: string | null
  onRetryData: () => void
  onConfirm: (selection: OperatorSelection, remember: boolean) => void
  onClose: () => void
}

const OPERATOR_RENDER_BATCH = 40
const OPERATOR_SCROLL_EDGE = 32

interface OperatorSectionProps {
  title: string
  addLabel: string
  hint: string
  section: OperatorFilterSection
  selected: readonly string[]
  options: readonly OperatorFilterOption[]
  iconVersion: number
  onAdd: (option: OperatorFilterOption) => void
  onRemove: (name: string) => void
}

function OperatorSection({
  title,
  addLabel,
  hint,
  section,
  selected,
  options,
  iconVersion,
  onAdd,
  onRemove,
}: OperatorSectionProps) {
  const [term, setTerm] = useState('')
  const [limit, setLimit] = useState(OPERATOR_RENDER_BATCH)

  const ordered = useMemo(() => orderOperatorFilterOptions(options, section), [options, section])
  const filtered = useMemo(() => filterOperatorOptions(ordered, term), [ordered, term])
  const visible = filtered.slice(0, limit)

  const handleTermChange = (value: string) => {
    setTerm(value)
    setLimit(OPERATOR_RENDER_BATCH)
  }

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const list = event.currentTarget
    if (list.scrollHeight - list.scrollTop - list.clientHeight > OPERATOR_SCROLL_EDGE) return
    setLimit(current => Math.min(current + OPERATOR_RENDER_BATCH, filtered.length))
  }

  return (
    <section className="combat-copilot-operator-section" aria-label={title}>
      <div className="combat-copilot-operator-section-heading">
        <span className="combat-copilot-operator-section-title">{title}</span>
        <span className="combat-copilot-operator-section-count">{selected.length} 名</span>
      </div>
      <p className="combat-copilot-operator-hint">{hint}</p>

      {selected.length > 0 && (
        <div className="combat-copilot-operator-chips">
          {selected.map(name => (
            <Button
              key={name}
              type="button"
              variant="ghost"
              size="xs"
              className="combat-copilot-operator-chip"
              aria-label={`移除 ${name}`}
              onClick={() => onRemove(name)}
            >
              {name}
              <span aria-hidden="true">×</span>
            </Button>
          ))}
        </div>
      )}

      <SearchField
        ariaLabel={`搜索${title}`}
        placeholder="搜索干员名称或拼音"
        value={term}
        onValueChange={handleTermChange}
        onClear={() => setLimit(OPERATOR_RENDER_BATCH)}
        clearable
        clearLabel={`清除${title}搜索`}
      />

      {filtered.length === 0 ? (
        <EmptyState
          compact
          title={selected.length > 0 ? '没有其他符合条件的干员' : '没有符合条件的干员'}
          description="换个名称或拼音再试。"
        />
      ) : (
        <div className="combat-copilot-operator-options" onScroll={handleScroll}>
          {visible.map(option => (
            <Item
              key={option.id}
              render={(
                <button
                  type="button"
                  aria-label={`${addLabel} ${option.name}`}
                  onClick={() => onAdd(option)}
                />
              )}
              size="xs"
              variant="outline"
              className="combat-copilot-operator-option text-left hover:bg-muted"
            >
              <ItemMedia>
                <img
                  className="combat-copilot-operator-avatar"
                  src={getOperatorAvatarUrl(option.id, 'base', iconVersion)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              </ItemMedia>
              <ItemContent className="min-w-0 gap-0">
                <ItemTitle className="w-full text-xs">{option.name}</ItemTitle>
                <ItemDescription className="text-[0.6875rem]">
                  {option.rarity ? `${option.rarity}★` : '未知稀有度'}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge
                  variant="secondary"
                  className={`bg-transparent${option.owned ? ' text-success-text' : ' text-tertiary'}`}
                >
                  {option.owned ? '已拥有' : '未拥有'}
                </Badge>
              </ItemActions>
            </Item>
          ))}
        </div>
      )}
    </section>
  )
}

function OperatorFilterForm({
  selection,
  enabled,
  remember: initialRemember,
  operators,
  operatorsLoading,
  operatorsError,
  onRetryData,
  onConfirm,
  onClose,
}: Omit<CombatCopilotOperatorFilterDialogProps, 'isOpen'>) {
  const [included, setIncluded] = useState<readonly string[]>(() => normalizeOperatorSelection(selection).included)
  const [excluded, setExcluded] = useState<readonly string[]>(() => normalizeOperatorSelection(selection).excluded)
  const [remember, setRemember] = useState(initialRemember)
  const iconVersion = useItemIconCacheVersion()

  const available = useMemo(
    () => operators.filter(operator => !included.includes(operator.name) && !excluded.includes(operator.name)),
    [operators, included, excluded],
  )

  const addIncluded = (option: OperatorFilterOption) => {
    setExcluded(current => current.filter(name => name !== option.name))
    setIncluded(current => (current.includes(option.name) ? current : [...current, option.name]))
  }

  const addExcluded = (option: OperatorFilterOption) => {
    setIncluded(current => current.filter(name => name !== option.name))
    setExcluded(current => (current.includes(option.name) ? current : [...current, option.name]))
  }

  const removeIncluded = (name: string) => setIncluded(current => current.filter(entry => entry !== name))
  const removeExcluded = (name: string) => setExcluded(current => current.filter(entry => entry !== name))

  const handleConfirm = () => {
    onConfirm(normalizeOperatorSelection({ included, excluded }), remember)
    onClose()
  }

  if (operatorsLoading) {
    return <Loading size="sm" text="干员数据加载中…" />
  }

  if (operatorsError) {
    return (
      <InlineAlert title="干员数据读取失败" onRetry={onRetryData}>
        {operatorsError}
      </InlineAlert>
    )
  }

  return (
    <div className="combat-copilot-operator-filter">
      {!enabled && (
        <InlineAlert tone="info">
          干员筛选已停用，本次搜索不会使用包含/排除条件；已选干员仍会保留。
        </InlineAlert>
      )}

      {operators.length === 0 ? (
        <EmptyState compact title="没有可用的干员数据" description="识别持有干员后可以按干员筛选作业。" />
      ) : (
        <>
          <OperatorSection
            title="包含干员"
            addLabel="加入包含"
            hint="作业包含任一这些干员即可。"
            section="included"
            selected={included}
            options={available}
            iconVersion={iconVersion}
            onAdd={addIncluded}
            onRemove={removeIncluded}
          />
          <OperatorSection
            title="排除干员"
            addLabel="加入排除"
            hint="包含这些干员的作业不会出现在结果里。"
            section="excluded"
            selected={excluded}
            options={available}
            iconVersion={iconVersion}
            onAdd={addExcluded}
            onRemove={removeExcluded}
          />
        </>
      )}

      <Field orientation="horizontal" className="min-h-11 gap-2">
        <Checkbox
          id="combat-copilot-operator-remember"
          checked={remember}
          onCheckedChange={setRemember}
        />
        <FieldLabel
          htmlFor="combat-copilot-operator-remember"
          className="cursor-pointer text-sm font-normal text-muted-foreground"
        >
          记住筛选结果
        </FieldLabel>
      </Field>

      <div className="combat-copilot-operator-actions">
        <span className="combat-copilot-operator-summary">
          包含 {included.length} · 排除 {excluded.length}
        </span>
        <div className="combat-copilot-operator-action-buttons">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={handleConfirm}>确认筛选</Button>
        </div>
      </div>
    </div>
  )
}

export default function CombatCopilotOperatorFilterDialog({
  isOpen,
  onClose,
  ...props
}: CombatCopilotOperatorFilterDialogProps) {
  return (
    <DialogFrame
      open={isOpen}
      onOpenChange={open => { if (!open) onClose() }}
      title="筛选干员"
      size="4xl"
    >
      <DialogBody>
        {isOpen && <OperatorFilterForm {...props} onClose={onClose} />}
      </DialogBody>
    </DialogFrame>
  )
}
